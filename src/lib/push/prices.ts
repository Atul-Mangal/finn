// End-of-day price & volume from Yahoo Finance's chart endpoint (the same data
// yfinance wraps). NSE first, BSE as fallback.

import { fetchJson } from "../http";
import type { PriceSeries } from "../types";

interface ChartResp {
  chart: {
    result?: {
      timestamp?: number[];
      indicators: { quote: { close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description: string } | null;
  };
}

export async function fetchEod(symbol: string, range = "6mo"): Promise<PriceSeries> {
  let lastErr: unknown;
  const attempts = [".NS", ".BO"].flatMap((suffix) => ["query1", "query2"].map((host) => ({ suffix, host })));
  for (const { suffix, host } of attempts) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + suffix)}?range=${range}&interval=1d`;
      const j = await fetchJson<ChartResp>(url);
      const r = j.chart.result?.[0];
      if (!r?.timestamp) throw new Error(j.chart.error?.description || "no data");
      const q = r.indicators.quote[0];
      const out: PriceSeries = { d: [], c: [], v: [] };
      r.timestamp.forEach((ts, i) => {
        const c = q.close[i];
        const v = q.volume[i];
        if (c == null || v == null) return;
        // timestamps are market-open instants; shift to IST to get the trading date
        out.d.push(new Date((ts + 5.5 * 3600) * 1000).toISOString().slice(0, 10));
        out.c.push(+c.toFixed(2));
        out.v.push(v);
      });
      // End-of-day data only: while the market is open (or just after), today's bar
      // is a partial day — half the volume, a mid-session price. Drop it.
      const nowIst = new Date(Date.now() + 5.5 * 3600e3);
      const todayIst = nowIst.toISOString().slice(0, 10);
      const minutes = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      if (out.d[out.d.length - 1] === todayIst && minutes < 16 * 60) {
        out.d.pop();
        out.c.pop();
        out.v.pop();
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Yahoo intermittently returns blanks for recent sessions, then fills them in
 * later. So a refresh never throws away a bar we already stored: fresh data
 * wins where it exists, stored bars fill the gaps (within the fresh range).
 */
export function mergeSeries(stored: PriceSeries | undefined, fresh: PriceSeries): PriceSeries {
  if (!stored?.d.length) return fresh;
  if (!fresh.d.length) return stored;
  const rows = new Map<string, [number, number]>();
  stored.d.forEach((d, i) => {
    if (d >= fresh.d[0]) rows.set(d, [stored.c[i], stored.v[i]]);
  });
  fresh.d.forEach((d, i) => rows.set(d, [fresh.c[i], fresh.v[i]]));
  const dates = [...rows.keys()].sort();
  return { d: dates, c: dates.map((d) => rows.get(d)![0]), v: dates.map((d) => rows.get(d)![1]) };
}
