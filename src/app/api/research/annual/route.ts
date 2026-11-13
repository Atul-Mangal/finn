// Optional stage: red-flag scan of the latest annual report (cheap model, one
// call over ~7 keyword-selected pages). Runs alongside the transcript stage.
import { scanAnnualReport } from "@/lib/pull/annual";
import { newUsage } from "@/lib/llm";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { url, period, netWorth } = (await req.json()) as { url?: string; period?: string; netWorth?: number | null };
  if (!url || !/^https?:\/\//.test(url)) return Response.json({ error: "url required" }, { status: 400 });
  const usage = newUsage();
  try {
    const annual = await scanAnnualReport({ url, period: period || "", kind: "annual_report" }, netWorth ?? null, usage);
    return Response.json({ annual, usage });
  } catch (e) {
    return Response.json({ error: (e as Error).message, usage }, { status: 502 });
  }
}
