import type { Category } from "./types";

export const CATEGORY_LABEL: Record<Category, string> = {
  results: "Results",
  "M&A": "M&A",
  fund_raise: "Fund raise",
  management_change: "Management",
  litigation: "Litigation",
  insider_trading: "Insider trade",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meet",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus / split",
  capex: "Capex",
  press_release: "News",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM / EGM",
  pledging: "Pledge",
  unclassified: "Routine",
};

export function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

export function crore(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 1000 ? 0 : 1 })} Cr`;
}

export function signedPct(n: number | null | undefined, d = 1): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
}

export function toneOf(n: number | null | undefined): string {
  if (n == null || !isFinite(n) || Math.abs(n) < 0.05) return "text-graphite";
  return n > 0 ? "text-up" : "text-down";
}

export function dayLabel(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function pctChange(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

/** The promise-ledger headline, counted in code so it's consistent across companies. */
export function scoreLine(promises: { verdict: string }[]): string {
  const n = (v: string) => promises.filter((p) => p.verdict === v).length;
  const kept = n("delivered"),
    missed = n("missed"),
    partial = n("partial"),
    open = n("pending") + n("unverifiable");
  const checkable = kept + missed + partial;
  if (!promises.length) return "No explicit guidance found in the recent calls.";
  if (!checkable) return `None of ${promises.length} promises can be checked against the filed numbers yet.`;
  const parts = [`Kept ${kept} of ${checkable} checkable promise${checkable > 1 ? "s" : ""}`];
  if (missed) parts.push(`${missed} missed`);
  if (partial) parts.push(`${partial} partly met`);
  return parts.join("; ") + "." + (open ? ` ${open} more can't be checked yet.` : "");
}
