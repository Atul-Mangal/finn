// screener.in company page → standardised tables + document links.
// Works for any NSE symbol screener covers; nothing here is specific to the
// demo set. Consolidated first, standalone fallback.

import * as cheerio from "cheerio";
import { fetchText } from "../http";
import type { CompanyBase, DocLink, Table } from "../types";

const ALIASES: Record<string, string> = {
  sales: "revenue",
  revenue: "revenue",
  expenses: "expenses",
  operatingprofit: "op",
  financingprofit: "op",
  opm: "opm",
  financingmargin: "opm",
  otherincome: "otherIncome",
  interest: "interest",
  depreciation: "dep",
  profitbeforetax: "pbt",
  tax: "tax",
  netprofit: "pat",
  epsinrs: "eps",
  dividendpayout: "payout",
  equitycapital: "equity",
  reserves: "reserves",
  borrowings: "borrowings",
  borrowing: "borrowings",
  deposits: "deposits",
  otherliabilities: "otherLiab",
  totalliabilities: "totalLiab",
  fixedassets: "fixed",
  cwip: "cwip",
  investments: "investments",
  otherassets: "otherAssets",
  totalassets: "totalAssets",
  cashfromoperatingactivity: "cfo",
  cashfrominvestingactivity: "cfi",
  cashfromfinancingactivity: "cff",
  netcashflow: "netCash",
  debtordays: "debtorDays",
  inventorydays: "inventoryDays",
  dayspayable: "payableDays",
  cashconversioncycle: "ccc",
  workingcapitaldays: "wcDays",
  roce: "roce",
  roe: "roe",
};

const normLabel = (s: string) => {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[k] || k;
};

export const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.replace(/[,₹%\s]|Cr\.?/g, "");
  if (t === "" || t === "-" || t === "—") return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
};

function parseTable($: cheerio.CheerioAPI, sectionId: string): Table {
  const tbl = $(`section#${sectionId} table.data-table`).first();
  const headers = tbl
    .find("thead th")
    .toArray()
    .map((th) => $(th).text().trim())
    .slice(1);
  const rows: Table["rows"] = {};
  tbl.find("tbody tr").each((_, tr) => {
    const tds = $(tr).find("td").toArray();
    if (tds.length < 2) return;
    const label = normLabel($(tds[0]).text().replace(/ /g, " ").replace(/\+/g, ""));
    if (!label || rows[label]) return;
    rows[label] = tds.slice(1).map((td) => num($(td).text()));
  });
  return { headers, rows };
}

function parseDocs($: cheerio.CheerioAPI): { transcripts: DocLink[]; annualReports: DocLink[] } {
  const transcripts: DocLink[] = [];
  $(".documents.concalls li").each((_, li) => {
    const period = $(li).find("div").first().text().trim();
    $(li)
      .find("a")
      .each((__, a) => {
        const label = $(a).text().trim().toLowerCase();
        const href = $(a).attr("href");
        if (href && label === "transcript") transcripts.push({ period, url: href, kind: "transcript" });
      });
  });
  const annualReports: DocLink[] = [];
  $(".documents.annual-reports li a").each((_, a) => {
    const href = $(a).attr("href");
    const text = $(a).text().replace(/\s+/g, " ").trim();
    const yr = text.match(/(\d{4})/)?.[1] || text;
    if (href) annualReports.push({ period: `FY${yr}`, url: href, kind: "annual_report" });
  });
  return { transcripts, annualReports };
}

export class NotFoundError extends Error {}

export async function fetchCompany(symbolRaw: string): Promise<CompanyBase> {
  const symbol = symbolRaw.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
  if (!/^[A-Z0-9&\-]{1,20}$/.test(symbol)) throw new NotFoundError(`"${symbolRaw}" is not a valid NSE symbol`);

  let html = "";
  let basis: CompanyBase["basis"] = "consolidated";
  let url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;
  const first = await fetchText(url);
  if (first.status === 404) throw new NotFoundError(`No company found for ${symbol}`);
  html = first.text;

  let $ = cheerio.load(html);
  // Companies without subsidiaries have an empty consolidated view.
  if (parseTable($, "quarters").headers.length < 3 || parseTable($, "profit-loss").headers.length < 3) {
    url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
    const sa = await fetchText(url);
    if (sa.status === 200) {
      $ = cheerio.load(sa.text);
      basis = "standalone";
    }
  }

  const name = $("h1").first().text().trim() || symbol;
  const about = $(".company-profile .about p").first().text().replace(/\s+/g, " ").trim();
  const topRatios: Record<string, string> = {};
  $("#top-ratios li").each((_, li) => {
    const k = $(li).find(".name").text().trim();
    const v = $(li).find(".value").text().replace(/\s+/g, " ").trim();
    if (k) topRatios[k] = v;
  });

  const quarters = parseTable($, "quarters");
  const annual = parseTable($, "profit-loss");
  const balance = parseTable($, "balance-sheet");
  const cashflow = parseTable($, "cash-flow");
  const ratios = parseTable($, "ratios");
  if (!annual.headers.length) throw new NotFoundError(`screener.in has no financials for ${symbol}`);
  const isLender = "deposits" in balance.rows || /financing/i.test($("section#quarters").text());

  return {
    symbol,
    name,
    basis,
    about,
    isLender,
    topRatios,
    quarters,
    annual,
    balance,
    cashflow,
    ratios,
    ...parseDocs($),
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
  };
}
