import Link from "next/link";
import type { FeedItem } from "@/lib/types";

/** Dated events pulled out of routine notices: the next two weeks at a glance. */
export function Upcoming({ items, today, muted }: { items: FeedItem[]; today: string; muted: string[] }) {
  const horizon = new Date(Date.parse(today + "T00:00:00Z") + 14 * 864e5).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const ev = items
    .filter((i) => i.event && i.event.date >= today && i.event.date <= horizon && !muted.includes(i.symbol))
    .sort((a, b) => a.event!.date.localeCompare(b.event!.date))
    .filter((i) => {
      const k = `${i.symbol}:${i.event!.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
  if (!ev.length) return null;
  return (
    <section className="mt-6" aria-label="Coming up">
      <h2 className="text-[13px] font-semibold">Coming up</h2>
      <ul className="mt-1">
        {ev.map((i) => {
          const d = new Date(i.event!.date + "T00:00:00");
          return (
            <li key={i.id} className="flex items-center gap-3 border-t border-rule py-2 first:border-t-0">
              <span className="w-11 shrink-0 rounded-md bg-paper py-1 text-center leading-none">
                <span className="block text-[10px] text-graphite">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
                <span className="num block text-[16px] font-bold">{d.getDate()}</span>
              </span>
              <span className="min-w-0 text-[14px]">
                <Link href={`/research/${i.symbol}`} className="font-semibold">{i.symbol}</Link>{" "}
                <span className="text-graphite">{i.event!.what.toLowerCase()}</span>
              </span>
              {i.event!.date === today && <span className="ml-auto shrink-0 text-[12px] font-semibold text-link">Today</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
