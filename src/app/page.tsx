"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { initialLastVisit, useFeed, useMarks, useNow, usePrices, useSettings } from "@/lib/client";
import { filingTrips, personalPriority, priceTrips } from "@/lib/alerts";
import { CATEGORY_LABEL, ago, signedPct, toneOf } from "@/lib/format";
import { Row, TopCard } from "@/components/FeedItems";
import { SampleBanner } from "@/components/SampleBanner";
import { Pulse } from "@/components/Pulse";
import { Upcoming } from "@/components/Upcoming";
import type { Category, FeedItem } from "@/lib/types";

const WINDOWS = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "3d", label: "3 days", hours: 72 },
  { key: "7d", label: "Week", hours: 168 },
  { key: "30d", label: "Month", hours: 720 },
] as const;

export default function Brief() {
  const feed = useFeed();
  const prices = usePrices();
  const [settings] = useSettings();
  const [marks, toggleDone, visit] = useMarks();
  const [win, setWin] = useState<string>("24h");
  const [custom, setCustom] = useState<string>("");

  const now = useNow();
  // Remember when the user last looked, so new items get a dot.
  const [prevVisit] = useState(initialLastVisit);
  useEffect(() => {
    visit();
  }, [visit]);

  const sinceMs = useMemo(() => {
    if (win === "custom" && custom) return Date.parse(custom + "T00:00:00+05:30");
    const w = WINDOWS.find((x) => x.key === win) ?? WINDOWS[0];
    return now - w.hours * 3600e3;
  }, [win, custom, now]);

  const view = useMemo(() => {
    if (!feed.data) return null;
    const inWin = feed.data.items.filter((i) => Date.parse(i.time) >= sinceMs && !settings.muted.includes(i.symbol));
    const rank = (a: FeedItem, b: FeedItem) => personalPriority(b, settings) - personalPriority(a, settings) || b.time.localeCompare(a.time);
    const top = inWin.filter((i) => i.tier === "top").sort(rank);
    const open = top.filter((i) => !marks.done[i.id]);
    const handled = top.filter((i) => marks.done[i.id]);
    const normal = inWin.filter((i) => i.tier === "normal").sort(rank);
    const routine = inWin.filter((i) => i.tier === "routine");
    const groups = new Map<Category, FeedItem[]>();
    routine.forEach((i) => groups.set(i.category, [...(groups.get(i.category) || []), i]));
    // A quiet window shouldn't hide the week: show what mattered recently.
    const earlier =
      open.length < 2
        ? feed.data.items
            .filter((i) => i.tier === "top" && Date.parse(i.time) < sinceMs && Date.parse(i.time) >= now - 7 * 864e5 && !marks.done[i.id] && !settings.muted.includes(i.symbol))
            .sort(rank)
            .slice(0, 6)
        : [];
    return { total: inWin.length, open, handled, normal, routine, earlier, groups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length) };
  }, [feed.data, sinceMs, settings, marks.done, now]);

  const trips = useMemo(() => (prices.data ? priceTrips(prices.data, settings, 1) : []), [prices.data, settings]);
  const filingAlerts = useMemo(() => (feed.data ? filingTrips(feed.data, settings, sinceMs) : []), [feed.data, settings, sinceMs]);

  if (feed.loading) return <Skeleton />;
  if (feed.error || !feed.data || !view)
    return <Empty title="No feed yet" body="The pipeline hasn't produced a feed. Run the “Refresh data” GitHub Action, or `npm run pipeline` locally." />;

  const isNew = (i: FeedItem) => prevVisit > 0 && Date.parse(i.time) > prevVisit;
  const winLabel = win === "custom" ? `since ${custom}` : `in the last ${WINDOWS.find((w) => w.key === win)?.label.toLowerCase()}`;

  return (
    <main>
      <header className="flex items-baseline justify-between pt-2">
        <h1 className="text-[22px] font-extrabold tracking-tight">FINN</h1>
        <p className="text-[13px] text-graphite">
          {now ? new Date(now).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : ""}
        </p>
      </header>

      {feed.data.sample && <div className="mt-3"><SampleBanner /></div>}

      {/* Window picker */}
      <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto no-scrollbar px-4 pb-1" role="tablist" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button key={w.key} role="tab" aria-selected={win === w.key} onClick={() => setWin(w.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] ${win === w.key ? "bg-ink text-stone" : "bg-paper text-ink"}`}>
            {w.label}
          </button>
        ))}
        <label className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] ${win === "custom" ? "bg-ink text-stone" : "bg-paper"}`}>
          <span>From</span>
          <input type="date" value={custom} max={now ? new Date(now).toISOString().slice(0, 10) : undefined}
            onChange={(e) => { setCustom(e.target.value); setWin(e.target.value ? "custom" : "24h"); }}
            className="w-[7.5rem] bg-transparent text-[13px] outline-none" aria-label="Custom start date" />
        </label>
      </div>

      {/* The one-sentence brief */}
      <p className="mt-5 font-serif text-[27px] leading-[1.15] tracking-[-0.01em]">
        {view.open.length === 0 ? (
          <>Nothing needs you {winLabel}.</>
        ) : (
          <>{view.open.length} {view.open.length === 1 ? "filing needs" : "filings need"} you {winLabel}.</>
        )}{" "}
        <span className="text-graphite">
          {view.normal.length} worth a glance, {view.routine.length} routine folded away.
        </span>
      </p>

      {prices.data && (
        <Pulse prices={prices.data} muted={settings.muted} flagged={new Set([...view.open, ...view.earlier].map((i) => i.symbol))} />
      )}

      {/* Tripwires that fired */}
      {(trips.length > 0 || filingAlerts.length > 0) && (
        <section className="mt-5" aria-label="Tripwires">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Tripwires</h2>
            <Link href="/tripwires" className="text-[13px] text-link">Adjust</Link>
          </div>
          <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto no-scrollbar px-4 pb-1">
            {trips.map((t) => (
              <li key={t.symbol + t.date} className="shrink-0 rounded-lg border border-ink/15 bg-paper px-3 py-2">
                <Link href={`/research/${t.symbol}`} className="block">
                  <span className="text-[13px] font-bold">{t.symbol}</span>
                  <span className={`num ml-2 text-[13px] ${toneOf(t.ret)}`}>{signedPct(t.ret)}</span>
                  <span className="num block text-[12px] text-graphite">
                    {t.kind === "price" ? `move beyond ±${settings.pricePct}%` : `volume ${t.volX.toFixed(1)}× ${settings.volLookback}d avg`}
                  </span>
                </Link>
              </li>
            ))}
            {filingAlerts.slice(0, 6).map((i) => (
              <li key={i.id} className="shrink-0 rounded-lg border border-ink/15 bg-paper px-3 py-2">
                <a href={`#item-${i.id}`} className="block">
                  <span className="text-[13px] font-bold">{i.symbol}</span>
                  <span className="ml-2 text-[13px] text-ink">{CATEGORY_LABEL[i.category]}</span>
                  <span className="num block text-[12px] text-graphite">filed {ago(i.time)} ago</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Needs you */}
      {view.open.length > 0 && (
        <section className="mt-6 space-y-3" aria-label="Needs you">
          {view.open.map((i, idx) => (
            <div id={`item-${i.id}`} key={i.id} className="scroll-mt-4">
              <TopCard item={i} series={prices.data?.series[i.symbol]} isNew={isNew(i)} done={false}
                onDone={() => toggleDone(i.id)} animate={idx < 3} />
            </div>
          ))}
        </section>
      )}

      {view.earlier.length > 0 && (
        <section className="mt-6" aria-label="Earlier this week">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold">Earlier this week</h2>
            <button className="text-[13px] text-link" onClick={() => setWin("7d")}>Show the week</button>
          </div>
          <div className="mt-2 space-y-3">
            {view.earlier.map((i, idx) => (
              <div id={`item-${i.id}`} key={i.id} className="scroll-mt-4">
                <TopCard item={i} series={prices.data?.series[i.symbol]} isNew={isNew(i)} done={false} onDone={() => toggleDone(i.id)} animate={idx < 2} />
              </div>
            ))}
          </div>
        </section>
      )}

      {view.total === 0 && view.earlier.length === 0 && (
        <div className="mt-6 rounded-xl bg-paper p-4 text-[14px] text-graphite">
          No filings {winLabel}.{" "}
          {win !== "30d" && <button className="text-link" onClick={() => setWin(win === "24h" ? "3d" : win === "3d" ? "7d" : "30d")}>Look further back</button>}
        </div>
      )}

      {now > 0 && (
        <Upcoming items={feed.data.items} muted={settings.muted} today={new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10)} />
      )}

      {/* Worth a glance */}
      {view.normal.length > 0 && (
        <section className="mt-7" aria-label="Worth a glance">
          <h2 className="text-[13px] font-semibold">Worth a glance</h2>
          <ul className="mt-1">
            {view.normal.map((i) => <Row key={i.id} item={i} isNew={isNew(i)} />)}
          </ul>
        </section>
      )}

      {/* Folded away */}
      {view.routine.length > 0 && (
        <section className="mt-6" aria-label="Routine">
          <details className="group">
            <summary className="flex cursor-pointer items-baseline justify-between text-[13px]">
              <span className="font-semibold">Folded away</span>
              <span className="text-graphite">
                {view.groups.slice(0, 3).map(([c, l]) => `${l.length} ${CATEGORY_LABEL[c].toLowerCase()}`).join(", ")}
                {view.groups.length > 3 ? ", …" : ""} <span className="inline-block transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <ul className="mt-2 text-[13px] text-graphite">
              {view.routine.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 border-t border-rule py-1.5">
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink/70">{i.symbol}</span>{" "}
                    {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">{i.headline}</a> : i.headline}
                  </span>
                  <span className="num shrink-0 text-faint">{ago(i.time)}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {/* Handled */}
      {view.handled.length > 0 && (
        <section className="mt-6" aria-label="Handled">
          <details>
            <summary className="cursor-pointer text-[13px] font-semibold">Done ({view.handled.length})</summary>
            <div className="mt-2 space-y-3">
              {view.handled.map((i) => (
                <TopCard key={i.id} item={i} series={prices.data?.series[i.symbol]} isNew={false} done onDone={() => toggleDone(i.id)} />
              ))}
            </div>
          </details>
        </section>
      )}

      <Footer generatedAt={feed.data.generatedAt} usage={feed.data.usage} errors={feed.data.errors} />
    </main>
  );
}

function Footer({ generatedAt, usage, errors }: { generatedAt: string; usage: import("@/lib/types").UsageSummary; errors: string[] }) {
  return (
    <footer className="mt-10 space-y-1 border-t border-rule pt-3 text-[12px] text-faint">
      <p>Filings and prices updated {ago(generatedAt)} ago from BSE and Yahoo Finance.</p>
      <p>
        Last run: {usage.cheapCalls} small-model calls, {usage.strongCalls} large-model calls, {usage.cacheHits} answers reused from cache,
        about ${usage.estCostUSD.toFixed(3)} at list price.
      </p>
      {errors.length > 0 && (
        <details>
          <summary className="cursor-pointer">{errors.length} source warnings</summary>
          <ul className="mt-1 list-disc pl-4">{errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}
    </footer>
  );
}

function Skeleton() {
  return (
    <main className="animate-pulse pt-2" aria-busy>
      <div className="h-6 w-16 rounded bg-rule" />
      <div className="mt-8 h-8 w-4/5 rounded bg-rule" />
      <div className="mt-2 h-8 w-3/5 rounded bg-rule" />
      <div className="mt-8 h-40 rounded-xl bg-paper" />
      <div className="mt-3 h-40 rounded-xl bg-paper" />
    </main>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <main className="pt-10">
      <h1 className="text-[22px] font-extrabold tracking-tight">FINN</h1>
      <p className="mt-6 font-serif text-[24px]">{title}</p>
      <p className="mt-2 text-[14px] text-graphite">{body}</p>
    </main>
  );
}
