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
    // the note with the numbers, not the accounting-policy paragraph
    contingent: top((t) => (digits(t) > 120 ? 3 * count(t, /contingent liabilit/g) + 4 * count(t, /not acknowledged as debts?/g) + count(t, /disputed|guarantees? given/g) : 0), 2),
    related: top((t) => (digits(t) > 150 && count(t, /related part(y|ies)/g) >= 2 ? count(t, /related part(y|ies)/g) + 2 * count(t, /key manage(rial|ment) personnel/g) : 0), 2),
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
  contingentLiabilities?: { found?: boolean; totalAmount?: number | null; unit?: string; largest?: string[] };
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

export async function scanAnnualReport(doc: DocLink, netWorthCr: number | null, usage: UsageSummary): Promise<AnnualScan> {
  const key = `ar:v1:${doc.url}`;
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
Return JSON:
{
 "auditor": {
   "opinion": "unmodified|qualified|adverse|disclaimer|not_found",   // unmodified = a clean 'true and fair view' opinion with no 'Basis for Qualified Opinion'
   "emphasisOfMatter": "<=30 words on what the auditor draws attention to, or ''",
   "keyAuditMatters": ["<=10 words each, max 3"]
 },
 "contingentLiabilities": {
   "found": true|false,
   "totalAmount": number|null,        // the printed total for the latest year; if no total is printed, the largest single item
   "unit": "the unit printed on that page, e.g. 'Rs crore', 'Rs lakh', 'Rs million', or 'not stated'",
   "largest": ["<item>: <amount as printed>", max 3]
 },
 "relatedParty": {"notable": ["<=22 words each, max 3: the largest or most unusual transactions with promoter/KMP-linked entities, with amounts as printed"]}
}
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
    const pct = cr != null && netWorthCr && netWorthCr > 0 ? (cr / netWorthCr) * 100 : null;
    contingent = {
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
