# Trendline Dev Log

All activity tracked with timestamps. Pushed daily.

---

## 2026-03-14 (Saturday)

### 18:59 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 13–14)
- No memory files created since March 6 — quiet stretch continues (day 11+)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance status unknown; shutdown decision still pending
- Mission Control v2 rebuild prompt still pending execution

---

## 2026-03-13 (Friday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 12–13)
- No memory files created for this period — quiet stretch continues (day 10+)
- All project statuses unchanged

---

## 2026-03-12 (Thursday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 11–12)
- No memory files created for this period — quiet stretch continues (day 9+)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance status unknown; shutdown decision still pending

---

## 2026-03-11 (Wednesday)

### 16:27 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 10–11)
- No memory files created for March 10 or March 11 — quiet period continues (day 8+)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance status unknown; shutdown decision still pending

---

## 2026-03-10 (Tuesday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 9–10)
- No memory files created for March 9 or March 10 — quiet period continues (day 7, one full week)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-09 (Monday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 8–9)
- No memory files created for March 8 or March 9 — quiet period continues (day 6)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-08 (Sunday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 7–8)
- No memory files created for March 7 or March 8 — quiet period continues (day 5)
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-07 (Saturday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 6–7)
- No memory files created for March 6 or March 7 — quiet period continues
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-06 (Friday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 5–6)
- Two brief Discord sessions logged (22:54 UTC Mar 5, 01:40 UTC Mar 6) — no substantive work captured
- Political influence project unchanged since March 3 data cleanup
- All dataset counts hold steady: 31K individual contributions ($91M), 45K PAC, 71/90 lobbying, 64/90 gov contracts, full OpenStates
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-05 (Thursday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity recorded in the last 24 hours (March 4–5)
- No memory files for March 4 or March 5 — quiet period
- Political influence project unchanged since March 3 data cleanup
- Dataset status holds: 31K individual contributions ($91M clean), 45K PAC contributions, 71/90 lobbying, 64/90 gov contracts, full OpenStates data
- OpenStates Postgres instance still running locally (~45GB); shutdown decision still pending

---

## 2026-03-04 (Wednesday)

### 06:00 CST — Daily Changelog Push (automated)

#### Political Influence — Data Cleanup & Validation (March 3)
- Ran deep analysis sub-agent → produced DEEP_ANALYSIS.md
- Ran data cleanup sub-agent → **removed $5.5B in garbage data**
  - AMC Networks: Soros/Bloomberg/Mercer misattributed (FEC fuzzy search for "AMC" pulled unrelated mega-donors)
  - Bloomberg LP: Biden Victory Fund misattributed ($266M)
  - 4,721 zero-amount contributions removed
  - Database corrected: $5.6B → $91.2M in real contributions (1,584 individuals, 31,078 contributions)

#### Political Influence — Data Fill Attempts (March 3)
- **Lobbying spend**: Aggregated from lobbying_filings → 26 → 71 of 90 companies covered
- **USASpending contracts**: Reran with correct schema (award_amount not amount). 64/90 companies, 4,683 records
- **FEC independent expenditures**: Only 4 new records (38 total) — most PACs don't do independent expenditures
- **State contributions (Socrata)**: 0 new records — most state dataset IDs stale or missing employer fields
- **FollowTheMoney API**: Seanny provided API key. API alive but unusable for bulk — employer queries hang 20+ seconds and return empty

#### Political Influence — Current Dataset Status (March 3)
- ✅ Individual contributions: 31K records, clean ($91M)
- ✅ PAC contributions: 45K records ($211M)
- ✅ Lobbying: 71/90 companies ($418M via lobbying_filings)
- ✅ Government contracts: 64/90 companies (4,683 records)
- ✅ OpenStates: 49M votes, 1.5M bills, 7M sponsorships
- 🟡 State contributions: 4 states only (WA dominates at 99%)
- ❌ FollowTheMoney API too slow for bulk pulls

#### Key Analytical Findings (March 3)
- Lobbying dominates at $418M (67% of real spending)
- Energy PACs 85-97% Republican; tech PACs more bipartisan
- Tech/media employees 95-100% Democratic (opposite to their PACs)
- Amazon, Meta, Comcast top lobbying spenders ($39M, $38M, $28M)
- Healthcare companies show 400-600:1 ROI on contracts vs spending
- Centene leads government contracts at $3.8B

---

## 2026-03-03 (Tuesday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24 hours
- Political influence project data pipeline and analysis from March 1-2 remains the latest work
- OpenStates Postgres instance still running locally (~45GB); pending shutdown decision after SQLite verification
- Seanny's 7:30 AM update on alignment scores was the last scheduled item (March 2)

---

## 2026-03-02 (Monday)

### Overnight — OpenStates Postgres Restore
- Downloaded schema dump (696KB) + data dump (9.5GB)
- Multiple failed pg_restore attempts (data-only dump without schema, PostGIS deps, auth issues)
- Finally restored by filtering TOC lists to remove PostGIS/geometry/boundary deps
- Schema first, then data (~2 hours for data load)
- **Result:** Full OpenStates database restored locally — 1.5M bills, 49M person votes, 7M sponsorships, 1.1M vote events, 22K legislators

### Overnight — SQLite Extraction from OpenStates
- Extracted all OpenStates data into political_influence.db:
  - state_bills: 1,505,145
  - bill_sponsorships: 7,023,270
  - person_votes: 49,128,610
  - vote_events: 1,110,809
  - state_legislators: 20,278
  - committee_memberships: 58,622
  - state_committees: 2,815
  - legislative_sessions: 1,063
- Postgres still running locally (~45GB disk), can shut down after confirming SQLite completeness

### Overnight — Political Influence Analysis (3 phases)
- **ANALYSIS.md:** Surface-level corporate spending overview ($2.7B tracked)
- **DEEP_ANALYSIS.md:** Expanded to 102 donation-legislator links, classified 368K state bills by industry, geographic patterns, contribution trends
- **ALIGNMENT_SCORES.md:** Core finding — corporate donations show LOW correlation with voting patterns
  - Energy: 5.89% alignment (highest), Finance/Healthcare/Media: 0%
  - Only 41 of 102 identified links had matching vote data
  - Honest takeaway: influence likely works through access/agenda-setting, not direct vote-flipping

### Data Quality Issues Found
- $211M AMC Networks/Bloomberg misattribution
- EPA data appears synthetic
- Board member data polluted with metadata
- "Pro-industry" vote heuristic is crude — may undercount true alignment

### Lessons Learned
- Fumbled Postgres restore badly — sent Seanny back to terminal 5+ times with broken commands
- Didn't check dump format before downloading 9.5GB, didn't check for PostGIS deps
- Same pattern as betting engine: confidence without verification. Must follow SOUL.md.

### 06:00 CST — Daily Changelog Push (automated)
- OpenStates full database restored and extracted to SQLite (49M+ person votes)
- Three-phase political influence analysis completed
- Low alignment scores challenge simple vote-buying narrative

---

## 2026-03-01 (Sunday)

### ~10:20 PM (Feb 28) — Political Influence Tracker: UI Overhaul
- Phase 1 agent: Design system, sidebar, dashboard, companies grid, party-trends analysis
- Phase 2 agent: Company detail (tabbed), 5 analysis pages, compare, research, network, skeleton/empty states
- ~5,300 lines changed across all frontend files
- Glassmorphism cards, gradient text, animated hover effects, rank badges
- Build passed, pushed to Vercel

### Overnight — Data Fills (political-influence)
- **pac_contributions: 0 → 45,340** (FEC Schedule B disbursements for all 125 PACs)
- **board_members: 0 → 11,430** (Wikipedia scrape across 90 companies)
- **state_contributions: 0 → 12,125** (WA: 10,631, IA: 1,301, HI: 170, TX: 23)
- **state_legislators: 478 → 5,381** (OpenStates full 50-state pull)
- **epa_enforcement: 0 → 550** (EPA ECHO, limited by API 500s)
- **state_lobbying: 0 → 240** (derived from federal LDA filings)
- **donation_legislator_links: 0 → 41** (cross-referenced donations to legislators)
- **foreign_agent_registrations: 0 → 5** (FARA bulk CSV — sparse for US domestic companies)

### Overnight — Dead Ends Documented
- political_ads: Google moved to BigQuery only, Meta has no public API
- FARA API: all endpoints return 404 (bulk CSV works but irrelevant for domestic companies)
- EPA ECHO primary endpoint: HTTP 500s; alt endpoint returns 197K records causing OOM
- Illinois Sunshine API: 404. Florida: 403. TX Ethics bulk CSVs: 404
- CA bulk download: 1.5GB — too large for overnight processing

### Overnight — Still Running at Log Time
- OpenStates bills search (tidal-bison) — rate-limited, searching by industry terms across 50 states
- FEC individual contributions — stopped at company 69/90 (API cap duplicates)

### ~12:30 AM — BUILDER.md Created
- Seanny provided personal builder philosophy document
- Saved as BUILDER.md in workspace root, added to AGENTS.md session startup checklist
- Key themes: skepticism as feature, working > clever, production is only truth

### ~1:00 AM — Data Export + Deploy
- Re-exported data.json with new fields (board_members, pac_contributions, epa_actions, state_contributions, lobbying, irs_990, gov_contracts, legislator_links)
- Build passed, pushed to Vercel

### 06:00 CST — Daily Changelog Push (automated)
- Massive data fill overnight — 8 tables populated from zero
- Political Influence Tracker UI overhauled with glassmorphism design system
- Trendline repo pulled to stay current

---

## 2026-02-28 (Saturday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 9 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-27 (Friday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 8 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-26 (Thursday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 7 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-25 (Wednesday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 6 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-24 (Tuesday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 5 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-23 (Monday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 4 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-22 (Sunday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files since Feb 19 — 3 consecutive quiet days
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current
- Betting engine remains shelved on `engine-v17` branch

---

## 2026-02-21 (Saturday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- No new memory files created since Feb 19
- Mission Control v2 rebuild prompt still pending execution (`mission-control/REBUILD-PROMPT.md`)
- Trendline repo pulled to stay current

---

## 2026-02-20 (Friday)

### 06:00 CST — Daily Changelog Push (automated)
- No new development activity in the last 24h
- Previous day's major events logged below (Feb 19)
- Trendline repo pulled to stay current

---

## 2026-02-19 (Thursday)

### ~Morning CST — Betting Engine Post-Mortem
- Seanny confronted Dorothy with evidence: NCAAMB O/U backtest claimed 65% accuracy (66,776 games), live season hit 49.9% (coin flip). Spread: 49.4%.
- Root cause: likely look-ahead bias in backtests (using same-day KenPom data instead of point-in-time snapshots)
- 2 weeks of development invalidated. Hundreds in API costs lost.
- **Decision:** Engine on `engine-v17` branch effectively shelved. Seanny stepping back from AI-assisted betting.
- Updated SOUL.md with anti-sycophancy as rule #1
- Updated USER.md with full failure context for future sessions
- Created MEMORY.md with detailed post-mortem

### ~Afternoon–Evening CST — Mission Control Dashboard (Full Build)

#### Phase 0: Multi-Agent Gateway Config
- Updated `~/.openclaw/openclaw.json` with 11 agents (main/Dorothy + foreman + 9 specialists)
- Enabled `/v1/chat/completions` HTTP API for dashboard→foreman communication
- Unlocked `sessions_spawn`, `sessions_send`, `sessions_history` over HTTP `/tools/invoke`
- Created 10 agent workspaces (`~/.openclaw/workspace-{agent}/`) each with AGENTS.md + SOUL.md
- Agent roster: foreman (Opus), frontend/backend/qa/researcher/writer/devops/data (Sonnet), architect/math (Opus)
- Verified: spawning works, chat completions work, agents respond in character

#### Dashboard v1 Built & Deployed
- Sub-agent built dashboard in ~6 min (session `24b706d7`)
- Fixed: `(dashboard)` route group leftovers, `AgentInfo`/`Agent` type mismatch, missing root `page.tsx`
- Fixed transcript loading — `content` is array of content blocks, not string
- Deployed to Vercel: `https://mission-control-alpha-lime.vercel.app`
- Four views: Command Center, Production Line (kanban), Sessions, System

#### Research & v2 Planning
- Researched 6 reference projects: Danm72, ClawDeck, abhi1693, Jon Tsai, Medium article
- Wrote v2 rebuild prompt at `mission-control/REBUILD-PROMPT.md` (27KB)
- Retrowave/synthwave aesthetic chosen (neon pink/cyan/purple, Orbitron font, glow effects)
- 5 views planned: Command Center, Production Line, Sessions, System, Agent Profiles
- Agent profiles with codenames, skill bars, personality, cost tiers
- Seanny approved prompt, not yet executed

#### Key Technical Learnings
- `sessions_spawn`/`sessions_send` hard-denied on `/tools/invoke` by default — needs `gateway.tools.allow`
- `agents_list` resolves to requesting agent — HTTP = main, so main needs `allowAgents`
- Tool invoke uses `args` not `params` in request body
- Sub-agents cannot spawn sub-agents (no nesting)

### 06:00 CST — Daily Changelog Push (automated)
- Massive engine-v17 sprint logged below from Feb 18
- Trendline repo pulled to stay current

---

## 2026-02-18 (Wednesday) — Engine V17 Sprint

### All Day — Deep Engine Analysis + Rewrite (engine-v17 branch)
- Read every file in pick-engine (5,211 lines), all Ridge models, CLV engine, signal fusion, convergence scoring, backtests
- Wrote comprehensive improvement plan → `trendline-engine-improvement-plan.md`
- Got push access to trendline repo, started executing on engine-v17 branch

### ~Morning CST — Training & New Signals
- `6c1b798` — fix(nba-ridge): compute actual rest days (was hardcoded to 1)
- `389c4b8` — feat: NBA Ridge training script
- `983ca22` — feat: cross-market spread↔total correlation signal (new signal, fully wired)
- `098233b` — feat: NCAAMB spread logistic training script
- `d8dfff3` — feat: NCAAMB O/U v2 training script (10 features)
- `f465108` — feat: NFL Ridge training script (needs EPA data)
- `f0b0f0b` — Updated NCAAMB O/U coefficients (65.0% OOS, up from 62.8%) + spread logistic coefficients
- `3b1dacc` — feat: NFL Ridge v2 (Elo + rolling avgs)
- Created 4 training scripts: train-nba-ridge.ts, train-nfl-ridge.ts, train-ncaamb-spread.ts, train-ncaamb-ou-v2.ts

### Training Results (validated on real data)
- **NCAAMB O/U Ridge (66,776 games):** 65.0% OOS accuracy (lambda 5000). V2 with 10 features scored 64.87% — more features = noise
- **NCAAMB Spread Logistic (66,163 games):** 53.08% raw → **57.3% at p≥55%, 59.0% at p≥56% (+12.7% ROI), 59.8% at p≥58%**. Edge is real but only when selective.
- **NFL Ridge v2:** Can't beat the spread (MAE 10.23 vs market 9.84). EPA contributes nothing — all edge from Elo.
- **NBA:** Only 4 games in DB, can't train. Needs full backfill.

### ~Afternoon CST — Key Decisions
- NCAAMB is the money sport — only one with validated edge
- More features ≠ better model (proven empirically)
- Selectivity is where the edge lives (53% raw → 59% at high threshold)
- NFL/NBA need data pipelines before models can work
- DB credentials updated from stale ep-soft-lab to ep-patient-sea

### ~Evening CST — Wiring Models + Data Backfills (~25 commits on engine-v17)
- `0b34859` — Spread logistic wired into generator, config weight 0.12, budget-neutral rebalance
- `06699e2` — Line movement confidence adjustment (1.15–1.25x when model agrees, 0.80–0.90x disagree)
- `3306666` — NFL EPA backfill: 2,723 rows across 2020–2024
- `59ca4b2` — NCAAF Ridge trained: 51.7% ATS, 54.3% O/U (6,104 games)
- `5f3460b` — All v16 feature flags enabled
- `dfef288` — DST detection bug fix (Intl.DateTimeFormat replaces getTimezoneOffset)

### ~Evening CST — NFL Model Validated
- **68.3% ATS** multi-season walk-forward (2022=63.6%, 2023=71.0%, 2024=68.7%, 778 games)
- Feature ablation: EPA contributes nothing; all edge from Elo ratings
- Could simplify to 2-feature model (Elo + spread)
- 51.6% O/U (not useful)
- Full validation: `config/nfl-model-validation.json`

### ~Evening CST — NBA Data Backfill
- 6,422 real games from official NBA API (nba_api Python), seasons 2020–2025
- 1,241 NBATeamStats records (30 teams × 5 seasons)
- 900 synthetic/fake games removed
- PIT retrain with rolling 15-game window: 64.1% "spread accuracy" BUT eval is broken

### NBA Model Status — BROKEN
- "Spread accuracy" measures who wins, not ATS (wrong metric)
- NBAGame has NO Vegas odds (spread/overUnder all NULL)
- OddsHistory has 372 spread + 744 total records — need join by date+team
- O/U model disabled (40.3% = actively harmful)

### ~Late Evening CST — Slack Bot Setup (in progress)
- Bot token (xoxb-) and app token (xapp-) saved
- **BOTH COMPROMISED** — pasted in Discord, needs rotation
- Gateway config.patch failing with schema validation error — still debugging

### Bug Fixes
- evaluate-lines expiry buffer 5h→8h in manager.ts
- gameDate switched from UTC to US Eastern in generator.ts
- DST detection fixed (server TZ always 0 on Vercel)

### Model Accuracy Scoreboard (end of day)
| Sport | ATS | O/U | Status |
|-------|-----|-----|--------|
| NFL | 68.3% ✅ | 51.6% | Validated, Elo-driven |
| NCAAMB | 59% @p≥.56 ✅ | 65% ✅ | Crown jewel |
| NBA | Unknown | Unknown | Eval broken, no odds |
| NCAAF | 51.7% | 54.3% | Unvalidated |

### Beta Launch Target
- **March 10, 2026** — 20 users, 3-week sprint (Feb 19 – Mar 9)

### New Files
- `src/lib/pick-engine/spread-logistic.ts`, `line-movement.ts`, `signals-cross-market.ts`
- `scripts/validate-nfl-model.ts`, `backfill-nfl-epa.ts`, `backfill-nba-batch.py`, `backfill-nba-team-stats.py`, `backfill-nba-official.py`, `train-nba-simple.ts`

### Next Steps
1. Fix Slack config (schema mismatch) + rotate compromised creds
2. Fix NBA model (link OddsHistory → NBAGame, fix eval metrics)
3. Consider NFL 2-feature simplification
4. Week 2: Ensemble stacking, confidence intervals
5. Week 3: March Madness tuning, UI polish, load test, beta

---

## 2026-02-17 (Tuesday)

### 06:00 CST — Daily Changelog Push (automated)
- Backfilled full Feb 16 activity (massive code health sprint + beta launch progress)
- Git pulled trendline repo to stay current

---

## 2026-02-16 (Monday) — Massive Code Health Sprint + Beta Launch

### All Day — Trendline Code Health Sprint (24 tasks across 6 sprint prompts)
- Seanny ran external coding agent; Dorothy wrote all prompts and verified between each push
- **Pick engine split:** 4,463-line monolith → 1,192-line orchestrator + 9 modules (signals-spread, signals-ou, model-edge, convergence, grading, injuries, props, config, types)
- **NBA fully wired:** reverse lookup (9 templates), daily-sync, sync-odds, weight allocation (0.10 trendAngles)
- **Tournament logic hardened:** config-driven dates 2024–2027, DB fallback, ±1 day tolerance, 550-line test suite
- **Dead code removed:** 6 unused modules + 44 .bak files (22,612 lines)
- **Ridge coefficients externalized:** `config/model-coefficients.json` with loader + fallback
- **Cron schedules expanded:** 3→12 jobs (closing lines 4×, odds monitor 3×, sync-odds 2×, daily-sync 3×)
- **Rate limiter consolidated:** in-memory deleted, Redis-only with fail-open
- **CI added:** `.github/workflows/ci.yml` (tsc + jest) + `validate-deployment.yml` (daily + on push)
- **New scripts:** retrain-ridge.ts, check-fusion-performance.ts, audit-nba-signals.ts, rollout-check.ts, test.sh
- **Error boundaries** for 4 pages, **loading states** for 7 pages, **PWA manifest** updated for NBA
- **New test suites:** model-edge, signals-spread, signals-ou, signal-fusion, confidence-calibrator
- **Docs:** v16-rollout-plan.md, ci-setup.md, next15-upgrade-plan.md, config/README.md, backtest/README.md
- **End-of-sprint stats:** 262 source files, 50,971 LOC, 18 test suites (300 tests), 52 API routes, 23 pages

### Evening — Beta Launch Roadmap Progress
- **Team logos** via ESPN CDN: `src/lib/team-logos.ts` (532 lines) + component, wired into 4 components
- **Discord webhook** env var consolidated to `DISCORD_ALERT_WEBHOOK_URL`
- **Auth imports** fixed: all routes using `import { auth } from "@/lib/auth-helpers"`
- **32 console.logs** removed from app/components
- **Phase 0 (Security):** `.env.production` deleted from repo, Google OAuth + site password rotated
- **Phase 1 (Infrastructure):** Redis health check, cron monitoring script, daily email digest cron
- **Bets/stats API** restored (242 lines)
- **Error handling** added to 7 API routes (try/catch + trackError)
- **Rate limiting** added to gate + picks/recap
- **Zod validation** added to 4 API routes
- **Phase 2 (Beta UX):** InviteCode model, invite validation API, admin invite CRUD, signup with invite codes, onboarding page (3-step flow), middleware redirect, completion endpoint, migration SQL
- **v16 flags seeded in Neon** — all 5 created disabled
- **`enable_signal_fusion` enabled** in prod (Phase 1 rollout, weight 0.0)
- **`rollout-check.ts`** + **`v16-launch.sh`** scripts created
- **Tests:** 310→324 passing across 21+ suites

### Evening — Phase 3 Code Pulled (commit 878adf6)
- PickFeedback + Feedback Prisma models added
- Feedback widget, admin dashboard enhancements, Discord auto-posting, health-ping cron
- **BLOCKER:** Need `npx prisma generate` + migration SQL against Neon
- Neon serverless adapter (`@prisma/adapter-neon`) added to `src/lib/db.ts`
- **End-of-day stats:** 271+ files, 52K+ LOC, 72 lib modules, 53 API routes, 23 pages, 13 cron entries

### Pending Migrations (manual)
1. `prisma/migrations/20260216_add_invite_codes_and_onboarding/migration.sql`
2. `prisma/migrations/manual/add-pick-feedback.sql`
3. `prisma/migrations/manual/add-feedback-table.sql`

### v16 Feature Flags Status
- `enable_signal_fusion` — ✅ ENABLED (weight 0.0, confidence boost only)
- `enable_market_intelligence` — ⏳ disabled (enable second)
- `optimize_weights_via_clv` — ⏳ disabled (enable third)
- `dynamic_confidence_calibration` — ⏳ disabled (NCAAMB only, enable fourth)
- `march_madness_logic` — ⏳ disabled (enable before March 1)

### Decisions Made
- Next.js upgrade: skip 15, go directly to 16 AFTER March Madness (late April)
- Node/Bun: default `node` in PATH is Bun shim — real Node at `/snap/bin/node` for jest/tsc
- UI concepts: 5 HTML mockups built in `/workspace/trendline-ui-concepts/`

---

## 2026-02-16 (Monday)

### 06:00 CST — Daily Changelog Push (automated)
- Backfilled late Feb 15 entries (16:00–20:32 CST) that were in memory but not yet in changelog
- Git pulled trendline repo to stay current

---

## 2026-02-15 (Sunday)

### 04:58 - 08:58 CST
- Heartbeat checks — nothing requiring attention

### ~09:00 CST
- Seanny requested overnight analysis summary on mobile
- Delivered mobile-friendly breakdown of 6-agent overnight results
- Key finding surfaced: DailyPick 36.8% (14W/24L) vs 62.8% backtest

### ~09:30 CST
- **Bug hunt initiated** — traced the backtest-to-live divergence
- Read full pick-engine.ts (3,095 lines), kenpom.ts, team-resolver
- **Found root cause:** `computeKenPomEdge()` called with raw `game.homeTeam`/`game.awayTeam` instead of canonical names — KenPom ratings map keyed by canonical names, so lookups silently fail for mismatched teams
- **Second bug:** Grading pipeline fails silently for same reason — 64/102 picks stuck as PENDING
- Proposed fix: swap `game.homeTeam` → `canonHome` (already resolved on prior line)

### ~10:00 CST
- Discussion: risks of AI access to main repo
- Seanny researching online warnings about AI coding assistants
- Provided honest assessment of risks + recommended workflow
- Proposed: branch-per-task, tests-before-code, review all diffs, never push to main

### ~10:30 CST
- Discussed maximizing compute usage (overnight work, cron jobs, agent swarms)
- Proposed nightly cron + weekly cron + on-demand spawn pattern
- Seanny noted I don't have access to main repo

### ~10:45 CST
- Proposed read-only access model: dev branch DB + no deploy creds
- Seanny agreed to read-only access pattern

### 11:24 CST
- **Trendline repo cloned** from github.com/SeannyQuest/trendline
- 280 files, 55k lines TypeScript
- Located at /workspace/trendline

### 11:28 CST
- **Established dev team role:** read-only auditor → proposals → copy-paste prompts
- Created DOROTHY-AUDIT.md tracking board
- Standard operating procedure: git pull before every audit pass

### 11:30 CST
- **Deployed 6 audit agents in parallel:**
  1. Pick Engine Logic — bugs, dead signals, weight validation
  2. Security & Auth — injection, auth gaps, Stripe, rate limits
  3. Data Quality — name resolution, pipeline failures, schema issues
  4. Frontend & UX — accessibility, error boundaries, loading states
  5. Architecture — dependencies, test coverage, caching, scalability
  6. Edge Research — new signals, free data APIs, academic research

### 11:34 CST
- **Security audit complete** (1m51s) — 0 critical, 1 high, 5 medium, 6 low
  - HIGH: Site gate bypass via static cookie
  - Positives: Stripe webhooks correct, timing-safe cron auth, no SQL injection

- **Data quality audit complete** (1m56s) — 0 critical, 4 high, 6 medium, 6 low
  - HIGH: FanMatch matched by date only (not team!) — wrong predictions on wrong games
  - HIGH: dayOfWeek calculated in UTC not ET
  - HIGH: NBA alias table empty
  - HIGH: Race condition in game insertion

### 11:35 CST
- **Pick engine audit complete** (2m53s) — 1 critical, 5 high, 3+ medium
  - CRITICAL: FanMatch moneyline edge uses raw ESPN names vs KenPom names
  - HIGH: NBA grading falls through to NCAAMBGame table — never grades
  - HIGH: NFL O/U double-counts weather
  - HIGH: NCAAF SP+ uses raw names
  - HIGH: NBA 30% dead spread weight
  - HIGH: NFL EPA defense always null

- **Architecture audit complete** (2m20s) — 3 critical, 5 high, 6 medium
  - CRITICAL: Zero unit tests (22k lines untested)
  - CRITICAL: In-memory rate limiting useless on Vercel serverless
  - CRITICAL: In-memory game cache inconsistent across instances
  - HIGH: 3,090-line god file (pick-engine.ts)
  - HIGH: Only 3/88 error paths use Sentry

- **Frontend audit complete** (2m37s) — 1 critical, 7 high, 12 medium, 8 low
  - CRITICAL: 14 routes missing error boundaries
  - HIGH: No SEO metadata on most pages
  - HIGH: Accessibility gaps throughout

### 11:37 CST
- **Edge research complete** (4m35s) — 18 new signal opportunities
  - FanMatch total prediction fetched but unused for O/U
  - NBA rest days signal completely disabled
  - Zero market-derived signals (no CLV, no line movement, no public %)
  - Easy wins: altitude HCA, tempo×DE interaction, NCAAF returning production

### 11:40 CST
- **dorothyv2 repo repurposed** as Trendline dev repo
- All old dorothyv2 code removed
- 6 audit reports + README + tracking board pushed to GitHub
- Structure: audit-reports/ → proposals/ → prompts/

### 11:45 CST
- **CHANGELOG.md created** — daily activity log, pushed every 24h
- Set up daily push cron

---

### ~13:30 CST
- **Phase 1.5 Tournament Readiness prompt written** — `prompts/PHASE-1.5-TOURNAMENT-READINESS.md`
  - 12 tasks: weight rebalancing (3), tournament logic (5), FanMatch cross-checks (2), stale odds protection, CLV tracking
  - NCAAMB spread weights restructured: modelEdge 0.23→0.31, eloEdge→0, barttorvik 0.05→0.02, new seedMismatch 0.05
  - NCAAMB O/U weights restructured: modelEdge 0.28→0.31, barttorvik 0.05→0.02, seasonOU 0.10→0.07, new eloOU 0.03
  - Tournament UNDER boost: 1.3x multiplier for March neutral-site unders, lowered gates
  - New signals: eloOU, seedMismatch, conference tournament fatigue detection
  - Stale odds protection: 0.8x penalty + 3★ cap for >6h old odds
  - CLV infrastructure: closingSpread/closingTotal fields on DailyPick

- **Phase NFL Foundation prompt written** — `prompts/PHASE-NFL-FOUNDATION.md`
  - 7 tasks: defensive EPA, Ridge regression, bye/rest, weather fix, confidence tiers, injuries, weight rebalancing
  - Based on NFL edge exploration report findings
  - Defensive EPA fix: download nflverse PBP CSV, aggregate by defteam
  - Ridge regression: replace napkin-math power rating with trained model (5 seasons training data)
  - Rest signal: bye week (+55% ATS), short week (46% ATS for road teams)
  - Injury impact scoring: positional value × status multiplier → point adjustment
  - NFL weights restructured with new restDays and injuries signals

### 13:41 CST
- **Switched to Sonnet** — per user request for faster/cheaper operation
- **Phase 1.5 implementation status:** Halfway done (tournament readiness)

### 13:58 CST
- **Phase 2 mega-prompt written:** PHASE-2-TESTS-ARCHITECTURE.md (22KB, 9 tasks)
  - Unit tests for pick engine (22k lines untested is risky for tournament)
  - Split pick-engine.ts into modular architecture  
  - Redis rate limiting + game cache
  - Split cron jobs into 6 independent functions
  - Sentry error tracking + performance monitoring
  - Integration tests for full pipeline
  - Target: Complete by Feb 21 for 10-day validation before conference tournaments

### ~16:00 CST
- **Deep code review** of Seanny's implementation — Phase 1, 1.5, NFL Foundation, Phase 2 all landed
- **116 files changed, 33k+ lines added** in trendline repo
- **3 critical bugs found:**
  1. NFL Ridge Regression: hardcoded `week: 1` instead of computing actual NFL week from gameDate (line 2979)
  2. Jest tests: `jest.spyOn` used without importing jest from `@jest/globals` → all tests fail
  3. Redis tests: `@upstash/redis` module not found during test execution
- **Verified working:** tournament UNDER boost, seed mismatch, conference fatigue, weight rebalancing (sums to 1.0), CLV schema migration, Sentry integration, Redis rate limiting + caching
- **Architecture refactor:** partial — modules created but main functions still in parent file
- Bug report written → `BUG-REPORT-POST-PHASE2.md`

### ~16:00 CST
- **Phase 3 mega-prompt written:** `prompts/PHASE-3-MODEL-ACCURACY.md`
- 9 tasks: Ridge regression for NFL/NBA/NCAAF, dynamic HCA, CLV tracking, ATS refinement, new edge signals, tournament validation, signal weight optimization + performance attribution
- Timeline: Feb 16–28 (before conference tournaments ~March 3)

### ~17:42 CST
- **3 critical bug fix prompts written** to `prompts/`:
  - `CRITICAL-BUG-FIX-NFL-WEEK.md` — hardcoded `week: 1` in `computeNflRidgeEdge()` (BUG-001)
  - `CRITICAL-BUG-FIX-JEST-IMPORTS.md` — missing `@jest/globals` imports (BUG-002/004)
  - `CRITICAL-BUG-FIX-REDIS-MOCKS.md` — `@upstash/redis` mock failure in ESM (BUG-003)
- All prompts copy-paste ready with exact file refs, code, and success criteria

### ~19:49 CST
- **Phase 4 mega-prompt written:** `prompts/PHASE-4-MARKET-SIGNALS.md`
- 8 tasks: CLV line movement, sharp vs public money, live odds monitoring, market timing, public bias exploitation, signal attribution, market inefficiency alerts, bookmaker profiles
- Timeline: Feb 28 – March 3 (before conference tournaments)
- New schema: LineMovement, OddsHistory, MarketAlert, PickSignalAttribution tables
- Discord webhook alerts for steam moves, reverse line movement, arbitrage

### ~20:32 CST
- **Phase 5 mega-prompt written:** `prompts/PHASE-5-POLISH-LAUNCH.md`
- 9 tasks: performance optimization, UX polish (tournament bracket, confidence viz, mobile), production monitoring, tournament marketing, edge cases, final model calibration, deployment/rollback, security hardening, documentation
- Timeline: March 4–10 (5-day buffer before Selection Sunday March 15)
- New systems: pick batching, multi-tier cache, SystemMetric/AlertEvent tables, feature flags, health check endpoint

**End-of-day running totals:**
- Findings: 5 critical, 22 high, 32 medium, 20 low (97 total)
- Edge opportunities: 18 new signals identified
- Bugs confirmed fixed in trendline: 1 (team name mismatch, commit 28246c9) + 3 new bugs found post-Phase 2
- Prompts delivered: 8 total (Phase 1.5, NFL Foundation, Phase 2, Phase 3, 3× bug fixes, Phase 4, Phase 5)
- **Full roadmap complete:** Phases 1–5 covering Feb 15 → March 15 Selection Sunday
