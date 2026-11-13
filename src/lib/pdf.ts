// PDF → text. Filings and transcripts are text PDFs; scanned ones come back
// near-empty and we report that rather than hallucinating over nothing.

import { extractText, getDocumentProxy } from "unpdf";
import { fetchBuffer } from "./http";

const BSE_HEADERS = { Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com" };

export async function pdfText(url: string, maxPages = 40): Promise<{ text: string; pages: number }> {
  const buf = await fetchBuffer(url, { headers: url.includes("bseindia") ? BSE_HEADERS : {} });
  const head = new Uint8Array(buf.slice(0, 5));
  if (String.fromCharCode(...head) !== "%PDF-") throw new Error("Not a PDF (link may be an HTML page)");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages = pdf.numPages;
  if (pages <= maxPages) {
    const { text } = await extractText(pdf, { mergePages: true });
    return { text: clean(text as string), pages };
  }
  // Long documents: only the first maxPages pages
  const parts: string[] = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    parts.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { text: clean(parts.join("\n")), pages };
}

/** Every page's text separately — for long documents where only a few pages matter. */
export async function pdfPages(url: string, maxPages = 700): Promise<string[]> {
  const buf = await fetchBuffer(url, { headers: url.includes("bseindia") ? BSE_HEADERS : {} }, 150000);
  const head = new Uint8Array(buf.slice(0, 5));
  if (String.fromCharCode(...head) !== "%PDF-") throw new Error("Not a PDF (link may be an HTML page)");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const n = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    out.push(clean(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ")));
    page.cleanup();
  }
  return out;
}

function clean(s: string) {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
