// Board-meeting and earnings-call notices are routine as *news*, but they carry
// a date. Pulling that date out turns folded-away paperwork into a calendar.

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toIso(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Find "on 14/11/2026", "on November 14, 2026", "on 14th November, 2026" after a scheduling verb. */
export function eventDate(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  const scope = t.match(/(?:scheduled|to be held|will be held|is held|convened|meeting)[^.]{0,80}?\bon\b(.{0,40})/i)?.[1] || "";
  let m = scope.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) return toIso(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = scope.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+(\d{4})/i);
  if (m) return toIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = scope.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) return toIso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

export function eventWhat(text: string): string | null {
  const t = text.toLowerCase();
  if (/(financial )?results/.test(t) && /board/.test(t)) return "Board meeting on results";
  if (/earnings call|conference call|con-?call/.test(t)) return "Earnings call";
  if (/dividend/.test(t) && /board/.test(t)) return "Board meeting on dividend";
  if (/fund rais|qip|rights|preferential|debenture/.test(t) && /board/.test(t)) return "Board meeting on fund raise";
  if (/board meeting/.test(t)) return "Board meeting";
  if (/\bagm\b|annual general/.test(t)) return "AGM";
  return null;
}
