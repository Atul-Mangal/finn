# Build log

A condensed, dated log of how FINN was built. **FINN was built with Claude (Anthropic) as the coding agent**, working in a claude.ai agent workspace with push access to this repository. Atul directed the work, set up the accounts, ran and checked the live jobs, and tested the app on a phone. Claude wrote the code and docs. Times are IST. Every step below matches a commit in `git log`; the 16 `data:` commits are the scheduled jobs refreshing data.

## Day 1: Mon 9 Nov

**12:08 — Brief.** Shared both challenge PDFs. Claude summarised them and proposed scope:
- go deep on the digest, the results card and the promise-vs-delivered check rather than broad;
- build interaction around a point of view ("the product is the filter"), not chat plus a dashboard.

**12:10–12:30 — Setup (Atul).**
- Created the public `finn` repo, a Gemini API key and a Tavily key.
- Added the keys as GitHub Actions secrets.
- Created a Vercel account.

Claude confirmed it could push to the repo before writing code.

**12:23 — `cbc4199` Initial commit.**

**12:40 — `68e7fb6` Data engine.** One TypeScript codebase. The key choices, all still in place:
- **Push:** BSE announcements API (NSE blocks bots) plus Yahoo end-of-day prices.
- **Classification:** rules on BSE's own category and subject first; a cheap model only for leftovers, in batches.
- **Priority:** an explicit scoring function, not a prompt.
- **Results card:** the model copies the table; code converts units, derives EBITDA and computes QoQ/YoY.
- **Pull:** a screener.in parser, deterministic metrics and flags, cheap-model guidance extraction per transcript, and one strong-model judgment call.
- A two-tier model router with caching and cost accounting.
- Clearly labelled sample data with fictional companies.

**12:51 — `c93f5ad` Mobile app.**
- **Brief:** window picker, one-sentence summary, ranked cards, routine filings folded away.
- **Tripwires:** sliders, plus live "alerts per week over the last 60 sessions".
- **Research:** staged live run, promise ledger first.

Also scheduled GitHub Actions (hourly refresh, weekly research prefetch, CI), offline tests, README and DECISIONS. Claude checked every screen at phone size in a headless browser. That caught two bugs before pushing: tabular figures widened punctuation, and grid cells were left empty.

**12:51 — `f2dba2d`** Yahoo second-host fallback.

**13:06 — Deployed (Atul).** Imported the repo on Vercel: https://finn-92ls.vercel.app

**13:10 — First real run (Atul triggered).** 219 filings, prices for all 20 stocks. Two problems:
- Zero AI calls. The GitHub secret had been named `Finn` instead of `GEMINI_API_KEY`; Atul fixed it.
- Ranking mistakes in real data → **`4d88c8c`**:
  - ESOP allotments were scored as fund raises;
  - a board-meeting *intimation* was treated as news;
  - routine commercial-paper repayments ranked as top items.

**13:25 — `d31a443`, `eb5a478`** Google had retired `gemini-2.5-flash-lite` for new keys. Instead of hardcoding the next name, FINN now reads the key's own model list and picks the newest Flash-Lite and Flash.

**13:31 — `661fcf5` Robustness from first live runs.**
- The retry wrapper was swallowing Google's 429s; it now honours Google's retry delay.
- Calls are spaced out in the cron job.
- Scanned-image results PDFs (Maruti, KPIT, Deepak Nitrite) fall back to screener.in's quarterly table.
- Column dates are checked (HDFC Bank's "previous quarter" was really March).
- Labels are normalised to Q/FY.

Atul's live test of Pidilite on his phone showed the research numbers working, with transcripts hitting 503s.

**13:33 — `76fd786`** The final judgment step was rate-limited. The newest Flash had almost no free quota, so FINN now falls back across model versions.

**13:42 — `d024407` Maruti's revenue came out 10× too high** (₹ million read as ₹ crore). Every extracted results card is now reconciled with screener.in's figure for the same quarter, and unit slips are rescaled and flagged.

## Day 3: Wed 11 Nov

**12:41 — Status check.** The hourly job had run unattended since Monday with no errors.

**12:41 — `4a1c81e`** The cross-check flagged ITC, ICICI Bank and HDFC Bank, disagreeing with screener.in by 40–57%. Decision: never show a number known to disagree. Over 25% off means show screener.in's figures and say why. Banks are compared on PAT. Duplicate results cards are merged.

**14:00 — `23438f0` First research prefetch (Atul triggered): all 5 companies failed.**
- The log showed the strongest model hanging past the 2-minute timeout.
- One failed step was discarding the whole report.

Fixes: a timeout now moves to the next model; reports are saved with numbers and extracts even if judgment fails.

**14:15 — `2b0efe3`** The next prefetch was lost to a merge conflict: the hourly refresh had written the same cache file. Fixes:
- separate cache files for the two jobs, and each job re-applies its outputs on top of the latest `main`;
- jobs record which models actually answer (`data/models.json`). gemini-3.8/3.7-flash were listed but hung; 3.6 answered in about 10 s.

Rerun: all 5 reports in 2 minutes, about $0.005 per judgment call.

**14:19 — `f223e3a`, 14:36 — `991249b` Reviewing the reports.**
- Dixon, Asian Paints, Pidilite and Kaynes read well. Kaynes missed its ₹4,000 Cr FY26 revenue guide, and operating cash came in at −₹600 Cr against a promise to turn positive.
- HDFC Bank said "OPM is −6%". screener.in's bank "financing margin" isn't an operating margin, so for lenders that column is dropped and deposits are added.
- Verdicts backed only by management's own later claim are now "unverifiable — per management".
- Models that hang are remembered and tried last.

**17:02 — Phone review (Atul).** Kaynes report checked on a phone. A sideways-shift report was traced to pinch-zoom; there was no overflow at a 360 px width.

**17:08 — `f7297c1` Decision (Atul): stay on Gemini's free tier.** On the free tier, a brand-new ticker researched after the daily quota is spent still gets all the numbers and flags. The promise check now says plainly that it resumes after the daily reset.

## Where the human judgment went

Claude wrote the code. These calls were made in the conversation, with Atul:
- Scope: depth over breadth, no chat interface.
- Testing against real data before polishing. Most fixes above came from real filings, not from the sample data.
- Rejecting numbers that disagree with an independent source, instead of showing them with a warning.
- Staying on the free tier, and saying so honestly in the app.
