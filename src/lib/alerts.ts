// Tripwires: the investor decides what "unusual" means; this checks EOD data
// against it. Pure functions so the settings screen can show, live, how often
// a threshold would have fired — the quickest way to calibrate noise.

import type { Category, Feed, FeedItem, Prices } from "./types";

export interface Settings {
  volMult: number; // volume ≥ volMult × trailing average
  volLookback: number; // trading days in the average
  pricePct: number; // |daily move| ≥ pricePct %
  watch: Category[]; // material announcement types that trip an alert
  muted: string[]; // symbols the user has muted
}

export const DEFAULT_SETTINGS: Settings = {
  volMult: 2,
  volLookback: 20,
  pricePct: 4,
  watch: ["results", "M&A", "management_change", "fund_raise", "credit_rating", "pledging", "litigation"],
  muted: [],
};

export interface PriceTrip {
  kind: "volume" | "price" | "both";
  symbol: string;
  date: string;
  close: number;
  ret: number; // %
  volX: number; // multiple of trailing avg
}

export function priceTrips(prices: Prices, s: Settings, sessions = 1): PriceTrip[] {
  const out: PriceTrip[] = [];
  for (const [symbol, ser] of Object.entries(prices.series)) {
    if (s.muted.includes(symbol)) continue;
    const n = ser.c.length;
    for (let i = Math.max(s.volLookback, 1, n - sessions); i < n; i++) {
      const window = ser.v.slice(i - s.volLookback, i);
      const avg = window.reduce((a, b) => a + b, 0) / (window.length || 1);
      const volX = avg ? ser.v[i] / avg : 0;
      const ret = ((ser.c[i] - ser.c[i - 1]) / ser.c[i - 1]) * 100;
      const v = volX >= s.volMult,
        p = Math.abs(ret) >= s.pricePct;
      if (v || p) out.push({ kind: v && p ? "both" : v ? "volume" : "price", symbol, date: ser.d[i], close: ser.c[i], ret, volX });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.ret) - Math.abs(a.ret));
}

export function filingTrips(feed: Feed, s: Settings, sinceMs: number): FeedItem[] {
  return feed.items.filter(
    (i) => s.watch.includes(i.category) && i.priority >= 50 && !s.muted.includes(i.symbol) && Date.parse(i.time) >= sinceMs,
  );
}

/** Re-rank with the user's watched categories: watched types get a lift. */
export function personalPriority(i: FeedItem, s: Settings): number {
  return i.priority + (s.watch.includes(i.category) && i.priority >= 40 ? 8 : 0) - (s.muted.includes(i.symbol) ? 100 : 0);
}
