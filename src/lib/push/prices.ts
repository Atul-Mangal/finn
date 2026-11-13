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
