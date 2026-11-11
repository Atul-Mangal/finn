// Stage 2: one transcript → guidance (cheap model). Called once per transcript
// by the client, in parallel, so each request stays well inside the timeout.
import { extractTranscript } from "@/lib/pull/guidance";
import { newUsage } from "@/lib/llm";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { url, period } = (await req.json()) as { url?: string; period?: string };
  if (!url || !/^https?:\/\//.test(url)) return Response.json({ error: "url required" }, { status: 400 });
  const usage = newUsage();
  try {
    const extract = await extractTranscript({ url, period: period || "", kind: "transcript" }, usage);
    return Response.json({ extract, usage });
  } catch (e) {
    return Response.json({ error: (e as Error).message, usage }, { status: 502 });
  }
}
