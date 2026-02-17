# 🔍 Full Codebase Sweep — Post-Phase Analysis

**Date:** February 15, 2026  
**Repo:** `/home/seannyquest/trendline` (latest commit: `28246c9`)  
**Scope:** Complete assessment of trendline codebase vs. dorothyv2 Phase 2-5 proposals  

---

## ⚠️ CRITICAL FINDING: Phases 2-5 Were Never Implemented

**The dorothyv2 repo contains detailed prompts and proposals for Phases 2-5, but the actual trendline codebase shows NO evidence that these phases were executed.** The Phase proposals exist only as markdown documentation in `/home/seannyquest/.openclaw/workspace/dorothyv2/prompts/`.

### What Actually Exists vs. What Was Proposed

| Proposed Feature | Status | Evidence |
|---|---|---|
| `src/lib/clv-engine.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/clv-tracker.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/sharp-money.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/market-timing.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/odds-monitor.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/market-alerts.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/nba-ridge.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/ncaaf-ridge.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/hca-tracker.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/signal-optimizer.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/model-calibration.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/tournament-validator.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/cache.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/redis-game-cache.ts` | ❌ **Does not exist** | No file in codebase |
| `src/lib/monitoring.ts` | ❌ **Does not exist** | No file in codebase |
| Split cron jobs (8+ routes) | ❌ **Not split** | Only 1 cron: `src/app/api/cron/daily-sync/route.ts` |
| Unit tests (jest) | ❌ **Not created** | Only 5 Playwright e2e specs exist |
| CLV database tables | ❌ **Not added** | No CLV fields in schema |

**The bug report (`BUG-REPORT-POST-PHASE2.md`) references code that doesn't exist** (e.g., `computeNflRidgeEdge()` function) — it was describing bugs in *proposed* code, not deployed code.

---

## 1. Critical Bug Status Check

### BUG-001: NFL Week Calculation (Hardcoded as 1)
**Status: 🟡 N/A — The function doesn't exist**  
`computeNflRidgeEdge()` is not in the codebase. The NFL Ridge regression model was never implemented. NFL picks use the same convergence-score pipeline as other sports. The NFL EPA module (`src/lib/nflverse.ts`) correctly tracks `week` per row — no hardcoding issue there.

### BUG-002: Jest Test Framework Imports
**Status: 🟡 N/A — Test files don't exist**  
The referenced test files (`tests/performance.test.ts`, `tests/redis-rate-limit.test.ts`, `tests/team-resolver.test.ts`) were never created. Only 5 Playwright e2e specs exist in `tests/e2e/`.

### BUG-003: Tournament Logic Implementation
**Status: ❌ NOT IMPLEMENTED**  
Zero tournament-specific logic exists. `grep` for "tournament", "seed", "mismatch", "conference fatigue", "marchMadness", "isTournament" returns **nothing** in `pick-engine.ts`. The only March-related code is a minor KenPom fade for "March top-25 home" teams (line ~516), which reduces spread confidence — this is a basic seasonal adjustment, not tournament logic.

### Weight Configurations
**Status: ✅ FIXED**  
All 8 weight sets (4 sports × spread/OU) sum to exactly 1.00.

### CLV Tracking
**Status: ❌ NOT IMPLEMENTED**  
No CLV fields in the Prisma schema, no CLV tracking code anywhere in the codebase.

---

## 2. Tournament Logic — Complete Absence

The codebase has **zero** tournament-specific features:

- ❌ No UNDER boost for tournament games
- ❌ No seed mismatch logic (5-12 upsets, etc.)
- ❌ No conference fatigue detection
- ❌ No neutral site tournament detection
- ❌ No tournament round identification
- ❌ No `tournament-validator.ts`
- ❌ No tournament weight adjustments

**What does exist for March:**
- Line ~508-517: A minor spread fade that reduces KenPom home-edge confidence in March for top-25 teams (sets magnitude to 25% and confidence to 0.35). This is a blanket seasonal correction, not tournament-aware logic.

**Impact on 41.8% win rate:** The lack of tournament logic is likely NOT the primary cause of poor performance, since the backtest period (Feb 5-15) is pre-tournament regular season. The issues are more fundamental.

---

## 3. What Actually Exists — Current Architecture

### Pick Engine (`src/lib/pick-engine.ts` — 3,090 lines)
This is a monolithic "god file" that handles everything:
- KenPom signal generation (spread + O/U Ridge regression)
- Multi-signal convergence scoring
- Confidence tier assignment
- Pick generation and storage
- Pick grading
- Bet grading

**Key architecture:**
1. **NCAAMB O/U:** Uses PIT Ridge regression (λ=1000, 4 features, 70,303 game training set) → edge-to-magnitude mapping → PIT-calibrated tier gates (config #26)
2. **NCAAMB Spread:** KenPom-based model edge with seasonal fade logic + convergence scoring
3. **Other sports:** Standard convergence scoring with sport-specific weights

### NCAAMB O/U Tier Gates (lines ~2710-2722)
```
5★: UNDER + edge ≥ 12 + tempo ≤ 64 (82.3% OOS, ~2.4/wk)
4★: UNDER + edge ≥ 10 (74.9% OOS, ~16.7/wk)  
3★: edge ≥ 9 (68.0% OOS, ~59.1/wk)
```

**OVER bias diagnosis:** The tier gates show UNDER-favoring filters for 5★ and 4★, but 3★ has no directional filter. If most picks are 3★ with `absEdge ≥ 9`, the Ridge regression's prediction determines direction. The regression model (`-233.5315 + 0.4346*sumAdjDE + 0.4451*sumAdjOE + 2.8399*avgTempo`) may systematically predict higher totals than the market, creating OVER bias.

### Cron Architecture
**Single monolithic cron:** `src/app/api/cron/daily-sync/route.ts`
- Runs at 11:00, 17:00, 21:00 UTC
- Steps: refresh games → sync completed → generate picks → grade picks → grade bets → evaluate trends → clear caches
- All in one 300-second-max endpoint

### Data Sources (42 files in `src/lib/`)
Working modules: ESPN sync, KenPom, BartTorvik, Elo, NFL EPA (nflverse), NBA stats, weather, line movement, odds API, venue data, team resolver.

### Database Schema
Standard sports tables (NFLGame, NCAAFGame, NCAAMBGame, NBAGame) + DailyPick, Bet, UpcomingGame, KenpomSnapshot, OddsSnapshot, PlayerGameLog, Team, User. No CLV tables. Indexes appear comprehensive.

---

## 4. Performance Issues Root Cause Analysis

### Why Spread Picks Are 4-12 (25%)

**Primary cause: KenPom home-edge fade may be too aggressive.**

Lines 500-525 show that for NCAAMB:
- Any positive home KenPom edge after November gets magnitude reduced to 20% and confidence to 0.30
- March top-25 homes get even more aggressive fading (25% magnitude, 0.35 confidence)
- This means the strongest model signal (KenPom spread edge, weight 0.23) is being severely neutered for most of the season

The spread confidence tier is simple: `score >= 85 → 5★, score >= 70 → 4★`. With the model edge signal suppressed, convergence scores likely cluster around the threshold, making tier assignment noise-driven.

### Why O/U Picks Show Heavy OVER Bias

**The Ridge regression coefficients predict systematically high totals.**

The model: `total = -233.53 + 0.43*sumAdjDE + 0.45*sumAdjOE + 2.84*avgTempo`

With modern KenPom efficiencies (AdjOE ~110, AdjDE ~95-100) and tempos (~68):
- `sumAdjDE ≈ 195`, `sumAdjOE ≈ 220`, `avgTempo ≈ 68`
- Predicted: `-233.53 + 84.6 + 97.9 + 193.1 = 142.1`

If market lines average ~140, the model produces a slight OVER edge on most games. Combined with the 3★ tier having no directional filter (just `absEdge ≥ 9`), most 3★ picks will be OVER.

**The 5★ and 4★ tiers require UNDER direction**, so the OVER bias is entirely in 3★ picks. This is by design — the backtest showed UNDER at 5★ was highly profitable. But if the 3★ OVER picks are losing, the overall record suffers.

### Specific Fix Recommendations

1. **Add OVER edge threshold to 3★ tier:** Currently any `absEdge ≥ 9` qualifies. Add: OVER requires `absEdge ≥ 12` for 3★ (matching UNDER 5★ threshold).
2. **Re-examine KenPom spread fade:** The blanket suppression of home edges may be too aggressive. Consider narrowing to specific scenarios (large favorites, specific conferences).
3. **Validate Ridge coefficients against 2025-26 KenPom data:** The model was trained on 2012-2025 PIT data. If KenPom's efficiency distributions shifted, coefficients may be stale.

---

## 5. Architecture Assessment

### Cron: Single Monolithic Job
- **1 cron endpoint** doing 7+ steps sequentially
- 300-second timeout is tight for all operations
- No retry logic for individual steps
- Risk: one failure blocks all downstream steps

### Testing: Minimal
- **5 Playwright e2e specs** (auth, homepage, odds, picks, pricing)
- **0 unit tests** for pick engine, convergence scoring, grading
- **0 integration tests** for the pick pipeline
- No test coverage for the Ridge regression, tier gates, or weight systems

### Code Quality
- **No TODO/FIXME/HACK comments** in pick-engine.ts (clean)
- Well-documented with version history in file header
- Functions are reasonably sized within the monolith
- Error handling via try/catch with Sentry integration
- But: 3,090-line god file is a maintenance risk

---

## 6. Code Quality Deep Dive

### Implementation Completeness
All features in the current codebase appear **fully implemented** — no stubs. The issue is that many *planned* features were never built:

| Feature | Implemented | Quality |
|---|---|---|
| KenPom spread signals | ✅ | Good — validated with backtest data |
| Ridge regression O/U | ✅ | Good — PIT-validated coefficients |
| Convergence scoring | ✅ | Good — weighted multi-signal system |
| Tier gates (NCAAMB O/U) | ✅ | Good — PIT-calibrated |
| ESPN game sync | ✅ | Good — handles edge cases |
| Team resolver | ✅ | Good — unified system |
| Pick grading | ✅ | Functional — automatic post-game |
| Elo ratings | ✅ | Functional |
| NFL EPA | ✅ | Functional — nflverse integration |
| NBA Four Factors | ✅ | Functional |
| BartTorvik signals | ✅ | Functional |
| Weather integration | ✅ | Functional |

### What's Missing (was proposed but never built)
- CLV tracking (entire Phase 4)
- Sharp money detection (Phase 4)
- Market timing (Phase 4)
- NBA/NCAAF Ridge models (Phase 3)
- Dynamic HCA (Phase 3)
- Signal optimization (Phase 3)
- Model calibration (Phase 3)
- Split cron architecture (Phase 2)
- Unit/integration tests (Phase 2)
- Redis caching (Phase 2)
- Tournament-specific logic (Phase 1.5)

---

## 7. Tournament Readiness Assessment (28 Days to Selection Sunday)

### What Works
- ✅ KenPom data pipeline (ratings, point distribution, size/experience)
- ✅ Ridge regression O/U with PIT-validated tier gates
- ✅ Basic pick generation and grading pipeline
- ✅ Multi-signal convergence scoring
- ✅ ESPN game sync with odds capture
- ✅ Team resolution system

### What's Broken/Missing
- ❌ **No tournament-specific logic at all** — no seed awareness, no neutral site boost, no UNDER tournament bias
- ❌ **No CLV tracking** — can't assess line value
- ❌ **OVER bias in O/U picks** — 3★ tier lacks directional filtering
- ❌ **Spread picks performing at 25%** — KenPom fade may be too aggressive
- ❌ **No unit tests** — changes carry high regression risk
- ❌ **Monolithic cron** — one failure breaks everything

### Is 41.8% Win Rate Fixable Quickly?

**Yes, with targeted fixes:**

#### Priority 1 — Fix OVER Bias (1-2 hours)
**File:** `src/lib/pick-engine.ts`, lines ~2710-2722  
Add OVER edge threshold to 3★ tier:
```typescript
} else if (absEdge >= 9) {
  // Only allow OVER at 3★ if edge is very large (≥12)
  if (ouDir === 'over' && absEdge < 12) {
    confidence = 0; // reject marginal OVERs
  } else {
    confidence = 3;
  }
}
```

#### Priority 2 — Reduce Spread Fade Aggression (1 hour)
**File:** `src/lib/pick-engine.ts`, lines ~511-522  
Increase the home-edge multiplier from 0.2 → 0.5 and confidence from 0.3 → 0.5. The current 80% suppression is likely destroying valid signals.

#### Priority 3 — Add Basic Tournament Logic (4-6 hours)
**File:** `src/lib/pick-engine.ts`  
Add before the convergence scoring section:
1. Detect tournament games (check UpcomingGame for neutral site + March dates)
2. Apply UNDER boost for tournament games (increase O/U UNDER magnitude by 1.5x)
3. Add seed mismatch signal (12-5, 11-6 seed matchups favor UNDER historically)
4. Reduce HCA for neutral sites

#### Priority 4 — Add Minimal Unit Tests (2-3 hours)
Create `tests/unit/convergence.test.ts` and `tests/unit/tier-gates.test.ts` to validate the core scoring logic before making changes.

### Realistic March 15 Assessment

**The system is functional but unoptimized.** The core pipeline works (games sync → signals compute → picks generate → grading runs). The poor performance stems from:
1. Overly aggressive signal suppression (spread fading)
2. Missing directional filtering (O/U OVER bias)
3. No tournament awareness

These are **all fixable in 1-2 days of focused work**. The Phases 2-5 infrastructure (CLV, sharp money, split crons, etc.) are nice-to-haves, not requirements for a working tournament system.

**Recommended sprint:**
- Day 1: Fix OVER bias + reduce spread fade + add basic tournament detection
- Day 2: Add unit tests for changes + validate against recent data
- Day 3-7: Monitor live performance, iterate on thresholds
- Day 8-14: Add tournament-specific signals as games approach
- Day 15+: Tournament begins — monitor and adjust

**Bottom line:** The 41.8% win rate is fixable. The codebase is clean and well-structured despite being a monolith. The missing Phases 2-5 are aspirational — focus on the core algorithm fixes first.
