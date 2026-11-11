// Precompute research for the demo set so the demo opens instantly.
// Any other ticker is researched live in the app.
//   npm run prefetch               → RESEARCH_DEMO
//   npm run prefetch -- TCS INFY   → specific tickers
import fs from "node:fs";
import path from "node:path";
import { RESEARCH_DEMO } from "../src/config/portfolio";
import { setCacheStore } from "../src/lib/cache";
import { runResearch } from "../src/lib/pull/run";
import { scoreLine } from "../src/lib/format";
import { fileCache } from "./lib/file-cache";
import { saveWorkingModels } from "./lib/models-file";

// Separate cache file from the hourly pipeline so the two jobs never conflict.
const store = fileCache(path.join(process.cwd(), "data", "research-cache.json"));
setCacheStore(store);
const OUT = path.join(process.cwd(), "public", "data", "research");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const symbols = process.argv.slice(2).length ? process.argv.slice(2) : RESEARCH_DEMO;
  const index: { symbol: string; name: string; generatedAt: string; scorecard?: string }[] = [];
  for (const s of symbols) {
    try {
      const r = await runResearch(s);
      fs.writeFileSync(path.join(OUT, `${r.base.symbol}.json`), JSON.stringify(r));
      index.push({ symbol: r.base.symbol, name: r.base.name, generatedAt: r.generatedAt, scorecard: r.analysis ? scoreLine(r.analysis.promises) : undefined });
      if (r.analysisError) console.log(`[prefetch] ${s}: judgment step failed: ${r.analysisError}`);
      console.log(`[prefetch] ${s}: ${r.extracts.length} transcripts, ${r.usage.cheapCalls}+${r.usage.strongCalls} calls, $${r.usage.estCostUSD}`);
    } catch (e) {
      console.error(`[prefetch] ${s} failed: ${(e as Error).message}`);
    }
    store.save();
  }
  const idxFile = path.join(OUT, "index.json");
  let prev: typeof index = [];
  try { prev = JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch {}
  const merged = [...index, ...prev.filter((p) => p.symbol !== "SAMPLECO" && !index.some((i) => i.symbol === p.symbol))];
  fs.writeFileSync(idxFile, JSON.stringify(merged, null, 1));
  saveWorkingModels();
}
main();
