// Stage 3: the one reasoning call (strong model) over compact extracted facts.
import { analyze } from "@/lib/pull/analyze";
import { newUsage } from "@/lib/llm";
import { cache, hashKey } from "@/lib/cache";
import type { Analysis, CompanyBase, Computed, TranscriptExtract } from "@/lib/types";

export const maxDuration = 300;

interface Body {
  base: Pick<CompanyBase, "name" | "about" | "isLender" | "symbol">;
  computed: Pick<Computed, "qualityTable" | "trajectory" | "balance" | "cash">;
  extracts: TranscriptExtract[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  if (!body?.base?.name || !body.computed?.qualityTable) return Response.json({ error: "bad request" }, { status: 400 });
  const usage = newUsage();
  const key = `analysis:v2:${body.base.symbol}:${hashKey(JSON.stringify(body.extracts.map((e) => e.url)) + body.computed.qualityTable)}`;
  try {
    const hit = await cache.get<Analysis>(key);
    if (hit) {
      usage.cacheHits++;
      return Response.json({ analysis: hit, usage });
    }
    const analysis = await analyze(body.base, body.computed, body.extracts.slice(0, 6), usage);
    await cache.set(key, analysis, 60 * 60 * 24 * 7);
    return Response.json({ analysis, usage });
  } catch (e) {
    return Response.json({ error: (e as Error).message, usage }, { status: 502 });
  }
}
