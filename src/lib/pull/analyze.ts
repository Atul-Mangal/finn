// The single reasoning call. The strong model gets only compact, already-
// extracted facts: guidance items with their source quotes, and a table of
// delivered numbers computed in code. It judges; it does not read PDFs or do
// arithmetic, and it is told not to use outside knowledge of the company.

import { llmJson } from "../llm";
import type { Analysis, CompanyBase, Computed, TranscriptExtract, UsageSummary } from "../types";

const SYSTEM = `You are a sceptical buy-side analyst. You judge management against its own words using ONLY the data provided.
Hard rules:
- Do not use any outside knowledge about this company, its sector, news or broker views. If the data cannot settle a question, say "unverifiable".
- Every verdict and every bull/bear point must cite a specific number from the tables or a quote from the transcripts provided.
- Be terse. No adjectives without numbers. Output JSON only.`;

export async function analyze(
  base: Pick<CompanyBase, "name" | "about" | "isLender">,
  computed: Pick<Computed, "qualityTable" | "trajectory" | "balance" | "cash">,
  extracts: TranscriptExtract[],
  usage: UsageSummary,
): Promise<Analysis> {
  const ok = extracts.filter((e) => !e.error);
  // oldest → newest
  const calls = ok
    .map(
      (e, i) =>
        `### Call ${i + 1}: ${e.period}\nTone: ${e.tone}\nGuidance:\n` +
        (e.guidance.length
          ? e.guidance.map((g) => `- [${g.metric}] ${g.statement} | target: ${g.target} | horizon: ${g.horizon} | "${g.quote}"`).join("\n")
          : "- (no explicit guidance)") +
        `\nAnalysts pressed on: ${e.analystConcerns.join("; ")}`,
    )
    .join("\n\n");
  const latest = ok[ok.length - 1];
  const flags = [...computed.trajectory.flags, ...computed.balance.flags, ...computed.cash.flags].map((f) => `- ${f.text}`).join("\n");

  const prompt = `Company: ${base.name}${base.isLender ? " (LENDER — the tables have no margin or asset-quality data; judge on revenue, profit, deposits/borrowings, and say 'unverifiable' for NIM, asset-quality, CD-ratio or loan-growth targets)" : ""}
Business description (from screener): ${base.about || "n/a"}
Segments (latest call): ${latest?.segments.map((s) => `${s.name}: ${s.comment}`).join("; ") || "n/a"}

== EARNINGS CALLS, oldest to newest ==
${calls || "(no transcripts available)"}

== DELIVERED NUMBERS (computed from filings) ==
${computed.qualityTable}

== RULE-BASED FLAGS ==
${flags || "- none"}

Return JSON:
{
 "business": {"summary": "2 sentences: what it does and how it makes money", "segments": [{"name":"","comment":""}]},
 "promises": [ {
    "promise": "what management said would happen, <=20 words",
    "madeIn": "call period, e.g. Q1 FY25",
    "metric": "revenue_growth|margin|capex|volume|other",
    "delivered": "what the numbers show, citing figures from the table, <=25 words",
    "verdict": "delivered|missed|partial|pending|unverifiable",
    "evidence": "the quarters/years compared, e.g. 'Rev YoY Q2-Q4 FY25: 14%, 11%, 9% vs 15-18% guided'"
 } ],
 "scorecard": "one line, e.g. '3 of 5 checkable promises delivered; margin guidance missed twice'",
 "narrativeVsNumbers": [ {"point": "a claim or framing management keeps making", "stance": "agrees|diverges", "evidence": "the numbers that confirm or contradict it"} ],
 "guidanceNow": [ {"metric":"","target":"","horizon":"","quote":"verbatim from the LATEST call"} ],
 "bull": ["3 points, <=25 words each, each citing a number or quote"],
 "bear": ["3 points, <=25 words each, each citing a number or quote"]
}
Promises: take guidance from the OLDER calls whose horizon has (at least partly) passed, and check it against later delivered numbers.
"delivered"/"missed"/"partial" require evidence from the DELIVERED NUMBERS tables. If the only evidence is management's own later statement on a call, verdict is "unverifiable" and "delivered" starts with "Per management (Qx):". Up to 8, most material first. Use "pending" if the horizon hasn't arrived, "unverifiable" if the tables can't measure it (e.g. segment-level targets).
narrativeVsNumbers: 3–5 points. guidanceNow: up to 6 items from the latest call.`;

  const r = await llmJson<Analysis>("strong", { system: SYSTEM, prompt, maxOutputTokens: 8000, temperature: 0.2 }, usage);
  return {
    business: r.business || { summary: "", segments: [] },
    promises: (r.promises || []).slice(0, 8),
    scorecard: r.scorecard || "",
    narrativeVsNumbers: (r.narrativeVsNumbers || []).slice(0, 5),
    guidanceNow: (r.guidanceNow || []).slice(0, 6),
    bull: (r.bull || []).slice(0, 3),
    bear: (r.bear || []).slice(0, 3),
  };
}
