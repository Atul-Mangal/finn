// One-line "why it matters" summaries.
//
// Judgment on spend: routine items get nothing (they're collapsed anyway).
// Mid-priority items get a one-liner from the subject line, 20 per call.
// High-priority items without a bespoke card (M&A, fund raise, litigation,
// capex, ratings…) get the filing's first pages read for the actual numbers.

import { llmJson } from "../llm";
import type { UsageSummary } from "../types";

const SYSTEM =
  "You are an equity analyst's assistant. Write one plain-English line (max 22 words) saying what happened and why an investor should care. " +
  "Include concrete numbers (₹ amounts, %, ratings, dates) when present. No hype, no advice. Output JSON only.";

export async function batchHeadlineSummaries(
  items: { id: string; company: string; text: string }[],
  usage: UsageSummary,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    try {
      const r = await llmJson<{ lines: Record<string, string> }>(
        "cheap",
        {
          system: SYSTEM,
          prompt:
            `Return {"lines": {"<id>": "<one line>"}}. If the subject alone says nothing material, return "".\n\n` +
            batch.map((b) => `${b.id} | ${b.company} | ${b.text.slice(0, 400)}`).join("\n"),
          maxOutputTokens: 2500,
        },
        usage,
      );
      Object.assign(out, r.lines || {});
    } catch {
      /* summaries are optional */
    }
  }
  return out;
}

export async function filingSummary(company: string, headline: string, text: string, usage: UsageSummary): Promise<string> {
  const r = await llmJson<{ line: string }>(
    "cheap",
    {
      system: SYSTEM,
      prompt: `Company: ${company}\nSubject: ${headline}\n\nReturn {"line": "..."}.\n\n--- FILING (first pages) ---\n${text.slice(0, 9000)}`,
      maxOutputTokens: 300,
    },
    usage,
  );
  return r.line || "";
}
