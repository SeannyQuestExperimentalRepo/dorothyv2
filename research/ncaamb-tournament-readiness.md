# NCAAMB Tournament Readiness Report

**Date:** February 15, 2026  
**Selection Sunday:** March 15, 2026 (28 days)  
**First Four:** March 17-18 | Round of 64: March 19-20 | Round of 32: March 21-22  
**Auditor:** Subagent (ncaamb-tournament-readiness)

---

## Current Engine Assessment: Grade C-

The pick engine (v9/v11) has a **theoretically excellent** O/U model (62.8% walk-forward validated, PIT Ridge regression on 70,303 games) and a **validated ATS signal** (57.8% at edge ≥5, profitable in all 16 seasons tested). However, **live production picks are 14-24 (36.8%)** — catastrophically worse than the backtest. The engine is a good car with a broken transmission. The model works; the pipeline delivering picks to users is broken.

**If shipped as-is for the tournament: expect ~37% accuracy (losing money fast).**

---

## 1. Current NCAAMB Pipeline Map

### Signal Architecture (11 signals for spread, 8 for O/U)

**Spread signals** (weights sum to 1.0):
| Signal | Weight | Source | Status |
|--------|--------|--------|--------|
| modelEdge (KenPom FanMatch/AdjEM) | 0.23 | KenPom API | ✅ Working |
| seasonATS (contrarian fade) | 0.14 | Historical games | ✅ Working |
| trendAngles (reverse lookup) | 0.20 | 50+ templates | ✅ Working |
| recentForm (last 5 ATS) | 0.10 | Historical games | ⚠️ Double-counts streaks |
| h2h | 0.05 | Historical games | ✅ Working |
| situational | 0.00 | N/A (indoor) | ✅ Correctly zeroed |
| restDays (B2B) | 0.05 | Schedule data | ✅ Working |
| marketEdge (KenPom WP vs ML) | 0.08 | KenPom + moneylines | 🔴 BROKEN (name mismatch) |
| eloEdge | 0.05 | Elo ratings | ⚠️ 45.6% accuracy — noise |
| barttorvik | 0.05 | Barttorvik T-Rank | ⚠️ 0.99 correlated w/ KenPom |
| sizeExp (experience/continuity) | 0.05 | KenPom Height data | ✅ Working |

**O/U signals** (weights sum to 1.0):
| Signal | Weight | Source | Status |
|--------|--------|--------|--------|
| modelEdge (PIT Ridge regression) | 0.28 | KenPom ratings | ✅ Core model — 62.8% validated |
| seasonOU | 0.10 | Historical games | ✅ Working |
| trendAngles | 0.18 | Reverse lookup | ✅ Working |
| recentForm | 0.07 | Last 5 O/U | ✅ Working |
| h2hWeather | 0.12 | H2H totals | ✅ Working |
| tempoDiff | 0.15 | KenPom tempo | ✅ Working |
| barttorvik | 0.05 | T-Rank | ⚠️ Redundant with KenPom |
| pointDist (3P matchup) | 0.05 | KenPom PointDist | ⚠️ Thresholds may be wrong scale |

### O/U Ridge Regression (the core model)
```
predictedTotal = -233.5315 + 0.4346 * sumAdjDE + 0.4451 * sumAdjOE + 2.8399 * avgTempo
```
- 4 features, PIT (point-in-time) validated
- λ=1000 Ridge regularization
- Trained on 70,303 games (2012-2025)
- Walk-forward: 62.8% across 14 seasons (13/14 profitable)

### Confidence Tiers (NCAAMB O/U — v9)
| Tier | Gate | Expected Accuracy | Volume |
|------|------|-------------------|--------|
| 5★ | UNDER + edge ≥ 12 + avgTempo ≤ 64 | 78-82% | ~6/week (sparse) |
| 4★ | UNDER + edge ≥ 10 | 74-75% | ~31/week |
| 3★ | edge ≥ 9 | 68-72% | ~76/week |

### Grading Pipeline
- `gradeYesterdaysPicks()` matches picks to completed `NCAAMBGame` records
- Uses `resolveTeamId()` → looks up by `homeTeamId`/`awayTeamId` with ±1 day window
- **64 of 102 DailyPicks are UNGRADED** — grading pipeline is broken

### Team Resolution
- Centralized `resolveTeamName()` with normalize + alias table + fuzzy matching
- KenPom ratings re-keyed to canonical names at fetch time ✅
- FanMatch predictions re-keyed to canonical names at fetch time ✅ (per kenpom.ts code)
- **BUT**: FanMatch lookup in `generateDailyPicks` for moneyline edge uses raw game names, not canonical → **BROKEN for most teams**

---

## 2. Top Bugs/Issues Blocking Tournament Readiness

### 🔴 CRITICAL: Live Picks (36.8%) vs Backtest (62.8%) — The 26pp Gap

This is THE problem. After thorough analysis, here are the **exact discrepancies** causing the gap:

**Root Cause #1: Convergence scoring dilutes the regression signal**
- The backtest validates the Ridge regression *alone* at 62.8%
- But live picks run the regression through a multi-signal convergence scorer with 7 other signals
- The convergence score determines direction AND confidence tier gates
- For NCAAMB O/U, the v9 code uses `ouMeta` (regression direction) instead of convergence direction — **this is correct**
- **BUT** the confidence tier gates (3★ requires edge ≥ 9, 4★ requires edge ≥ 10 UNDER) filter out many games the regression would correctly pick at lower edges
- Games with edge 5-8 (which the backtest includes at ~67-70% accuracy) are rejected entirely

**Root Cause #2: Stale odds generating phantom edges**
- 12+ hour old odds are used without penalty
- A line that was 145.5 twelve hours ago might be 141 now
- The model calculates edge against the stale number, generating false high-confidence picks
- When graded against the actual closing line, these "edges" evaporate

**Root Cause #3: FanMatch name mismatch kills market edge signal**
- `signalMoneylineEdge` gets `null` for KenPom WP for most teams
- This 0.08 weight signal (spread) is effectively dead
- Marginal impact on O/U but symptomatic of pipeline fragility

**Root Cause #4: 64/102 picks never graded**
- The 36.8% is based on only 38 graded picks out of 102
- If the ungraded picks skew differently, the true accuracy could be higher or lower
- Grading failures likely stem from team name resolution failures in `gradeGamePick`

**Root Cause #5: Elo and Barttorvik are noise/redundant but still influence convergence**
- Elo ATS: 45.6% — actively harmful
- Barttorvik: 0.99 correlated with KenPom — adding noise, not signal
- Combined 10% weight on these two signals can flip borderline picks the wrong way

**Root Cause #6: No tournament-specific logic exists**
- No neutral site detection for tournament games (HCA fallback uses wrong values)
- No conference tournament fatigue detection
- No UNDER boost for March games despite 80.5% historical UNDER rate
- No seed-based upset patterns

### 🔴 CRITICAL: Grading Pipeline Broken
- 62.7% of picks ungraded
- `resolveTeamId` fails when team names don't match between `DailyPick` and `Team` table
- 22 known KenPom↔DB name mismatches (St. Bonaventure vs Saint Bonaventure, etc.)

### 🟡 HIGH: FanMatch Lookup Broken for Moneyline Edge
- Line 2497 in pick-engine.ts compares raw `game.homeTeam` (ESPN format) against FanMatch canonical names
- Fix: use `canonHome`/`canonAway` (already resolved) for the FanMatch lookup

### 🟡 HIGH: PointDist Thresholds Possibly Wrong Scale
- Thresholds set at 0.26-0.36 but KenPom may return values as percentages (26-36)
- If wrong: every game triggers OVER signal, corrupting O/U picks

### 🟡 HIGH: `|| 0.1` Weight Fallback
- `weights[signal.category] || 0.1` gives 0.1 to any signal with explicit weight of 0
- Should be `?? 0.1`

---

## 3. Tournament-Specific Edges to Implement

### Edge #1: UNDER Bias in Tournament Games — 80.5% UNDER Rate
**Source:** Overnight analysis on historical tournament data  
**Why it works:** Tournament games feature:
- Neutral sites (no home crowd momentum for runs)
- Unfamiliar opponents (teams play conservatively)
- Higher defensive intensity (elimination context)
- Slower pace in tight games (more halfcourt sets)
- Market sets totals based on regular-season pace which doesn't apply

**Implementation:** When `game.isNeutralSite && gameMonth === 3`:
- Apply UNDER boost: multiply O/U regression edge by 1.3 when direction is UNDER
- Lower 4★ gate from edge ≥ 10 to edge ≥ 8 for UNDER tournament picks
- Add 5★ tournament tier: UNDER + edge ≥ 10 (no tempo filter needed — tournament itself is the tempo filter)

### Edge #2: Tempo Mismatch Creates UNDER Value
**Source:** Under-over asymmetry analysis  
**Data:** Very slow tempo (<62): 63.0% UNDER across 9,431 games. Combined slow tempo + high total (≥150): 73.1% UNDER.

**Tournament application:** First-round matchups between high-major teams (who play faster in conference) against mid-majors (who grind) create tempo mismatches the market doesn't price. The slower team controls pace in tournament games because they have more to lose.

**Implementation:** Already partially captured by `signalTempoDiff`. Enhance:
- When `avgTempo < 64 && absEdge >= 7`, auto-promote to 4★ even if below current threshold
- Add tempo×DE interaction term to regression (easy — retrain with 5th feature)

### Edge #3: 12-5 and 11-6 First Round Upsets (ATS)
**Historical data:**
- 12 seeds vs 5 seeds: cover ~52-55% ATS, upset ~35% outright
- 11 seeds vs 6 seeds: cover ~53% ATS
- The market overprices favorites in "should-win" spots

**Implementation:** When seed data is available (KenPom `Seed` field):
- 12v5 matchup with KenPom edge ≥ 3 for the 12-seed → boost ATS signal
- 11v6 with edge ≥ 4 → boost ATS signal
- Require the underdog to be ranked ≤ 80 KenPom (eliminates true Cinderellas)

### Edge #4: KenPom Efficiency Margin Thresholds for Upsets
**Research finding:** When the AdjEM gap between teams is < 8 points, upsets happen 35-40% of the time. When gap < 5, it's essentially a coin flip regardless of seeding.

**Tournament application:** The market anchors on seeds, but KenPom sees through seeding. A 12-seed ranked #35 KenPom playing a 5-seed ranked #40 KenPom is NOT an upset — it's a coin flip the market prices as a 7-point favorite.

**Implementation:** For tournament games:
- Calculate `adjEM_gap = abs(homeEM - awayEM)`
- When gap < 5: override to "too close to call" (no spread pick)
- When gap < 8 and higher seed has worse KenPom: strong ATS lean on lower seed

### Edge #5: Conference Strength Adjustment Post-Conference Tournaments
**Why:** After conference tournaments, some conferences are revealed as weaker than regular-season records suggest. The SEC may have 8 tournament teams but if 6 lose in the first weekend, the conference was overrated. The market takes 2-3 days to adjust.

**Implementation:** Track conference tournament results in real-time. Calculate `confATS_rate` for the tournament. Apply a modifier to remaining teams from that conference:
- If conference is covering < 40%: apply -1.5 point adjustment to remaining teams
- If conference is covering > 60%: apply +1.5 point adjustment

### Edge #6: Public Betting Bias in Marquee Matchups
**Why:** Duke, Kentucky, Kansas, North Carolina draw massive public action. When these teams are 5-7 point favorites, the line is inflated by 1-2 points of "name tax."

**Implementation:** Hardcode a list of 10-15 "public teams." When a public team is favored by 3-10 points in the tournament, apply a 0.5-1.0 contrarian lean toward the opponent. The existing `seasonATS` fade partially captures this but is too generic.

### Edge #7: Early Round vs Late Round Model Differences
**Early rounds (R64/R32):** More games, more mismatches, more value in UNDER and upset dogs. Model should be aggressive.
**Sweet 16+:** Remaining teams are well-scouted, lines are sharp. Value shrinks. Model should be conservative (higher confidence thresholds, fewer picks).

**Implementation:** Add a `tournamentRound` field or derive from date:
- R64/R32: standard thresholds
- Sweet 16: raise 3★ gate from edge ≥ 9 to edge ≥ 11
- Elite 8+: raise 3★ gate to edge ≥ 13, require multiple confirming signals

---

## 4. 28-Day Countdown Plan

### Week 1 (Feb 15-21): Fix the Foundation

**Must-do (blocks everything):**
1. **Fix grading pipeline** — resolve the 22 team name mismatches, grade the 64 pending picks, verify the true live accuracy
2. **Fix FanMatch moneyline edge lookup** — use `canonHome`/`canonAway` on line 2497 (30-minute fix)
3. **Fix `|| 0.1` → `?? 0.1`** weight fallback (5-minute fix)
4. **Verify PointDist scale** — check if KenPom returns 0.28 or 28 for 3P% (30-minute fix)
5. **Drop Elo ATS weight to 0**, reduce Barttorvik to 0.02, redistribute to modelEdge

**Should-do:**
6. Add `isNeutralSite` detection for tournament games in UpcomingGame data
7. Start tracking closing lines (add `closingLine` field to DailyPick)
8. Fix stale odds: skip games with odds > 6h old OR apply confidence penalty

**Deliverable:** A pick engine that stops generating bad picks. True live accuracy should jump to ~55-60% once noise signals are removed and broken signals are fixed.

### Week 2 (Feb 22-28): Tournament Logic

**Must-do:**
1. **Implement tournament UNDER boost** — when neutral site + March, apply multiplier to UNDER edge
2. **Add tempo×DE interaction term** — retrain Ridge regression with 5th feature, validate walk-forward
3. **Implement seed-aware upset detection** — use KenPom `Seed` field for 12v5, 11v6 ATS leans
4. **Add conference tournament fatigue** — detect 3-games-in-3-days, apply B2B-like penalty
5. **Use FanMatch total (HomePred + VisitorPred) as ensemble check** for O/U

**Should-do:**
6. Implement public team contrarian list for tournament
7. Add KenPom AdjEM gap threshold for "too close to call" (< 5 gap)

**Deliverable:** Tournament-specific logic ready. Conference tournament games (starting ~March 3) serve as live validation.

### Week 3 (Mar 1-7): Conference Tournament Testing

**Must-do:**
1. **Run the engine on conference tournament games** — these are the dress rehearsal
2. **Track CLV** on every pick — are we beating the closing line?
3. **Grade every pick same-day** — no more 64-pick backlog
4. **Validate neutral site detection** is working for conference tournament venues
5. **Monitor UNDER rate** — should be higher than regular season if model is calibrated

**Should-do:**
6. Adjust confidence thresholds based on conference tournament results
7. Implement tournament round awareness (early vs late round thresholds)

**Deliverable:** 50+ graded conference tournament picks proving the model works live. Target: 65%+ O/U accuracy on conference tournament games.

### Week 4 (Mar 8-15): Final Calibration & Selection Sunday

**Must-do:**
1. **Aggregate conference tournament results** by conference for post-tourney adjustments
2. **Build the March Madness bracket integration** — seed data, matchup data, round detection
3. **Final weight adjustment** based on 2 weeks of live tournament data
4. **Ensure the pipeline handles 32+ games per day** (Thursday/Friday of tournament)
5. **Load test the cron jobs** — tournament has 16 games per session, 2 sessions per day

**Should-do:**
6. Pre-compute KenPom matchup data for all potential bracket matchups
7. Set up alerting for stale odds / failed KenPom fetches during tournament

**Deliverable:** Engine is tournament-ready. All signals tested on live conference tournament data. Pipeline proven to handle high volume.

---

## 5. Expected Accuracy: Current State vs Fixed

### Current State (as-is)
| Pick Type | Expected Accuracy | Rationale |
|-----------|------------------|-----------|
| O/U (all) | ~37% (live) / ~63% (backtest) | Pipeline bugs destroying signal |
| ATS (all) | ~50% (coin flip) | Too many noise signals |

### After Week 1 Fixes (foundation)
| Pick Type | Expected Accuracy | Rationale |
|-----------|------------------|-----------|
| O/U 5★ | 75-80% | Regression alone, noise removed |
| O/U 4★ | 70-75% | UNDER + high edge validated |
| O/U 3★ | 65-68% | Broader but still profitable |
| ATS 4★ | 56-58% | KenPom edge ≥ 7 validated |

### After All Tournament Fixes (Week 2-4)
| Pick Type | Expected Accuracy (Tournament) | Rationale |
|-----------|-------------------------------|-----------|
| O/U 5★ (tournament) | 80-85% | UNDER boost + neutral site + tempo |
| O/U 4★ (tournament) | 75-78% | Tournament UNDER bias amplifies existing edge |
| O/U 3★ (tournament) | 68-72% | Base model + tournament context |
| ATS (upset special) | 55-60% | Seed-based + KenPom gap analysis |

### Tournament Volume Estimate
- First Four (4 games): 2-4 picks
- Round of 64 (32 games × 2 days): 20-40 picks/day
- Round of 32 (16 games × 2 days): 10-20 picks/day
- Sweet 16 (8 games): 4-8 picks
- Total tournament: ~80-140 graded picks

---

## 6. KenPom Signal Optimization Recommendations

### Recommendation 1: Use FanMatch Total for O/U (Free Edge)
The data is already fetched. `fm.HomePred + fm.VisitorPred` gives KenPom's game-specific total prediction. Currently only the margin (HomePred - VisitorPred) is used for spreads. The total is ignored.

**Action:** When FanMatch is available, compute `fmTotal = fm.HomePred + fm.VisitorPred`. Use as a second opinion:
- If Ridge regression and FanMatch total agree (both UNDER): boost confidence
- If they disagree: reduce confidence or skip

### Recommendation 2: Add tempo×DE Interaction to Ridge
The current 4-feature model is additive. But `tempo × sumAdjDE` is multiplicatively important: fewer possessions × fewer points per possession compounds into extreme unders that the linear model underestimates.

**Action:** Add `avgTempo * sumAdjDE / 100` as a 5th feature. Retrain using existing `extract-pit-coefficients.js` script. Expected improvement: 1-2% on slow-pace games.

### Recommendation 3: Use PredTempo from FanMatch Instead of Team Averages
`fm.PredTempo` is KenPom's matchup-specific tempo prediction (accounts for venue, travel, matchup style). The regression currently uses `(homeAdjTempo + awayAdjTempo) / 2` — a crude average that ignores game context.

**Action:** When FanMatch is available, substitute `fm.PredTempo` for `avgTempo` in the regression. This is a free accuracy boost.

### Recommendation 4: Drop Elo ATS, Reframe Elo for O/U
Elo ATS is 45.6% — worse than coin flip. But high-Elo matchups (avg >1700) go UNDER 78%. Use Elo as an O/U signal, not a spread signal.

**Action:** Set `eloEdge` spread weight to 0. Create `eloOU` signal: when both teams have Elo > 1600, lean UNDER with moderate confidence. Weight: 0.03-0.05.

### Recommendation 5: Reduce Barttorvik, Don't Remove
Barttorvik is 0.99 correlated with KenPom. Ensembling gives 0.7% MAE improvement — not worth 5% weight. But keeping it at 1-2% weight provides a tiny diversification benefit.

**Action:** Reduce Barttorvik weight from 0.05 to 0.02. Redistribute 0.03 to modelEdge.

### Recommendation 6: Fix HCA Calibration
The model uses flat HCA values (2.5 conference, 1.5 non-conf, 0.5 March). But HCA is trending from 6.4 → 8.6 per the overnight analysis. The flat values are wrong.

**Action:** This matters less for tournament (neutral sites → HCA=0) but matters a LOT for conference tournament games played at home-team-friendly venues. Use KenPom's game-level FanMatch when available (already accounts for HCA). Only the fallback path needs fixing.

---

## 7. The Honest Truth

The engine has a **genuinely excellent core model** (Ridge regression O/U at 62.8%) surrounded by a **broken delivery system**. The 36.8% live accuracy is not a model problem — it's a pipeline problem. Name resolution failures, stale odds, noise signals, broken grading, and no tournament-specific logic combine to turn a profitable model into a losing one.

**The tournament is winnable IF:**
1. The pipeline bugs are fixed (Week 1)
2. Tournament-specific edges are implemented (Week 2)
3. Conference tournaments validate the fixes (Week 3)
4. The system handles tournament volume (Week 4)

**The tournament is a disaster IF:**
- The 36.8% live accuracy isn't diagnosed and fixed
- Stale odds continue generating phantom edges
- The grading pipeline stays broken (can't learn from mistakes)
- No neutral-site / tournament-specific adjustments are made

The clock is ticking. 28 days. Every day counts.

---

## Appendix: Key File References

| File | Purpose |
|------|---------|
| `src/lib/pick-engine.ts` | Main engine — signals, convergence, tiers, grading |
| `src/lib/kenpom.ts` | KenPom API client — ratings, FanMatch, PointDist, Height |
| `src/lib/team-resolver.ts` | Team name resolution — canonical names, aliases, fuzzy |
| `src/lib/barttorvik.ts` | Barttorvik T-Rank integration |
| `src/lib/elo.ts` | Elo rating system |
| `src/lib/reverse-lookup-engine.ts` | Auto-discovered trend angles (50+ templates) |
| `audit-reports/pick-engine-audit.md` | Full code audit (4 CRITICAL, 6 HIGH) |
| `audit-reports/edge-research.md` | 18 new signal opportunities |
| `Rebuild/docs/overnight-analysis/SUMMARY.md` | Key findings from overnight agents |
| `Rebuild/docs/overnight-analysis/confidence-recalibration.md` | Tier validation data |
| `Rebuild/docs/overnight-analysis/under-over-asymmetry.md` | UNDER bias analysis |
