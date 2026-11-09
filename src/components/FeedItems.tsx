"use client";
import Link from "next/link";
import type { FeedItem, PersonCard, PriceSeries, ResultsCard } from "@/lib/types";
import { CATEGORY_LABEL, ago, pctChange, signedPct, toneOf } from "@/lib/format";

function DayMove({ series }: { series?: PriceSeries }) {
  if (!series || series.c.length < 22) return null;
  const n = series.c.length;
  const ret = ((series.c[n - 1] - series.c[n - 2]) / series.c[n - 2]) * 100;
  const avg = series.v.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
  const volX = series.v[n - 1] / avg;
  return (
    <span className="num text-[12px] text-graphite">
      Last close <span className={toneOf(ret)}>{signedPct(ret)}</span>
      {volX >= 1.5 && <>, volume {volX.toFixed(1)}× avg</>}
    </span>
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
      </p>
      {r.warnings.length > 0 && <p className="mt-1 text-[12px] text-down">Check against filing: {r.warnings.join("; ")}</p>}
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

export function TopCard({ item, series, isNew, done, onDone, animate }: {
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

      {item.results && <ResultsBlock r={item.results} animate={animate} />}
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
      </p>
    </li>
  );
}

