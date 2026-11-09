// Deterministic analysis. Every number on the research screen that can be
// computed is computed here, in code — the model never does arithmetic.
// Flags are simple, explainable rules (an analyst can disagree with a
// threshold, but can always see why a flag fired).

import type { CompanyBase, Computed, Flag, Metric, SeriesPoint, Table } from "../types";

const row = (t: Table, k: string) => t.rows[k] || [];

function series(t: Table, k: string, opts: { dropTTM?: boolean; last?: number } = {}): SeriesPoint[] {
  const vals = row(t, k);
  let pts = t.headers.map((h, i) => ({ label: h, value: vals[i] ?? null }));
  if (opts.dropTTM) pts = pts.filter((p) => !/ttm/i.test(p.label));
  if (opts.last) pts = pts.slice(-opts.last);
  return pts;
}

const vals = (s: SeriesPoint[]) => s.map((p) => p.value);
const lastN = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));
const avg = (a: (number | null)[]) => {
  const x = a.filter((v): v is number => v != null);
  return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null;
};
const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

export function cagr(a: number | null | undefined, b: number | null | undefined, years: number): number | null {
  if (a == null || b == null || a <= 0 || b <= 0 || years <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}
export function pct(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

export const fmtCr = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L Cr`;
  if (a >= 1000) return `₹${(n / 1000).toFixed(1)}K Cr`;
  return `₹${n.toFixed(0)} Cr`;
};
export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;

export function compute(b: CompanyBase): Computed {
  const A = b.annual,
    Q = b.quarters,
    BS = b.balance,
    CF = b.cashflow,
    R = b.ratios;

  // ---------- annual series ----------
  const rev = series(A, "revenue", { dropTTM: true, last: 10 });
  const pat = series(A, "pat", { dropTTM: true, last: 10 });
  const opm = series(A, "opm", { dropTTM: true, last: 10 });
  const revV = vals(rev),
    patV = vals(pat),
    opmV = vals(opm);
  const n = revV.length;
  const ttmIdx = A.headers.findIndex((h) => /ttm/i.test(h));
  const ttmRev = ttmIdx >= 0 ? row(A, "revenue")[ttmIdx] : revV[n - 1];
  const ttmPat = ttmIdx >= 0 ? row(A, "pat")[ttmIdx] : patV[n - 1];

  const salesCagr5 = cagr(revV[n - 6], revV[n - 1], 5);
  const salesCagr3 = cagr(revV[n - 4], revV[n - 1], 3);
  const profitCagr5 = cagr(patV[n - 6], patV[n - 1], 5);
  const profitCagr3 = cagr(patV[n - 4], patV[n - 1], 3);

  // ---------- quarters ----------
  const qn = Q.headers.length;
  const qRev = row(Q, "revenue"),
    qOp = row(Q, "op"),
    qPbt = row(Q, "pbt"),
    qPat = row(Q, "pat"),
    qOpm = row(Q, "opm");
  const lastQuarter =
    qn >= 2
      ? {
          label: Q.headers[qn - 1],
          rows: [
            { metric: "Revenue", k: qRev },
            { metric: b.isLender ? "Financing profit" : "EBITDA (op. profit)", k: qOp },
            { metric: "PBT", k: qPbt },
            { metric: "PAT", k: qPat },
          ].map(({ metric, k }) => ({
            metric,
            value: k[qn - 1] ?? null,
            qoq: pct(k[qn - 1], k[qn - 2]),
            yoy: qn >= 5 ? pct(k[qn - 1], k[qn - 5]) : null,
          })),
        }
      : null;

  const qRevenueYoY: SeriesPoint[] = [];
  for (let i = 4; i < qn; i++) qRevenueYoY.push({ label: Q.headers[i], value: pct(qRev[i], qRev[i - 4]) });

  // ---------- trajectory flags ----------
  const tFlags: Flag[] = [];
  if (salesCagr3 != null && salesCagr5 != null) {
    const d = salesCagr3 - salesCagr5;
    if (d > 3) tFlags.push({ text: `Growth accelerating: 3y sales CAGR ${fmtPct(salesCagr3)} vs 5y ${fmtPct(salesCagr5)}`, tone: "good" });
    else if (d < -3) tFlags.push({ text: `Growth slowing: 3y sales CAGR ${fmtPct(salesCagr3)} vs 5y ${fmtPct(salesCagr5)}`, tone: "bad" });
  }
  const opmRecent = avg(lastN(opmV, 3)),
    opmPrior = avg(opmV.slice(-6, -3));
  if (opmRecent != null && opmPrior != null) {
    const bps = (opmRecent - opmPrior) * 100;
    if (Math.abs(bps) >= 150)
      tFlags.push({
        text: `${b.isLender ? "Financing margin" : "Operating margin"} ${bps > 0 ? "expanding" : "compressing"}: ${opmRecent.toFixed(1)}% (3y avg) vs ${opmPrior.toFixed(1)}% before`,
        tone: bps > 0 ? "good" : "bad",
      });
  }
  if (profitCagr3 != null && salesCagr3 != null) {
    if (profitCagr3 > salesCagr3 + 5) tFlags.push({ text: `Operating leverage: profit compounding faster than sales (${fmtPct(profitCagr3)} vs ${fmtPct(salesCagr3)}, 3y)`, tone: "good" });
    if (profitCagr3 < salesCagr3 - 5) tFlags.push({ text: `Profit lagging sales (${fmtPct(profitCagr3)} vs ${fmtPct(salesCagr3)}, 3y)`, tone: "bad" });
  }
  const recentYoY = lastN(vals(qRevenueYoY), 4);
  const lastYoY = recentYoY[recentYoY.length - 1];
  const prevAvg = avg(recentYoY.slice(0, -1));
  if (lastYoY != null && prevAvg != null && Math.abs(lastYoY - prevAvg) > 8)
    tFlags.push({
      text: `Latest quarter revenue YoY ${fmtPct(lastYoY)} vs ${fmtPct(prevAvg)} avg of prior 3 — ${lastYoY > prevAvg ? "inflection up" : "slowdown"}`,
      tone: lastYoY > prevAvg ? "good" : "bad",
    });

  // ---------- balance sheet ----------
  const bn = BS.headers.length;
  const borrowings = series(BS, "borrowings", { last: 10 });
  const equity = row(BS, "equity").map((v, i) => (v ?? 0) + (row(BS, "reserves")[i] ?? 0));
  const de = (i: number) => {
    const d = row(BS, "borrowings")[i];
    return d != null && equity[i] ? d / equity[i] : null;
  };
  const deNow = de(bn - 1),
    de3 = de(bn - 4);
  const cwipNow = row(BS, "cwip")[bn - 1],
    fixedNow = row(BS, "fixed")[bn - 1];
  const rn = R.headers.length;
  const wcNow = row(R, "wcDays")[rn - 1],
    wc3 = row(R, "wcDays")[rn - 4];
  const cccNow = row(R, "ccc")[rn - 1],
    ccc3 = row(R, "ccc")[rn - 4];
  const debtorNow = row(R, "debtorDays")[rn - 1],
    debtor3 = row(R, "debtorDays")[rn - 4];

  const bMetrics: Metric[] = b.isLender
    ? [
        { label: "Borrowings", value: fmtCr(row(BS, "borrowings")[bn - 1]) },
        { label: "Deposits", value: fmtCr(row(BS, "deposits")[bn - 1]) },
        { label: "Net worth", value: fmtCr(equity[bn - 1]) },
      ]
    : [
        { label: "Debt / Equity", value: deNow == null ? "—" : deNow.toFixed(2), sub: de3 == null ? undefined : `${de3.toFixed(2)} 3y ago`, tone: deNow != null && deNow > 1 ? "bad" : "neutral" },
        { label: "Borrowings", value: fmtCr(row(BS, "borrowings")[bn - 1]) },
        { label: "Working-capital days", value: wcNow == null ? "—" : wcNow.toFixed(0), sub: wc3 == null ? undefined : `${wc3.toFixed(0)} 3y ago` },
        { label: "Cash conversion cycle", value: cccNow == null ? "—" : `${cccNow.toFixed(0)} d`, sub: ccc3 == null ? undefined : `${ccc3.toFixed(0)} d 3y ago` },
        { label: "CWIP / fixed assets", value: cwipNow != null && fixedNow ? `${((cwipNow / fixedNow) * 100).toFixed(0)}%` : "—", sub: "capex in progress" },
      ];

  const bFlags: Flag[] = [];
  if (!b.isLender) {
    if (deNow != null && de3 != null && deNow > de3 + 0.25) bFlags.push({ text: `Leverage rising: D/E ${de3.toFixed(2)} → ${deNow.toFixed(2)} in 3 years`, tone: "bad" });
    if (deNow != null && deNow < 0.1) bFlags.push({ text: "Essentially debt-free", tone: "good" });
    if (wcNow != null && wc3 != null && wcNow - wc3 > 20) bFlags.push({ text: `Working capital stretching: ${wc3.toFixed(0)} → ${wcNow.toFixed(0)} days`, tone: "bad" });
    if (debtorNow != null && debtor3 != null && debtorNow - debtor3 > 15) bFlags.push({ text: `Customers paying slower: debtor days ${debtor3.toFixed(0)} → ${debtorNow.toFixed(0)}`, tone: "bad" });
    if (cwipNow != null && fixedNow && cwipNow / fixedNow > 0.3) bFlags.push({ text: `Heavy capex underway: CWIP is ${((cwipNow / fixedNow) * 100).toFixed(0)}% of fixed assets`, tone: "neutral" });
  }

  // ---------- cash quality ----------
  const cfo = series(CF, "cfo", { last: 10 });
  const cfi = series(CF, "cfi", { last: 10 });
  const fcfProxy = cfo.map((p, i) => ({ label: p.label, value: p.value != null && cfi[i]?.value != null ? p.value + cfi[i].value! : null }));
  // align PAT to cash-flow years
  const patByYear = new Map(series(A, "pat", { dropTTM: true }).map((p) => [p.label, p.value]));
  const patAligned = cfo.map((p) => ({ label: p.label, value: patByYear.get(p.label) ?? null }));
  const last5cfo = lastN(vals(cfo), 5),
    last5pat = lastN(vals(patAligned), 5);
  const conversion5y = sum(last5pat) > 0 ? (sum(last5cfo) / sum(last5pat)) * 100 : null;
  const cFlags: Flag[] = [];
  if (!b.isLender && conversion5y != null) {
    if (conversion5y < 70) cFlags.push({ text: `Weak cash conversion: only ${conversion5y.toFixed(0)}% of 5y profit arrived as operating cash`, tone: "bad" });
    else if (conversion5y > 95) cFlags.push({ text: `Profits are real cash: 5y CFO/PAT ${conversion5y.toFixed(0)}%`, tone: "good" });
    else cFlags.push({ text: `Cash conversion adequate: 5y CFO/PAT ${conversion5y.toFixed(0)}%`, tone: "neutral" });
    const negYears = lastN(vals(fcfProxy), 5).filter((v) => v != null && v < 0).length;
    if (negYears >= 3) cFlags.push({ text: `Cash after investing negative in ${negYears} of last 5 years — growth is funded externally`, tone: "bad" });
  }
  if (b.isLender) cFlags.push({ text: "For lenders, operating cash flow mostly reflects loan-book growth — read with caution", tone: "neutral" });

  // ---------- snapshot ----------
  const tr = b.topRatios;
  const snapshot: Metric[] = [
    { label: "Market cap", value: tr["Market Cap"]?.replace(/\s*Cr\.?/, " Cr") || "—" },
    { label: "Revenue (TTM)", value: fmtCr(ttmRev) },
    { label: "PAT (TTM)", value: fmtCr(ttmPat) },
    { label: b.isLender ? "Fin. margin (last Q)" : "OPM (last Q)", value: qOpm[qn - 1] != null ? `${qOpm[qn - 1]}%` : "—" },
    { label: "ROCE", value: tr["ROCE"] || "—" },
    { label: "ROE", value: tr["ROE"] || "—" },
    { label: "P/E", value: tr["Stock P/E"] || "—" },
    { label: "Sales CAGR 5y", value: fmtPct(salesCagr5), tone: salesCagr5 == null ? "neutral" : salesCagr5 > 12 ? "good" : salesCagr5 < 5 ? "bad" : "neutral" },
    { label: "Profit CAGR 5y", value: fmtPct(profitCagr5), tone: profitCagr5 == null ? "neutral" : profitCagr5 > 12 ? "good" : profitCagr5 < 5 ? "bad" : "neutral" },
  ];

  return {
    snapshot,
    lastQuarter,
    trajectory: { revenue: rev, profit: pat, margin: opm, qRevenueYoY, flags: tFlags },
    balance: { metrics: bMetrics, borrowings, flags: bFlags },
    cash: { cfo, pat: patAligned, fcfProxy, conversion5y, flags: cFlags },
    qualityTable: qualityTable(b),
  };
}

/** Compact markdown of the hard numbers, handed to the reasoning model. */
function qualityTable(b: CompanyBase): string {
  const Q = b.quarters,
    A = b.annual;
  const f = (v: number | null | undefined, d = 0) => (v == null ? "-" : v.toFixed(d));
  const lines: string[] = ["QUARTERLY (₹ Cr; YoY% computed vs same quarter prior year)", "Quarter | Revenue | Rev YoY% | OPM% | PAT | PAT YoY%"];
  const qr = row(Q, "revenue"),
    qp = row(Q, "pat"),
    qo = row(Q, "opm");
  for (let i = 0; i < Q.headers.length; i++)
    lines.push(`${Q.headers[i]} | ${f(qr[i])} | ${i >= 4 ? f(pct(qr[i], qr[i - 4]), 1) : "-"} | ${f(qo[i])} | ${f(qp[i])} | ${i >= 4 ? f(pct(qp[i], qp[i - 4]), 1) : "-"}`);
  lines.push("", "ANNUAL (₹ Cr)", "Year | Revenue | Rev growth% | OPM% | PAT | CFO");
  const ar = row(A, "revenue"),
    ap = row(A, "pat"),
    ao = row(A, "opm");
  const cfoBy = new Map(b.cashflow.headers.map((h, i) => [h, row(b.cashflow, "cfo")[i]]));
  const start = Math.max(0, A.headers.length - 7);
  for (let i = start; i < A.headers.length; i++)
    lines.push(`${A.headers[i]} | ${f(ar[i])} | ${i > 0 ? f(pct(ar[i], ar[i - 1]), 1) : "-"} | ${f(ao[i])} | ${f(ap[i])} | ${f(cfoBy.get(A.headers[i]))}`);
  const bs = b.balance;
  lines.push("", "BALANCE SHEET (₹ Cr)", "Year | Borrowings | Net worth | CWIP");
  for (let i = Math.max(0, bs.headers.length - 5); i < bs.headers.length; i++) {
    const nw = (row(bs, "equity")[i] ?? 0) + (row(bs, "reserves")[i] ?? 0);
    lines.push(`${bs.headers[i]} | ${f(row(bs, "borrowings")[i])} | ${f(nw)} | ${f(row(bs, "cwip")[i])}`);
  }
  return lines.join("\n");
}
