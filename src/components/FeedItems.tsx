"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { FeedItem, PersonCard, PriceSeries, ResultsCard } from "@/lib/types";
import { CATEGORY_LABEL, ago, pctChange, signedPct, toneOf } from "@/lib/format";

function DayMove({ series }: { series?: PriceSeries }) {
  if (!series || series.c.length < 22) return null;
  const n = series.c.length;
  const ret = ((series.c[n - 1] - series.c[n - 2]) / series.c[n - 2]) * 100;
  const avg = series.v.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
  const volX = series.v[n - 1] / avg;
  const last30 = series.c.slice(-30);
  const month = ((last30[last30.length - 1] - last30[0]) / last30[0]) * 100;
  const lo = Math.min(...last30),
    hi = Math.max(...last30);
  const pts = last30.map((v, i) => `${(i / (last30.length - 1)) * 100},${22 - ((v - lo) / (hi - lo || 1)) * 20 - 1}`).join(" ");
  return (
    <span className="num flex items-center gap-2 text-[12px] text-graphite">
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" className="h-5 w-14 shrink-0" role="img" aria-label={`30-day price ${signedPct(month)}`}>
        <polyline points={pts} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className={month >= 0 ? "stroke-up" : "stroke-down"} />
      </svg>
      <span>
        Last close <span className={toneOf(ret)}>{signedPct(ret)}</span>
        {volX >= 1.5 && <>, vol {volX.toFixed(1)}×</>}
      </span>
    </span>
  );
}

/** Swipe right to mark done (the button stays for everyone else). */
export function Swipe({ enabled, onDone, children }: { enabled: boolean; onDone: () => void; children: React.ReactNode }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [gone, setGone] = useState(false);
  if (!enabled) return <>{children}</>;
  const end = () => {
    if (!start.current) return;
    start.current = null;
    setDrag(false);
    if (dx > 96) {
      setGone(true);
      setDx(520);
      setTimeout(onDone, 200);
    } else setDx(0);
  };
  return (
    <div className="swipe-track relative overflow-hidden rounded-xl">
      <div aria-hidden className="absolute inset-0 flex items-center rounded-xl bg-up/15 pl-5 text-[14px] font-semibold text-up" style={{ opacity: Math.min(dx / 96, 1) }}>
        ✓ Done
      </div>
      <div
        className={`swipe-card relative ${drag ? "dragging" : ""}`}
        style={{ transform: `translateX(${dx}px)`, opacity: gone ? 0 : 1 }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const s0 = start.current;
          if (!s0) return;
          const mx = e.clientX - s0.x,
            my = e.clientY - s0.y;
          if (!drag) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
              start.current = null; // it's a scroll
              return;
            }
            if (mx > 12) {
              setDrag(true);
              (e.currentTarget as HTMLElement).setPointerCapture(s0.id);
            }
            return;
          }
          setDx(Math.max(0, mx));
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setDrag(false);
          setDx(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ResultsBlock({ r, animate }: { r: ResultsCard; animate?: boolean }) {
  const rows: { k: keyof ResultsCard["current"]; label: string }[] = [
    { k: "revenue", label: "Revenue" },
    { k: "ebitda", label: "EBITDA" },
    { k: "pbt", label: "PBT" },
    { k: "pat", label: "PAT" },
  ];
  const revYoY = pctChange(r.current.revenue, r.yearAgo?.revenue);
  const patYoY = pctChange(r.current.pat, r.yearAgo?.pat);
  const m = (p: ResultsCard["current"] | null) => (p?.ebitda != null && p.revenue ? (p.ebitda / p.revenue) * 100 : null);
  const marginNow = m(r.current), marginYa = m(r.yearAgo);
  return (
    <div className="mt-3">
      {(revYoY != null || patYoY != null) && (
        <p className="text-[15px] leading-snug">
          <span className={`mark ${animate ? "mark-draw" : ""}`}>
            Revenue {signedPct(revYoY)} YoY, PAT {signedPct(patYoY)}
          </span>
          {marginNow != null && marginYa != null && (
            <span className="text-graphite">
              {" "}EBITDA margin {marginNow.toFixed(1)}% ({(marginNow - marginYa) >= 0 ? "+" : "−"}
              {Math.abs((marginNow - marginYa) * 100).toFixed(0)} bps YoY)
            </span>
          )}
        </p>
      )}
      <table className="num mt-2 w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] text-faint">
            <th className="py-1 font-normal">{r.basis === "consolidated" ? "Consolidated" : "Standalone"}, ₹ Cr</th>
            <th className="py-1 text-right font-normal">{r.current.label}</th>
            <th className="py-1 text-right font-normal">QoQ</th>
            <th className="py-1 text-right font-normal">YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, label }) => {
            const v = r.current[k] as number | null;
            if (k === "ebitda" && r.isLender) return null;
            const q = pctChange(v, r.prevQuarter?.[k] as number | null);
            const y = pctChange(v, r.yearAgo?.[k] as number | null);
            return (
              <tr key={k} className="border-t border-rule">
                <td className="py-1.5">{label}</td>
                <td className="py-1.5 text-right">{v == null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                <td className={`py-1.5 text-right ${toneOf(q)}`}>{signedPct(q)}</td>
                <td className={`py-1.5 text-right ${toneOf(y)}`}>{signedPct(y)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-faint">
        vs {r.prevQuarter?.label || "prev. quarter"} and {r.yearAgo?.label || "year-ago quarter"}. {r.ebitdaNote}
        {r.source === "screener" && !r.warnings.length && " Figures from screener.in because the filing PDF couldn't be read."}
      </p>
      {r.warnings.length > 0 && <p className="mt-1 text-[12px] text-down">{r.warnings.join("; ")}</p>}
    </div>
  );
}

function PeopleBlock({ people }: { people: PersonCard[] }) {
  return (
    <ul className="mt-3 space-y-3">
      {people.map((p, i) => (
        <li key={i} className={p.change === "appointed" ? "" : "text-graphite"}>
          <p className="text-[15px]">
            <span className={p.change === "appointed" ? "font-semibold text-ink" : ""}>{p.name}</span>
            <span className="text-graphite">
              {" "}{p.change === "appointed" ? "joins as" : p.change === "resigned" ? "steps down as" : p.change === "retired" ? "retires as" : "—"} {p.role}
              {p.effective ? `, ${p.effective}` : ""}
            </span>
          </p>
          {p.bio && (
            <p className="mt-1 border-l-2 border-marker pl-2.5 text-[14px] leading-snug text-ink/85">
              {p.bio}
              <span className="ml-1 text-[11px] text-faint">{p.bioSource === "web" ? "from web search" : "from the filing"}</span>
            </p>
          )}
          {p.links?.length ? (
            <p className="mt-1 flex gap-3 text-[13px]">
              {p.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">{l.title}</a>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function TopCard(props: {
  item: FeedItem; series?: PriceSeries; isNew: boolean; done: boolean; onDone: () => void; animate?: boolean;
}) {
  return (
    <Swipe enabled={!props.done} onDone={props.onDone}>
      <CardBody {...props} />
    </Swipe>
  );
}

function CardBody({ item, series, isNew, done, onDone, animate }: {
  item: FeedItem; series?: PriceSeries; isNew: boolean; done: boolean; onDone: () => void; animate?: boolean;
}) {
  return (
    <article className={`rounded-xl bg-paper px-4 pb-3 pt-3.5 shadow-[0_1px_0_var(--color-rule)] ${done ? "opacity-55" : ""}`}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate">
          <Link href={`/research/${item.symbol}`} className="text-[15px] font-bold tracking-tight">{item.symbol}</Link>
          <span className="ml-2 text-[13px] text-graphite">{CATEGORY_LABEL[item.category]}</span>
        </h3>
        <span className="num shrink-0 text-[12px] text-faint">
          {isNew && <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-link align-middle" aria-label="new" />}
          {ago(item.time)}
        </span>
      </header>
      <p className="mt-1 text-[14px] leading-snug text-graphite">{item.headline}</p>

      {item.results && (item.results.current.revenue != null || item.results.current.pat != null) && <ResultsBlock r={item.results} animate={animate} />}
      {item.people?.length ? <PeopleBlock people={item.people} /> : null}
      {item.summary && !item.results && (
        <p className="mt-2.5 text-[15px] leading-snug">
          <span className={`mark ${animate ? "mark-draw" : ""}`}>{item.summary}</span>
        </p>
      )}

      <footer className="mt-3 flex items-center justify-between gap-2">
        <DayMove series={series} />
        <div className="flex shrink-0 gap-1 text-[13px]">
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-link hover:bg-stone">Filing</a>
          )}
          <button onClick={onDone} className="rounded-md px-2 py-1 text-ink hover:bg-stone" aria-pressed={done}>
            {done ? "Undo" : "Done"}
          </button>
        </div>
      </footer>
      {item.related?.length ? (
        <details className="mt-1 text-[12px] text-faint">
          <summary className="cursor-pointer">+{item.related.length} related filing{item.related.length > 1 ? "s" : ""} folded in</summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {item.related.map((r) => (
              <li key={r.id}>{r.url ? <a className="hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.headline}</a> : r.headline}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

export function Row({ item, isNew }: { item: FeedItem; isNew: boolean }) {
  return (
    <li className="border-t border-rule py-2.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[14px]">
          <Link href={`/research/${item.symbol}`} className="font-semibold">{item.symbol}</Link>
          <span className="ml-2 text-graphite">{CATEGORY_LABEL[item.category]}</span>
        </p>
        <span className="num shrink-0 text-[12px] text-faint">
          {isNew && <span className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-link align-middle" aria-label="new" />}
          {ago(item.time)}
        </span>
      </div>
      <p className="mt-0.5 text-[14px] leading-snug">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">{item.summary || item.headline}</a>
        ) : (
          item.summary || item.headline
        )}
        {item.category === "earnings_call" && /transcript/i.test(item.headline) && (
          <Link href={`/research/${item.symbol}`} className="ml-2 text-[13px] text-link">Check promises vs delivery</Link>
        )}
      </p>
    </li>
  );
}

