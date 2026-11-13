"use client";
import Link from "next/link";
import type { Prices } from "@/lib/types";
import { dayLabel, signedPct } from "@/lib/format";

/**
 * Every holding as a tile, tinted by its last-session move: the whole portfolio
 * at a glance. Strongest moves sort to the corners; a dot marks names with an
 * important filing in the current window.
 */
export function Pulse({ prices, flagged, muted, sinceMs, sessions }: {
  prices: Prices; flagged: Set<string>; muted: string[];
  sinceMs: number; // start of the selected window
  sessions?: number; // for "24 hours": exactly the last session
}) {
  const sinceDay = new Date(sinceMs + 5.5 * 3600e3).toISOString().slice(0, 10);
  const rows = Object.entries(prices.series)
    .filter(([s, ser]) => !muted.includes(s) && ser.c.length >= 2)
    .map(([symbol, ser]) => {
      const n = ser.c.length;
      // Move over the window: from the close before the window's first session to the latest close.
      let first = sessions ? n - sessions : ser.d.findIndex((d) => d > sinceDay);
      if (first < 1) first = first === -1 ? n - 1 : 1;
      const base = ser.c[first - 1];
      return { symbol, ret: ((ser.c[n - 1] - base) / base) * 100, date: ser.d[n - 1], from: ser.d[first] };
    })
    .sort((a, b) => b.ret - a.ret);
  if (!rows.length) return null;
  const date = rows.map((r) => r.date).sort().at(-1)!;
  const from = rows.map((r) => r.from).sort()[0];
  const up = rows.filter((r) => r.ret > 0).length;
  const scale = Math.max(4, ...rows.map((r) => Math.abs(r.ret))) / 1.5; // longer windows, bigger moves
  return (
    <section className="mt-6" aria-label="Portfolio pulse">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">
          {from === date ? <>Last session, {dayLabel(date)}</> : <>{dayLabel(from)} to {dayLabel(date)}</>}
        </h2>
        <p className="text-[12px] text-graphite">
          {up} up, {rows.length - up} down
        </p>
      </div>
      <ul className="mt-2 grid grid-cols-4 gap-1">
        {rows.map((r) => {
          const k = Math.min(Math.abs(r.ret) / scale, 1) * 60;
          const tint = r.ret >= 0 ? "var(--color-up)" : "var(--color-down)";
          return (
            <li key={r.symbol}>
              <Link
                href={`/research/${r.symbol}`}
                className="relative block rounded-md px-1.5 py-1.5"
                style={{ background: `color-mix(in oklab, ${tint} ${k.toFixed(0)}%, var(--color-paper))` }}
                aria-label={`${r.symbol} ${signedPct(r.ret)}`}
              >
                <span className="block truncate text-[11px] font-semibold tracking-tight">{r.symbol}</span>
                <span className="num block text-[11px]">{signedPct(r.ret)}</span>
                {flagged.has(r.symbol) && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-ink" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
