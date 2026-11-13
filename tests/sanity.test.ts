// Offline sanity tests for the deterministic parts: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleClassify, scorePriority, tierOf } from "../src/lib/push/classify";
import { buildCard, reconcile, quarterEnd, fiscalLabel } from "../src/lib/push/results";
import * as cheerio from "cheerio";
import { num } from "../src/lib/pull/screener";
import { cagr } from "../src/lib/pull/metrics";
import { eventDate, eventWhat } from "../src/lib/push/events";
import { pickPages } from "../src/lib/pull/annual";
import { briefScript, speakable } from "../src/lib/speak";
import { parseJsonLoose } from "../src/lib/llm";

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
  // the missing previous quarter is filled from screener AFTER the rescale (not divided by 10)
  assert.equal(fixed.prevQuarter?.revenue, 50000);
  // a 50% disagreement that isn't a unit slip -> screener's figures, with a note
  const off = reconcile({ ...card, current: { ...card.current, revenue: 80000 } }, { headers: ["Jun 2026", "Sep 2026"], rows: { revenue: [50000, 53344], pat: [2000, 2466] } });
  assert.equal(off.source, "screener");
  assert.equal(off.current.revenue, 53344);
  assert.ok(off.warnings.some((w) => /disagreed/.test(w)));
});

test("subsidiary housekeeping ranks below real M&A", () => {
  assert.ok(scorePriority("M&A", "Incorporation of a wholly owned subsidiary in Canada") < 60);
  assert.ok(scorePriority("M&A", "Acquisition of 76% stake in XYZ Ltd") >= 60);
});

test("event dates from board-meeting notices", () => {
  const a = "Titan Company Ltd has informed BSE that a meeting of the Board of Directors of the Company is scheduled on 14/11/2026, inter alia, to consider and approve the Unaudited Financial Results";
  assert.equal(eventDate(a), "2026-11-14");
  assert.equal(eventWhat(a), "Board meeting on results");
  assert.equal(eventDate("The earnings call will be held on November 18, 2026 at 4 PM"), "2026-11-18");
  assert.equal(eventDate("Board meeting to be held on 20th November, 2026"), "2026-11-20");
  assert.equal(eventDate("Outcome of board meeting"), null);
});

test("odd period labels and column-order fallback", () => {
  assert.equal(fiscalLabel(quarterEnd("2Q of FY2026")!), "Q2 FY26");
  const card = buildCard({
    found: true, basis: "consolidated", unitAsPrinted: "Rs crore", isLender: false,
    columns: [
      { label: "30.09.2026", role: "current", revenueFromOperations: 100, otherIncome: 0, financeCosts: 0, depreciation: 0, profitBeforeExceptionalAndTax: 20, profitBeforeTax: 20, profitAfterTax: 15 },
      { label: "31.03.2026", role: "prevQuarter", revenueFromOperations: 90, otherIncome: 0, financeCosts: 0, depreciation: 0, profitBeforeExceptionalAndTax: 18, profitBeforeTax: 18, profitAfterTax: 13 },
    ],
  })!;
  const q = { headers: ["Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"], rows: { revenue: [80, 85, 90, 95, 100], pat: [10, 11, 12, 14, 15] } };
  const fixed = reconcile(card, q);
  assert.equal(fixed.source, "screener");
  assert.equal(fixed.prevQuarter?.label, "Q1 FY27");
  assert.ok(fixed.warnings.some((w) => /out of order/.test(w)));
});

test("annual report: picks the opinion page and the notes with numbers", () => {
  const nums = " 1,234.5 678.9 2,345.6 987.1".repeat(20);
  const pages = [
    "Contents Independent Auditor's Report 210 Related party 260", // table of contents: no opinion text, few digits
    "Chairman's letter. We had a good year.",
    "INDEPENDENT AUDITOR'S REPORT To the Members. Opinion We have audited... true and fair view. Basis for Opinion ... Key Audit Matters",
    "Significant accounting policies: contingent liabilities are disclosed when there is a possible obligation.", // policy text, no numbers
    "Note 38 Contingent liabilities: claims against the company not acknowledged as debts: income tax matters" + nums,
    "Note 41 Related party disclosures. Related parties and key managerial personnel. Transactions with related parties: sale of goods" + nums,
  ];
  const p = pickPages(pages);
  assert.deepEqual(p.auditor, [2]);
  assert.deepEqual(p.contingent, [4]);
  assert.deepEqual(p.related, [5]);
  // the consolidated note wins over the standalone one
  const both = [
    "Notes to the Standalone Financial Statements. Contingent liabilities: claims not acknowledged as debts; corporate guarantee to subsidiary" + nums,
    "Notes to the Consolidated Financial Statements. Contingent liabilities: claims not acknowledged as debts" + nums,
  ];
  assert.equal(pickPages(both).contingent[0], 0); // both are kept (top 2), in page order…
  assert.deepEqual(pickPages([both[0], both[1], both[1], both[1]]).contingent, [1, 2]); // …but consolidated pages outrank standalone
});

test("spoken brief is built from the ranked data", () => {
  assert.equal(speakable("Order worth ₹1,150 Cr; margin −467 bps YoY, PAT +7%"), "Order worth 1,150 crore rupees; margin minus 467 basis points year on year, PAT +7 percent");
  const item = {
    id: "1", symbol: "IRCTC", company: "IRCTC Ltd", time: "2026-11-12T17:45:00+05:30", category: "results", categorySource: "rule", headline: "Results", priority: 92, tier: "top",
    results: { basis: "consolidated", unit: "₹ Cr", isLender: false, warnings: [], current: { label: "Q2 FY27", revenue: 1333, ebitda: 408, pbt: 356, pat: 264 }, prevQuarter: null, yearAgo: { label: "Q2 FY26", revenue: 1146, ebitda: 404, pbt: 457, pat: 342 } },
  } as never;
  const lines = briefScript({ windowLabel: "in the last 24 hours", open: [item], glance: 3, routine: 5, trips: [{ kind: "volume", symbol: "IRCTC", date: "2026-11-12", close: 700, ret: 2.6, volX: 6 }], names: { IRCTC: "IRCTC Ltd" } });
  assert.equal(lines[0], "1 filing needs you in the last 24 hours.");
  assert.equal(lines[1], "IRCTC reported results. Revenue up 16 percent, profit down 23 percent on last year.");
  assert.match(lines[2], /IRCTC traded 6.0 times its usual volume, up 2.6 percent/);
  assert.match(lines[3], /3 more are worth a glance, and 5 routine filings are folded away/);
});

test("tolerant JSON parsing keeps URLs intact", () => {
  const raw = '```json\n{\n "a": 1, // the total\n "u": "https://x.in/a",\n "l": ["p", "q",],\n}\n```';
  assert.deepEqual(parseJsonLoose(raw), { a: 1, u: "https://x.in/a", l: ["p", "q"] });
});
