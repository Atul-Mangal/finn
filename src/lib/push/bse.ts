// Corporate announcements from BSE's public announcements API (what
// bseindia.com's own announcements page calls). NSE's equivalent blocks
// non-browser clients, so BSE is the more reliable feed for a cron job.

import { fetchJson, sleep } from "../http";

export interface BseAnnouncement {
  NEWSID: string;
  SCRIP_CD: number;
  NEWSSUB: string;
  HEADLINE: string;
  NEWS_DT: string; // "2025-07-18T19:45:12.83" (IST, no zone)
  DT_TM?: string;
  CATEGORYNAME: string | null;
  SUBCATNAME: string | null;
  ATTACHMENTNAME: string | null;
  SLONGNAME?: string;
}

const HEADERS = {
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
  Accept: "application/json, text/plain, */*",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export async function fetchAnnouncements(scrip: string, from: Date, to: Date): Promise<BseAnnouncement[]> {
  const out: BseAnnouncement[] = [];
  for (let page = 1; page <= 10; page++) {
    const url =
      `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1` +
      `&strPrevDate=${ymd(from)}&strScrip=${scrip}&strSearch=P&strToDate=${ymd(to)}&strType=C&subcategory=-1`;
    const j = await fetchJson<{ Table?: BseAnnouncement[]; Table1?: { ROWCNT: number }[] }>(url, { headers: HEADERS });
    const rows = j.Table || [];
    out.push(...rows);
    const total = j.Table1?.[0]?.ROWCNT ?? rows.length;
    if (out.length >= total || rows.length === 0) break;
    await sleep(300);
  }
  return out;
}

/** BSE keeps recent PDFs under AttachLive and moves older ones to AttachHis. */
export function attachmentUrls(name: string | null): string[] {
  if (!name) return [];
  return [
    `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${name}`,
    `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${name}`,
  ];
}

export function istToIso(s: string): string {
  // "2025-07-18T19:45:12.83" -> "2025-07-18T19:45:12+05:30"
  const base = s.split(".")[0];
  return /[zZ]|[+-]\d\d:\d\d$/.test(base) ? base : `${base}+05:30`;
}
