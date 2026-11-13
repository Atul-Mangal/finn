// Shared types for the push feed, prices and pull research.

export const CATEGORIES = [
  "results",
  "M&A",
  "fund_raise",
  "management_change",
  "litigation",
  "insider_trading",
  "earnings_call",
  "investor_meetings",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "postal_ballot",
  "agm_egm",
  "pledging",
  "unclassified",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Tier = "top" | "normal" | "routine";

export interface PortfolioEntry {
  symbol: string; // NSE symbol
  bse: string; // BSE scrip code
  name: string;
  sector: string;
}

// ---------- push ----------

export interface ResultsPeriod {
  label: string; // e.g. "Q2 FY26"
  revenue: number | null;
  ebitda: number | null;
  pbt: number | null;
  pat: number | null;
}

export interface ResultsCard {
  basis: "consolidated" | "standalone";
  unit: string; // e.g. "₹ Cr"
  current: ResultsPeriod;
  prevQuarter: ResultsPeriod | null;
  yearAgo: ResultsPeriod | null;
  isLender: boolean; // banks/NBFCs: EBITDA not meaningful
  ebitdaNote?: string;
  warnings: string[]; // sanity-check failures, shown to the user
  source?: "filing" | "screener"; // screener = filing PDF was a scanned image
  note?: string; // e.g. "previous quarter from screener.in"
}

export interface PersonCard {
  name: string;
  role: string;
  change: "appointed" | "resigned" | "retired" | "other";
  effective?: string;
  bio?: string; // 1–3 lines
  bioSource?: "filing" | "web";
  links?: { title: string; url: string }[];
}

export interface FeedItem {
  id: string;
  symbol: string;
  company: string;
  time: string; // ISO, IST-aware
  category: Category;
  categorySource: "rule" | "llm";
  headline: string;
  url?: string; // filing PDF
  priority: number; // 0–100
  tier: Tier;
  summary?: string; // one-line "why it matters"
  results?: ResultsCard;
  people?: PersonCard[];
  related?: { id: string; headline: string; url?: string }[]; // collapsed duplicates
  event?: { date: string; what: string }; // a dated upcoming event announced by this filing
}

export interface UsageSummary {
  cheapCalls: number;
  strongCalls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  estCostUSD: number;
  models: { cheap: string; strong: string };
}

export interface Feed {
  generatedAt: string;
  sample?: boolean;
  windowDays: number;
  portfolio: PortfolioEntry[];
  items: FeedItem[];
  usage: UsageSummary;
  errors: string[];
}

export interface PriceSeries {
  d: string[]; // YYYY-MM-DD
  c: number[]; // close
  v: number[]; // volume
}

export interface Prices {
  generatedAt: string;
  sample?: boolean;
  series: Record<string, PriceSeries>;
}

// ---------- pull ----------

export interface Table {
  headers: string[]; // period labels, e.g. "Sep 2024", "Mar 2025", "TTM"
  rows: Record<string, (number | null)[]>; // normalised label -> values aligned with headers
}

export interface DocLink {
  period: string; // "Jul 2025"
  url: string;
  kind: "transcript" | "annual_report" | "ppt";
}

export interface CompanyBase {
  symbol: string;
  name: string;
  basis: "consolidated" | "standalone";
  about: string;
  isLender: boolean;
  topRatios: Record<string, string>;
  quarters: Table;
  annual: Table;
  balance: Table;
  cashflow: Table;
  ratios: Table;
  transcripts: DocLink[];
  annualReports: DocLink[];
  sourceUrl: string;
  fetchedAt: string;
}

export interface Metric {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}

export interface SeriesPoint {
  label: string;
  value: number | null;
}

export interface Flag {
  text: string;
  tone: "good" | "bad" | "neutral";
}

export interface Computed {
  snapshot: Metric[];
  lastQuarter: {
    label: string;
    rows: { metric: string; value: number | null; qoq: number | null; yoy: number | null }[];
  } | null;
  trajectory: {
    revenue: SeriesPoint[];
    profit: SeriesPoint[];
    margin: SeriesPoint[];
    qRevenueYoY: SeriesPoint[];
    flags: Flag[];
  };
  balance: { metrics: Metric[]; borrowings: SeriesPoint[]; flags: Flag[] };
  cash: { cfo: SeriesPoint[]; pat: SeriesPoint[]; fcfProxy: SeriesPoint[]; conversion5y: number | null; flags: Flag[] };
  qualityTable: string; // compact markdown handed to the reasoning model
}

export interface GuidanceItem {
  metric: string; // revenue_growth | margin | capex | volume | other
  statement: string;
  target: string;
  horizon: string;
  quote: string;
  speaker?: string;
}

export interface TranscriptExtract {
  period: string;
  url: string;
  guidance: GuidanceItem[];
  segments: { name: string; comment: string }[];
  tone: string;
  analystConcerns: string[];
  error?: string;
}

export interface Verdict {
  promise: string;
  madeIn: string;
  metric: string;
  delivered: string;
  verdict: "delivered" | "missed" | "partial" | "pending" | "unverifiable";
  evidence: string;
}

export interface Analysis {
  business: { summary: string; segments: { name: string; comment: string }[] };
  promises: Verdict[];
  scorecard: string; // one line
  narrativeVsNumbers: { point: string; stance: "agrees" | "diverges"; evidence: string }[];
  guidanceNow: { metric: string; target: string; horizon: string; quote: string }[];
  bull: string[];
  bear: string[];
}

export interface Research {
  base: CompanyBase;
  computed: Computed;
  extracts: TranscriptExtract[];
  analysis: Analysis | null;
  analysisError?: string; // the judgment step failed; numbers and extracts are still shown
  usage: UsageSummary;
  generatedAt: string;
  sample?: boolean;
}
