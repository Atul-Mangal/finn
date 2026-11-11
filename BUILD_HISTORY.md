# Build history (detailed)

A turn-by-turn record of the AI-assisted build of FINN.

- **Tool:** Claude (Anthropic) working as a coding agent in a claude.ai agent workspace. It had a Linux shell, file tools, headless Chrome for phone-size screenshots, and push access to this repo.
- **Coverage:** one continuous conversation over two working days, 9 and 11 Nov 2026. Times are IST.
- **Format:** "Human" turns are the requests made, paraphrased closely. "Claude" turns summarise what it did, the commands and checks it ran, and what it decided and why. Short exchanges about API-key handling are left out; no key appears here. Every code change ends in a commit you can open (`git log`). The `data:` commits are the scheduled jobs.

[BUILD_LOG.md](BUILD_LOG.md) is the one-page version.

---

## Day 1: Monday 9 November

### 12:08 — The brief
**Human:** attached the two challenge PDFs (main brief + reference glossary).

**Claude:** extracted both PDFs with `pdftotext` and summarised them. It proposed where the points are won:
- go deep on three things rather than broad: the windowed digest, the results card (QoQ/YoY) and promise-vs-delivered research;
- treat the management bio as best-effort (LinkedIn blocks scraping);
- decide the data source first (NSE blocks bots, BSE's API is usable);
- have a real point of view on interaction, e.g. a ranked morning brief instead of "chat + dashboard";
- go cheap model for bulk work, strong model only for judgment, with caching.

It flagged that the workspace couldn't reach market sites, so scrapers would be validated by running them on GitHub's servers.

### 12:10 — "Just build it and push it"
**Human:** asked Claude to build it now and push to GitHub, and clarified that the submission is Atul's.

**Claude:** checked the environment. The GitHub token was invalid, no account was linked, and NSE, BSE, Yahoo, screener.in and Gemini were all unreachable from the workspace. It explained both blockers. It planned a single TypeScript codebase, with a scheduled GitHub Action doing the scraping where those sites are reachable. It also proposed a `DECISIONS.md` so every choice could be explained in an interview. It started scaffolding Next.js.

### 12:13–12:29 — Setup, one step at a time
**Human:** asked to set up first, one step at a time.

**Claude:** walked through each step and waited for confirmation before giving the next.
1. Create an empty public repo `Atul-Mangal/finn`.
2. Get a Gemini API key from AI Studio, without pasting it into chat.
3. Add it as a GitHub Actions secret.
4. Optionally, get a Tavily key for exec bios.
5. Create a Vercel account, but don't import yet.

When the repo existed, Claude attached it to the session, cloned it, and pushed a placeholder commit **`cbc4199`** to prove push access.

### 12:30–12:40 — Data engine (`68e7fb6`)
**Claude:** wrote the backend. Choices made, and why:

**Model router (`src/lib/llm.ts`).**
- Two tiers: *cheap* for bulk extraction, *strong* for the one reasoning call.
- Gemini by default, or any OpenAI-compatible API.
- Every call cached on its prompt; tokens and list-price cost counted, so cost can be shown in the UI.

**Push side:**
- **Prices:** Yahoo's chart endpoint, the same data yfinance wraps.
- **Filings:** BSE's announcements API. NSE's API blocks non-browser clients.
- **Classifier:** regex rules on BSE's own category and subject first; the cheap model only for leftovers, in batches of 25. Rules are free, instant and deterministic.
- **Priority:** an explicit scoring function, e.g. a board-meeting *intimation* about results −65 because it's a date, not news; a CFO/MD change +15; a downgrade +30. Ranking should be readable and arguable, not hidden in a prompt.
- **Clustering:** one results event (results + deck + newspaper ad + press release) becomes one item.
- **Results:** the model only *copies* table cells for three quarter columns. Code converts units, derives EBITDA (PBT + finance cost + D&A − other income), computes QoQ/YoY and runs sanity checks shown to the user. Lenders get "EBITDA not meaningful".
- **People:** names and roles are extracted. The bio comes first from the filing's own brief profile, which SEBI requires. A web search is added only if the model confirms it's the same person.

**Pull side:**
- A screener.in parser: tables plus transcript and annual-report links; consolidated with standalone fallback; banks detected.
- **Deterministic metrics and flags (`metrics.ts`):** CAGRs, margin trend, D/E, working-capital days, CFO/PAT and an FCF proxy. Every computable number is computed.
- **Guidance extraction:** one cheap call per transcript, cached forever per URL.
- **One strong judgment call** over compact facts. It must cite a number or quote for each verdict and is told not to use outside knowledge.

**Also:** labelled sample data with *fictional* companies, so the UI could be built before live data existed. Type-checked and pushed.

### 12:40–12:51 — The app (`c93f5ad`)
**Claude:** wrote a design plan and checked it against generic AI-design defaults. It chose a cool stone background, ink text, Schibsted Grotesk plus Newsreader, and a single bold device: a highlighter stroke only on what matters. Then it built three screens.

- **Brief:** time-window chips (24h default, 3 days, week, month, custom date), then one sentence ("3 filings need you…"). Ranked cards for important items, one-line rows for medium ones, routine filings folded into a count. Plus a "Done" pile and new-since-last-visit dots.
- **Tripwires:** sliders for volume ×, averaging window and price %, plus filing types. It re-runs the thresholds over the last 60 sessions to say *"about N alerts a week"*, so the investor calibrates noise directly.
- **Research:** any symbol; three staged API routes (numbers → transcripts → judgment) so each fits a serverless timeout and progress shows. Promise ledger first.

It then:
- added GitHub Actions: an hourly refresh, a weekly research prefetch, and CI;
- added offline tests (classifier, scoring, results maths, parsing);
- wrote README and DECISIONS.

**Verification:** `next build`, lint, tests, and headless-Chrome screenshots at 390 px. The screenshots caught two bugs: tabular figures put spaces before punctuation in this font, and 5-metric grids left empty cells. Both fixed before pushing.

**`f2dba2d`:** a fallback to Yahoo's second host.

**Claude:** also drafted the covering email.

### 13:06 — Deployed
**Human:** imported the repo on Vercel and set the keys: https://finn-92ls.vercel.app

### 13:12 — First real run
**Human:** triggered "Refresh data"; green in 42 s.

**Claude:** pulled the committed data. 219 filings and 20 price series arrived, but there were **zero model calls**. It audited the real ranking and found:
- ESOP allotments scored as fund raises;
- a board-meeting intimation scored as a fund raise;
- commercial-paper repayments ranked as top items.

→ **`4d88c8c`**: rules reordered, a generic intimation penalty, debt-servicing ranked below equity raises, and the name check taught acronyms (IRCTC). Regression tests added.

**Human:** said the secret had been named `Finn` instead of `GEMINI_API_KEY`. **Claude** explained the variable name and asked to rerun.

### 13:24 — Second run: the model was gone
**Human:** shared run #2 (green, 52 s).

**Claude:** the errors said Google had retired `gemini-2.5-flash-lite` for new keys. Instead of hardcoding a new name, the code now asks the key's model list and picks the newest stable Flash-Lite and Flash → **`d31a443`, `eb5a478`**.

### 13:28–13:32 — Third run and the first live research
**Human:** shared run #3 (1 min 24 s), plus phone screenshots of Pidilite research: numbers, flags and charts rendering live; one transcript failed with HTTP 503; then the pasted page text showing the judgment step "rate-limited after retries".

**Claude:** checked 9 extracted results cards (Airtel, Reliance, L&T, Bajaj Finance looked consistent) and diagnosed four bugs:
- **The retry wrapper swallowed 429/503**, so Gemini's own backoff never ran. Fixed to honour Google's `retryDelay`, with call spacing in the cron job.
- **Scanned-image results PDFs** (Maruti, KPIT, Deepak Nitrite) → fall back to screener.in's quarterly table, labelled.
- **HDFC Bank's "previous quarter" was really March** → column dates parsed and checked, labels normalised to "Q2 FY27".
- **Gemini 3 thinking tokens could hit the timeout** → thinking effort capped per tier, with automatic fallback if a model rejects the setting.

→ **`661fcf5`**. For the rate-limited judgment step, a model out of quota now falls back to the next version → **`76fd786`**.

### 13:41 — Fourth run: the 10× error
**Human:** shared run #4 (4 min 59 s).

**Claude:** zero errors: 15 results cards, 10 people cards (including the HDFC Bank MD & CEO change, with a bio), and substantive summaries (Polycab NCLAT order, Sun Pharma USFDA approval). But **Maruti's revenue showed ₹5,33,441 Cr**: Maruti reports in ₹ million and the unit was read as crore. → **`d024407`**: every extracted card is reconciled with screener.in's figure for the same quarter, and a 10×/100× gap is rescaled and flagged. Also: subsidiary housekeeping (Titan's small Canada unit) ranked below real M&A. Tests added.

---

## Day 3: Wednesday 11 November

### 12:39 — "What's the status?"
**Claude:** pulled the repo. The hourly job had run 7 times unattended with no errors, and the latest run made zero new model calls (all cache). The cross-check flagged ITC, ICICI Bank and HDFC Bank at 40–57% off, and HDFC was showing revenue −49% YoY.

Decision: **never show a number known to disagree with an independent source.** Over 25% off means show screener.in's figures and say why. Banks are compared on PAT, because "revenue" differs by definition. Duplicate results cards are merged. → **`4a1c81e`**, with a test.

It also noted the research prefetch had never run, and the build-history requirement.

### 13:35 — "Explain all of this"
**Claude:** gave a plain-language walkthrough of the challenge, the three screens, how the push pipeline and research engine work, every problem real data exposed, and likely interview questions.

### 13:58 — First research prefetch fails
**Human:** had triggered "Prefetch research".

**Claude:** `gh` now worked from the session, so it read the Actions logs directly. The judgment call to `gemini-3.8-flash` had exceeded the 2-minute timeout for all 5 companies, and one failed step had been throwing away the whole report. → **`23438f0`**:
- a timeout means "try the next model";
- reports are saved with numbers and extracts even if judgment fails;
- model timings are logged;
- the research routes get a longer limit. Claude verified via GitHub commit statuses that Vercel accepted the deploy.

It re-dispatched the job through the REST API and watched it. All 5 reports were generated, but the save step **failed on a merge conflict**: the hourly refresh had written the same cache file. → **`2b0efe3`**:
- separate cache files;
- each job re-applies its outputs on top of the latest `main` before pushing;
- jobs record which models actually answered (`data/models.json`), since 3.8 and 3.7 were listed but hung for over 4 minutes while 3.6 answered in about 10 s.

Re-run: **all 5 in 2 minutes**, about $0.005 per judgment call.

### 14:19–14:36 — Reading the reports critically
**Claude:** audited every verdict.
- **Good:** Dixon, Asian Paints (margin fell below the guided 18–20% band) and Pidilite. **Kaynes**: the ₹4,000 Cr FY26 revenue guide was missed (₹3,626 Cr), and operating cash came in at −₹600 Cr against a promise to turn positive.
- **Bad:** HDFC Bank said "OPM is −6%". screener's bank "financing margin" isn't an operating margin, and one verdict relied only on management's own later claim.

→ **`f223e3a`**: lenders are judged without that column, and self-reported delivery becomes "unverifiable — per management". Docs updated with measured costs and a "What real data broke" table. Re-run.

The second run burned through daily free quotas (3.6 exhausted, 3.8 hanging, so it fell back to 3.5 and 3.7) but completed, and HDFC's report was now honest. → **`991249b`**: deposits added to the bank analysis table, and models that hang are remembered and tried last.

### 17:01–17:04 — Phone review
**Human:** forwarded a GitHub failure email, and sent phone screenshots of the Kaynes report.

**Claude:** confirmed from the run list that the email was the old conflict run and everything since was green. It reviewed the screenshots: the ledger, honest "can't verify" verdicts and pending FY28 targets all read correctly. One screenshot looked shifted sideways. Claude measured every screen for overflow at 360 px in headless Chrome (none) and traced it to pinch-zoom.

### 17:06–17:08 — Free tier or paid?
**Human:** asked what enabling billing meant, then decided to stay on the free tier.

**Claude:** explained the trade-off (free: ₹0, but brand-new tickers can hit daily limits; paid: about ₹1 per report). → **`f7297c1`**: when the quota is spent, the app says so plainly instead of showing a raw error, and DECISIONS records it as a deliberate choice.

### 17:10 — Covering email
**Claude:** drafted the submission email with measured facts (₹1/report, the Kaynes example, the Maruti catch).

### 17:23 — Build history
**Human:** asked for help producing the AI build history.

**Claude:** proposed documenting the real session faithfully rather than recreating it, and wrote [BUILD_LOG.md](BUILD_LOG.md) → **`85058bc`**.

### 17:25 — "Check everything from their point of view"
**Claude:** re-read both PDFs line by line and mapped every requirement to the app. It then screenshotted the app *with real data* for the first time from a reviewer's side, and found:
- a quiet 24h window opened on "Nothing needs you", hiding the week's best cards → an "Earlier this week" section;
- one-liners that just repeated a vague subject ("Credit Rating") → read the filing itself (capped per run);
- inconsistent, wordy model-written verdict headlines → counted in code from the verdicts ("Kept 0 of 2 checkable promises; 2 missed"), shown on the Research list too;
- transcript rows → link to that company's promise check; the Tripwires list → capped at 8.

→ **`c6967a8`**. It also flagged that ENAM asks for the actual conversations as build history, which led to this document.

---

## How the work was split

**Human:**
- set up accounts and secrets, deployed, and triggered and checked runs;
- tested on a phone and shared screenshots;
- made the product calls: depth over breadth, stay on the free tier.

**Claude:**
- wrote all the code, tests and docs;
- read logs and data after every run;
- found and fixed each failure above, and verified with builds, tests and headless screenshots before every push.

Most of the important fixes came from **real data contradicting assumptions**: the unit error, the scanned PDFs, bank semantics, retired and hanging models. That's why the design leans on code-computed numbers and independent cross-checks.
