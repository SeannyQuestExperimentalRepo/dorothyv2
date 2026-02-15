# Dorothy's Trendline Audit Board

**Role:** Read-only dev team member. Research → Propose → Build prompts for implementation.  
**Goal:** Pristine, acquisition-worthy launch. Quality over speed.

---

## Current Phase: 1 — Bug Fixes (0/12 complete)

## Progress

| Phase | Description | Prompts | Done |
|-------|------------|---------|------|
| 1 | Bug Fixes | 01-12 | 0/12 |
| 2 | Tests & Architecture | 13-22 | 0/10 |
| 3 | Model Accuracy | 23-30 | 0/8 |
| 4 | Market Signals (Moat) | 31-36 | 0/6 |
| 5 | Polish for Launch | 37-45 | 0/9 |
| **Total** | | **45** | **0/45** |

---

## 📊 Audit Log

| Date | Area | Finding | Status |
|------|------|---------|--------|
| 2026-02-15 | pick-engine | FanMatch moneyline edge uses raw ESPN names vs KenPom | 🔴 Prompt 01 |
| 2026-02-15 | data quality | FanMatch predictions matched by date only, not team | 🔴 Prompt 01 |
| 2026-02-15 | pick-engine | NBA grading falls through to NCAAMBGame table | 🔴 Prompt 02 |
| 2026-02-15 | data quality | dayOfWeek computed in UTC not ET | 🔴 Prompt 03 |
| 2026-02-15 | pick-engine | NFL O/U weather double-counted | 🔴 Prompt 04 |
| 2026-02-15 | pick-engine | NCAAF SP+ lookup uses raw names | 🔴 Prompt 05 |
| 2026-02-15 | pick-engine | NBA 30% dead spread weight | 🔴 Prompt 06 |
| 2026-02-15 | security | Site gate cookie bypass | 🔴 Prompt 07 |
| 2026-02-15 | data quality | NBA alias table empty | 🔴 Prompt 08 |
| 2026-02-15 | frontend | 14 routes missing error boundaries | 🔴 Prompt 09 |
| 2026-02-15 | data quality | PlayerGameLog no unique constraint | 🔴 Prompt 10 |
| 2026-02-15 | architecture | 85/88 errors skip Sentry | 🔴 Prompt 11 |
| 2026-02-15 | architecture | Stripe webhook no idempotency | 🔴 Prompt 12 |
| 2026-02-15 | architecture | Zero unit tests (22k lines) | ⏳ Phase 2 |
| 2026-02-15 | architecture | In-memory rate limiting useless on serverless | ⏳ Phase 2 |
| 2026-02-15 | architecture | In-memory game cache inconsistent | ⏳ Phase 2 |
| 2026-02-15 | architecture | 3,090-line pick-engine god file | ⏳ Phase 2 |
| 2026-02-15 | pick-engine | Elo ATS weight should be 0 | ⏳ Phase 3 |
| 2026-02-15 | pick-engine | fmHomePred/fmAwayPred signals bad (r=0.12) | ⏳ Phase 3 |
| 2026-02-15 | pick-engine | HCA flat 3.5 but trending 6.4→8.6 | ⏳ Phase 3 |
| 2026-02-15 | pick-engine | FanMatch total fetched but unused for O/U | ⏳ Phase 3 |
| 2026-02-15 | pick-engine | NBA rest days signal disabled | ⏳ Phase 3 |
| 2026-02-15 | edge research | No CLV tracking | ⏳ Phase 3 |
| 2026-02-15 | edge research | No line movement signals | ⏳ Phase 4 |
| 2026-02-15 | edge research | No public betting % | ⏳ Phase 4 |

---

## 🔄 Standing Orders

1. `git pull` trendline before every audit pass
2. Verify fixes after Seanny implements prompts — update status
3. Write Phase 2 prompts once Phase 1 is complete
4. Daily changelog push at 6 AM CST (cron)
5. Re-audit after each phase completes
