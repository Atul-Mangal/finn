// Model router.
//
// Two tiers, picked per task rather than per app:
//   cheap  — bulk, schema-shaped work: classifying headlines, pulling numbers out
//            of a results PDF, extracting guidance from a transcript.
//   strong — the one place reasoning matters: judging promises vs delivery and
//            writing the bull/bear case from already-extracted facts.
//
// Every call is cached on (model, system, prompt), and usage is counted so the
// UI can show what a feed or a research run actually cost.
//
// Providers: Gemini (default, free tier) or any OpenAI-compatible endpoint
// (Groq, OpenRouter, a local Ollama) via LLM_PROVIDER=openai.

import { cache, hashKey } from "./cache";
import { fetchWithRetry, sleep } from "./http";
import type { UsageSummary } from "./types";

export type ModelTier = "cheap" | "strong";

const PROVIDER = process.env.LLM_PROVIDER || "gemini";
export const MODELS = {
  cheap: process.env.CHEAP_MODEL || (PROVIDER === "gemini" ? "gemini-2.5-flash-lite" : "llama-3.1-8b-instant"),
  strong: process.env.STRONG_MODEL || (PROVIDER === "gemini" ? "gemini-2.5-flash" : "llama-3.3-70b-versatile"),
};

// List prices, USD per 1M tokens (input, output). Used only for the cost readout.
const PRICE: Record<string, [number, number]> = {
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-2.5-pro": [1.25, 10],
};

export function newUsage(): UsageSummary {
  return {
    cheapCalls: 0,
    strongCalls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    estCostUSD: 0,
    models: { ...MODELS },
  };
}

export function mergeUsage(a: UsageSummary, b: UsageSummary): UsageSummary {
  return {
    cheapCalls: a.cheapCalls + b.cheapCalls,
    strongCalls: a.strongCalls + b.strongCalls,
    cacheHits: a.cacheHits + b.cacheHits,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estCostUSD: +(a.estCostUSD + b.estCostUSD).toFixed(5),
    models: a.models,
  };
}

export function llmAvailable(): boolean {
  return PROVIDER === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.OPENAI_API_KEY;
}

interface CallOpts {
  system: string;
  prompt: string;
  json?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
}

export async function llm(tier: ModelTier, opts: CallOpts, usage: UsageSummary): Promise<string> {
  const model = MODELS[tier];
  const key = `llm:${model}:${hashKey(opts.system + "\u0000" + opts.prompt)}`;
  const hit = await cache.get<string>(key);
  if (hit !== undefined) {
    usage.cacheHits++;
    return hit;
  }
  if (!llmAvailable()) throw new Error("No LLM API key configured (GEMINI_API_KEY)");

  const { text, inTok, outTok } =
    PROVIDER === "gemini" ? await callGemini(model, tier, opts) : await callOpenAI(model, opts);

  if (tier === "cheap") usage.cheapCalls++;
  else usage.strongCalls++;
  usage.inputTokens += inTok;
  usage.outputTokens += outTok;
  const [pi, po] = PRICE[model] || [0, 0];
  usage.estCostUSD = +(usage.estCostUSD + (inTok * pi + outTok * po) / 1e6).toFixed(5);

  await cache.set(key, text);
  return text;
}

/** Call and parse JSON, retrying once with a nudge if the model returns junk. */
export async function llmJson<T>(tier: ModelTier, opts: CallOpts, usage: UsageSummary): Promise<T> {
  const raw = await llm(tier, { ...opts, json: true }, usage);
  try {
    return parseJsonLoose<T>(raw);
  } catch {
    const retry = await llm(
      tier,
      { ...opts, json: true, prompt: opts.prompt + "\n\nReturn ONLY valid JSON. No prose, no code fences." },
      usage,
    );
    return parseJsonLoose<T>(retry);
  }
}

export function parseJsonLoose<T>(raw: string): T {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const first = Math.min(...["{", "["].map((c) => (s.indexOf(c) === -1 ? Infinity : s.indexOf(c))));
  if (first > 0 && first !== Infinity) s = s.slice(first);
  return JSON.parse(s) as T;
}

async function callGemini(model: string, tier: ModelTier, o: CallOpts) {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      temperature: o.temperature ?? (tier === "cheap" ? 0 : 0.3),
      maxOutputTokens: o.maxOutputTokens ?? 4096,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
      // Extraction doesn't need thinking tokens; reasoning tier keeps its default.
      ...(tier === "cheap" && model.includes("flash") && !model.includes("lite")
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: JSON.stringify(body),
      },
      { retries: 0, timeoutMs: 90000 },
    );
    if (res.status === 429 || res.status === 503) {
      // free tier: back off and try again
      await sleep(4000 * (attempt + 1));
      continue;
    }
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      error?: { message: string };
    };
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${j.error?.message || "error"}`);
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const u = j.usageMetadata || {};
    return {
      text,
      inTok: u.promptTokenCount || 0,
      outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    };
  }
  throw new Error("Gemini rate-limited after retries");
}

async function callOpenAI(model: string, o: CallOpts) {
  const base = process.env.OPENAI_BASE_URL || "https://api.groq.com/openai/v1";
  const res = await fetchWithRetry(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: o.temperature ?? 0,
        max_tokens: o.maxOutputTokens ?? 4096,
        ...(o.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: o.prompt },
        ],
      }),
    },
    { retries: 3, timeoutMs: 90000 },
  );
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message: string };
  };
  if (!res.ok) throw new Error(`LLM ${res.status}: ${j.error?.message || "error"}`);
  return {
    text: j.choices?.[0]?.message?.content || "",
    inTok: j.usage?.prompt_tokens || 0,
    outTok: j.usage?.completion_tokens || 0,
  };
}
