import type { PortfolioEntry } from "@/lib/types";

// Mock portfolio: 20 NSE/BSE names chosen for spread — mega-cap banks and
// conglomerates next to mid-cap manufacturing, IT services, defence, chemicals
// and consumer names. Different sizes file very differently, which makes the
// digest's filtering visible.
//
// BSE scrip codes are needed for the BSE announcements API. `npm run check`
// verifies each code against BSE's own company name.
export const PORTFOLIO: PortfolioEntry[] = [
  { symbol: "RELIANCE", bse: "500325", name: "Reliance Industries", sector: "Conglomerate" },
  { symbol: "HDFCBANK", bse: "500180", name: "HDFC Bank", sector: "Banks" },
  { symbol: "ICICIBANK", bse: "532174", name: "ICICI Bank", sector: "Banks" },
  { symbol: "BAJFINANCE", bse: "500034", name: "Bajaj Finance", sector: "NBFC" },
  { symbol: "TCS", bse: "532540", name: "Tata Consultancy Services", sector: "IT Services" },
  { symbol: "PERSISTENT", bse: "533179", name: "Persistent Systems", sector: "IT Services" },
  { symbol: "KPITTECH", bse: "542651", name: "KPIT Technologies", sector: "Auto Software" },
  { symbol: "LT", bse: "500510", name: "Larsen & Toubro", sector: "Engineering" },
  { symbol: "BHARTIARTL", bse: "532454", name: "Bharti Airtel", sector: "Telecom" },
  { symbol: "ITC", bse: "500875", name: "ITC", sector: "FMCG" },
  { symbol: "SUNPHARMA", bse: "524715", name: "Sun Pharmaceutical", sector: "Pharma" },
  { symbol: "MARUTI", bse: "532500", name: "Maruti Suzuki", sector: "Auto" },
  { symbol: "TITAN", bse: "500114", name: "Titan Company", sector: "Consumer" },
  { symbol: "TRENT", bse: "500251", name: "Trent", sector: "Retail" },
  { symbol: "ASIANPAINT", bse: "500820", name: "Asian Paints", sector: "Paints" },
  { symbol: "DIXON", bse: "540699", name: "Dixon Technologies", sector: "Electronics Mfg" },
  { symbol: "POLYCAB", bse: "542652", name: "Polycab India", sector: "Cables" },
  { symbol: "HAL", bse: "541154", name: "Hindustan Aeronautics", sector: "Defence" },
  { symbol: "DEEPAKNTR", bse: "506401", name: "Deepak Nitrite", sector: "Chemicals" },
  { symbol: "IRCTC", bse: "542830", name: "IRCTC", sector: "Travel" },
];

// Ad-hoc research demo set — deliberately includes names outside the portfolio
// and a bank (different statement format) to show the engine generalises.
export const RESEARCH_DEMO = ["DIXON", "ASIANPAINT", "PIDILITIND", "HDFCBANK", "KAYNES"];
