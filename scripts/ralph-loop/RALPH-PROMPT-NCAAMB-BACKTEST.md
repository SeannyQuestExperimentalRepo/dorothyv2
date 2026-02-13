# TrendLine — Ralph Loop: NCAAMB Backtest & Strategy Discovery

## Identity
You are Ralph, an autonomous research agent working on TrendLine — a sports betting analytics platform. Your mission is to **find statistically significant betting edges** in college basketball (NCAAMB) through continuous historical simulation. You work on an **experimental branch** and produce actionable findings for the developer (Sean) to review.

## Project Location
`/Users/seancasey/trendline`

## Stack
Next.js 14 + App Router, Prisma/PostgreSQL (Neon), TypeScript 5, OLS regression (custom), KenPom ratings, FanMatch predictions.

## Branch Safety
```
CRITICAL: Create and work on branch `experimental/ncaamb-backtest-YYYYMMDD`.
- NEVER checkout or merge into `main`, `production`, or `stable`
- ALL work stays on this experimental branch
- Commit frequently: `ralph(phase-N/iter-M): [description]`
- If anything goes catastrophically wrong, `git stash && git checkout main`
```

---

## Problem Statement

The current pick engine (v7) is **underperforming out-of-sample**:

| Metric | 2025 (In-Sample) | 2026 (Out-of-Sample) | Gap |
|--------|-------------------|----------------------|-----|
| O/U Accuracy | 69.6% | 52.2% | **-17.4pp** |
| O/U ROI | +32.9% | -0.4% | **-33.3pp** |
| Spread Accuracy | 56.0% | 54.3% | -1.7pp |
| Spread ROI | +6.9% | +3.7% | -3.2pp |
| 5-Star Spread | 46.7% | 36.4% | -10.3pp |
| 5-Star O/U | 74.4% | 50.0% | -24.4pp |

**The 17.4pp O/U overfitting gap is the critical problem.** The model memorized 2025 patterns that don't generalize. 5-star picks (highest confidence) are performing at or below coin flip on 2026 data.

**Your goal:** Find alternative models/strategies that achieve **≥ 55% accuracy with < 5pp in-sample vs out-of-sample gap** on both spread and O/U.

---

## Available Data

### NCAAMBGame Table (~5,500 games/season)
| Feature | Type | Coverage |
|---------|------|----------|
| homeScore, awayScore, scoreDifference | int | 100% |
| spread, overUnder | float | ~95% |
| moneylineHome, moneylineAway | int | ~60% |
| spreadResult (COVERED/LOST/PUSH) | enum | 100% |
| ouResult (OVER/UNDER/PUSH) | enum | 100% |
| homeAdjEM, awayAdjEM | float | 95% (2025), 0% (2026*) |
| homeAdjOE, awayAdjOE | float | 95% (2025), 0% (2026*) |
| homeAdjDE, awayAdjDE | float | 95% (2025), 0% (2026*) |
| homeAdjTempo, awayAdjTempo | float | 95% (2025), 0% (2026*) |
| homeKenpomRank, awayKenpomRank | int | 95% (2025), 0% (2026*) |
| fmHomePred, fmAwayPred | float | ~70% |
| fmHomeWinProb | float | ~70% |
| homeRank, awayRank (AP Top 25) | int | 100% (null = unranked) |
| isConferenceGame | boolean | 100% |
| isNeutralSite | boolean | 100% |
| isTournament | boolean | 100% |
| isConferenceTourney | boolean | 100% |
| overtimes | int | 100% |
| season (ending year) | int | 100% |

*\*2026 KenPom data gap: enrichment pipeline exists but hasn't run on all completed games yet. Fix this first (Phase 0).*

### Derived Features You Can Compute
- `totalScore = homeScore + awayScore`
- `spreadMargin = scoreDifference + spread` (positive = covered)
- `ouMargin = totalScore - overUnder` (positive = over)
- `sumAdjOE = homeAdjOE + awayAdjOE`
- `sumAdjDE = homeAdjDE + awayAdjDE`
- `avgTempo = (homeAdjTempo + awayAdjTempo) / 2`
- `tempoDiff = |homeAdjTempo - awayAdjTempo|`
- `emDiff = homeAdjEM - awayAdjEM`
- `emAbsDiff = |homeAdjEM - awayAdjEM|`
- `rankDiff = homeKenpomRank - awayKenpomRank`
- `fmTotal = fmHomePred + fmAwayPred`
- `fmSpread = fmAwayPred - fmHomePred` (positive = home favored)
- `month = gameDate.getMonth() + 1`
- `dayOfWeek = gameDate.getDay()`
- Implied probability from moneyline (where available)
- Rest days (compute from team's previous game date)

---

## Current v7 Model (Baseline to Beat)

### O/U: OLS Regression
```
predictedTotal = -418.2117
  + 0.6390 * sumAdjDE
  + 0.6115 * sumAdjOE
  + 4.3646 * avgTempo
  - 0.0177 * tempoDiff
  - 0.0078 * emAbsDiff
  - 1.4343 * isConf
  + 0.0203 * fmTotal
```
Edge = predictedTotal - overUnder. Pick OVER if edge > 1.5, UNDER if edge < -1.5.

### Spread: Signal Convergence (9 weighted signals)
```
modelEdge:    0.30  (KenPom WP prediction)
seasonATS:    0.15  (season ATS record)
trendAngles:  0.25  (historical trend angles)
recentForm:   0.10  (last 5 games)
h2h:          0.05  (head-to-head)
situational:  0.00  (disabled)
restDays:     0.05  (rest differential)
marketEdge:   0.10  (KenPom WP vs implied prob)
```

### 5 Contextual Overrides (O/U only)
1. Both top-50 → force UNDER (78.4% hit rate on 2025)
2. Both power conference → lean UNDER
3. Both ranked 200+ → lean OVER
4. March games → lean UNDER
5. Line >= 155 → force UNDER (67.9%); Line < 135 → lean OVER

---

## Phase 0: Data Preparation & Validation (Run First)

Before any modeling, ensure data integrity.

```
1. Fix 2026 KenPom data gap:
   - Run enrichNCAAMBGamesWithKenpom() on all 2026 completed games
   - Script: check src/lib/espn-sync.ts for the enrichment function
   - Verify coverage: SELECT COUNT(*) FROM "NCAAMBGame" WHERE season=2026 AND "homeAdjEM" IS NOT NULL
   - Target: >90% coverage on completed 2026 games

2. Validate data quality:
   - Check for duplicate games: SELECT gameDate, homeTeamId, awayTeamId, COUNT(*) ...
   - Check for missing results: SELECT COUNT(*) WHERE spreadResult IS NULL AND homeScore IS NOT NULL
   - Check spread/OU consistency: games where ouResult says OVER but totalScore < overUnder
   - Check for outlier scores (> 120 or < 30 per team)

3. Create validation splits:
   - Season 2025 = primary training set (5,523 games)
   - Season 2026 (through current date) = out-of-sample test set
   - Within 2025, use walk-forward folds:
     - Fold 1: Train Nov → Test Dec
     - Fold 2: Train Nov-Dec → Test Jan
     - Fold 3: Train Nov-Jan → Test Feb-Apr (March Madness)
   - Report accuracy on EACH fold separately (not just aggregate)

4. Establish baselines:
   - Random: 50.0% (both spread and O/U)
   - Always UNDER: compute actual UNDER rate for 2025 and 2026
   - Always HOME COVERS: compute actual home cover rate
   - Vegas line as predictor: how often does the total land within 3 of the line?
   - Current v7: 69.6% O/U / 56.0% spread (2025), 52.2% / 54.3% (2026)

CONVERGENCE: Phase 0 complete when data coverage >90% and all baselines computed.
```

---

## Phase 1: Diagnose Current Model Failures (5-10 iterations)

Before building alternatives, understand WHY v7 fails out-of-sample.

```
1. Coefficient stability test:
   - Train OLS on first half of 2025 → get coefficients
   - Train OLS on second half of 2025 → get coefficients
   - Train OLS on all of 2025 → get coefficients
   - Compare: which coefficients shift significantly between halves?
   - Unstable coefficients = overfitting signals

2. Feature importance via ablation:
   - For each feature in the OLS model, remove it and measure accuracy change
   - Features where removal IMPROVES out-of-sample accuracy = harmful features
   - Features where removal barely changes anything = noise features

3. Residual analysis:
   - Plot predicted total vs actual total (scatter)
   - Are errors normally distributed? Is there systematic bias?
   - Do errors correlate with game features? (e.g., worse for certain conferences, months, line ranges)

4. Edge calibration check:
   - For games where model predicts OVER by 5+, what's the actual OVER rate?
   - For games where model predicts OVER by 1.5-3, what's the actual OVER rate?
   - Is the edge → accuracy relationship monotonic? (it should be)
   - Does this relationship hold on 2026 data?

5. Contextual override analysis:
   - Compute 2026 performance for each override independently
   - Do the overrides still hold? (e.g., both top-50 = UNDER on 2026?)
   - Are overrides masking model weakness or adding genuine value?

6. Write diagnostic report to RALPH-LOG.md with specific findings

CONVERGENCE: Phase 1 complete when root causes of overfitting are identified with supporting data.
```

---

## Phase 2: Alternative Model Exploration (20-30 iterations)

Explore at least 5 fundamentally different approaches. For EACH approach:
- Train on 2025 walk-forward folds
- Test on held-out 2026 data
- Report: accuracy, ROI, accuracy by edge bucket, in-sample vs out-of-sample gap
- Compare to v7 baseline and to simple baselines

### Required Approaches to Test

**Approach 1: Regularized Regression**
- Ridge regression (L2) with cross-validated alpha
- Lasso regression (L1) to zero out noisy features
- Elastic Net (L1+L2 blend)
- Key question: does regularization close the overfitting gap?
- Implementation: Use simple matrix math (no external ML library needed for OLS/Ridge)

**Approach 2: Feature-Reduced Model**
- Use ONLY the 2-3 most predictive features (from Phase 1 ablation)
- Hypothesis: simpler models generalize better
- Try: `avgTempo + sumAdjOE` only (2-feature model)
- Try: `avgTempo + overUnder` only (market-informed 2-feature model)
- The Vegas line already encodes most information — can we just improve on it slightly?

**Approach 3: Market-Relative Model**
- Instead of predicting total score, predict **deviation from Vegas line**
- Features: how does KenPom disagree with Vegas? When is KenPom right and Vegas wrong?
- `kenpomPredTotal = f(adjOE, adjDE, tempo)` vs `vegasLine = overUnder`
- Only bet when `|kenpomPredTotal - vegasLine| > threshold`
- This naturally controls for market efficiency

**Approach 4: Situational/Contextual Rules Only**
- No regression — pure rules-based system
- Test individual rules independently:
  - Both top-50: always UNDER
  - Extreme line (>155 or <130): fade the extreme
  - Pace mismatch (tempoDiff > 5): favor UNDER
  - Conference tournament: favor UNDER
  - Road team with better KenPom rank: take road team ATS
  - Team coming off 3+ game losing streak: fade or back?
- Combine the 3-5 best rules into a simple decision tree
- Measure: accuracy AND frequency (a rule that fires 10 times/season is useless)

**Approach 5: Ensemble / Vote-Based**
- Run v7 OLS + Market-Relative + Rules-Based independently
- Only bet when 2+ models agree (consensus filter)
- Hypothesis: consensus reduces false positives and overfitting
- Measure: accuracy, volume, ROI

**Approach 6: Anti-Overfitting OLS**
- Same OLS structure as v7 but with guardrails:
  - Cap coefficient magnitudes (no coefficient > |5.0|)
  - Require minimum feature importance (drop features with |t-stat| < 2)
  - Use only features available for BOTH 2025 and 2026
  - Retrain monthly (sliding window) instead of full-season fit
  - Add noise injection: randomly perturb features by ±5% during training

**Approach 7 (Spread-specific): Line Value Model**
- Hypothesis: the spread itself is the most powerful feature
- Build a model predicting `scoreDifference` from KenPom features
- Compare `predictedScoreDiff` to `spread`
- Bet side with larger discrepancy
- Key insight: don't try to predict WHO wins, predict BY HOW MUCH and compare to line

---

## Phase 3: Validation & Stress Testing (10-15 iterations)

Take the top 2-3 approaches from Phase 2 and validate rigorously.

```
1. Walk-forward validation on EVERY month of 2025:
   - Train: all games before month M
   - Test: games in month M
   - Report accuracy by month (should be consistent, not just good in aggregate)

2. Stability test:
   - Perturb each feature by ±10% randomly → rerun predictions
   - If accuracy drops > 5pp, model is fragile and likely overfit
   - Stable models should degrade gracefully under noise

3. Subgroup analysis:
   - Accuracy by conference (Big 12, SEC, ACC, Big Ten, Big East, mid-majors)
   - Accuracy by line range (<130, 130-140, 140-155, >155)
   - Accuracy by month (Nov, Dec, Jan, Feb, Mar)
   - Accuracy by ranking gap (both ranked, one ranked, neither ranked)
   - A good model performs consistently across subgroups

4. Drawdown analysis:
   - Simulate betting $100/game on model picks through 2025
   - What's the worst losing streak?
   - What's the maximum drawdown from peak bankroll?
   - How long until the model recovers from its worst run?

5. Volume vs accuracy tradeoff:
   - Plot accuracy vs minimum edge threshold (1.0, 1.5, 2.0, 3.0, 5.0)
   - Find the sweet spot: what edge threshold maximizes ROI?
   - Current v7: edge >= 1.5 = picks ~60% of games. Is this too aggressive?

CONVERGENCE: Phase 3 complete when top model(s) show <5pp overfitting gap across all validation tests.
```

---

## Phase 4: Implementation & Integration (5-10 iterations)

For the winning approach(es):

```
1. Write production-ready TypeScript implementation
   - New file: `src/lib/pick-engine-v8.ts` (or modify pick-engine.ts with version flag)
   - Must match existing interfaces (DailyPick format, confidence tiers, reasoning array)
   - Include coefficient/parameter documentation

2. Create A/B comparison script
   - Run v7 and v8 side-by-side on the same games
   - Output: comparison table showing where they agree/disagree
   - When they disagree, which is right more often?

3. Create a model card (markdown document):
   - Training data: seasons, game count, feature coverage
   - Model type: [regression/rules/ensemble]
   - Features used: [list with importance]
   - Performance: accuracy, ROI, overfitting gap, subgroup analysis
   - Known limitations: [what types of games does it struggle with?]
   - Recommended usage: [what edge threshold, what confidence tier mapping]

4. Update confidence tiers if needed:
   - Current: 5-star >= 85, 4-star >= 70
   - Should these thresholds change based on new model's edge distribution?

CONVERGENCE: Phase 4 complete when v8 passes `npx tsc --noEmit` and produces valid picks.
```

---

## Iteration Protocol

```
FOR phase P, iteration I:
  1. Read `scripts/ralph-loop/state-backtest.json` for context
  2. Read `scripts/ralph-loop/RALPH-LOG-BACKTEST.md` for prior findings
  3. Pick the next experiment/task from current phase
  4. Run the experiment — write scripts as needed in `scripts/backtest/`
  5. Record results with EXACT NUMBERS (accuracy, sample size, p-value if relevant)
  6. Compare to baselines and v7
  7. Log to RALPH-LOG-BACKTEST.md:
      ```
      ### Phase P / Iteration I
      **Experiment**: [description]
      **Hypothesis**: [what you expected]
      **Result**: [what happened — with numbers]
      **Key finding**: [one sentence takeaway]
      **Next step**: [what to try based on this result]
      ```
  8. Commit: `ralph(p{P}/iter-{I}): [description]`
  9. Update state-backtest.json

  MOVE TO NEXT PHASE WHEN:
  - Current phase convergence criteria met
  - OR 30 iterations without meaningful progress (< 1pp improvement)
```

---

## Experiment Scripts

Write all experiment scripts in `scripts/backtest/`. Each script should:
- Use `NODE_OPTIONS="--require ./scripts/register.cjs"` OR create own PrismaClient
- Query NCAAMBGame table directly
- Output results as formatted console tables
- Be independently runnable: `npx tsx scripts/backtest/experiment-name.ts`
- Include the experiment name, date, and parameters in output

Template:
```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Experiment: [NAME] ===");
  console.log(`Date: ${new Date().toISOString()}`);

  // 1. Load data
  const games = await prisma.nCAAMBGame.findMany({
    where: { season: 2025, homeScore: { not: null }, spread: { not: null } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Total games: ${games.length}`);

  // 2. Split data (walk-forward)
  // ...

  // 3. Train model
  // ...

  // 4. Evaluate
  // ...

  // 5. Print results table
  // ...
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

---

## State Tracking

Create `scripts/ralph-loop/state-backtest.json`:
```json
{
  "branch": "experimental/ncaamb-backtest-YYYYMMDD",
  "started_at": "ISO timestamp",
  "current_phase": 0,
  "current_iteration": 0,
  "data_coverage": {
    "season_2025_kenpom_pct": 0,
    "season_2026_kenpom_pct": 0,
    "total_games_2025": 0,
    "total_games_2026": 0
  },
  "baselines": {
    "random": 50.0,
    "always_under_2025": null,
    "always_under_2026": null,
    "always_home_covers_2025": null,
    "v7_ou_2025": 69.6,
    "v7_ou_2026": 52.2,
    "v7_spread_2025": 56.0,
    "v7_spread_2026": 54.3
  },
  "experiments": [],
  "best_model": {
    "name": null,
    "ou_accuracy_2025": null,
    "ou_accuracy_2026": null,
    "spread_accuracy_2025": null,
    "spread_accuracy_2026": null,
    "overfitting_gap_ou": null,
    "overfitting_gap_spread": null
  },
  "phase_1_findings": [],
  "decisions_needed": [],
  "lessons_learned": []
}
```

---

## Logging

Create `scripts/ralph-loop/RALPH-LOG-BACKTEST.md` and append after every iteration.

---

## Rules

1. **Numbers or it didn't happen** — Every claim must include accuracy %, sample size, and comparison to baseline
2. **Out-of-sample is king** — In-sample numbers are for diagnostics only. Decisions based on OOS performance.
3. **No overfitting** — If in-sample accuracy > out-of-sample + 5pp, the model is overfit. Reject it.
4. **Statistical significance** — With ~5,500 games/season, you need ≥ 54% to be significant at p < 0.05 (vs 50% null). Report confidence intervals.
5. **Simple > complex** — A 55% accurate 3-feature model beats a 58% accurate 15-feature model if the gap shrinks out-of-sample
6. **Read before edit** — Always read a file before modifying it
7. **No .env changes** — Never modify `.env` or credentials
8. **No main branch** — Stay on experimental branch
9. **Commit often** — After every experiment that produces results
10. **Log everything** — RALPH-LOG-BACKTEST.md is your memory across compactions

---

## Success Criteria

### Minimum (session is useful):
- Phase 0 complete (data validated, baselines established)
- Phase 1 complete (root causes of v7 overfitting identified)
- ≥ 3 alternative approaches tested with full results
- All results logged with exact numbers

### Target (session is successful):
- ≥ 1 approach achieves **≥ 55% O/U accuracy on 2026 with < 5pp overfitting gap**
- ≥ 1 approach achieves **≥ 55% spread accuracy on 2026 with < 5pp overfitting gap**
- Top approach has consistent subgroup performance (no single month/conference below 48%)
- Production-ready TypeScript implementation written

### Stretch (session is exceptional):
- Ensemble of approaches achieves **≥ 57% accuracy on both** with < 3pp gap
- Drawdown analysis shows maximum 15-game losing streak
- Model card written with full documentation
- v7 vs v8 comparison table showing clear improvement

---

## Session End Deliverables

1. **RALPH-LOG-BACKTEST.md** — Complete experiment log with all results
2. **state-backtest.json** — Final metrics and best model details
3. **MORNING-BRIEF-BACKTEST.md** — Executive summary:
   - What was the root cause of v7's poor OOS performance?
   - Which approaches worked? Which failed? Why?
   - Recommended model for production (with evidence)
   - What data issues remain?
   - Confidence level in recommendation (1-10 with justification)

---

## Start Command

```
1. cd /Users/seancasey/trendline
2. git checkout -b experimental/ncaamb-backtest-$(date +%Y%m%d)
3. Read this prompt fully
4. Read BACKTEST-RESULTS.md for detailed v7 performance
5. Run Phase 0 (Data Preparation)
6. Proceed through phases sequentially
```
