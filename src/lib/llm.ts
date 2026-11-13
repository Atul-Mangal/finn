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
// Last models that actually answered in time (written by the data jobs, shipped
// with every deploy) — so nobody waits minutes on a model that's listed but hangs.
import known from "../../data/models.json";

export type ModelTier = "cheap" | "strong";

const PROVIDER = process.env.LLM_PROVIDER || "gemini";
// Defaults are a starting guess; for Gemini they are re-resolved against the
// models this API key can actually use (Google retires model names often).
export const MODELS = {
  cheap: process.env.CHEAP_MODEL || (PROVIDER === "gemini" ? "gemini-3.5-flash-lite" : "llama-3.1-8b-instant"),
  strong: process.env.STRONG_MODEL || (PROVIDER === "gemini" ? "gemini-3.5-flash" : "llama-3.3-70b-versatile"),
};

// Approximate list prices, USD per 1M tokens (input, output), by model family.
// Used only for the cost readout in the UI.
function priceOf(model: string): [number, number] {
  if (/flash-lite/.test(model)) return [0.1, 0.4];
  if (/flash/.test(model)) return [0.3, 2.5];
  if (/pro/.test(model)) return [1.25, 10];
  return [0, 0];
}

// Minimum spacing between model calls. The cron pipeline sets this (free-tier
// RPM limits); interactive routes leave it at 0.
let lastCall = 0;
let chain: Promise<void> = Promise.resolve();
async function throttle() {
  const gap = Number(process.env.LLM_MIN_INTERVAL_MS || 0);
  if (!gap) return;
  chain = chain.then(async () => {
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  return chain;
}

// Ranked candidates per tier (newest first). When a model is out of quota, the
// next one is tried — free-tier quotas differ a lot between model versions.
const CANDIDATES: Record<ModelTier, string[]> = { cheap: [], strong: [] };

/** This model can't serve the request right now (no quota, or too slow): try the next one. */
class QuotaError extends Error {}

let resolved: Promise<void> | null = null;
/** Ask Gemini which models this key can call; pick the newest stable Flash-Lite / Flash. */
async function resolveGeminiModels(): Promise<void> {
  const res = await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! },
  });
  if (!res.ok) return;
  const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const names = (j.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  const ranked = (re: RegExp) =>
    names
      .map((n) => ({ n, m: n.match(re) }))
      .filter((x) => x.m)
      .sort((a, b) => parseFloat(b.m![1]) - parseFloat(a.m![1]))
      .map((x) => x.n);
  const lite = ranked(/^gemini-(\d+(?:\.\d+)?)-flash-lite$/);
  const flash = ranked(/^gemini-(\d+(?:\.\d+)?)-flash$/);
  CANDIDATES.cheap = [...lite, ...ranked(/^gemini-(\d+(?:\.\d+)?)-flash-lite-preview/)];
  // strong: Flash versions, newest first; Flash-Lite as a last resort
  CANDIDATES.strong = [...flash, ...ranked(/^gemini-(\d+(?:\.\d+)?)-flash-preview/), ...lite.slice(0, 1)];
  const slow: string[] = (known as { slow?: string[] }).slow || [];
  const preferFirst = (list: string[], m?: string) => {
    const ordered = m && list.includes(m) ? [m, ...list.filter((x) => x !== m)] : list;
    return [...ordered.filter((x) => !slow.includes(x)), ...ordered.filter((x) => slow.includes(x))];
  };
  CANDIDATES.cheap = preferFirst(CANDIDATES.cheap, known.cheap);
  CANDIDATES.strong = preferFirst(CANDIDATES.strong, known.strong);
  if (CANDIDATES.cheap[0] && !process.env.CHEAP_MODEL) MODELS.cheap = CANDIDATES.cheap[0];
  if (CANDIDATES.strong[0] && !process.env.STRONG_MODEL) MODELS.strong = CANDIDATES.strong[0];
  console.log(`[llm] using cheap=${MODELS.cheap} strong=${MODELS.strong}`);
}
/** Models that have answered successfully in this process (for data/models.json). */
export const WORKED: Partial<Record<ModelTier, string>> = {};
/** Models that hung past the timeout in this process: tried last next time. */
export const SLOW = new Set<string>();

export function ensureModels(): Promise<void> {
  if (PROVIDER !== "gemini" || !process.env.GEMINI_API_KEY) return Promise.resolve();
  resolved ||= resolveGeminiModels().catch(() => {});
  return resolved;
}

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
  await ensureModels();
  // Cache key is per tier, not per model, so a fallback model's answer is reused too.
  const key = `llm:${tier}:${hashKey(opts.system + "\u0000" + opts.prompt)}`;
  const hit = await cache.get<string>(key);
  if (hit !== undefined) {
    usage.cacheHits++;
    return hit;
  }
  if (!llmAvailable()) throw new Error("No LLM API key configured (GEMINI_API_KEY)");

  const pinned = tier === "cheap" ? process.env.CHEAP_MODEL : process.env.STRONG_MODEL;
  const order = PROVIDER !== "gemini" || pinned ? [MODELS[tier]] : [MODELS[tier], ...CANDIDATES[tier].filter((m) => m !== MODELS[tier])].slice(0, 4);
  let model = order[0];
  let out: { text: string; inTok: number; outTok: number } | null = null;
  let lastErr: unknown;
  for (const m of order) {
    model = m;
    const t0 = Date.now();
    try {
      out = PROVIDER === "gemini" ? await callGemini(m, tier, opts) : await callOpenAI(m, opts);
      WORKED[tier] = m;
      if (!process.env.VERCEL)
        console.log(`[llm] ${tier} ${m}: ${((Date.now() - t0) / 1000).toFixed(1)}s, ${out.inTok} in / ${out.outTok} out`);
      if (m !== MODELS[tier]) {
        console.log(`[llm] ${tier}: ${MODELS[tier]} out of quota, switched to ${m}`);
        MODELS[tier] = m; // stick with the model that works for the rest of this process
      }
      break;
    } catch (e) {
      lastErr = e;
      if (/timed out/.test(String(e))) SLOW.add(m);
      if (!process.env.VERCEL) console.log(`[llm] ${tier} ${m} failed after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${(e as Error).message}`);
      if (!(e instanceof QuotaError) && !/404|not found|no longer available/i.test(String(e))) throw e;
    }
  }
  if (!out) throw lastErr instanceof Error ? lastErr : new Error("All models failed");
  const { text, inTok, outTok } = out;

  if (tier === "cheap") usage.cheapCalls++;
  else usage.strongCalls++;
  usage.inputTokens += inTok;
  usage.outputTokens += outTok;
  const [pi, po] = priceOf(model);
  usage.models = { ...MODELS };
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
  try {
    return JSON.parse(s) as T;
  } catch {
    // Models sometimes echo the template's // comments or leave a trailing comma.
    const repaired = s.replace(/(^|[\s,{\[])\/\/[^\n]*$/gm, "$1").replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired) as T;
  }
}

async function callGemini(model: string, tier: ModelTier, o: CallOpts) {
  const cap = o.maxOutputTokens ?? 4096;
  const gen: Record<string, unknown> = {
    temperature: o.temperature ?? (tier === "cheap" ? 0 : 0.3),
    // Gemini 3+ models think, and thinking tokens count against the output cap,
    // so give them headroom (you only pay for tokens used).
    maxOutputTokens: /gemini-[3-9]/.test(model) ? Math.max(cap * 3, 8192) : cap,
    ...(o.json ? { responseMimeType: "application/json" } : {}),
  };
  // Extraction needs minimal thinking; judgment gets "low" so a research report
  // fits a serverless timeout. Dropped automatically if a model rejects it.
  if (/gemini-[3-9]/.test(model)) gen.thinkingConfig = { thinkingLevel: tier === "cheap" ? "minimal" : "low" };

  const request = () => ({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: gen,
  });

  // Serverless requests have a hard timeout, so they wait less and give up sooner.
  const serverless = !!process.env.VERCEL;
  const attempts = serverless ? 2 : 6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await throttle();
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: JSON.stringify(request()),
      },
      // Batch jobs can wait; an interactive request can't. A timeout means "try the next model".
      { retries: 0, timeoutMs: serverless ? (tier === "strong" ? 150000 : 50000) : tier === "strong" ? 240000 : 120000, passStatus: true },
    ).catch((e: Error) => {
      if (/abort/i.test(e.message)) throw new QuotaError(`${model}: timed out`);
      throw e;
    });
    if (res.status === 429 || res.status === 503 || res.status === 500) {
      // Free tier: Google says how long to wait (RetryInfo.retryDelay, e.g. "23s").
      const text = await res.text().catch(() => "");
      // "limit: 0" = this model has no free quota on this key: don't wait, switch model
      if (res.status === 429 && /limit:\s*0\b|PerDay/i.test(text)) throw new QuotaError(`${model}: quota exhausted`);
      const hinted = Number(text.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
      await sleep(isFinite(hinted) && hinted > 0 ? Math.min(hinted, serverless ? 8 : 60) * 1000 + 500 : (serverless ? 2000 : 5000) * (attempt + 1));
      continue;
    }
    const raw = await res.text();
    if (res.status === 400 && gen.thinkingConfig && /thinking/i.test(raw)) {
      delete gen.thinkingConfig; // this model doesn't take thinkingLevel: use its default
      continue;
    }
    let j: {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      error?: { message: string };
    };
    try {
      j = JSON.parse(raw);
    } catch {
      throw new Error(`Gemini ${res.status}: non-JSON response`);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${j.error?.message || "error"}`);
    const text = (j.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || "")
      .join("");
    if (!text) throw new Error(`Gemini returned no text (model ${model})`);
    const u = j.usageMetadata || {};
    return {
      text,
      inTok: u.promptTokenCount || 0,
      outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    };
  }
  throw new QuotaError(`${model}: rate-limited after retries`);
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
