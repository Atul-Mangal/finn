"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Analysis, CompanyBase, Computed, Flag, Metric, Research, TranscriptExtract, UsageSummary, Verdict } from "@/lib/types";
import { ago, signedPct, toneOf } from "@/lib/format";
import { Bars } from "@/components/Spark";
import { SampleBanner } from "@/components/SampleBanner";

type Stage = { label: string; state: "wait" | "run" | "ok" | "err"; note?: string };

const ZERO: UsageSummary = { cheapCalls: 0, strongCalls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, estCostUSD: 0, models: { cheap: "", strong: "" } };
const add = (a: UsageSummary, b?: UsageSummary): UsageSummary =>
  !b ? a : {
    cheapCalls: a.cheapCalls + b.cheapCalls, strongCalls: a.strongCalls + b.strongCalls, cacheHits: a.cacheHits + b.cacheHits,
    inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens,
    estCostUSD: +(a.estCostUSD + b.estCostUSD).toFixed(5), models: b.models?.cheap ? b.models : a.models,
  };

const TRANSCRIPTS = 5;

export default function ResearchPage() {
  const { symbol: raw } = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(raw || "").toUpperCase();
  const [base, setBase] = useState<CompanyBase | null>(null);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [extracts, setExtracts] = useState<TranscriptExtract[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [usage, setUsage] = useState<UsageSummary>(ZERO);
  const [stages, setStages] = useState<Stage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [sample, setSample] = useState(false);
  const [noLlm, setNoLlm] = useState(false);
  const started = useRef(false);

  const runLive = useCallback(async () => {
    setError(null); setSnapshotAt(null); setAnalysis(null); setExtracts([]); setUsage(ZERO); setSample(false);
    const st: Stage[] = [{ label: "Financial statements from screener.in", state: "run" }];
    setStages([...st]);
    const r = await fetch(`/api/research/base?symbol=${encodeURIComponent(symbol)}`);
    const j = await r.json();
    if (!r.ok) { setError(j.error || "Could not load this company"); setStages([]); return; }
    setBase(j.base); setComputed(j.computed);
    st[0].state = "ok";
    if (!j.llm) { setNoLlm(true); setStages([...st]); return; }

    const docs: { url: string; period: string }[] = (j.base as CompanyBase).transcripts.slice(0, TRANSCRIPTS).reverse();
    if (!docs.length) st.push({ label: "No earnings-call transcripts linked on screener.in", state: "err" });
    docs.forEach((d) => st.push({ label: `Earnings call, ${d.period}`, state: "wait" }));
    st.push({ label: "Checking promises against delivery", state: "wait" });
    setStages([...st]);

    const out: TranscriptExtract[] = new Array(docs.length);
    let u = ZERO;
    let next = 0;
    const offset = st.length - docs.length - 1;
    await Promise.all([0, 1].map(async () => {
      while (next < docs.length) {
        const i = next++;
        st[offset + i].state = "run"; setStages([...st]);
        try {
          const res = await fetch("/api/research/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(docs[i]) });
          const x = await res.json();
          u = add(u, x.usage);
          if (!res.ok) throw new Error(x.error);
          out[i] = x.extract;
          st[offset + i].state = x.extract.error ? "err" : "ok";
          st[offset + i].note = x.extract.error || `${x.extract.guidance.length} guidance points`;
          if (x.extract.period) st[offset + i].label = `Earnings call, ${x.extract.period}`;
        } catch (e) {
          out[i] = { period: docs[i].period, url: docs[i].url, guidance: [], segments: [], tone: "", analystConcerns: [], error: (e as Error).message };
          st[offset + i].state = "err"; st[offset + i].note = (e as Error).message;
        }
        setStages([...st]); setUsage(u);
      }
    }));
    const ex = out.filter(Boolean);
    setExtracts(ex);

    const last = st.length - 1;
    st[last].state = "run"; setStages([...st]);
    try {
      const b = j.base as CompanyBase, c = j.computed as Computed;
      const res = await fetch("/api/research/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: { name: b.name, about: b.about, isLender: b.isLender, symbol: b.symbol }, computed: { qualityTable: c.qualityTable, trajectory: c.trajectory, balance: c.balance, cash: c.cash }, extracts: ex }),
      });
      const a = await res.json();
      u = add(u, a.usage); setUsage(u);
      if (!res.ok) throw new Error(a.error);
      setAnalysis(a.analysis);
      st[last].state = "ok";
    } catch (e) {
      st[last].state = "err"; st[last].note = (e as Error).message;
    }
    setStages([...st]);
  }, [symbol]);

  useEffect(() => {
    if (started.current || !symbol) return;
    started.current = true;
    fetch(`/data/research/${encodeURIComponent(symbol)}.json`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Research>) : Promise.reject()))
      .then((r) => {
        setBase(r.base); setComputed(r.computed); setExtracts(r.extracts); setAnalysis(r.analysis); setUsage(r.usage);
        setSnapshotAt(r.generatedAt); setSample(!!r.sample);
      })
      .catch(() => runLive());
  }, [symbol, runLive]);

  const running = stages.some((s) => s.state === "run" || s.state === "wait");

  if (error)
    return (
      <main className="pt-2">
        <Back />
        <p className="mt-6 font-serif text-[24px]">{error}.</p>
        <p className="mt-2 text-[14px] text-graphite">Check the NSE symbol (for example PIDILITIND, not Pidilite) and try again.</p>
      </main>
    );

  return (
    <main className="pt-2">
      <Back />
      {sample && <div className="mt-3"><SampleBanner what="research" /></div>}
      <header className="mt-3">
        <h1 className="font-serif text-[30px] leading-[1.1] tracking-[-0.01em]">{base?.name || symbol}</h1>
        <p className="mt-1 text-[13px] text-graphite">
          {symbol}{base && <>, {base.basis} figures</>}
          {snapshotAt && !sample && <>, prepared {ago(snapshotAt)} ago. <button onClick={runLive} className="text-link">Refresh</button></>}
        </p>
      </header>

      {stages.length > 0 && (running || stages.some((s) => s.state === "err")) && <Progress stages={stages} />}

      {computed && base && (
        <>
          <nav className="sticky top-0 z-10 -mx-4 mt-4 flex gap-1.5 overflow-x-auto no-scrollbar bg-stone/95 px-4 py-2 backdrop-blur" aria-label="Sections">
            {[["promises", "Promises"], ["numbers", "Numbers"], ["trajectory", "Trajectory"], ["balance", "Balance sheet"], ["cash", "Cash"], ["guidance", "Guidance"], ["case", "Bull & bear"]].map(([id, l]) => (
              <a key={id} href={`#${id}`} className="shrink-0 rounded-full bg-paper px-3 py-1 text-[13px]">{l}</a>
            ))}
          </nav>

          <Section id="promises" title="Promised vs delivered">
            {analysis ? <Promises a={analysis} /> : noLlm ? (
              <p className="text-[14px] text-graphite">Add a GEMINI_API_KEY to read transcripts and check management&apos;s promises. The numbers below are computed without a model.</p>
            ) : running ? <p className="text-[14px] text-graphite">Reading the last {TRANSCRIPTS} earnings calls…</p> : (
              <p className="text-[14px] text-graphite">No transcript analysis available.</p>
            )}
            {analysis && analysis.narrativeVsNumbers.length > 0 && (
              <div className="mt-6">
                <h3 className="text-[13px] font-semibold">What they say vs what the numbers say</h3>
                <ul className="mt-2 space-y-3">
                  {analysis.narrativeVsNumbers.map((n, i) => (
                    <li key={i} className="text-[14px] leading-snug">
                      <span className={`mr-1.5 text-[12px] font-semibold ${n.stance === "agrees" ? "text-up" : "text-down"}`}>{n.stance === "agrees" ? "Holds up" : "Doesn’t hold up"}</span>
                      {n.point}
                      <span className="mt-0.5 block text-graphite">{n.evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section id="numbers" title="Snapshot">
            {analysis?.business.summary && <p className="mb-3 text-[14px] leading-snug">{analysis.business.summary}</p>}
            {!analysis?.business.summary && base.about && <p className="mb-3 text-[14px] leading-snug text-graphite">{base.about}</p>}
            {analysis?.business.segments.length ? (
              <ul className="mb-4 space-y-1 text-[13px]">
                {analysis.business.segments.map((s, i) => <li key={i}><span className="font-semibold">{s.name}</span> <span className="text-graphite">{s.comment}</span></li>)}
              </ul>
            ) : null}
            <MetricGrid metrics={computed.snapshot} />
            {computed.lastQuarter && (
              <table className="num mt-4 w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] text-faint">
                    <th className="py-1 font-normal">Quarter ended {computed.lastQuarter.label}, ₹ Cr</th>
                    <th className="py-1 text-right font-normal">Value</th><th className="py-1 text-right font-normal">QoQ</th><th className="py-1 text-right font-normal">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.lastQuarter.rows.map((r) => (
                    <tr key={r.metric} className="border-t border-rule">
                      <td className="py-1.5">{r.metric}</td>
                      <td className="py-1.5 text-right">{r.value?.toLocaleString("en-IN") ?? "—"}</td>
                      <td className={`py-1.5 text-right ${toneOf(r.qoq)}`}>{signedPct(r.qoq)}</td>
                      <td className={`py-1.5 text-right ${toneOf(r.yoy)}`}>{signedPct(r.yoy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section id="trajectory" title="Trajectory">
            <Flags flags={computed.trajectory.flags} />
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5">
              <Chart title="Revenue, ₹ Cr" points={computed.trajectory.revenue} />
              <Chart title="Net profit, ₹ Cr" points={computed.trajectory.profit} />
              <Chart title={base.isLender ? "Financing margin %" : "Operating margin %"} points={computed.trajectory.margin} unit="%" />
              <Chart title="Quarterly revenue, YoY %" points={computed.trajectory.qRevenueYoY} unit="%" />
            </div>
          </Section>

          <Section id="balance" title="Balance sheet">
            <Flags flags={computed.balance.flags} />
            <div className="mt-3"><MetricGrid metrics={computed.balance.metrics} /></div>
            <div className="mt-4"><Chart title="Borrowings, ₹ Cr" points={computed.balance.borrowings} /></div>
          </Section>

          <Section id="cash" title="Cash quality">
            <Flags flags={computed.cash.flags} />
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-5">
              <Chart title="Operating cash flow, ₹ Cr" points={computed.cash.cfo} />
              <Chart title="Net profit, ₹ Cr" points={computed.cash.pat} />
              <div className="col-span-2"><Chart title="Cash left after investing (CFO + CFI), ₹ Cr" points={computed.cash.fcfProxy} /></div>
            </div>
            <p className="mt-2 text-[12px] text-faint">CFO + CFI is a free-cash-flow proxy; it also counts purchases of financial investments.</p>
          </Section>

          <Section id="guidance" title="What management is guiding to now">
            {analysis?.guidanceNow.length ? (
              <ul className="space-y-3">
                {analysis.guidanceNow.map((g, i) => (
                  <li key={i}>
                    <p className="text-[15px]"><span className="font-semibold">{g.target}</span> <span className="text-graphite">{g.metric.replace(/_/g, " ")}, {g.horizon}</span></p>
                    <blockquote className="mt-0.5 border-l-2 border-rule pl-2.5 font-serif text-[15px] italic leading-snug text-ink/80">“{g.quote}”</blockquote>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[14px] text-graphite">{running ? "Waiting for transcripts…" : "No explicit guidance found in the latest call."}</p>}
          </Section>

          <Section id="case" title="Bull and bear">
            {analysis ? (
              <div className="grid gap-5">
                <CaseList title="The bull case" items={analysis.bull} tone="text-up" />
                <CaseList title="The bear case" items={analysis.bear} tone="text-down" />
              </div>
            ) : <p className="text-[14px] text-graphite">{running ? "Writing once the calls are read…" : "Not available."}</p>}
          </Section>

          <Sources base={base} extracts={extracts} usage={usage} />
        </>
      )}
      {!computed && !error && <div className="mt-8 h-40 animate-pulse rounded-xl bg-paper" />}
    </main>
  );
}

function Back() {
  return <Link href="/research" className="text-[14px] text-link">‹ Research</Link>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 border-t border-rule pt-4 mt-8 first-of-type:mt-4">
      <h2 className="mb-3 text-[17px] font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const VERDICT: Record<Verdict["verdict"], { label: string; cls: string }> = {
  delivered: { label: "Delivered", cls: "bg-up/10 text-up" },
  missed: { label: "Missed", cls: "bg-down/10 text-down" },
  partial: { label: "Partly", cls: "bg-marker-soft text-ink" },
  pending: { label: "Pending", cls: "bg-rule/60 text-graphite" },
  unverifiable: { label: "Can’t verify", cls: "bg-rule/60 text-graphite" },
};

function Promises({ a }: { a: Analysis }) {
  const counts = a.promises.reduce<Record<string, number>>((m, p) => ({ ...m, [p.verdict]: (m[p.verdict] || 0) + 1 }), {});
  return (
    <div>
      {a.scorecard && <p className="font-serif text-[22px] leading-[1.2]"><span className="mark mark-draw">{a.scorecard}</span></p>}
      <p className="num mt-2 text-[12px] text-graphite">
        {(["delivered", "partial", "missed", "pending", "unverifiable"] as const).filter((k) => counts[k]).map((k) => `${counts[k]} ${VERDICT[k].label.toLowerCase()}`).join(", ")}
      </p>
      <ol className="mt-4 space-y-4">
        {a.promises.map((p, i) => (
          <li key={i} className="rounded-xl bg-paper px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] leading-snug">{p.promise}</p>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold ${VERDICT[p.verdict]?.cls || ""}`}>{VERDICT[p.verdict]?.label || p.verdict}</span>
            </div>
            <p className="mt-1 text-[12px] text-faint">Said in {p.madeIn}</p>
            <p className="num mt-2 text-[14px] leading-snug">{p.delivered}</p>
            <p className="num mt-0.5 text-[12px] text-graphite">{p.evidence}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-rule">
      {metrics.map((m) => (
        <div key={m.label} className="bg-paper px-3 py-2.5">
          <dt className="text-[11px] leading-tight text-graphite">{m.label}</dt>
          <dd className={`num mt-0.5 text-[15px] font-semibold ${m.tone === "good" ? "text-up" : m.tone === "bad" ? "text-down" : ""}`}>{m.value}</dd>
          {m.sub && <dd className="num text-[11px] text-faint">{m.sub}</dd>}
        </div>
      ))}
      {Array.from({ length: (3 - (metrics.length % 3)) % 3 }, (_, i) => <div key={`pad${i}`} className="bg-paper" aria-hidden />)}
    </dl>
  );
}

function Flags({ flags }: { flags: Flag[] }) {
  if (!flags.length) return <p className="text-[13px] text-graphite">No rule-based flags fired.</p>;
  return (
    <ul className="space-y-1.5">
      {flags.map((f, i) => (
        <li key={i} className="flex gap-2 text-[14px] leading-snug">
          <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 rounded-full ${f.tone === "good" ? "bg-up" : f.tone === "bad" ? "bg-down" : "bg-faint"}`} />
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Chart({ title, points, unit = "" }: { title: string; points: { label: string; value: number | null }[]; unit?: string }) {
  const last = [...points].reverse().find((p) => p.value != null);
  return (
    <div>
      <p className="flex items-baseline justify-between text-[12px] text-graphite">
        <span>{title}</span>
        <span className="num font-semibold text-ink">{last?.value != null ? `${last.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${unit}` : "—"}</span>
      </p>
      {points.length ? <Bars points={points} unit={unit} /> : <p className="text-[12px] text-faint">No data</p>}
    </div>
  );
}

function CaseList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <h3 className={`text-[13px] font-semibold ${tone}`}>{title}</h3>
      <ul className="mt-1.5 space-y-2">
        {items.map((t, i) => <li key={i} className="text-[14px] leading-snug">{t}</li>)}
      </ul>
    </div>
  );
}

function Progress({ stages }: { stages: Stage[] }) {
  return (
    <ol className="mt-4 space-y-1.5 rounded-xl bg-paper px-4 py-3 text-[13px]" aria-live="polite">
      {stages.map((s, i) => (
        <li key={i} className="flex items-baseline gap-2">
          <span aria-hidden className={`inline-block w-3 text-center ${s.state === "ok" ? "text-up" : s.state === "err" ? "text-down" : s.state === "run" ? "animate-pulse text-ink" : "text-faint"}`}>
            {s.state === "ok" ? "✓" : s.state === "err" ? "!" : s.state === "run" ? "•" : "·"}
          </span>
          <span className={s.state === "wait" ? "text-faint" : ""}>{s.label}</span>
          {s.note && <span className="truncate text-faint">{s.note}</span>}
        </li>
      ))}
    </ol>
  );
}

function Sources({ base, extracts, usage }: { base: CompanyBase; extracts: TranscriptExtract[]; usage: UsageSummary }) {
  return (
    <footer className="mt-10 space-y-2 border-t border-rule pt-3 text-[12px] text-faint">
      <p>
        Primary sources only: company filings via <a className="underline" href={base.sourceUrl} target="_blank" rel="noreferrer">screener.in</a>
        {extracts.length > 0 && <> and {extracts.filter((e) => !e.error).length} earnings-call transcripts</>}. No news, broker notes or model background knowledge.
      </p>
      {extracts.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {extracts.map((e) => e.url && e.url !== "#" ? (
            <li key={e.url}><a className="underline" href={e.url} target="_blank" rel="noreferrer">{e.period} transcript</a></li>
          ) : null)}
        </ul>
      )}
      <p>
        This report: {usage.cheapCalls} small-model calls (reading), {usage.strongCalls} large-model call (judging), {usage.cacheHits} reused from cache,
        {" "}{(usage.inputTokens / 1000).toFixed(0)}K tokens in, about ${usage.estCostUSD.toFixed(3)} at list price.
      </p>
    </footer>
  );
}
