# Decisions, trade-offs, and what I left out

## Point of view: the product is the filter

An investor doesn't need more information; they need to know what they can ignore. So FINN opens with one sentence, not a dashboard: *"3 filings need you in the last 24 hours. 6 worth a glance, 41 routine folded away."* Then it shows exactly those three, fully worked. The visual language follows: only what matters gets a highlighter stroke. Mid-priority items are one line each. Routine paperwork is collapsed into a count.

I deliberately didn't make chat the main interface. A chat box makes the investor do the work of knowing what to ask. FINN asks the analyst's questions itself (*did they deliver what they promised? does the cash match the profit?*) and the investor taps.

## Push

**Rules before models.** About 80–90% of filings are classifiable from BSE's own category, subcategory and subject line. Rules are free, instant and deterministic. Only the leftovers go to the cheap model, in batches of 25.

**Priority is explicit code, not a prompt** (`scorePriority` in `classify.ts`). The base weight comes from the category, then adjustments encode analyst judgment:
- A board-meeting *intimation* about results is a date, not news (−65).
- A CFO or MD change outranks an independent-director change.
- A rating downgrade outranks a reaffirmation.
- A USFDA warning letter outranks a routine tax notice.

Anyone can read the rules and disagree with a number. The investor's watched categories add a personal lift on top.

**Clustering.** One results event often produces 3–4 filings (results, investor deck, newspaper ad, press release). They collapse into one item with "+3 related filings folded in."

**Results card: the model reads, code calculates.** The cheap model only copies line items for three quarter columns. Code then:
- converts units (lakh, million or crore → ₹ Cr);
- derives EBITDA as PBT before exceptional items + finance cost + D&A − other income;
- computes QoQ and YoY;
- runs sanity checks (PAT above PBT, an implausible jump in revenue, a missing column).

Failed checks are shown on the card. For banks and NBFCs, EBITDA is reported as not meaningful rather than faked.

**Management bio.** SEBI requires a brief profile of appointed directors and KMP inside the disclosure itself, so the filing is the first and most reliable source. Web search (Tavily) is optional enrichment. The model must say whether the search results are clearly the same person, and drops them if not. I didn't scrape LinkedIn: it blocks scraping and its terms forbid it.

**Spend follows priority.** How much model work each tier gets:
- Routine items: nothing.
- Mid-priority items: a one-liner written from the subject line, 20 per call.
- Top items: the PDF is read.
- Everything is cached by filing ID in a committed JSON file, so a filing is processed exactly once, ever.

**Tripwires calibrate themselves.** Instead of just asking for "volume ×" and "price %", the settings screen runs the thresholds over the last 60 sessions and says *"about 4 alerts a week."* The investor sets the noise level, not an abstract number.

**Static data, not a live backend.** A GitHub Action runs the pipeline hourly during market hours and again after close, then commits JSON. The commit redeploys the app. The phone never waits on a scraper, nothing breaks if BSE is slow at the moment you open the app, and hosting is free.

## Pull

**Three stages, each its own request:**
1. `base`: screener.in tables plus deterministic metrics. No model, about 1 second.
2. `extract`: one cheap call per transcript, run in parallel and cached per URL forever.
3. `analyze`: one strong call over compact facts.

This fits serverless timeouts, lets the UI show progress, and means the numbers appear before the model has said anything.

**Every computable number is computed** (`metrics.ts`): CAGRs, margin trend, D/E, working-capital days, CFO/PAT conversion, and a free-cash-flow proxy. The flags are simple rules with visible thresholds, e.g. "OPM compressing: 3y average vs prior 3y, ≥150 bps."

**Promise vs delivered is the centre of the research view.** The strong model gets guidance items with their verbatim quotes (from the cheap extraction) and a table of delivered numbers computed in code. It must cite a number or quote for every verdict, and use "unverifiable" when the tables can't settle a point (e.g. segment targets). It is told not to use outside knowledge of the company. I read 5 transcripts, not 4, so that promises made 4 quarters ago can be checked against the quarters after them.

**It generalises.** Nothing is tied to the demo set. Any NSE symbol that screener.in covers works:
- consolidated figures, falling back to standalone;
- banks detected automatically and handled differently;
- clear errors for unknown symbols.

## Models and cost

- **Cheap tier** (newest Gemini Flash-Lite): classification, table copying, guidance extraction.
- **Strong tier** (newest Gemini Flash): one call per research report.
- Model names are resolved at runtime from the models the API key can actually call. Google retired `gemini-2.5-flash-lite` for new keys mid-build, and hardcoded names break.
- Both can be swapped by environment variable. Any OpenAI-compatible provider works too (Groq, OpenRouter, local Ollama).
- Every call is cached on (model, prompt). Token usage and list-price cost are shown in the app's footer, because cost is a feature here.

## What real data broke, and what changed

The first live runs found problems that the sample data couldn't. Each fix is in the git history.

| What happened | Fix |
|---|---|
| Maruti files results in ₹ million; the model read it as crore, so revenue came out 10× too high. | Every extracted results card is reconciled with screener.in's figure for the same quarter. A 10×/100× gap is rescaled and flagged. Any other gap over 25% (ITC, ICICI, HDFC Bank) means a misread column, so the card shows screener.in's figures and says why. We never show a number we know disagrees with another source. |
| Some results PDFs are scanned images with no text (Maruti, KPIT, Deepak Nitrite). | Fall back to screener.in's standardised quarterly table, labelled as the source. |
| HDFC Bank's "previous quarter" column was actually March. | Column dates are parsed and checked (previous = 3 months earlier, year-ago = 12 months). Labels are normalised to "Q2 FY27". |
| Employee-stock allotments ranked as fund raises; incorporating a ₹-trivial Canadian subsidiary ranked as major M&A. | Rules tightened, with regression tests. |
| Google retired `gemini-2.5-flash-lite` for new keys mid-build. | Models are discovered from the key's own model list; the newest Flash-Lite / Flash are picked automatically. |
| The two newest Flash models were listed but hung for over 4 minutes on the free tier; 3.6 answered in 10–50 s. | A timeout or zero quota moves to the next model. The jobs record which models answered in `data/models.json`, which ships with each deploy, so the app starts with a model that works. |
| Bank research said "OPM is −6%". screener's bank "financing margin" isn't an operating margin. | For lenders the margin column and its flags are dropped. Verdicts that rely only on management's own later claim are marked "unverifiable", labelled "Per management". |
| The research job and the hourly refresh both wrote the same cache file, and a merge conflict lost a run's output. | Separate cache files. Each job re-applies its outputs on top of the latest main before pushing. |
| One failed model call threw away a whole research report. | Reports are saved with numbers and transcript extracts even if the judgment step fails, and the UI offers a retry. |

## What I deliberately left out

- **Real push notifications.** Web Push needs a subscription server and iOS home-screen install. The Tripwires screen shows what *would* have fired; delivery is the obvious next step.
- **NSE as a filings source.** NSE's API blocks non-browser clients; BSE carries the same filings and is reliable from a cron job.
- **Chat.** Covered above. A "follow-up question about this company", grounded in the cached transcript extracts, is a natural addition.
- **Annual-report deep reads.** Contingent liabilities, related-party transactions and auditor qualifications sit in 300-page PDFs. The plumbing (`pdf.ts` plus `annualReports` links) is there. It needs section-targeted chunking to stay cheap.
- **Intraday prices.** The brief asked for end-of-day data.

## Known limitations

- The BSE and screener.in page formats can change; parsers are isolated in single files so they're easy to fix.
- Scanned-image PDFs return no text. FINN says so rather than guessing.
- FINN runs on Gemini's free tier on purpose (₹0 to run). Each model version allows only a handful of judgment calls a day. The demo reports are pre-computed and unaffected. A brand-new ticker researched live after the day's quota is spent still gets all the numbers, charts and flags, but the promise check says so plainly and works again after the daily reset. Paid tier: about ₹1 per report, no code changes.

## Where I'd take it next

1. Push delivery (Web Push / Telegram) with a per-investor schedule ("brief at 8:45, tripwires live").
2. Learn from "Done": items the investor always dismisses should sink automatically.
3. Annual-report red-flag scan: contingent liabilities, related-party transactions, auditor remarks, pledge trend.
4. A promise ledger that persists across quarters, so management credibility becomes a tracked score per company.
