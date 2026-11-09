// Quarterly results → headline numbers.
//
// Division of labour: the cheap model only *reads* the results table (copies
// line items for the three quarter columns). Everything else — unit
// conversion, EBITDA derivation, QoQ/YoY maths, sanity checks — is plain code,
// so numbers are reproducible and a bad extraction gets flagged instead of
// silently shown.

import { llmJson } from "../llm";
import type { ResultsCard, ResultsPeriod, UsageSummary } from "../types";

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
${text.slice(0, 60000)}`;
}

function toCrore(unit: string): number {
  const u = unit.toLowerCase();
  if (/lakh|lac/.test(u)) return 0.01;
  if (/million|mn\b/.test(u)) return 0.1;
  if (/billion|bn\b/.test(u)) return 100;
  if (/thousand|'000/.test(u)) return 0.0001;
  return 1; // crore
}

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
    return {
      label: (c.label || "").split("(")[0].trim() || c.role,
      revenue: s(c.revenueFromOperations),
      ebitda: s(ebitda),
      pbt: s(c.profitBeforeTax),
      pat: s(c.profitAfterTax),
    };
  };

  const cur = toPeriod(raw.columns.find((c) => c.role === "current") || raw.columns[0]);
  if (!cur) return null;
  const prev = toPeriod(raw.columns.find((c) => c.role === "prevQuarter"));
  const ya = toPeriod(raw.columns.find((c) => c.role === "yearAgo"));

  // Sanity checks — surfaced to the user rather than hidden.
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
