# Trendline Dev Log

All activity tracked with timestamps. Pushed daily.

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

**Running totals:**
- Findings: 5 critical, 22 high, 32 medium, 20 low (97 total)
- Edge opportunities: 18 new signals identified
- Bugs confirmed fixed in trendline: 1 (team name mismatch, commit 28246c9)
- Proposals pending: 0
- Prompts delivered: 0
