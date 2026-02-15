# Trendline Dev Repo

Dorothy's workspace for Trendline development — audits, proposals, and implementation prompts.

**Main repo:** [SeannyQuest/trendline](https://github.com/SeannyQuest/trendline) (read-only access)  
**This repo:** Research, audits, roadmap, and copy-paste implementation prompts.

---

## 🎯 Mission

Build a pristine, acquisition-worthy sports betting analytics platform with a verified, market-beating track record. No rush to launch — every deployment must be bulletproof.

---

## 🗺️ Roadmap

### Phase 1: Bug Fixes ← CURRENT
*Stop the bleeding. Fix everything that's actively wrong.*

| # | Prompt | Status | What |
|---|--------|--------|------|
| 01 | fanmatch-wrong-game-assignment | ⬜ | FanMatch predictions assigned to wrong games |
| 02 | nba-grading-broken | ⬜ | NBA picks never graded (wrong table) |
| 03 | dayofweek-timezone-bug | ⬜ | Primetime games tagged wrong day |
| 04 | nfl-weather-double-count | ⬜ | NFL O/U weather counted 2x |
| 05 | ncaaf-sp-raw-names | ⬜ | NCAAF SP+ lookup misses teams |
| 06 | nba-dead-weights | ⬜ | 30% NBA spread weight wasted |
| 07 | site-gate-bypass | ⬜ | Cookie bypass on site gate |
| 08 | nba-aliases-empty | ⬜ | NBA team resolution broken |
| 09 | error-boundaries-missing | ⬜ | 14 routes show crash screens |
| 10 | playerlog-unique-constraint | ⬜ | Duplicate stats corrupt props |
| 11 | sentry-error-tracking | ⬜ | 85/88 errors skip Sentry |
| 12 | stripe-idempotency | ⬜ | Replayed webhooks double-process |

### Phase 2: Test Coverage & Architecture
*Build the foundation acquirers want to see. No new features until this is solid.*

| # | Prompt | Status | What |
|---|--------|--------|------|
| 13 | unit-tests-betting-math | ⬜ | Tests for odds calc, profit, payout |
| 14 | unit-tests-team-resolver | ⬜ | Tests for name resolution + edge cases |
| 15 | unit-tests-pick-scoring | ⬜ | Tests for convergence scoring, tier gates |
| 16 | unit-tests-grading | ⬜ | Tests for pick + bet grading pipeline |
| 17 | split-pick-engine | ⬜ | Break 3,090-line god file into modules |
| 18 | redis-rate-limiting | ⬜ | Replace in-memory with Upstash Redis |
| 19 | redis-game-cache | ⬜ | Consistent cache across serverless instances |
| 20 | split-cron-pipeline | ⬜ | Independent cron jobs (sync, picks, grading) |
| 21 | centralize-env-config | ⬜ | All env vars through config.ts |
| 22 | deduplicate-utils | ⬜ | Extract shared betting math, todayET, VALID_SPORTS |

### Phase 3: Model Accuracy
*Make the numbers undeniable. Every change backtested.*

| # | Prompt | Status | What |
|---|--------|--------|------|
| 23 | wire-fanmatch-ou | ⬜ | Use FanMatch total prediction for O/U |
| 24 | clv-tracking | ⬜ | Closing line value infrastructure |
| 25 | recalibrate-hca | ⬜ | Dynamic HCA (season/conference-specific) |
| 26 | add-ats-picks | ⬜ | NCAAMB ATS at edge≥5 (57.8%, 16 seasons) |
| 27 | drop-dead-signals | ⬜ | Remove fmHomePred/fmAwayPred, Elo ATS weight→0 |
| 28 | tournament-under-boost | ⬜ | NCAA tournament 80.5% UNDER auto-boost |
| 29 | nba-rest-signal | ⬜ | Enable NBA rest day signal |
| 30 | public-track-record | ⬜ | Verified, timestamped, auditable results page |

### Phase 4: Market Signals (The Moat)
*Signals competitors don't have. Hard to replicate.*

| # | Prompt | Status | What |
|---|--------|--------|------|
| 31 | line-movement-detection | ⬜ | Track line moves from OddsSnapshot history |
| 32 | steam-move-alerts | ⬜ | Detect sharp money / reverse line movement |
| 33 | public-betting-pct | ⬜ | Fade the public signal |
| 34 | clv-meta-signal | ⬜ | Use CLV as a model quality feedback loop |
| 35 | referee-tendencies | ⬜ | NBA ref impact on totals (2-5% edge) |
| 36 | altitude-hca | ⬜ | KenPom altitude data for HCA adjustment |

### Phase 5: Polish for Launch
*Every pixel, every interaction, every edge case.*

| # | Prompt | Status | What |
|---|--------|--------|------|
| 37 | seo-metadata | ⬜ | Meta tags on all pages |
| 38 | accessibility-pass | ⬜ | ARIA, keyboard nav, screen readers |
| 39 | loading-skeletons | ⬜ | Remaining 10 routes |
| 40 | nba-sync-pipeline | ⬜ | Complete NBA game recording |
| 41 | mobile-optimization | ⬜ | Responsive polish pass |
| 42 | csp-hardening | ⬜ | Remove unsafe-eval, add nonces |
| 43 | api-pagination | ⬜ | Paginate all list endpoints |
| 44 | odds-staleness-indicator | ⬜ | Show users when odds are stale |
| 45 | db-cleanup-cron | ⬜ | Prune old OddsSnapshots, StripeEvents |

---

## 📂 Structure

    ├── README.md                  # This file — roadmap + milestone tracker
    ├── CHANGELOG.md               # Daily activity log (auto-pushed 6 AM CST)
    ├── DOROTHY-AUDIT.md           # Master audit tracking board
    ├── audit-reports/             # Full codebase audit (Feb 15, 2026)
    │   ├── pick-engine-audit.md
    │   ├── security-audit.md
    │   ├── data-quality-audit.md
    │   ├── frontend-audit.md
    │   ├── architecture-audit.md
    │   └── edge-research.md
    ├── prompts/                   # Copy-paste Claude implementation prompts
    └── proposals/                 # Research + proposals pending review

## 📊 Audit Summary (Feb 15, 2026)

55,000 lines of TypeScript. 97 findings. 18 edge opportunities.

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Pick Engine | 1 | 5 | 3 | — |
| Security | 0 | 1 | 5 | 6 |
| Data Quality | 0 | 4 | 6 | 6 |
| Frontend | 1 | 7 | 12 | 8 |
| Architecture | 3 | 5 | 6 | — |
| **Total** | **5** | **22** | **32** | **20** |

## 🔄 Workflow

1. Dorothy scans trendline repo (read-only via SSH key)
2. Findings logged in audit-reports/
3. Prompts written in prompts/ (prioritized by phase)
4. Seanny reviews → accepts or skips
5. Seanny copies prompt into Claude on main repo
6. Dorothy pulls latest, verifies fix, updates roadmap status
7. CHANGELOG.md auto-pushed daily at 6 AM CST

## 💰 What Makes This Acquisition-Worthy

- **Verified public track record** — timestamped, graded, auditable picks
- **Proprietary PIT backtesting** — honest walk-forward validation, no look-ahead
- **Clean architecture** — tested, modular, well-documented
- **Multiple uncorrelated signals** — not just one model
- **CLV proof** — demonstrable market-beating edge
- **Market signals moat** — line movement, steam, public % (hard to replicate)
