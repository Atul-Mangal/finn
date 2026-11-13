// Quarterly results → headline numbers.
//
// Division of labour: the cheap model only *reads* the results table (copies
// line items for the three quarter columns). Everything else — unit
// conversion, EBITDA derivation, QoQ/YoY maths, sanity checks — is plain code,
// so numbers are reproducible and a bad extraction gets flagged instead of
// silently shown.

import { llmJson } from "../llm";
import type { ResultsCard, ResultsPeriod, Table, UsageSummary } from "../types";

interface RawColumn {
  label: string;
  role: "current" | "prevQuarter" | "yearAgo";
  revenueFromOperations: number | null;
  otherIncome: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeExceptionalAndTax: number | null;
  profitBeforeTax: number | null;
  profitAfterTax: number | null;
}

interface RawResults {
  found: boolean;
  basis: "consolidated" | "standalone";
  unitAsPrinted: string;
  isLender: boolean;
  columns: RawColumn[];
}

const SYSTEM =
  "You copy numbers from Indian listed-company quarterly results filings (SEBI format). " +
  "You never compute, estimate or round. If a value is not printed, use null. Output JSON only.";

function prompt(text: string) {
  return `From the results statement below, extract the QUARTERLY columns ("3 months/quarter ended") only — ignore half-year, nine-month and full-year columns.
Use the CONSOLIDATED statement if one is present, otherwise standalone.
Return JSON:
{
 "found": true|false,            // false if this document has no results table
 "basis": "consolidated"|"standalone",
 "unitAsPrinted": "e.g. Rs in crore / Rs in lakhs / Rs in million",
 "isLender": true|false,         // bank, NBFC or insurer (statement shows interest earned / provisions)
 "columns": [
  {"label":"Q2 FY26 (quarter ended 30-Sep-2025)","role":"current|prevQuarter|yearAgo",
   "revenueFromOperations": n,  // banks: "Total income"
   "otherIncome": n, "financeCosts": n, "depreciation": n,
   "profitBeforeExceptionalAndTax": n, "profitBeforeTax": n,
   "profitAfterTax": n          // net profit for the period, before OCI
  }
 ]
}
Negative numbers (losses) as negative. Copy exactly as printed, in the printed unit.

--- DOCUMENT ---
${text.slice(0, 45000)}`;
}

function toCrore(unit: string): number {
  const u = unit.toLowerCase();
  if (/lakh|lac/.test(u)) return 0.01;
  if (/million|mn\b/.test(u)) return 0.1;
  if (/billion|bn\b/.test(u)) return 100;
  if (/thousand|'000/.test(u)) return 0.0001;
  return 1; // crore
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Find a quarter-end date in a column label: "30.09.2026", "Sep'26", "September 30, 2026", "Q2 FY27". */
export function quarterEnd(label: string): { y: number; m: number } | null {
  const t = label.toLowerCase();
  let m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return { y, m: +m[2] };
  }
  m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9]{0,6}(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?'?(\d{2,4})/);
  if (m) {
    const y = +m[2] < 100 ? 2000 + +m[2] : +m[2];
    return { y, m: MONTHS[m[1]] };
  }
  m = t.match(/q([1-4])\s*fy\s*'?(\d{2,4})/);
  if (m) {
    const fy = +m[2] < 100 ? 2000 + +m[2] : +m[2];
    const q = +m[1];
    return { y: q === 4 ? fy : fy - 1, m: [6, 9, 12, 3][q - 1] };
  }
  return null;
}
export function fiscalLabel(d: { y: number; m: number }): string {
  const q = d.m >= 4 && d.m <= 6 ? 1 : d.m <= 9 && d.m >= 7 ? 2 : d.m >= 10 ? 3 : 4;
  const fy = d.m >= 4 ? d.y + 1 : d.y;
  return `Q${q} FY${String(fy).slice(-2)}`;
}
const monthsBetween = (a: { y: number; m: number }, b: { y: number; m: number }) => (a.y - b.y) * 12 + (a.m - b.m);

const r1 = (n: number | null) => (n == null || !isFinite(n) ? null : Math.round(n * 10) / 10);

export function buildCard(raw: RawResults): ResultsCard | null {
  if (!raw?.found || !raw.columns?.length) return null;
  const k = toCrore(raw.unitAsPrinted || "crore");
  const warnings: string[] = [];

  const toPeriod = (c: RawColumn | undefined): ResultsPeriod | null => {
    if (!c) return null;
    const pbtPre = c.profitBeforeExceptionalAndTax ?? c.profitBeforeTax;
    let ebitda: number | null = null;
    if (!raw.isLender && pbtPre != null && c.financeCosts != null && c.depreciation != null) {
      ebitda = pbtPre + c.financeCosts + c.depreciation - (c.otherIncome ?? 0);
    }
    const s = (n: number | null) => (n == null ? null : r1(n * k));
    const d = quarterEnd(c.label || "");
    return {
      label: d ? fiscalLabel(d) : (c.label || "").split("(")[0].trim() || c.role,
      revenue: s(c.revenueFromOperations),
      ebitda: s(ebitda),
      pbt: s(c.profitBeforeTax),
      pat: s(c.profitAfterTax),
    };
  };

  const cur = toPeriod(raw.columns.find((c) => c.role === "current") || raw.columns[0]);
  // A table read with no revenue and no profit is a failed read, not a result.
  if (!cur || (cur.revenue == null && cur.pat == null)) return null;
  const prev = toPeriod(raw.columns.find((c) => c.role === "prevQuarter"));
  const ya = toPeriod(raw.columns.find((c) => c.role === "yearAgo"));

  // Sanity checks — surfaced to the user rather than hidden.
  const dc = quarterEnd(raw.columns.find((c) => c.role === "current")?.label || "");
  const dp = quarterEnd(raw.columns.find((c) => c.role === "prevQuarter")?.label || "");
  const dy = quarterEnd(raw.columns.find((c) => c.role === "yearAgo")?.label || "");
  if (dc && dp && monthsBetween(dc, dp) !== 3) warnings.push(`"Previous quarter" column is ${prev?.label}, not 3 months earlier`);
  if (dc && dy && monthsBetween(dc, dy) !== 12) warnings.push(`"Year-ago" column is ${ya?.label}, not 12 months earlier`);
  if (!prev) warnings.push("Previous-quarter column not found");
  if (!ya) warnings.push("Year-ago column not found");
  if (cur.revenue != null && cur.revenue <= 0) warnings.push("Revenue ≤ 0 — check extraction");
  if (cur.pbt != null && cur.pat != null && cur.pbt > 0 && cur.pat > cur.pbt * 1.05)
    warnings.push("PAT above PBT — tax credit or extraction error");
  if (cur.revenue && prev?.revenue && Math.abs(cur.revenue / prev.revenue - 1) > 0.8)
    warnings.push("Revenue moved >80% QoQ — verify against filing");

  return {
    basis: raw.basis || "standalone",
    unit: "₹ Cr",
    current: cur,
    prevQuarter: prev,
    yearAgo: ya,
    isLender: !!raw.isLender,
    ebitdaNote: raw.isLender
      ? "EBITDA not meaningful for lenders — interest is the business"
      : "EBITDA derived: PBT (pre-exceptional) + finance cost + D&A − other income",
    warnings,
    source: "filing",
  };
}

/**
 * Fallback when the filing PDF is a scanned image: screener.in's standardised
 * quarterly table (itself built from the exchange filings). Labelled as such.
 */
export function cardFromScreener(q: Table, isLender: boolean, basis: "consolidated" | "standalone", at_?: number): ResultsCard | null {
  const n = (at_ ?? q.headers.length - 1) + 1;
  if (n < 2) return null;
  const at = (i: number): ResultsPeriod | null => {
    if (i < 0) return null;
    const d = quarterEnd(q.headers[i]);
    const g = (k: string) => q.rows[k]?.[i] ?? null;
    return { label: d ? fiscalLabel(d) : q.headers[i], revenue: g("revenue"), ebitda: isLender ? null : g("op"), pbt: g("pbt"), pat: g("pat") };
  };
  return {
    basis,
    unit: "₹ Cr",
    current: at(n - 1)!,
    prevQuarter: at(n - 2),
    yearAgo: n >= 5 ? at(n - 5) : null,
    isLender,
    ebitdaNote: isLender ? "EBITDA not meaningful for lenders — interest is the business" : "EBITDA = operating profit before other income (screener.in)",
    warnings: [],
    source: "screener",
  };
}

export async function extractResults(text: string, usage: UsageSummary): Promise<ResultsCard | null> {
  if (text.length < 500) return null; // scanned PDF or cover letter only
  const raw = await llmJson<RawResults>("cheap", { system: SYSTEM, prompt: prompt(text), maxOutputTokens: 2500 }, usage);
  return buildCard(raw);
}

export function pctChange(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

/**
 * Cross-check a filing-extracted card against screener.in's quarterly table.
 * - A ~10x/100x/1000x gap means the unit was misread (e.g. ₹ million read as
 *   crore): rescale and say so.
 * - Any other gap over 25% means the model read the wrong column or basis; we
 *   don't show a number we know disagrees — switch to screener's figures and
 *   say why.
 * Lenders are compared on PAT: "revenue" means total income in a bank's filing
 * but interest earned on screener.
 */
export function reconcile(card: ResultsCard, q: Table): ResultsCard {
  if (card.source !== "filing") return card;
  const target = quarterEnd(card.current.label);
  const idx = q.headers.findIndex((h) => {
    const d = quarterEnd(h);
    return d && target && d.y === target.y && d.m === target.m;
  });
  if (idx < 0) return card; // screener hasn't caught up with this quarter yet
  const key = card.isLender ? "pat" : "revenue";
  const ref = q.rows[key]?.[idx] ?? null;
  const got = card.current[key];
  if (ref == null || got == null || ref <= 0 || got <= 0) return card;
  const ratio = got / ref;
  const near = (x: number, k: number) => Math.abs(x / k - 1) < 0.2;
  for (const k of [10, 100, 1000, 0.1, 0.01]) {
    if (near(ratio, k)) {
      const fix = (p: ResultsPeriod | null): ResultsPeriod | null =>
        p && { ...p, revenue: r1(p.revenue == null ? null : p.revenue / k), ebitda: r1(p.ebitda == null ? null : p.ebitda / k), pbt: r1(p.pbt == null ? null : p.pbt / k), pat: r1(p.pat == null ? null : p.pat / k) };
      return {
        ...card,
        current: fix(card.current)!,
        prevQuarter: fix(card.prevQuarter),
        yearAgo: fix(card.yearAgo),
        warnings: [...card.warnings, `Unit corrected (filing figures were ${k}× screener.in's) — verify against filing`],
      };
    }
  }
  if (Math.abs(ratio - 1) > 0.25) {
    const alt = cardFromScreener(q, card.isLender, card.basis, idx);
    if (alt) {
      alt.warnings.push(`Automatic read of the filing disagreed with screener.in by ${((ratio - 1) * 100).toFixed(0)}% on ${key === "pat" ? "PAT" : "revenue"} — showing screener.in's figures`);
      return alt;
    }
  }
  return card;
}
