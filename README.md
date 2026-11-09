# FINN — what changed in your portfolio, and whether it matters

A mobile-first investing agent for Indian equities, built for the ENAM AI Engineer Build Challenge.

- **Brief (push):** every exchange filing across a 20-stock portfolio for the window you pick, ranked by materiality. Results arrive as headline numbers (Revenue, EBITDA, PBT, PAT, QoQ and YoY). Management changes arrive with who the incoming person is. Routine paperwork is folded away.
- **Tripwires (push):** you set what "unusual" means (volume ×, price move %, filing types). The screen tells you live how many alerts a week that setting would have produced, so you can calibrate noise before it happens.
- **Research (pull):** any NSE symbol. FINN reads the last five earnings-call transcripts and checks what management promised against what the filed numbers show. Then it gives trajectory, balance sheet, cash quality, current guidance and a bull/bear case. Primary sources only.

**Try it on a phone:** `<your Vercel URL>` (add to home screen; it installs as an app).

## How it works

```
GitHub Actions (hourly in market hours + after close)          Vercel (Next.js, mobile web app)
┌──────────────────────────────────────────────────┐           ┌───────────────────────────────┐
│ Yahoo EOD ─┐                                      │  commit   │ Brief / Tripwires read static  │
│ BSE filings ┼─ rules classify ─ score ─ cluster ──┼──JSON────▶│ JSON: instant, no waiting      │
│             └─ cheap model: leftovers, results    │           │                               │
│               tables, people, one-liners          │           │ Research: 3 staged API routes  │
│ file cache (committed) → each filing processed once│          │  base → extract×5 → analyze    │
└──────────────────────────────────────────────────┘           └───────────────────────────────┘
```

| Step | Who does it | Why |
|---|---|---|
| Classify filings | Regex rules on BSE category + subject; cheap model only for leftovers, 25 per call | Most filings are unambiguous; rules are free and deterministic |
| Rank | Explicit scoring function (`classify.ts`) | Ranking judgment should be readable and tunable, not hidden in a prompt |
| Results numbers | Cheap model **copies** the table; code converts units, derives EBITDA, computes QoQ/YoY, runs sanity checks | Models shouldn't do arithmetic; bad extractions get flagged, not shown silently |
| Exec bio | Filing's own "brief profile" first (SEBI requires one), then optional web search with a same-person check | Most reliable source first; avoid attaching a namesake's CV |
| Research numbers | screener.in tables → `metrics.ts` (pure code) | Every computable number is computed |
| Guidance | Cheap model, one call per transcript, cached forever per URL | A transcript never changes |
| Promise vs delivered, bull/bear | **One** strong-model call over compact extracted facts | The only step that needs reasoning |

A typical feed refresh is mostly cache hits. A fresh research run is 5 small-model calls and 1 large-model call: roughly ₹2–3 at list price, and ₹0 on Gemini's free tier.

## Run it

```bash
npm install
cp .env.example .env.local      # add GEMINI_API_KEY (free at aistudio.google.com)
npm run sample                   # labelled sample data (fictional companies) for offline UI work
npm run pipeline                 # real data: prices + filings → public/data/feed.json
npm run prefetch                 # precompute research for the demo tickers
npm run dev                      # http://localhost:3000
npm test                         # offline tests for the deterministic parts
npm run check                    # verify portfolio BSE codes / Yahoo symbols
```

### Deploy
1. Import the repo on Vercel and set `GEMINI_API_KEY` (and optionally `TAVILY_API_KEY`, `UPSTASH_REDIS_REST_URL`/`TOKEN`).
2. In GitHub → Settings → Secrets → Actions, add the same `GEMINI_API_KEY` / `TAVILY_API_KEY`.
3. Actions → **Refresh data** → Run workflow; then **Prefetch research** → Run workflow. Each run commits data, which redeploys the app.

## Layout

```
src/lib/push/     prices, BSE filings, classifier + scoring, results extraction, people, summaries
src/lib/pull/     screener parser, deterministic metrics & flags, transcript guidance, analysis
src/lib/llm.ts    two-tier model router (cheap/strong), caching, cost accounting; Gemini or any OpenAI-compatible API
src/lib/alerts.ts tripwire logic (pure; also powers the live "alerts per week" calibration)
src/app/          Brief (/), Tripwires, Research + API routes
scripts/          pipeline, research prefetch, sample data, portfolio check
```

See [DECISIONS.md](DECISIONS.md) for the trade-offs and what was left out.
