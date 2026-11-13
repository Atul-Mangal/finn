// End-to-end research run (used by the prefetch script; the app runs the same
// three stages through separate API routes so each fits a serverless timeout
// and the UI can show progress).

import { llmAvailable, mergeUsage, newUsage } from "../llm";
import { mapLimit } from "../http";
import { fetchCompany } from "./screener";
import { compute } from "./metrics";
import { extractTranscript } from "./guidance";
import { analyze } from "./analyze";
import { netWorthOf, scanAnnualReport } from "./annual";
import type { Research } from "../types";

export const TRANSCRIPTS_TO_READ = 5; // last 4 quarters + the one before, so the oldest promises can be checked

export async function runResearch(symbol: string): Promise<Research> {
  const usage = newUsage();
  const base = await fetchCompany(symbol);
  const computed = compute(base);
  let extracts: Research["extracts"] = [];
  let analysis: Research["analysis"] = null;
  let analysisError: string | undefined;
  if (llmAvailable()) {
    const docs = base.transcripts.slice(0, TRANSCRIPTS_TO_READ).reverse(); // screener lists newest first
    extracts = await mapLimit(docs, 2, async (d) => {
      const u = newUsage();
      const x = await extractTranscript(d, u);
      Object.assign(usage, mergeUsage(usage, u));
      return x;
    });
    try {
      analysis = await analyze(base, computed, extracts, usage);
    } catch (e) {
      // keep the report: numbers and transcript extracts are still worth showing
      analysisError = (e as Error).message;
    }
  }
  // Latest annual report: auditor's opinion, contingent liabilities, related parties.
  let annual: Research["annual"] = null;
  if (llmAvailable() && base.annualReports[0]) {
    annual = await scanAnnualReport(base.annualReports[0], netWorthOf(base), usage).catch((e: Error) => {
      console.log(`[annual] ${base.symbol}: ${e.message}`);
      return null;
    });
  }
  return { base, computed, extracts, analysis, analysisError, annual, usage, generatedAt: new Date().toISOString() };
}
