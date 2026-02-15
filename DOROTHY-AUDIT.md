# Dorothy's Trendline Audit Board

**Role:** Read-only dev team member. Research → Propose → Build prompts for implementation.

**Workflow:**
1. Continuously scan repo for bugs, security, data quality, feature opportunities
2. Research new data sources and edges
3. Write proposals with clear rationale
4. If accepted → produce copy-paste Claude prompt for implementation

---

## 🔴 Active Issues (needs attention)

_None yet — initial audit in progress_

## 🟡 Proposals (awaiting review)

_None yet — initial audit in progress_

## 🟢 Accepted (prompt ready)

_None yet_

## 📋 Audit Queue

### Code Quality
- [ ] Full pick-engine.ts audit (logic bugs, edge cases)
- [ ] Team resolver coverage check (all 22 known mismatches fixed?)
- [ ] Grading pipeline audit (why 64/102 ungraded?)
- [ ] Auth flow review (auth.ts, auth.config.ts, admin-auth.ts)
- [ ] API route security scan (rate limiting, input validation)
- [ ] Error handling patterns (silent failures, swallowed errors)
- [ ] Type safety audit (any casts, unsafe assertions)

### Data Quality
- [ ] Name mismatch sweep (KenPom ↔ ESPN ↔ DB)
- [ ] Odds freshness check (stale data detection)
- [ ] KenPom snapshot coverage (daily PIT data?)
- [ ] Barttorvik snapshot gaps
- [ ] Elo inflation check (season regression)
- [ ] Ungraded picks root cause

### Pick Engine
- [ ] Signal weight validation (are weights backed by data?)
- [ ] Confidence tier calibration vs live results
- [ ] O/U regression coefficient freshness
- [ ] ATS signal addition (edge ≥ 5 = 57.8%)
- [ ] HCA recalibration (flat 3.5 → dynamic)
- [ ] Dead signals removal (fmHomePred/fmAwayPred)

### New Edge Research
- [ ] Public betting % as signal
- [ ] Referee tendency data
- [ ] Injury impact modeling
- [ ] Line movement / reverse line movement
- [ ] Conference tournament UNDER auto-boost
- [ ] NBA model development
- [ ] NFL EPA-based model

### Security
- [ ] Env var handling audit
- [ ] API authentication review
- [ ] Stripe webhook verification
- [ ] Rate limiting coverage
- [ ] SQL injection check (raw queries)
- [ ] CORS / CSRF review

---

## 📊 Audit Log

| Date | Area | Finding | Status |
|------|------|---------|--------|
| 2026-02-15 | pick-engine | Team name mismatch in KenPom lookup (game.homeTeam vs canonHome) | ✅ Fixed (commit 28246c9) |
| 2026-02-15 | data quality | 64/102 DailyPicks ungraded — grading pipeline broken | 🔴 Open |
| 2026-02-15 | data quality | 22 KenPom↔Team name mismatches | 🟡 Partially fixed |
| 2026-02-15 | pick-engine | Elo ATS weight should be 0 (45.6% NCAAMB) | 🔴 Open |
| 2026-02-15 | pick-engine | fmHomePred/fmAwayPred signals bad (r=0.12) | 🔴 Open |
| 2026-02-15 | pick-engine | HCA flat 3.5 but trending 6.4→8.6 | 🔴 Open |
