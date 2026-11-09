// Offline sanity tests for the deterministic parts: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleClassify, scorePriority, tierOf } from "../src/lib/push/classify";
import { buildCard, reconcile, quarterEnd, fiscalLabel } from "../src/lib/push/results";
import * as cheerio from "cheerio";
import { num } from "../src/lib/pull/screener";
import { cagr } from "../src/lib/pull/metrics";

test("rules classify common BSE subjects", () => {
  const cases: [string, string][] = [
    ["Result | Financial Results | Unaudited Financial Results for the quarter ended September 30, 2026", "results"],
    ["Board Meeting | Board Meeting Intimation | to consider financial results", "results"],
    ["Company Update | Change in Management | Resignation of Chief Financial Officer", "management_change"],
    ["Company Update | Credit Rating | CRISIL reaffirms AA+", "credit_rating"],
    ["Corp. Action | Dividend | Record date for interim dividend", "dividend"],
    ["Company Update | Allotment of equity shares under ESOP", "unclassified"],
    ["Company Update | Appointment of Statutory Auditor", "unclassified"],
    ["Company Update | Earnings Call Transcript", "earnings_call"],
    ["Company Update | Acquisition | Acquisition of 76% stake in XYZ", "M&A"],
    ["Company Update | Receipt of USFDA warning letter", "litigation"],
    ["Insider Trading / SAST | Disclosure under Regulation 29(2)", "insider_trading"],
  ];
  cases.push(
    ["Company Update | Allotment | Allotment of 12,000 equity shares under Employee Stock Option Scheme", "unclassified"],
    ["Board Meeting | Board Meeting Outcome | Unaudited Financial Results and issue of non-convertible debentures", "results"],
  );
  for (const [t, want] of cases) assert.equal(ruleClassify(t), want, t);
});

test("priority encodes materiality", () => {
  const intimation = scorePriority("results", "Board Meeting Intimation to consider results");
  const actual = scorePriority("results", "Financial Results for the quarter");
  assert.equal(tierOf(actual), "top");
  assert.equal(tierOf(intimation), "routine");
  assert.ok(scorePriority("management_change", "Resignation of CFO") > scorePriority("management_change", "Appointment of Independent Director"));
  assert.ok(scorePriority("credit_rating", "rating downgraded to AA-") > scorePriority("credit_rating", "rating reaffirmed"));
  assert.equal(tierOf(scorePriority("fund_raise", "Intimation of Repayment of Commercial Paper")), "normal");
  assert.equal(tierOf(scorePriority("fund_raise", "Board Meeting Intimation to consider NCD issue")), "routine");
});

test("results card: units, EBITDA, sanity checks", () => {
  const card = buildCard({
    found: true, basis: "consolidated", unitAsPrinted: "Rs. in lakhs", isLender: false,
    columns: [
      { label: "Q2 FY27", role: "current", revenueFromOperations: 481240, otherIncome: 1000, financeCosts: 2000, depreciation: 5000, profitBeforeExceptionalAndTax: 15120, profitBeforeTax: 15120, profitAfterTax: 11290 },
      { label: "Q1 FY27", role: "prevQuarter", revenueFromOperations: 412080, otherIncome: 900, financeCosts: 1900, depreciation: 4800, profitBeforeExceptionalAndTax: 12250, profitBeforeTax: 12250, profitAfterTax: 9100 },
    ],
  })!;
  assert.equal(card.current.revenue, 4812.4); // lakhs -> crore
  assert.equal(card.current.ebitda, 211.2); // (15120+2000+5000-1000)/100
  assert.ok(card.warnings.some((w) => /Year-ago/.test(w)));
});

test("screener number parsing", () => {
  assert.equal(num("1,23,456"), 123456);
  assert.equal(num("12%"), 12);
  assert.equal(num(""), null);
  const $ = cheerio.load("<table><tr><td>-1,200</td></tr></table>");
  assert.equal(num($("td").text()), -1200);
  assert.ok(Math.abs(cagr(100, 200, 5)! - 14.87) < 0.01);
});

test("results labels and unit reconciliation", () => {
  assert.equal(fiscalLabel(quarterEnd("Quarter Ended 30th Sep'26")!), "Q2 FY27");
  assert.equal(fiscalLabel(quarterEnd("30.06.2026")!), "Q1 FY27");
  assert.equal(fiscalLabel(quarterEnd("Mar 2026")!), "Q4 FY26");
  const card = buildCard({
    found: true, basis: "consolidated", unitAsPrinted: "Rs crore", isLender: false,
    columns: [{ label: "Quarter ended 30.09.2026", role: "current", revenueFromOperations: 533441, otherIncome: 0, financeCosts: 0, depreciation: 0, profitBeforeExceptionalAndTax: 30000, profitBeforeTax: 30000, profitAfterTax: 24661 }],
  })!;
  const fixed = reconcile(card, { headers: ["Jun 2026", "Sep 2026"], rows: { revenue: [50000, 53344] } });
  assert.equal(fixed.current.revenue, 53344.1);
  assert.equal(fixed.current.pat, 2466.1);
  assert.ok(fixed.warnings.some((w) => /Unit corrected/.test(w)));
});

test("subsidiary housekeeping ranks below real M&A", () => {
  assert.ok(scorePriority("M&A", "Incorporation of a wholly owned subsidiary in Canada") < 60);
  assert.ok(scorePriority("M&A", "Acquisition of 76% stake in XYZ Ltd") >= 60);
});
