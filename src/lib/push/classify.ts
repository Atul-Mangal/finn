// Classification + priority.
//
// Most filings are classifiable from BSE's own category/subcategory and the
// subject line, so rules go first (free, instant, deterministic). Only the
// leftovers are sent to the cheap model, in batches. Priority is a separate,
// explicit scoring step so the ranking logic is readable and tunable — not
// buried in a prompt.

import type { Category, Tier, UsageSummary } from "../types";
import { CATEGORIES } from "../types";
import { llmJson } from "../llm";

type Rule = [RegExp, Category];

// Order matters: first match wins.
const RULES: Rule[] = [
  [/pledg|encumbr/, "pledging"],
  [/insider trading|\bsast\b|takeover regulation|regulation 7\s*\(|reg\.? 7\s*\(|29\s*\(\s*[12]\s*\)/, "insider_trading"],
  [/transcript|earnings call|conference call|con-?call|audio recording|video recording/, "earnings_call"],
  [/analyst|investor meet|institutional investor|investor conference|non-deal roadshow|investor day/, "investor_meetings"],
  [/esop|esos|esps|employee stock|stock option|employees? (welfare|benefit)|certificate pursuant|half[- ]yearly report|regulation 74|74\s*\(5\)/, "unclassified"],
  [/credit rating|\bcrisil\b|\bicra\b|care ratings|india ratings|\brating/, "credit_rating"],
  [/financial results?|quarterly results?|results for the (quarter|period|year)|unaudited|audited financial|financial statements for the quarter|investor presentation|shareholders?'? letter|earnings presentation/, "results"],
  [/buy-?back|rights issue|\bqip\b|qualified institution|preferential (issue|allotment)|commercial paper|non-convertible|\bncds?\b|debenture|fund rais|private placement/, "fund_raise"],
  [/\bbonus\b|stock split|sub-?division of (equity )?shares|split of/, "bonus_split"],
  [/dividend/, "dividend"],
  [/acqui|merger|amalgamation|demerger|scheme of arrangement|joint venture|stake sale|divest|slump sale|incorporation of.*subsidiary|investment in.*subsidiar/, "M&A"],
  [/auditor|registrar and (share )?transfer|\brta\b/, "unclassified"], // routine appointments
  [/resign|appoint|cessation|change in (director|management|kmp|senior management)|re-?designation|retire|chief executive|chief financial|managing director|\bceo\b|\bcfo\b|\bkmp\b/, "management_change"],
  [/litigation|dispute|penalt|show cause|tribunal|\bnclt\b|insolvency|sebi order|tax demand|demand order|\bgst\b|income tax|regulatory action|warning letter|usfda|form 483|observations|search and seizure|court/, "litigation"],
  [/capex|capital expenditure|capacity expansion|new (plant|facility|unit)|greenfield|brownfield|commissioning|commercial production/, "capex"],
  [/postal ballot/, "postal_ballot"],
  [/\bagm\b|\begm\b|annual general|extra-?ordinary general|scrutini[sz]er|voting results/, "agm_egm"],
  [/esop|esos|esps|employee stock|regulation 74|74\s*\(5\)|compliance certificate|trading window|loss of share certificate|duplicate share|book closure|\bbrsr\b|business responsibility|secretarial|statement of deviation|regulation 40|newspaper publication|certificate under|record date|change of (registered|address)|reg\.? ?39/, "unclassified"],
  [/order|contract|award|launch|partnership|\bmou\b|press release|media release|clarification|update/, "press_release"],
];

export function ruleClassify(text: string): Category | null {
  const t = text.toLowerCase();
  for (const [re, cat] of RULES) if (re.test(t)) return cat;
  return null;
}

/** Batch-classify the leftovers with the cheap model. */
export async function llmClassify(
  items: { id: string; text: string }[],
  usage: UsageSummary,
): Promise<Record<string, Category>> {
  const out: Record<string, Category> = {};
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    const prompt =
      `Categories: ${CATEGORIES.join(", ")}.\n` +
      `Definitions: results=quarterly/annual results & decks; M&A=acquisitions, mergers, JVs, subsidiary stake changes; ` +
      `fund_raise=rights/QIP/preferential/buyback/debt; management_change=CEO/CFO/MD/director changes; litigation=lawsuits, regulatory orders, fines; ` +
      `insider_trading=promoter/insider dealing in own shares; earnings_call=concall notice/transcript/recording; investor_meetings=analyst/investor meets; ` +
      `credit_rating; dividend; bonus_split; capex=new plant/capacity; press_release=order wins, launches, partnerships, clarifications; ` +
      `postal_ballot; agm_egm; pledging; unclassified=routine compliance paperwork.\n\n` +
      `Classify each filing. Return JSON {"labels": {"<id>": "<category>"}}.\n\n` +
      batch.map((b) => `${b.id}: ${b.text.slice(0, 300)}`).join("\n");
    try {
      const r = await llmJson<{ labels: Record<string, string> }>(
        "cheap",
        { system: "You classify Indian stock-exchange corporate announcements. Output JSON only.", prompt, maxOutputTokens: 2000 },
        usage,
      );
      for (const b of batch) {
        const c = r.labels?.[b.id];
        out[b.id] = (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : "unclassified";
      }
    } catch {
      for (const b of batch) out[b.id] = "unclassified";
    }
  }
  return out;
}

const BASE: Record<Category, number> = {
  results: 90,
  "M&A": 80,
  management_change: 70,
  fund_raise: 70,
  litigation: 65,
  pledging: 65,
  capex: 65,
  bonus_split: 60,
  credit_rating: 50,
  press_release: 42,
  dividend: 45,
  insider_trading: 40,
  earnings_call: 30,
  agm_egm: 20,
  postal_ballot: 18,
  investor_meetings: 12,
  unclassified: 5,
};

/** Explicit, readable materiality score. Adjustments encode analyst judgment. */
export function scorePriority(cat: Category, text: string): number {
  const t = text.toLowerCase();
  let p = BASE[cat];
  const adj = (re: RegExp, d: number) => {
    if (re.test(t)) p += d;
  };
  // A notice that a board WILL meet is a date, not news — whatever it's about.
  if (cat !== "results") adj(/board meeting intimation|intimation of (the )?board meeting|prior intimation|will be held on/, -40);
  switch (cat) {
    case "fund_raise":
      adj(/commercial paper|repayment|redemption|\bncds?\b|debenture|interest payment/, -25); // routine debt servicing
      adj(/\bqip\b|rights issue|preferential|buy-?back|qualified institution/, +5);
      break;
    case "results":
      adj(/intimation|to consider|will be held|is scheduled|trading window/, -65); // a date, not the numbers
      adj(/newspaper|publication|advertisement/, -75);
      adj(/presentation|letter/, -30);
      adj(/press release|media release/, -3); // keep the actual results filing as the primary
      adj(/financial results|unaudited|audited/, +2);
      break;
    case "management_change":
      adj(/\b(ceo|cfo|chief executive|chief financial|managing director|whole-?time director|chairman|chairperson)\b/, +15);
      adj(/independent director|non-executive|nominee director/, -20);
      adj(/company secretary|compliance officer|senior management personnel|smp\b/, -30);
      adj(/re-?appointment|continuation/, -25);
      break;
    case "credit_rating":
      adj(/downgrad|negative|watch with negative|default|suspend/, +30);
      adj(/upgrad|positive/, +15);
      adj(/reaffirm|re-affirm|withdraw/, -20);
      break;
    case "litigation":
      adj(/not material|no material impact|no impact on/, -25);
      adj(/usfda|warning letter|import alert|form 483|insolvency|nclt|sebi order|fraud/, +15);
      break;
    case "insider_trading":
      adj(/promoter/, +10);
      adj(/regulation 7\s*\(\s*2|disclosure under regulation 7|continual disclosure/, -5);
      break;
    case "press_release":
      adj(/order|contract|award|wins?/, +10);
      adj(/clarification|rumou?r|news item/, +12);
      break;
    case "earnings_call":
      adj(/transcript/, +5);
      adj(/intimation|schedule|invitation/, -10);
      break;
    case "agm_egm":
    case "postal_ballot":
      adj(/result|outcome|voting/, +5);
      break;
  }
  return Math.max(0, Math.min(100, p));
}

export function tierOf(p: number): Tier {
  return p >= 60 ? "top" : p >= 35 ? "normal" : "routine";
}
