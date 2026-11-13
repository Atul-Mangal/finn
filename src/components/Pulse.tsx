"use client";
import Link from "next/link";
import type { Prices } from "@/lib/types";
import { dayLabel, signedPct } from "@/lib/format";

/**
 * Every holding as a tile, tinted by its last-session move: the whole portfolio
 * at a glance. Strongest moves sort to the corners; a dot marks names with an
 * important filing in the current window.
 */
export function Pulse({ prices, flagged, muted }: { prices: Prices; flagged: Set<string>; muted: string[] }) {
  const rows = Object.entries(prices.series)
    .filter(([s, ser]) => !muted.includes(s) && ser.c.length >= 2)
    .map(([symbol, ser]) => {
      const n = ser.c.length;
      return { symbol, ret: ((ser.c[n - 1] - ser.c[n - 2]) / ser.c[n - 2]) * 100, date: ser.d[n - 1] };
    })
    .sort((a, b) => b.ret - a.ret);
  if (!rows.length) return null;
  const date = rows.map((r) => r.date).sort().at(-1)!;
  const up = rows.filter((r) => r.ret > 0).length;
  return (
    <section className="mt-6" aria-label="Portfolio pulse">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Last session, {dayLabel(date)}</h2>
        <p className="text-[12px] text-graphite">
          {up} up, {rows.length - up} down
        </p>
      </div>
      <ul className="mt-2 grid grid-cols-4 gap-1">
        {rows.map((r) => {
          const k = Math.min(Math.abs(r.ret) / 4, 1) * 60;
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
