// Push pipeline. Run by GitHub Actions on a schedule (and locally with
// `npm run pipeline`). Produces public/data/feed.json and public/data/prices.json,
// which the app serves statically — the phone never waits on a scraper.
//
//   1. EOD prices (Yahoo)            → prices.json
//   2. Filings, last N days (BSE)    → raw announcements
//   3. Classify: rules, then cheap-model batch for leftovers
//   4. Score priority, cluster duplicates (results + newspaper ad + deck …)
//   5. Enrich by type: results → headline numbers; management change → bio;
//      other top items → one-liner from the PDF; mid items → one-liner from subject
//   6. Write feed + usage

import fs from "node:fs";
import path from "node:path";
import { PORTFOLIO } from "../src/config/portfolio";
import { setCacheStore, cache } from "../src/lib/cache";
import { llmAvailable, newUsage, MODELS } from "../src/lib/llm";
import { mapLimit, sleep } from "../src/lib/http";
import { pdfText } from "../src/lib/pdf";
import { fetchEod } from "../src/lib/push/prices";
import { attachmentUrls, fetchAnnouncements, istToIso, type BseAnnouncement } from "../src/lib/push/bse";
import { llmClassify, ruleClassify, scorePriority, tierOf } from "../src/lib/push/classify";
import { cardFromScreener, extractResults, reconcile } from "../src/lib/push/results";
import { fetchCompany } from "../src/lib/pull/screener";
import { enrichPerson, extractPeople } from "../src/lib/push/people";
import { batchHeadlineSummaries, filingSummary } from "../src/lib/push/summarize";
import type { Category, Feed, FeedItem, Prices } from "../src/lib/types";
import { fileCache } from "./lib/file-cache";

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 30);
// Free-tier friendly: space model calls out. The cron job isn't in a hurry.
process.env.LLM_MIN_INTERVAL_MS ||= "4500";
const OUT = path.join(process.cwd(), "public", "data");
const store = fileCache(path.join(process.cwd(), "data", "cache.json"));
setCacheStore(store);

const usage = newUsage();
const errors: string[] = [];
const log = (...a: unknown[]) => console.log("[pipeline]", ...a);

async function tryPdf(name: string | null) {
  for (const url of attachmentUrls(name)) {
    try {
      return { url, ...(await pdfText(url, 30)) };
    } catch {
      /* try next location */
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!llmAvailable()) log("WARNING: no GEMINI_API_KEY — classification falls back to rules, no enrichment");

  // 1. Prices
  const prices: Prices = { generatedAt: new Date().toISOString(), series: {} };
  await mapLimit(PORTFOLIO, 4, async (p) => {
    try {
      prices.series[p.symbol] = await fetchEod(p.symbol);
    } catch (e) {
      errors.push(`prices ${p.symbol}: ${(e as Error).message}`);
    }
  });
  log(`prices: ${Object.keys(prices.series).length}/${PORTFOLIO.length}`);
  if (Object.keys(prices.series).length) fs.writeFileSync(path.join(OUT, "prices.json"), JSON.stringify(prices));

  // 2. Announcements
  const to = new Date();
  const from = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const raw: { a: BseAnnouncement; symbol: string; company: string }[] = [];
  for (const p of PORTFOLIO) {
    try {
      const list = await fetchAnnouncements(p.bse, from, to);
      list.forEach((a) => raw.push({ a, symbol: p.symbol, company: p.name }));
      if (list[0]?.SLONGNAME && !similar(list[0].SLONGNAME, p.name))
        errors.push(`check BSE code for ${p.symbol}: BSE says "${list[0].SLONGNAME}"`);
    } catch (e) {
      errors.push(`filings ${p.symbol}: ${(e as Error).message}`);
    }
    await sleep(350);
  }
  log(`filings: ${raw.length}`);

  // 3. Classify
  const textOf = (a: BseAnnouncement) =>
    [a.CATEGORYNAME, a.SUBCATNAME, a.NEWSSUB, a.HEADLINE].filter(Boolean).join(" | ");
  const cats: Record<string, { c: Category; src: "rule" | "llm" }> = {};
  const leftovers: { id: string; text: string }[] = [];
  for (const { a } of raw) {
    const c = ruleClassify(textOf(a));
    if (c) cats[a.NEWSID] = { c, src: "rule" };
    else leftovers.push({ id: a.NEWSID, text: textOf(a) });
  }
  if (leftovers.length && llmAvailable()) {
    const lab = await llmClassify(leftovers, usage);
    for (const [id, c] of Object.entries(lab)) cats[id] = { c, src: "llm" };
  }
  for (const l of leftovers) cats[l.id] ??= { c: "unclassified", src: "rule" };
  log(`classified: ${raw.length - leftovers.length} by rules, ${leftovers.length} by model`);

  // 4. Score + cluster
  let items: FeedItem[] = raw.map(({ a, symbol, company }) => {
    const { c, src } = cats[a.NEWSID];
    const p = scorePriority(c, textOf(a));
    return {
      id: String(a.NEWSID),
      symbol,
      company,
      time: istToIso(a.NEWS_DT || a.DT_TM || ""),
      category: c,
      categorySource: src,
      headline: cleanHeadline(a.NEWSSUB || a.HEADLINE),
      url: attachmentUrls(a.ATTACHMENTNAME)[0],
      priority: p,
      tier: tierOf(p),
    };
  });
  items = cluster(items);
  const byId = new Map(raw.map((r) => [String(r.a.NEWSID), r.a]));

  // 5. Enrich
  if (llmAvailable()) {
    const top = items.filter((i) => i.tier === "top");
    await mapLimit(top, 2, async (it) => {
      const key = `enrich:v3:${it.id}`;
      const cached = await cache.get<Partial<FeedItem>>(key);
      if (cached) {
        usage.cacheHits++;
        Object.assign(it, cached);
        return;
      }
      const a = byId.get(it.id)!;
      const doc = await tryPdf(a.ATTACHMENTNAME);
      const patch: Partial<FeedItem> = {};
      try {
        if (it.category === "results") {
          let card = doc ? await extractResults(doc.text, usage) : null;
          // screener.in's standardised table: a cross-check for extracted numbers,
          // and the fallback when the filing PDF is a scanned image or a cover letter
          const co = await fetchCompany(it.symbol).catch(() => null);
          if (card && co) card = reconcile(card, co.quarters);
          if (!card && co) card = cardFromScreener(co.quarters, co.isLender, co.basis);
          if (card) patch.results = card;
          else patch.summary = "Results filing — the table couldn't be read automatically; open the filing.";
        } else if (it.category === "management_change") {
          const text = doc?.text || `${a.NEWSSUB}\n${a.HEADLINE}`;
          const people = await extractPeople(text, it.company, usage);
          patch.people = await Promise.all(people.map((p) => enrichPerson(p, it.company, usage)));
        } else {
          patch.summary = await filingSummary(it.company, it.headline, doc?.text || a.HEADLINE || "", usage);
        }
        await cache.set(key, patch);
      } catch (e) {
        errors.push(`enrich ${it.symbol} ${it.id}: ${(e as Error).message}`);
      }
      Object.assign(it, patch);
    });

    // A one-liner adds nothing to "Earnings call transcript" — that lives in Research.
    const mid = items.filter((i) => i.tier === "normal" && !i.summary && !["earnings_call", "investor_meetings"].includes(i.category));
    const lines = await batchHeadlineSummaries(
      mid.map((i) => ({ id: i.id, company: i.company, text: `${i.headline} — ${byId.get(i.id)?.HEADLINE || ""}` })),
      usage,
    );
    for (const i of mid) if (lines[i.id]) i.summary = lines[i.id];
  }

  // One results card per company per quarter (a results PDF and a later press
  // release can both carry the numbers): keep the filing-sourced one, fold the other in.
  const keep = new Map<string, FeedItem>();
  const drop = new Set<string>();
  for (const it of items) {
    if (!it.results) continue;
    const k = `${it.symbol}:${it.results.current.label}`;
    const prev = keep.get(k);
    if (!prev) {
      keep.set(k, it);
      continue;
    }
    const [better, worse] = it.results.source === "filing" && prev.results!.source !== "filing" ? [it, prev] : [prev, it];
    (better.related ||= []).push({ id: worse.id, headline: worse.headline, url: worse.url }, ...(worse.related || []));
    keep.set(k, better);
    drop.add(worse.id);
  }
  items = items.filter((it) => !drop.has(it.id));

  // 6. Write
  items.sort((a, b) => b.time.localeCompare(a.time));
  const feed: Feed = {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    portfolio: PORTFOLIO,
    items,
    usage: { ...usage, models: { ...MODELS } },
    errors,
  };
  if (raw.length || !fs.existsSync(path.join(OUT, "feed.json"))) {
    fs.writeFileSync(path.join(OUT, "feed.json"), JSON.stringify(feed));
  } else {
    log("no filings fetched — keeping previous feed.json");
  }
  store.save();
  log(`done: ${items.length} items (${items.filter((i) => i.tier === "top").length} top), ` +
    `${usage.cheapCalls} cheap + ${usage.strongCalls} strong calls, ${usage.cacheHits} cache hits, ~$${usage.estCostUSD}`);
  if (errors.length) log("errors:\n  " + errors.join("\n  "));
}

/** Collapse same-company, same-category filings within 3 days into one item. */
function cluster(items: FeedItem[]): FeedItem[] {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const kept: FeedItem[] = [];
  for (const it of sorted) {
    const host = kept.find(
      (k) =>
        k.symbol === it.symbol &&
        k.category === it.category &&
        it.category !== "unclassified" &&
        Math.abs(Date.parse(k.time) - Date.parse(it.time)) < 3 * 864e5,
    );
    if (host) (host.related ||= []).push({ id: it.id, headline: it.headline, url: it.url });
    else kept.push(it);
  }
  return kept;
}

function cleanHeadline(s: string) {
  return (s || "")
    .replace(/^announcement under regulation 30 \(lodr\)-?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similar(bseName: string, ours: string) {
  const norm = (s: string) => s.toLowerCase().replace(/limited|ltd|\.|&|and|the/g, "").replace(/\s+/g, "");
  const x = norm(bseName),
    y = norm(ours);
  if (x.includes(y.slice(0, 6)) || y.includes(x.slice(0, 6))) return true;
  // acronyms: "Indian Railway Catering and Tourism Corporation" ~ "IRCTC"
  const initials = bseName.split(/\s+/).filter((w) => /^[A-Z]/.test(w) && !/^(Ltd|Limited|And|Of|The)\.?$/i.test(w)).map((w) => w[0]).join("").toLowerCase();
  return initials.length >= 3 && y.startsWith(initials.slice(0, 3));
}

main().catch((e) => {
  console.error(e);
  store.save();
  process.exit(1);
});
