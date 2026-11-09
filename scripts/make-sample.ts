// Generates clearly-labelled SAMPLE data with fictional companies so the UI is
// usable before the first real pipeline run. The app shows a banner whenever
// it is rendering sample data. Real runs overwrite these files.
import fs from "node:fs";
import path from "node:path";
import type { Feed, FeedItem, Prices, PortfolioEntry, Research } from "../src/lib/types";
import { compute } from "../src/lib/pull/metrics";
import { newUsage } from "../src/lib/llm";

const OUT = path.join(process.cwd(), "public", "data");
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const portfolio: PortfolioEntry[] = [
  ["ALPHAFIN", "Alpha Finance (sample)", "NBFC"],
  ["BHARATCAB", "Bharat Cables (sample)", "Cables"],
  ["CEDARPH", "Cedar Pharma (sample)", "Pharma"],
  ["DELTAEMS", "Delta Electronics Mfg (sample)", "EMS"],
  ["EASTPAINT", "Eastern Paints (sample)", "Paints"],
  ["FALCONDEF", "Falcon Defence (sample)", "Defence"],
  ["GANGAFOOD", "Ganga Foods (sample)", "FMCG"],
  ["HELIXIT", "Helix Infotech (sample)", "IT Services"],
].map(([symbol, name, sector], i) => ({ symbol, name, sector, bse: String(900001 + i) }));

const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600e3).toISOString();
let id = 1;
const item = (p: Partial<FeedItem> & Pick<FeedItem, "symbol" | "category" | "headline" | "priority">, h: number): FeedItem => ({
  id: String(id++),
  company: portfolio.find((x) => x.symbol === p.symbol)!.name,
  time: ago(h),
  categorySource: "rule",
  tier: p.priority >= 60 ? "top" : p.priority >= 35 ? "normal" : "routine",
  ...p,
});

const items: FeedItem[] = [
  item({
    symbol: "DELTAEMS", category: "results", priority: 90, headline: "Unaudited Financial Results for the quarter ended 30 September 2026",
    results: {
      basis: "consolidated", unit: "₹ Cr", isLender: false, warnings: [],
      ebitdaNote: "EBITDA derived: PBT (pre-exceptional) + finance cost + D&A − other income",
      current: { label: "Q2 FY27", revenue: 4812.4, ebitda: 201.6, pbt: 151.2, pat: 112.9 },
      prevQuarter: { label: "Q1 FY27", revenue: 4120.8, ebitda: 168.3, pbt: 122.5, pat: 91.0 },
      yearAgo: { label: "Q2 FY26", revenue: 3305.1, ebitda: 150.7, pbt: 118.4, pat: 87.6 },
    },
    related: [{ id: "x1", headline: "Investor Presentation Q2 FY27" }, { id: "x2", headline: "Newspaper publication of results" }],
  }, 3),
  item({
    symbol: "CEDARPH", category: "management_change", priority: 85, headline: "Appointment of Chief Financial Officer and Key Managerial Personnel",
    people: [
      { name: "Priya Raman (fictional)", role: "Chief Financial Officer", change: "appointed", effective: "1 Dec 2026",
        bio: "Chartered accountant; previously CFO of a mid-size API manufacturer for 6 years and 11 years in treasury at a large Indian pharma company.", bioSource: "filing" },
      { name: "Anil Mehta (fictional)", role: "Chief Financial Officer", change: "resigned", effective: "30 Nov 2026" },
    ],
  }, 6),
  item({ symbol: "ALPHAFIN", category: "credit_rating", priority: 80, headline: "Credit rating: long-term rating revised to AA- (Negative) from AA (Stable)",
    summary: "Rating agency cut long-term debt rating one notch to AA- with negative outlook, citing rising stage-3 loans in unsecured book." }, 9),
  item({ symbol: "BHARATCAB", category: "M&A", priority: 80, headline: "Acquisition of 76% stake in a specialty wires company",
    summary: "Buying 76% of a specialty wires maker for ₹420 Cr cash (~1.4x sales); adds EV and solar cable capacity, closing by Q4." }, 14),
  item({ symbol: "FALCONDEF", category: "press_release", priority: 55, headline: "Receipt of order worth ₹1,150 Cr from Ministry of Defence",
    summary: "₹1,150 Cr order, about 0.4x FY26 revenue; execution over 3 years lifts order book visibility." }, 20),
  item({ symbol: "EASTPAINT", category: "dividend", priority: 45, headline: "Interim dividend of ₹5 per share; record date 18 November",
    summary: "Interim dividend ₹5/share (yield ~0.3%); record date 18 Nov." }, 22),
  item({ symbol: "HELIXIT", category: "insider_trading", priority: 50, headline: "Disclosure by promoter group under SAST — sale of 1.2% stake",
    summary: "Promoter group sold 1.2% via block deal; promoter holding now 48.6%." }, 30),
  item({ symbol: "GANGAFOOD", category: "litigation", priority: 45, headline: "GST demand order of ₹38 Cr; company to appeal",
    summary: "₹38 Cr GST demand (~4% of net worth); company says it has strong grounds to appeal." }, 40),
  item({ symbol: "DELTAEMS", category: "earnings_call", priority: 20, headline: "Intimation of earnings call on 12 November" }, 26),
  item({ symbol: "HELIXIT", category: "investor_meetings", priority: 12, headline: "Schedule of analyst / institutional investor meetings" }, 8),
  item({ symbol: "CEDARPH", category: "unclassified", priority: 5, headline: "Allotment of equity shares under ESOP scheme" }, 11),
  item({ symbol: "EASTPAINT", category: "unclassified", priority: 5, headline: "Certificate under Regulation 74(5) of SEBI (DP) Regulations" }, 16),
  item({ symbol: "FALCONDEF", category: "agm_egm", priority: 20, headline: "Scrutinizer's report on e-voting" }, 50),
  item({ symbol: "BHARATCAB", category: "unclassified", priority: 5, headline: "Loss of share certificate" }, 60),
  item({ symbol: "GANGAFOOD", category: "results", priority: 25, headline: "Board meeting intimation: to consider results for Q2 FY27" }, 70),
  item({ symbol: "ALPHAFIN", category: "fund_raise", priority: 70, headline: "Allotment of non-convertible debentures worth ₹1,000 Cr",
    summary: "Raised ₹1,000 Cr via NCDs at 8.9% coupon — ~60 bps above its last issue, consistent with the rating pressure." }, 100),
];

const feed: Feed = {
  generatedAt: new Date().toISOString(),
  sample: true,
  windowDays: 30,
  portfolio,
  items,
  usage: { ...newUsage(), cheapCalls: 14, strongCalls: 0, cacheHits: 31, inputTokens: 98000, outputTokens: 6100, estCostUSD: 0.0122 },
  errors: [],
};

// Prices: random walks; DELTAEMS gets a results-day volume spike, ALPHAFIN a drop.
const prices: Prices = { generatedAt: new Date().toISOString(), sample: true, series: {} };
const days: string[] = [];
for (let i = 120; i >= 0; i--) {
  const d = new Date(now - i * 864e5);
  if (d.getDay() === 0 || d.getDay() === 6) continue;
  days.push(d.toISOString().slice(0, 10));
}
for (const p of portfolio) {
  let c = 200 + rnd() * 3000;
  const base = 2e5 + rnd() * 2e6;
  const s = { d: days, c: [] as number[], v: [] as number[] };
  days.forEach((_, i) => {
    let r = (rnd() - 0.5) * 0.03;
    let v = base * (0.7 + rnd() * 0.6);
    const last = i === days.length - 1;
    if (last && p.symbol === "DELTAEMS") { r = 0.072; v = base * 3.4; }
    if (last && p.symbol === "ALPHAFIN") { r = -0.058; v = base * 2.3; }
    if (i === days.length - 8 && p.symbol === "FALCONDEF") { r = 0.051; v = base * 2.1; }
    c = c * (1 + r);
    s.c.push(+c.toFixed(2));
    s.v.push(Math.round(v));
  });
  prices.series[p.symbol] = s;
}

// Research sample for a fictional company.
const yrs = ["Mar 2017", "Mar 2018", "Mar 2019", "Mar 2020", "Mar 2021", "Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025", "Mar 2026", "TTM"];
const rev = [1210, 1405, 1690, 1820, 2105, 2860, 3910, 5480, 7650, 10420, 11980];
const opm = [7.1, 7.4, 7.0, 6.8, 6.5, 6.1, 5.4, 4.9, 4.6, 4.4, 4.3];
const pat = rev.map((r, i) => +(r * (opm[i] - 2.6) / 100).toFixed(0));
const qh = ["Sep 2023", "Dec 2023", "Mar 2024", "Jun 2024", "Sep 2024", "Dec 2024", "Mar 2025", "Jun 2025", "Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"];
const qrev = [1310, 1405, 1540, 1690, 1840, 1960, 2160, 2310, 2470, 2650, 2990, 2780, 3210];
const qopm = [5.0, 4.9, 4.8, 4.7, 4.6, 4.5, 4.6, 4.4, 4.3, 4.4, 4.5, 4.2, 4.3];
const base: Research["base"] = {
  symbol: "SAMPLECO", name: "SampleCo Electronics (fictional)", basis: "consolidated", isLender: false,
  about: "Fictional contract manufacturer of consumer electronics and EV components for global brands, used to demo FINN before live data is loaded.",
  topRatios: { "Market Cap": "₹ 42,300 Cr.", "Stock P/E": "88.1", ROCE: "21.4 %", ROE: "18.9 %" },
  quarters: { headers: qh, rows: { revenue: qrev, op: qrev.map((r, i) => +(r * qopm[i] / 100).toFixed(0)), opm: qopm, pbt: qrev.map((r, i) => +(r * (qopm[i] - 1.6) / 100).toFixed(0)), pat: qrev.map((r, i) => +(r * (qopm[i] - 2.4) / 100).toFixed(0)) } },
  annual: { headers: yrs, rows: { revenue: rev, opm, pat } },
  balance: { headers: yrs.slice(3, 10), rows: { equity: [12, 12, 12, 12, 12, 12, 12], reserves: [410, 480, 610, 790, 1010, 1320, 1780], borrowings: [120, 140, 260, 420, 610, 980, 1430], cwip: [10, 15, 40, 90, 160, 210, 380], fixed: [220, 260, 340, 520, 760, 1050, 1420] } },
  cashflow: { headers: yrs.slice(3, 10), rows: { cfo: [60, 95, 70, 120, 180, 150, 210], cfi: [-80, -110, -190, -260, -330, -420, -610] } },
  ratios: { headers: yrs.slice(3, 10), rows: { wcDays: [18, 15, 20, 26, 31, 38, 44], ccc: [12, 10, 14, 19, 25, 30, 36], debtorDays: [42, 40, 44, 49, 55, 61, 66] } },
  transcripts: [], annualReports: [], sourceUrl: "https://www.screener.in/", fetchedAt: new Date().toISOString(),
};
const research: Research = {
  sample: true, base, computed: compute(base), generatedAt: new Date().toISOString(),
  usage: { ...newUsage(), cheapCalls: 5, strongCalls: 1, inputTokens: 121000, outputTokens: 9800, estCostUSD: 0.0381 },
  extracts: ["Q1 FY26", "Q2 FY26", "Q3 FY26", "Q4 FY26", "Q1 FY27"].map((period) => ({ period, url: "#", guidance: [], segments: [], tone: "Confident on volumes; evasive on margins", analystConcerns: ["Margin trajectory", "Customer concentration", "Working capital"] })),
  analysis: {
    business: { summary: "Fictional EMS company assembling smartphones, TVs and EV electronics for brands under PLI. Revenue is volume-driven at thin margins.",
      segments: [{ name: "Mobile phones", comment: "~62% of revenue, growing 50%+" }, { name: "Consumer electronics", comment: "~25%, flat" }, { name: "EV & industrial", comment: "~13%, small but fastest-growing" }] },
    scorecard: "Revenue promises over-delivered 3 of 3; margin promises missed in all 4 quarters checked.",
    promises: [
      { promise: "Revenue growth of 35–40% in FY26", madeIn: "Q1 FY26", metric: "revenue_growth", delivered: "FY26 revenue ₹10,420 Cr vs ₹7,650 Cr: +36.2%", verdict: "delivered", evidence: "Annual FY25→FY26" },
      { promise: "Operating margin to recover to ~5% by H2 FY26", madeIn: "Q1 FY26", metric: "margin", delivered: "OPM 4.4% (Dec-25) and 4.5% (Mar-26); never reached 5%", verdict: "missed", evidence: "Quarterly OPM Dec 2025–Mar 2026" },
      { promise: "Working capital to normalise below 30 days", madeIn: "Q2 FY26", metric: "other", delivered: "Working-capital days rose to 44 in FY26 from 38", verdict: "missed", evidence: "Ratios FY25→FY26" },
      { promise: "Capex of ~₹600 Cr in FY26, funded internally", madeIn: "Q2 FY26", metric: "capex", delivered: "Investing outflow ₹610 Cr vs CFO ₹210 Cr; borrowings +₹450 Cr", verdict: "partial", evidence: "Cash flow & balance sheet FY26" },
      { promise: "Q1 FY27 revenue to grow 20%+ YoY", madeIn: "Q4 FY26", metric: "revenue_growth", delivered: "Jun-26 revenue ₹2,780 Cr vs ₹2,310 Cr: +20.3%", verdict: "delivered", evidence: "Quarterly Jun 2025 vs Jun 2026" },
      { promise: "EV segment to cross ₹1,000 Cr revenue in FY27", madeIn: "Q1 FY27", metric: "revenue_growth", delivered: "Segment data not in filings tables", verdict: "pending", evidence: "Horizon not reached" },
    ],
    narrativeVsNumbers: [
      { point: "“Operating leverage will kick in as utilisation rises”", stance: "diverges", evidence: "OPM fell every year from 7.1% (FY17) to 4.4% (FY26) while revenue grew 8.6x" },
      { point: "“Growth is high quality and cash-generative”", stance: "diverges", evidence: "5y CFO/PAT well below 100%; borrowings up 12x since FY20" },
      { point: "“Volume momentum remains strong”", stance: "agrees", evidence: "Revenue YoY above 25% in each of the last 8 quarters" },
    ],
    guidanceNow: [
      { metric: "revenue_growth", target: "30%+", horizon: "FY27", quote: "We remain confident of growing upwards of 30% this year on the back of new customer additions." },
      { metric: "margin", target: "4.5–5%", horizon: "FY27", quote: "Margins should settle in the 4.5 to 5 percent band as the mix improves." },
      { metric: "capex", target: "₹700 Cr", horizon: "FY27", quote: "Capex for the year will be around 700 crores, largely for the new display facility." },
    ],
    bull: ["Revenue compounding ~40%/yr for 5 years with guidance met three times running", "EV & industrial (~13% of sales) carries higher margins and is the fastest-growing line", "ROCE 21% despite thin margins — asset turns are high"],
    bear: ["Margin guidance missed every quarter checked; OPM down from 7.1% to 4.4% over the decade", "Working capital 18 → 44 days and debtor days 42 → 66 — growth is being bought with credit", "Capex outran operating cash by ₹400 Cr in FY26; borrowings now ₹1,430 Cr"],
  },
};

fs.mkdirSync(path.join(OUT, "research"), { recursive: true });
fs.writeFileSync(path.join(OUT, "feed.json"), JSON.stringify(feed));
fs.writeFileSync(path.join(OUT, "prices.json"), JSON.stringify(prices));
fs.writeFileSync(path.join(OUT, "research", "SAMPLECO.json"), JSON.stringify(research));
fs.writeFileSync(path.join(OUT, "research", "index.json"), JSON.stringify([{ symbol: "SAMPLECO", name: base.name, generatedAt: research.generatedAt, sample: true }], null, 1));
console.log("sample data written");
