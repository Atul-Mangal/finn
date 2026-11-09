// Sanity-check portfolio config: Yahoo has prices and BSE codes map to the
// right company (BSE returns the company name with each filing).
import { PORTFOLIO } from "../src/config/portfolio";
import { fetchEod } from "../src/lib/push/prices";
import { fetchAnnouncements } from "../src/lib/push/bse";

async function main() {
  const from = new Date(Date.now() - 60 * 864e5), to = new Date();
  for (const p of PORTFOLIO) {
    const px = await fetchEod(p.symbol, "1mo").then((s) => `${s.c.length}d, last ₹${s.c.at(-1)}`).catch((e) => `ERR ${e.message}`);
    const an = await fetchAnnouncements(p.bse, from, to).then((a) => `${a.length} filings, BSE name: ${a[0]?.SLONGNAME ?? "?"}`).catch((e) => `ERR ${e.message}`);
    console.log(`${p.symbol.padEnd(11)} ${p.bse}  prices: ${px.padEnd(22)} ${an}`);
  }
}
main();
