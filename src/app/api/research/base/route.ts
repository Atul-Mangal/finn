// Stage 1: fetch + compute. No model calls — this is fast and free.
import { cache } from "@/lib/cache";
import { fetchCompany, NotFoundError } from "@/lib/pull/screener";
import { compute } from "@/lib/pull/metrics";
import { llmAvailable } from "@/lib/llm";
import type { CompanyBase, Computed } from "@/lib/types";

export const maxDuration = 30;

export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol) return Response.json({ error: "symbol required" }, { status: 400 });
  const key = `base:v2:${symbol}`;
  try {
    let hit = await cache.get<{ base: CompanyBase; computed: Computed }>(key);
    if (!hit) {
      const base = await fetchCompany(symbol);
      hit = { base, computed: compute(base) };
      await cache.set(key, hit, 60 * 60 * 12);
    }
    return Response.json({ ...hit, llm: llmAvailable() });
  } catch (e) {
    const status = e instanceof NotFoundError ? 404 : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
