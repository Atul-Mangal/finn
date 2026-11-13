// Annual-report red-flag scan.
//
// An annual report is 300–500 pages; reading all of it with a model would cost
// more than everything else FINN does combined. An analyst doesn't read it
// cover to cover either — they go to three places first: the auditor's
// opinion, contingent liabilities, and related-party transactions.
//
// So: extract every page's text locally (free), pick the handful of pages that
// carry those three sections by keyword, and send only those (~7 pages) to the
// cheap model in one call. Unit conversion and "% of net worth" are computed
// in code. Cached forever per report URL.

import { cache } from "../cache";
import { llmJson } from "../llm";
import { pdfPages } from "../pdf";
import type { AnnualScan, CompanyBase, DocLink, Flag, UsageSummary } from "../types";

const count = (t: string, re: RegExp) => (t.match(re) || []).length;
const digits = (t: string) => count(t, /\d/g);

/** Notes pages carry a running header naming the statement they belong to. */
const basisWeight = (t: string) => (/consolidated/.test(t) ? 1.6 : /standalone|separate financial/.test(t) ? 0.6 : 1);

/** Choose the pages worth reading. Exported for tests. */
export function pickPages(pages: string[]): { auditor: number[]; contingent: number[]; related: number[] } {
  const lower = pages.map((p) => p.toLowerCase());
  const top = (score: (t: string) => number, n: number) =>
    lower
      .map((t, i) => ({ i, s: score(t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, n)
      .map((x) => x.i)
      .sort((a, b) => a - b);
  return {
    // the opinion page(s) of the auditor's report, plus any page with a modified opinion
    auditor: top(
      (t) =>
        (/independent auditor/.test(t) && /opinion/.test(t) ? 3 + count(t, /opinion/g) : 0) +
        5 * count(t, /basis for (qualified|adverse|disclaimer)|qualified opinion|adverse opinion|disclaimer of opinion/g) +
        4 * count(t, /emphasis of matter|material uncertainty related to going concern/g) +
        (/key audit matters?/.test(t) && /independent auditor|how our audit addressed|auditor.s response/.test(t) ? 2 : 0),
      3,
    ),
    // the note with the numbers, not the accounting-policy paragraph; consolidated over standalone
    contingent: top((t) => (digits(t) > 120 ? basisWeight(t) * (3 * count(t, /contingent liabilit/g) + 4 * count(t, /not acknowledged as debts?/g) + count(t, /disputed|guarantees? given/g)) : 0), 2),
    related: top((t) => (digits(t) > 150 && count(t, /related part(y|ies)/g) >= 2 ? basisWeight(t) * (count(t, /related part(y|ies)/g) + 2 * count(t, /key manage(rial|ment) personnel/g)) : 0), 2),
  };
}

function toCrore(amount: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (/crore|\bcr\b/.test(u)) return amount;
  if (/lakh|lac/.test(u)) return amount / 100;
  if (/million|\bmn\b/.test(u)) return amount / 10;
  if (/billion|\bbn\b/.test(u)) return amount * 100;
  return null; // unit not printed on the page: don't guess
}

interface Raw {
  auditor?: { opinion?: string; emphasisOfMatter?: string; keyAuditMatters?: string[] };
  contingentLiabilities?: { found?: boolean; basis?: string; totalAmount?: number | null; unit?: string; largest?: string[] };
  relatedParty?: { notable?: string[] };
}

const SYSTEM =
  "You read pages from an Indian listed company's annual report. Report ONLY what is printed on these pages. " +
  "Never infer, never use outside knowledge, never compute. If something is not on the pages, say so. Output JSON only.";

export function netWorthOf(b: Pick<CompanyBase, "balance">): number | null {
  const n = b.balance.headers.length;
  const eq = b.balance.rows["equity"]?.[n - 1],
    res = b.balance.rows["reserves"]?.[n - 1];
  return eq == null && res == null ? null : (eq ?? 0) + (res ?? 0);
}

export interface AnnualContext {
  netWorthCr: number | null;
  isLender: boolean;
  basis: "consolidated" | "standalone"; // the basis of the net-worth figure
}

export async function scanAnnualReport(doc: DocLink, ctx: AnnualContext, usage: UsageSummary): Promise<AnnualScan> {
  const { netWorthCr } = ctx;
  const key = `ar:v2:${doc.url}`;
  const hit = await cache.get<AnnualScan>(key);
  if (hit) {
    usage.cacheHits++;
    return hit;
  }
  const empty: AnnualScan = {
    period: doc.period, url: doc.url, pages: 0, pagesRead: 0,
    auditor: { opinion: "not_found", emphasis: "", keyMatters: [] }, contingent: null, relatedParty: [], flags: [],
  };
  let pages: string[];
  try {
    pages = await pdfPages(doc.url);
  } catch (e) {
    return { ...empty, error: `Could not read the annual report: ${(e as Error).message}` };
  }
  if (pages.join("").length < 20000) return { ...empty, pages: pages.length, error: "The annual report PDF has no extractable text (scanned)" };

  const pick = pickPages(pages);
  const chosen = [...new Set([...pick.auditor, ...pick.contingent, ...pick.related])].sort((a, b) => a - b);
  if (!chosen.length) return { ...empty, pages: pages.length, error: "Auditor's report and notes not found in the PDF text" };

  const body = chosen.map((i) => `=== PAGE ${i + 1} ===\n${pages[i].slice(0, 5500)}`).join("\n\n");
  const raw = await llmJson<Raw>(
    "cheap",
    {
      system: SYSTEM,
      prompt: `Annual report ${doc.period}. Pages selected: auditor's report, contingent liabilities, related-party note.
Return JSON in exactly this shape (no comments):
{
 "auditor": {"opinion": "unmodified|qualified|adverse|disclaimer|not_found", "emphasisOfMatter": "", "keyAuditMatters": [""]},
 "contingentLiabilities": {"found": true, "basis": "consolidated|standalone|unclear", "totalAmount": 0, "unit": "", "largest": [""]},
 "relatedParty": {"notable": [""]}
}
Rules:
- opinion: "unmodified" means a clean 'true and fair view' opinion with no 'Basis for Qualified Opinion'.
- emphasisOfMatter: <=30 words on what the auditor draws attention to, or "".
- keyAuditMatters: <=10 words each, max 3.
- contingentLiabilities.basis: which statement that page belongs to, from its header.
- totalAmount: the printed total for the latest year as a number, or null; if no total is printed, the largest single item.
- unit: the unit printed on that page, e.g. "Rs crore", "Rs lakh", "Rs million", or "not stated".
- largest: max 3, each "<item>: <amount as printed, with the unit>".
- relatedParty.notable: max 3, <=22 words each: the largest or most unusual transactions with promoter/KMP-linked entities, with amounts as printed including the unit.
Prefer the CONSOLIDATED statements when both appear.

${body}`,
      maxOutputTokens: 1500,
    },
    usage,
  );

  const op = raw.auditor?.opinion || "not_found";
  const opinion = (["unmodified", "qualified", "adverse", "disclaimer"].includes(op) ? op : "not_found") as AnnualScan["auditor"]["opinion"];
  const emphasis = (raw.auditor?.emphasisOfMatter || "").trim();
  const cl = raw.contingentLiabilities;
  let contingent: AnnualScan["contingent"] = null;
  if (cl?.found && cl.totalAmount != null && isFinite(cl.totalAmount)) {
    const cr = toCrore(cl.totalAmount, cl.unit || "");
    const basis = (["consolidated", "standalone"].includes(cl.basis || "") ? cl.basis : "unclear") as "consolidated" | "standalone" | "unclear";
    // A ratio only means something when numerator and denominator come from the same
    // statement, and never for a lender (its "contingent liabilities" are mostly the
    // notional value of forex and derivative contracts).
    const comparable = !ctx.isLender && basis === ctx.basis;
    const pct = comparable && cr != null && netWorthCr && netWorthCr > 0 ? (cr / netWorthCr) * 100 : null;
    contingent = {
      basis,
      printed: `${cl.totalAmount.toLocaleString("en-IN")} ${cl.unit && !/not stated/i.test(cl.unit) ? cl.unit.replace(/^rs\.?\s*/i, "₹ ") : "(unit not stated on the page)"}`,
      amountCr: cr == null ? null : Math.round(cr),
      // an absurd ratio means a misread unit: show the printed figure, make no claim
      pctNetWorth: pct != null && pct < 300 ? Math.round(pct * 10) / 10 : null,
      largest: (cl.largest || []).slice(0, 3),
    };
  }

  const flags: Flag[] = [];
  if (opinion === "unmodified") flags.push({ text: "Auditor's opinion is clean (unmodified)", tone: "good" });
  else if (opinion === "not_found") flags.push({ text: "Auditor's opinion not found in the pages scanned — open the report", tone: "neutral" });
  else flags.push({ text: `Auditor's opinion is ${opinion}`, tone: "bad" });
  if (emphasis) flags.push({ text: `Auditor draws attention to: ${emphasis}`, tone: "neutral" });
  if (contingent?.pctNetWorth != null)
    flags.push(
      contingent.pctNetWorth > 25
        ? { text: `Contingent liabilities are ${contingent.pctNetWorth}% of net worth — large enough to matter if they crystallise`, tone: "bad" }
        : { text: `Contingent liabilities are ${contingent.pctNetWorth}% of net worth`, tone: "neutral" },
    );
  else if (contingent && ctx.isLender)
    flags.push({ text: "For a bank, contingent liabilities are mostly the notional value of forex and derivative contracts — not a like-for-like risk measure", tone: "neutral" });
  else if (contingent && contingent.basis !== ctx.basis)
    flags.push({
      text: `Contingent-liabilities figure is from the ${contingent.basis === "unclear" ? "notes (statement unclear)" : contingent.basis + " accounts"}, so it isn't compared with ${ctx.basis} net worth${/subsidiar/i.test(contingent.largest.join(" ")) ? "; guarantees for its own subsidiaries are already in group debt" : ""}`,
      tone: "neutral",
    });

  const out: AnnualScan = {
    period: doc.period,
    url: doc.url,
    pages: pages.length,
    pagesRead: chosen.length,
    auditor: { opinion, emphasis, keyMatters: (raw.auditor?.keyAuditMatters || []).slice(0, 3) },
    contingent,
    relatedParty: (raw.relatedParty?.notable || []).slice(0, 3),
    flags,
  };
  await cache.set(key, out, 60 * 60 * 24 * 365);
  return out;
}
