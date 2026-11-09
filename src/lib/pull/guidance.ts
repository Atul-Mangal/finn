// Transcript → structured guidance (cheap model, one call per transcript,
// cached forever per URL: a transcript never changes once filed).

import { cache } from "../cache";
import { llmJson } from "../llm";
import { pdfText } from "../pdf";
import type { DocLink, TranscriptExtract, UsageSummary } from "../types";

const SYSTEM =
  "You extract management's forward-looking statements from Indian listed-company earnings-call transcripts. " +
  "Use only the transcript. Quote verbatim. Never infer guidance that was not stated. Output JSON only.";

function prompt(callMonth: string, text: string) {
  return `Earnings call held around ${callMonth}.
Return JSON:
{
 "period": "the results quarter discussed, e.g. Q1 FY26 (read it from the transcript)",
 "guidance": [ {
   "metric": "revenue_growth|volume|margin|capex|debt|market_share|launch|other",
   "statement": "plain-English paraphrase, <=20 words",
   "target": "the number or range, e.g. '18-20%' or 'double-digit' or '₹500 Cr'",
   "horizon": "e.g. FY26, next 2 years, H2 FY26",
   "quote": "verbatim, <=35 words",
   "speaker": "name/designation if given"
 } ],
 "segments": [ {"name": "segment / business line", "comment": "share of revenue or growth as stated, <=15 words"} ],
 "tone": "one line on management's tone (confident / cautious / defensive) and why",
 "analystConcerns": ["top 3 themes analysts pressed on, <=12 words each"]
}
Rules: guidance = MANAGEMENT's forward expectations (not analysts' questions, not past results).
Be thorough: scan the opening remarks AND every answer in the Q&A. Include every statement about future
revenue/volume growth, margin bands, capex, debt, pricing, market share, launches or capacity with a number,
a range or a clear direction ("double-digit growth", "margins in the 20–24% band", "capex of ₹800 Cr next year").
Management often answers guidance questions in Q&A — those count. 5–10 items is typical for a full call.

--- TRANSCRIPT ---
${text}`;
}

/** Trim operator boilerplate and safe-harbour text to save tokens. */
function compact(text: string): string {
  let t = text;
  const start = t.search(/(ladies and gentlemen|good (morning|afternoon|evening)|welcome to the)/i);
  if (start > 0 && start < 6000) t = t.slice(start);
  return t.slice(0, 90000);
}

export async function extractTranscript(doc: DocLink, usage: UsageSummary): Promise<TranscriptExtract> {
  const key = `tx:v2:${doc.url}`;
  const hit = await cache.get<TranscriptExtract>(key);
  if (hit) {
    usage.cacheHits++;
    return hit;
  }
  const base: TranscriptExtract = { period: doc.period, url: doc.url, guidance: [], segments: [], tone: "", analystConcerns: [] };
  let text: string;
  try {
    text = (await pdfText(doc.url, 45)).text;
  } catch (e) {
    return { ...base, error: `Could not read transcript: ${(e as Error).message}` };
  }
  if (text.length < 2000) return { ...base, error: "Transcript PDF has no extractable text (scanned?)" };

  const r = await llmJson<Omit<TranscriptExtract, "url">>(
    "cheap",
    { system: SYSTEM, prompt: prompt(doc.period, compact(text)), maxOutputTokens: 3000 },
    usage,
  );
  const out: TranscriptExtract = {
    period: r.period || doc.period,
    url: doc.url,
    guidance: (r.guidance || []).slice(0, 10),
    segments: (r.segments || []).slice(0, 8),
    tone: r.tone || "",
    analystConcerns: (r.analystConcerns || []).slice(0, 3),
  };
  await cache.set(key, out, 60 * 60 * 24 * 180);
  return out;
}
