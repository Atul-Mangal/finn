// The brief, as something you can listen to. Built in code from the same ranked
// data the screen shows — no model call, no cost — and read aloud by the phone's
// own speech engine. Voice as output only: an investor walking in to work wants
// to hear what changed, not hold a conversation.

import type { PriceTrip } from "./alerts";
import { pctChange } from "./format";
import type { FeedItem } from "./types";

const pct = (n: number) => {
  const a = Math.abs(n);
  return `${a >= 10 ? Math.round(a) : Math.round(a * 10) / 10} percent`;
};

const shortName = (s: string) =>
  s
    .replace(/\s*\((sample|fictional)\)/i, "")
    .replace(/\b(limited|ltd\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

/** Make finance shorthand pronounceable. */
export function speakable(t: string): string {
  return t
    .replace(/₹\s?([\d,.]+)\s?(?:Cr\b\.?|crores?)/gi, "$1 crore rupees")
    .replace(/₹\s?([\d,.]+)/g, "$1 rupees")
    .replace(/\bYoY\b/g, "year on year")
    .replace(/\bQoQ\b/g, "quarter on quarter")
    .replace(/\bbps\b/g, "basis points")
    .replace(/[−–]/g, " minus ")
    .replace(/(\d)\s?%/g, "$1 percent")
    .replace(/\bCr\b\.?/g, "crore")
    .replace(/\s+/g, " ")
    .trim();
}

function line(i: FeedItem): string {
  const name = shortName(i.company);
  const r = i.results;
  if (r && (r.current.revenue != null || r.current.pat != null)) {
    const rev = pctChange(r.current.revenue, r.yearAgo?.revenue);
    const pat = pctChange(r.current.pat, r.yearAgo?.pat);
    const parts: string[] = [];
    if (rev != null) parts.push(`revenue ${rev >= 0 ? "up" : "down"} ${pct(rev)}`);
    if (pat != null) parts.push(`profit ${pat >= 0 ? "up" : "down"} ${pct(pat)}`);
    const body = parts.join(", ");
    return `${name} reported results.${body ? ` ${body[0].toUpperCase()}${body.slice(1)} on last year.` : ""}`;
  }
  if (i.people?.length) {
    const p = i.people.find((x) => x.change === "appointed") || i.people[0];
    const verb = p.change === "appointed" ? "joins as" : p.change === "resigned" ? "steps down as" : p.change === "retired" ? "retires as" : "changes role:";
    const bio = p.change === "appointed" && p.bio ? " " + p.bio.split(/(?<=\.)\s/)[0] : "";
    return speakable(`${name}: ${p.name} ${verb} ${p.role}.${bio}`);
  }
  return speakable(`${name}: ${i.summary || i.headline}`);
}

export function briefScript(o: {
  windowLabel: string; // "in the last 24 hours"
  open: FeedItem[];
  glance: number;
  routine: number;
  trips: PriceTrip[];
  names: Record<string, string>;
}): string[] {
  const out: string[] = [];
  const n = o.open.length;
  out.push(n ? `${n} ${n === 1 ? "filing needs" : "filings need"} you ${o.windowLabel}.` : `Nothing needs you ${o.windowLabel}.`);
  o.open.slice(0, 5).forEach((i) => out.push(line(i)));
  if (n > 5) out.push(`And ${n - 5} more on screen.`);
  const trips = o.trips.slice(0, 3).map((t) => {
    const name = shortName(o.names[t.symbol] || t.symbol);
    const move = `${t.ret >= 0 ? "up" : "down"} ${pct(t.ret)}`;
    return t.kind === "price" ? `${name} moved ${move}` : `${name} traded ${t.volX.toFixed(1)} times its usual volume, ${move}`;
  });
  if (trips.length) out.push(`Tripwires. ${trips.join(". ")}.`);
  if (o.glance || o.routine) out.push(`${o.glance} more ${o.glance === 1 ? "is" : "are"} worth a glance, and ${o.routine} routine ${o.routine === 1 ? "filing is" : "filings are"} folded away.`);
  return out;
}

export const spokenSeconds = (lines: string[]) => Math.max(5, Math.round(lines.join(" ").split(/\s+/).length / 2.6 / 5) * 5);
