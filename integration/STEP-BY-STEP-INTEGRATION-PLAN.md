# Step-by-Step Integration-First Development Plan

**Created:** February 15, 2026  
**Codebase:** `/home/seannyquest/trendline` — `src/lib/pick-engine.ts` (3,090-line monolith)  
**Current Win Rate:** 41.8%  
**Target:** 60%+ by March 15, 2026 (Selection Sunday)  
**Core Principle:** Nothing ships without proving it's wired in, tested, and measurably better.

---

## How to Read This Plan

Each step follows the same pattern:
1. **Build** — write the code
2. **Wire** — integrate into pick-engine.ts
3. **Test** — unit + integration + backtest
4. **Monitor** — deploy with flag off, then on, watch metrics
5. **Gate** — must pass success criteria before next step

**If a step fails its gate, STOP. Fix it before moving on.**

---

# PHASE 1: Foundation Systems (Days 1–3)

> Build the infrastructure that makes integration-first development possible. Nothing fancy gets built until we can measure everything.

---

## Step 1A: Feature Flag System

### Build

**File:** `src/lib/feature-flags.ts`

```typescript
// Schema: add to prisma/schema.prisma
model FeatureFlag {
  id        String   @id @default(cuid())
  key       String   @unique       // e.g. "fix_3star_over_bias"
  enabled   Boolean  @default(false)
  rollout   Float    @default(0)   // 0-1 for percentage rollout
  sport     String?                // null = all sports
  metadata  Json?                  // arbitrary config
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Implementation tasks:**
1. Add `FeatureFlag` model to Prisma schema, run migration
2. Create `src/lib/feature-flags.ts`:
   - `isEnabled(key: string, context?: { sport?: string, gameId?: string }): Promise<boolean>`
   - `getFlag(key: string): Promise<FeatureFlag | null>`
   - `setFlag(key: string, enabled: boolean, rollout?: number): Promise<void>`
   - Cache flags in memory with 60s TTL (fine for serverless — short-lived)
3. Create API route `src/app/api/admin/flags/route.ts`:
   - GET: list all flags
   - POST: create/update flag
   - DELETE: remove flag
4. Seed initial flags (all disabled):
   - `fix_3star_over_bias`
   - `fix_spread_suppression`
   - `fix_fanmatch_names`
   - `fix_convergence_fallback`

### Wire

Add to `pick-engine.ts` at top of `generateDailyPicks()`:
```typescript
import { isEnabled } from './feature-flags';
// Load all flags once per generation run
const flags = await loadAllFlags();
```

Pass `flags` through the pipeline so each feature can check its gate.

### Test

| Test | Command | Expected |
|------|---------|----------|
| Unit: flag CRUD | `bun test src/lib/__tests__/feature-flags.test.ts` | Create, read, update, delete flags |
| Unit: rollout logic | Same file | 50% rollout → ~50% of calls return true (100 iterations) |
| Integration: flag in pipeline | `bun test src/lib/__tests__/flag-integration.test.ts` | Generate picks with flag on vs off, verify different code paths execute |
| API: admin endpoints | `curl` tests against dev server | 200 on GET/POST, flags persist |

### Success Criteria
- [ ] Flags persist in database across restarts
- [ ] `isEnabled()` returns correct value within 60s of change
- [ ] pick-engine.ts reads flags without error
- [ ] Admin API works (authenticated)

### Time Estimate: 4 hours

---

## Step 1B: Pipeline Monitoring Dashboard

### Build

**File:** `src/lib/pipeline-monitor.ts`

```typescript
// Schema addition
model PipelineRun {
  id            String   @id @default(cuid())
  date          String                        // "2026-02-15"
  sport         String                        // "NCAAMB"
  startedAt     DateTime @default(now())
  completedAt   DateTime?
  totalGames    Int      @default(0)
  picksGenerated Int     @default(0)
  flagsActive   Json     @default("[]")       // which flags were on
  metrics       Json     @default("{}")       // arbitrary metrics
  errors        Json     @default("[]")
}

model PickMetric {
  id            String   @id @default(cuid())
  pipelineRunId String
  pipelineRun   PipelineRun @relation(fields: [pipelineRunId], references: [id])
  gameId        String
  pickType      String                        // "spread" | "total" | "prop"
  tier          Int                           // 1-5 stars
  direction     String                        // "home" | "away" | "over" | "under"
  convergenceScore Float
  signalsUsed   Json                          // { "modelEdge": 0.23, "ridgeModel": null, ... }
  featuresActive Json                         // which flags influenced this pick
  createdAt     DateTime @default(now())
}
```

**Implementation tasks:**
1. Add models to Prisma schema, migrate
2. Create `src/lib/pipeline-monitor.ts`:
   - `startRun(date, sport): string` — returns runId
   - `recordPick(runId, pickData): void` — logs each pick's details
   - `endRun(runId, summary): void` — finalizes run
   - `getRunSummary(runId): PipelineRunSummary` — stats for a run
3. Create monitoring API routes:
   - `GET /api/admin/pipeline/runs` — list recent runs
   - `GET /api/admin/pipeline/runs/[id]` — single run detail
   - `GET /api/admin/pipeline/metrics` — aggregated metrics
4. Create simple admin page `src/app/admin/pipeline/page.tsx`:
   - Table of recent runs
   - Per-run: games processed, picks generated, flags active
   - Signal utilization heatmap (which signals are actually firing)
   - OVER vs UNDER ratio by tier
   - Sport breakdown

### Wire

Instrument `generateDailyPicks()`:
```typescript
const runId = await startRun(dateStr, sport);
// ... existing pipeline ...
// After each pick is generated:
await recordPick(runId, {
  gameId: game.id,
  pickType: 'spread',
  tier: pick.stars,
  direction: pick.direction,
  convergenceScore: pick.trendScore,
  signalsUsed: signalBreakdown,
  featuresActive: activeFlags,
});
// At end:
await endRun(runId, { totalGames, picksGenerated, errors });
```

### Test

| Test | Command | Expected |
|------|---------|----------|
| Unit: monitor CRUD | `bun test src/lib/__tests__/pipeline-monitor.test.ts` | Start/record/end run, verify data persists |
| Integration: full pipeline run | Run `generateDailyPicks('2026-02-15', 'NCAAMB')` | PipelineRun record created with correct counts |
| API: fetch metrics | `curl /api/admin/pipeline/runs` | Returns recent runs with metrics |
| Dashboard: renders | Manual check of admin page | Shows runs, picks, signal utilization |

### Success Criteria
- [ ] Every pipeline run creates a PipelineRun record
- [ ] Every pick has a PickMetric record with signal breakdown
- [ ] Dashboard shows OVER/UNDER ratios by tier (verifying the known 3★ OVER bias)
- [ ] Can identify which signals are firing at 0% utilization (dead signals)

### Time Estimate: 6 hours

---

## Step 1C: Integration Testing Framework

### Build

**Files:**
- `tests/integration/pipeline.test.ts` — end-to-end pipeline tests
- `tests/integration/backtest.ts` — historical comparison tool
- `tests/integration/baseline.json` — captured baseline metrics

**Implementation tasks:**
1. Create `tests/integration/pipeline.test.ts`:
   ```typescript
   describe('Pick Pipeline Integration', () => {
     it('generates picks for NCAAMB games', async () => {
       const picks = await generateDailyPicks('2026-02-15', 'NCAAMB');
       expect(picks.length).toBeGreaterThan(0);
       // Verify structure
       for (const pick of picks) {
         expect(pick.stars).toBeGreaterThanOrEqual(1);
         expect(pick.stars).toBeLessThanOrEqual(5);
         expect(pick.trendScore).toBeGreaterThan(0);
         expect(['home','away','over','under']).toContain(pick.direction);
       }
     });

     it('uses convergence scoring for all spread picks', async () => {
       const picks = await generateDailyPicks('2026-02-15', 'NCAAMB');
       const spreadPicks = picks.filter(p => p.type === 'spread');
       for (const pick of spreadPicks) {
         expect(pick.convergenceScore).toBeDefined();
         expect(pick.signalsUsed).toBeDefined();
       }
     });

     it('records pipeline metrics', async () => {
       await generateDailyPicks('2026-02-15', 'NCAAMB');
       const runs = await getRecentRuns('NCAAMB', 1);
       expect(runs.length).toBe(1);
       expect(runs[0].picksGenerated).toBeGreaterThan(0);
     });
   });
   ```

2. Create `tests/integration/backtest.ts`:
   ```typescript
   // Run pipeline against historical dates, compare results to actual outcomes
   async function backtest(options: {
     sport: string;
     startDate: string;
     endDate: string;
     flags?: Record<string, boolean>; // override feature flags
   }): Promise<BacktestResult> {
     // For each date in range:
     //   1. Generate picks with given flags
     //   2. Look up actual game results
     //   3. Grade each pick
     //   4. Return aggregate stats
     return {
       totalPicks: number,
       wins: number,
       losses: number,
       winRate: number,
       byTier: { [tier: number]: { wins, losses, winRate } },
       byType: { spread: {...}, total: {...} },
       overUnderRatio: { over: number, under: number },
     };
   }
   ```

3. Capture current baseline:
   ```bash
   bun run tests/integration/backtest.ts \
     --sport NCAAMB --start 2026-01-01 --end 2026-02-15 \
     > tests/integration/baseline.json
   ```

### Test

| Test | Command | Expected |
|------|---------|----------|
| Baseline capture | Run backtest with no flags | Captures current 41.8% win rate |
| Pipeline smoke test | `bun test tests/integration/pipeline.test.ts` | All assertions pass |
| Backtest tool works | Run on 1 week of data | Produces valid BacktestResult JSON |

### Success Criteria
- [ ] Baseline captured: `tests/integration/baseline.json` exists with current metrics
- [ ] Confirms ~41.8% overall win rate
- [ ] Confirms 3★ OVER bias (should show >65% of 3★ picks are OVER)
- [ ] Backtest tool runs in <5 minutes for 1 month of NCAAMB data
- [ ] All integration tests pass

### Time Estimate: 6 hours

---

## Phase 1 Deliverables Checklist

- [ ] `src/lib/feature-flags.ts` — working flag system
- [ ] `src/lib/pipeline-monitor.ts` — run tracking + pick metrics
- [ ] `src/app/admin/pipeline/page.tsx` — monitoring dashboard
- [ ] `tests/integration/` — pipeline tests + backtest tool
- [ ] `tests/integration/baseline.json` — documented 41.8% baseline
- [ ] Prisma migration applied with FeatureFlag, PipelineRun, PickMetric models
- [ ] All tests green

### Phase 1 Gate: Do NOT proceed to Phase 2 until:
1. You can toggle a feature flag and see the change reflected in pick generation logs
2. Dashboard shows real pipeline run data
3. Baseline is captured and verified
4. All tests pass

---

# PHASE 2: Fix Core Issues (Days 4–7)

> Apply surgical fixes to known bugs. Each fix gets its own flag, its own tests, and its own measured improvement. No bundling.

---

## Step 2A: Fix OVER Bias in 3★ Tier

### The Bug
3★ total picks are ~70% OVER because the O/U convergence logic has weak UNDER signal detection. The PIT model and convergence tiers interact badly — OVER signals accumulate more easily.

### Build

**In `pick-engine.ts`, find the O/U convergence section (around line ~2200):**

```typescript
// NEW: Directional balance filter for 3★ totals
if (await isEnabled('fix_3star_over_bias', { sport })) {
  // After computing O/U convergence, check if we're in 3★ tier
  if (ouTier === 3) {
    // Require at least 2 independent UNDER signals to pick UNDER
    // Require at least 2 independent OVER signals to pick OVER
    // This prevents the accumulation bias
    const overSignals = ouSignals.filter(s => s.direction === 'over' && s.magnitude > 0.1);
    const underSignals = ouSignals.filter(s => s.direction === 'under' && s.magnitude > 0.1);
    
    if (ouDirection === 'over' && overSignals.length < 2) {
      ouTier = 0; // Suppress weak OVER picks
      monitor.log('3star_over_suppressed', { gameId, overSignals: overSignals.length });
    }
    if (ouDirection === 'under' && underSignals.length < 2) {
      ouTier = 0; // Suppress weak UNDER picks
      monitor.log('3star_under_suppressed', { gameId, underSignals: underSignals.length });
    }
  }
}
```

### Wire
- Wrap fix in `isEnabled('fix_3star_over_bias')` check
- Add logging via pipeline-monitor when filter activates

### Test

| Test | What | Expected |
|------|------|----------|
| Unit | Mock O/U signals, verify filter logic | Suppresses weak 3★ OVER with <2 signals |
| Integration | Generate picks with flag ON vs OFF | Flag ON: OVER/UNDER ratio closer to 50/50 for 3★ |
| Backtest | Run Jan 1–Feb 15 with flag ON vs OFF | 3★ total win rate improves from ~35% to ~48%+ |
| Live monitor | Enable flag, run for 24h | Dashboard shows balanced 3★ direction ratios |

### Backtest Protocol
```bash
# Flag OFF (baseline)
bun run tests/integration/backtest.ts --sport NCAAMB --start 2026-01-01 --end 2026-02-15
# Flag ON
bun run tests/integration/backtest.ts --sport NCAAMB --start 2026-01-01 --end 2026-02-15 --flag fix_3star_over_bias=true
# Compare
bun run tests/integration/compare.ts --before baseline.json --after fix-over-bias.json
```

### Success Criteria
- [ ] 3★ OVER/UNDER ratio moves from ~70/30 to ~55/45 or better
- [ ] 3★ total win rate improves (any improvement = pass)
- [ ] No regression in 4★ or 5★ pick performance
- [ ] No regression in spread pick performance
- [ ] Monitoring shows filter activating on real games

### Rollback
Set `fix_3star_over_bias` flag to `false`. Immediate effect on next pipeline run.

### Time Estimate: 4 hours

---

## Step 2B: Fix Spread Model Suppression

### The Bug
NFL and NBA spread picks use `computePowerRatingEdge()` which is just `avgMargin diff` — a napkin calculation. The convergence scoring then applies low confidence to these, suppressing valid spread signals. Should use graduated suppression based on signal agreement rather than blanket low confidence.

### Build

```typescript
// In computeConvergenceScore(), find the spread signal processing
if (await isEnabled('fix_spread_suppression', { sport })) {
  // Instead of flat suppression for non-Ridge sports:
  // Count agreeing vs disagreeing signals
  const agreeingSignals = signals.filter(s => s.direction === mainDirection);
  const disagreeing = signals.filter(s => s.direction !== mainDirection);
  
  // Graduate: if 70%+ of signals agree, boost confidence
  const agreementRatio = agreeingSignals.length / signals.length;
  if (agreementRatio >= 0.7) {
    // High agreement — don't suppress
    scaleFactor = 1.0;
  } else if (agreementRatio >= 0.5) {
    // Moderate agreement — mild suppression
    scaleFactor = 0.7;
  } else {
    // Low agreement — heavy suppression (current behavior)
    scaleFactor = 0.4;
  }
}
```

### Wire
- Wrap in `isEnabled('fix_spread_suppression')` check
- Log scale factor decisions with signal counts

### Test

| Test | What | Expected |
|------|------|----------|
| Unit | Mock signals with varying agreement | Correct scaleFactor for each agreement level |
| Integration | NFL/NBA picks with flag ON | More spread picks pass 3★+ threshold |
| Backtest | NFL Jan data with flag ON vs OFF | Spread pick volume increases, win rate stable or better |

### Success Criteria
- [ ] Spread pick volume increases by 20%+ for NFL/NBA
- [ ] Spread pick win rate does not decrease
- [ ] High-agreement spread picks (70%+) no longer suppressed
- [ ] Monitoring shows graduation logic activating

### Time Estimate: 4 hours

---

## Step 2C: Fix FanMatch Name Mismatch

### The Bug
FanMatch predictions use ESPN display names while KenPom uses its own naming convention. Games fail to match, losing the FanMatch moneyline edge signal entirely for affected games.

### Build

**File:** `src/lib/team-aliases.ts` (enhance existing)

```typescript
// Build a robust name normalization function
export function normalizeTeamName(name: string, source: 'espn' | 'kenpom' | 'fanmatch'): string {
  // 1. Strip common suffixes: "State" variants, "University", etc.
  // 2. Apply known alias mappings (load from DB or static map)
  // 3. Fuzzy match as fallback (Levenshtein distance < 3)
  return normalized;
}
```

**In pick-engine.ts, FanMatch lookup section:**
```typescript
if (await isEnabled('fix_fanmatch_names')) {
  // Use normalized names for FanMatch matching
  const normalizedHome = normalizeTeamName(homeTeam, 'fanmatch');
  const normalizedAway = normalizeTeamName(awayTeam, 'fanmatch');
  // Match on normalized names instead of raw
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit | Known mismatches resolve | "UConn" ↔ "Connecticut", "St. John's" ↔ "St John's" etc. |
| Integration | FanMatch match rate with flag ON | Match rate increases from ~70% to ~95% |
| Backtest | NCAAMB with flag ON | More games have FanMatch signal, overall accuracy improves |

### Success Criteria
- [ ] FanMatch match rate >90% (up from ~70%)
- [ ] No false matches (wrong team paired)
- [ ] Monitoring shows FanMatch signal utilization increase
- [ ] NCAAMB pick accuracy improves or holds

### Time Estimate: 3 hours

---

## Step 2D: Fix Convergence Fallback Weight

### The Bug
In `computeConvergenceScore()`, unmapped signal categories fall back to `weight = 0.1`. This silently gives unknown signals moderate influence instead of flagging them or using 0.

### Build

```typescript
if (await isEnabled('fix_convergence_fallback')) {
  // Replace: weight = signalWeights[category] || 0.1
  // With:
  const weight = signalWeights[category];
  if (weight === undefined) {
    monitor.warn('unmapped_signal', { category, sport, gameId });
    weight = 0; // Unknown signals get zero weight, not 0.1
  }
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit | Pass unknown category | Weight = 0, warning logged |
| Integration | Full pipeline with flag ON | No unmapped signals getting 0.1 weight |
| Backtest | Flag ON vs OFF | Win rate improves slightly as noise removed |

### Success Criteria
- [ ] All signals explicitly mapped (monitoring shows zero unmapped warnings after fixes)
- [ ] No silent 0.1 fallback weights
- [ ] Win rate does not decrease

### Time Estimate: 2 hours

---

## Phase 2 Deliverables Checklist

- [ ] 4 fixes implemented, each behind its own feature flag
- [ ] Each fix has unit tests, integration tests, and backtest results
- [ ] Monitoring dashboard shows per-fix impact metrics
- [ ] Updated baseline captured with all 4 flags enabled

### Phase 2 Backtest Summary (fill in after implementation)

| Fix | Flag | Picks Affected | Win Rate Change | Status |
|-----|------|---------------|-----------------|--------|
| 3★ OVER bias | `fix_3star_over_bias` | ~XX% of 3★ totals | 41.8% → ??% | ⏳ |
| Spread suppression | `fix_spread_suppression` | ~XX% of NFL/NBA spreads | ??% → ??% | ⏳ |
| FanMatch names | `fix_fanmatch_names` | ~30% of NCAAMB games | ??% → ??% | ⏳ |
| Convergence fallback | `fix_convergence_fallback` | Unknown | ??% → ??% | ⏳ |
| **Combined** | All 4 ON | — | 41.8% → **target 50%+** | ⏳ |

### Phase 2 Gate: Do NOT proceed to Phase 3 until:
1. All 4 fixes show individual improvement in backtest (or at minimum no regression)
2. Combined backtest shows improvement over 41.8% baseline
3. 24h live monitoring with all flags ON shows no errors
4. Updated baseline captured and documented

---

# PHASE 3: NFL Ridge Model (Days 8–12)

> Build ONE complete model from scratch with real trained coefficients. This is the template for all future model work.

---

## Step 3A: Ridge Model Implementation

### Build

**File:** `src/lib/models/nfl-ridge.ts`

```typescript
export interface RidgeModelInput {
  homeEpa: number;          // EPA offensive
  awayEpa: number;
  homeDefEpa: number;       // EPA defensive
  awayDefEpa: number;
  homeSOS: number;          // Strength of schedule
  awaySOS: number;
  homeRestDays: number;
  awayRestDays: number;
  homeField: number;        // 1 for home, 0 for neutral
  weatherImpact: number;    // 0-1 scale
  lineMovement: number;     // current line vs opener
}

export interface RidgeModelOutput {
  predictedSpread: number;  // positive = home favored
  predictedTotal: number;
  confidence: number;       // 0-1
  features: Record<string, number>; // feature contributions
}

export class NFLRidgeModel {
  private spreadCoefficients: number[];
  private totalCoefficients: number[];
  private spreadIntercept: number;
  private totalIntercept: number;
  
  constructor(coefficients?: ModelCoefficients) {
    // Load trained coefficients or use defaults
  }
  
  predict(input: RidgeModelInput): RidgeModelOutput {
    // Standard ridge regression: y = X * beta + intercept
    const features = this.extractFeatures(input);
    const spread = dotProduct(features, this.spreadCoefficients) + this.spreadIntercept;
    const total = dotProduct(features, this.totalCoefficients) + this.totalIntercept;
    return { predictedSpread: spread, predictedTotal: total, confidence, features: breakdown };
  }
  
  private extractFeatures(input: RidgeModelInput): number[] {
    // Normalize and combine features
    // Include interaction terms: homeEpa * homeField, etc.
  }
}
```

### Wire

In `pick-engine.ts`, within the NFL section of `generateDailyPicks()`:

```typescript
if (sport === 'NFL' && await isEnabled('use_nfl_ridge_model')) {
  const ridge = new NFLRidgeModel(await loadTrainedCoefficients('nfl'));
  const ridgeResult = ridge.predict({
    homeEpa: homeStats.epa,
    awayEpa: awayStats.epa,
    // ... map pipeline data to model inputs
  });
  
  // Replace computePowerRatingEdge() result with Ridge result
  modelEdge = {
    spreadEdge: ridgeResult.predictedSpread - currentLine,
    totalEdge: ridgeResult.predictedTotal - currentTotal,
    confidence: ridgeResult.confidence,
    source: 'ridge',
  };
  
  monitor.recordPick(runId, { ...pickData, ridgeUsed: true, ridgeConfidence: ridgeResult.confidence });
} else {
  // Existing napkin math fallback
  modelEdge = computePowerRatingEdge(homeStats, awayStats);
  monitor.recordPick(runId, { ...pickData, ridgeUsed: false });
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit: prediction | Known inputs → known output | Deterministic prediction matches hand calculation |
| Unit: feature extraction | Edge cases (missing data, neutral site) | Handles gracefully, no NaN |
| Integration: pipeline uses Ridge | Flag ON, generate NFL picks | Picks use Ridge model, logged as `source: 'ridge'` |
| Integration: fallback works | Flag OFF | Falls back to `computePowerRatingEdge()` |

### Time Estimate: 6 hours

---

## Step 3B: Training Pipeline

### Build

**File:** `src/lib/models/train-nfl-ridge.ts`

```typescript
// Training script — runs offline, outputs coefficient JSON
async function trainNFLRidge(): Promise<ModelCoefficients> {
  // 1. Load historical NFL games from database
  const games = await loadNFLGames({ seasons: [2023, 2024, 2025] });
  
  // 2. Build feature matrix X and target vectors y_spread, y_total
  const { X, ySpread, yTotal } = buildFeatureMatrix(games);
  
  // 3. Ridge regression with cross-validation for lambda
  //    Use simple implementation (no scipy needed):
  //    beta = (X'X + lambda*I)^-1 * X'y
  const lambdas = [0.001, 0.01, 0.1, 1.0, 10.0];
  const bestLambda = crossValidate(X, ySpread, lambdas, 5); // 5-fold CV
  
  // 4. Train final model
  const spreadCoefficients = ridgeFit(X, ySpread, bestLambda);
  const totalCoefficients = ridgeFit(X, yTotal, bestLambda);
  
  // 5. Evaluate
  const { rmse, mae, r2 } = evaluate(X, ySpread, spreadCoefficients);
  console.log(`Spread model: RMSE=${rmse.toFixed(2)}, R²=${r2.toFixed(3)}`);
  
  // 6. Save coefficients
  return { spreadCoefficients, totalCoefficients, spreadIntercept, totalIntercept, lambda: bestLambda, trainedAt: new Date(), metrics: { rmse, mae, r2 } };
}
```

**Implementation tasks:**
1. Implement ridge regression in TypeScript (no external ML lib needed — it's a matrix operation)
2. Build feature extraction from NFLGame records
3. Cross-validation for regularization parameter
4. Script to run training and save coefficients to `src/lib/models/coefficients/nfl-ridge.json`
5. Validation script comparing trained model vs random vs current napkin math

### Test

| Test | What | Expected |
|------|------|----------|
| Training runs | `bun run src/lib/models/train-nfl-ridge.ts` | Produces coefficient JSON, R² > 0.1 |
| Validation | Trained model vs holdout set | RMSE < vegas line error margin (~10 points) |
| Comparison | Ridge vs `computePowerRatingEdge()` | Ridge RMSE is lower |
| Overfit check | Train R² vs test R² | Gap < 0.1 (not overfitting) |

### Success Criteria
- [ ] Trained coefficients saved to JSON
- [ ] R² > 0.05 on holdout data (low bar, but proves signal)
- [ ] Ridge outperforms napkin math on historical data
- [ ] No NaN or infinite coefficients

### Time Estimate: 8 hours

---

## Step 3C: Integration and Validation

### A/B Testing Protocol

```typescript
// In pick-engine.ts, use rollout percentage for A/B
const flag = await getFlag('use_nfl_ridge_model');
if (flag?.enabled && Math.random() < flag.rollout) {
  // Use Ridge model
} else {
  // Use fallback
}
```

**Week 1 plan:**
- Day 1-2: `rollout: 0` — flag enabled but 0% rollout, just verify logging works
- Day 3-4: `rollout: 0.5` — 50% of NFL games use Ridge
- Day 5-7: `rollout: 1.0` or `0` based on results

### Monitoring Queries

```sql
-- Ridge utilization rate
SELECT 
  COUNT(*) FILTER (WHERE (metrics->>'ridgeUsed')::boolean) as ridge_picks,
  COUNT(*) as total_picks,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (metrics->>'ridgeUsed')::boolean) / COUNT(*), 1) as utilization_pct
FROM "PickMetric"
WHERE "pickType" = 'spread'
AND "createdAt" > NOW() - INTERVAL '7 days';

-- Ridge vs Fallback win rate
SELECT 
  (pm.metrics->>'ridgeUsed')::boolean as used_ridge,
  COUNT(*) as picks,
  COUNT(*) FILTER (WHERE dp.result = 'win') as wins,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dp.result = 'win') / COUNT(*), 1) as win_rate
FROM "PickMetric" pm
JOIN "DailyPick" dp ON dp.id = pm."gameId"
WHERE pm."pickType" = 'spread'
GROUP BY 1;
```

### Test

| Test | What | Expected |
|------|------|----------|
| A/B routing | 50% rollout over 100 games | ~50 Ridge, ~50 fallback |
| Ridge picks logged | Monitor dashboard | Shows Ridge utilization % |
| Performance comparison | After 1 week of data | Ridge win rate vs fallback win rate |
| Backtest (final) | Full season with Ridge ON | NFL spread win rate improvement |

### Success Criteria
- [ ] Ridge model utilization shows >0% in monitoring (proves integration works)
- [ ] Ridge picks have equal or better win rate than fallback in backtest
- [ ] No errors or exceptions from Ridge model in production
- [ ] A/B test shows Ridge ≥ fallback performance
- [ ] Coefficients are non-trivial (not all zeros)

### Time Estimate: 6 hours

---

## Phase 3 Deliverables Checklist

- [ ] `src/lib/models/nfl-ridge.ts` — Ridge model class
- [ ] `src/lib/models/train-nfl-ridge.ts` — Training pipeline
- [ ] `src/lib/models/coefficients/nfl-ridge.json` — Trained coefficients
- [ ] Feature flag `use_nfl_ridge_model` controlling Ridge vs fallback
- [ ] Monitoring showing Ridge utilization and performance
- [ ] Backtest showing NFL spread improvement
- [ ] Documentation: how to replicate this pattern for other sports

### Phase 3 Gate:
1. Ridge model is being used in production (utilization > 0%)
2. Backtest shows improvement or no regression
3. Training pipeline is reproducible
4. Pattern documented for reuse in NCAAMB/NBA/NCAAF Ridge models

---

# PHASE 4: CLV System Integration (Days 13–17)

> Build Closing Line Value tracking — the gold standard for evaluating pick quality.

---

## Step 4A: Database Schema and CLV Engine

### Build

```typescript
// Schema additions
model LineSnapshot {
  id          String   @id @default(cuid())
  gameId      String
  sport       String
  bookmaker   String   @default("consensus")
  spread      Float?
  total       Float?
  homeML      Int?     // American odds
  awayML      Int?
  capturedAt  DateTime @default(now())
  
  @@index([gameId, capturedAt])
}

model CLVRecord {
  id              String   @id @default(cuid())
  pickId          String   @unique
  pick            DailyPick @relation(fields: [pickId], references: [id])
  pickLine        Float              // line when pick was made
  closingLine     Float              // line at game start
  clvPoints       Float              // closing - pick (positive = beat the close)
  clvPercentage   Float              // CLV as percentage
  capturedAt      DateTime @default(now())
}
```

**File:** `src/lib/clv-engine.ts`

```typescript
export class CLVEngine {
  // Capture current line for a game
  async captureLineSnapshot(gameId: string, sport: string): Promise<void>;
  
  // Record the line at time of pick
  async recordPickLine(pickId: string, line: number): Promise<void>;
  
  // After game starts, capture closing line and compute CLV
  async computeCLV(pickId: string): Promise<CLVRecord>;
  
  // Aggregate CLV stats
  async getCLVSummary(filters: { sport?, tier?, dateRange? }): Promise<CLVSummary>;
}
```

**Implementation tasks:**
1. Add models, migrate
2. Build CLV engine with line capture and computation
3. Create cron job / scheduled task to capture lines every 2 hours
4. Create cron job to compute CLV after games start (capture closing line)
5. API endpoints for CLV data

### Wire

In `generateDailyPicks()`, after a pick is created:
```typescript
if (await isEnabled('enable_clv_tracking')) {
  await clvEngine.recordPickLine(pick.id, currentLine);
  monitor.log('clv_line_captured', { pickId: pick.id, line: currentLine });
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit: CLV calculation | Known pick line + closing line | Correct CLV points and percentage |
| Unit: line snapshots | Capture and retrieve | Data persists and returns correctly |
| Integration: picks get CLV data | Generate picks with flag ON | Every pick has a LineSnapshot |
| Cron: closing line capture | Simulate game start | CLVRecord created with closing line |

### Success Criteria
- [ ] Line snapshots captured every 2h for active games
- [ ] Every pick with `enable_clv_tracking` ON has a recorded pick-time line
- [ ] CLV computed correctly after game start
- [ ] CLV summary shows aggregate stats by tier

### Time Estimate: 8 hours

---

## Step 4B: Pick Pipeline Integration

### Build

Add CLV data to the monitoring dashboard:
```typescript
// Dashboard additions:
// - CLV by tier: are 5★ picks beating the close more than 3★?
// - CLV by signal: which signals produce the most CLV?
// - CLV trend: is CLV improving over time?
```

Add CLV to pick evaluation:
```typescript
if (await isEnabled('enable_clv_tracking')) {
  // After pick generation, attach CLV context
  pick.metadata.currentLine = currentLine;
  pick.metadata.lineHistory = await getLineHistory(gameId, pickType);
  pick.metadata.lineMovement = computeLineMovement(lineHistory);
  
  // Flag picks where we're picking against line movement
  if (pick.direction === 'home' && lineMovement > 0.5) {
    pick.metadata.lineMovementWarning = 'Picking against significant line movement';
  }
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Integration: CLV in picks | Generate picks | Picks include line movement data |
| Dashboard: CLV display | Check admin page | CLV summary visible per tier |
| Line movement warnings | Pick against movement | Warning attached to pick metadata |

### Success Criteria
- [ ] Dashboard shows CLV by tier (even if initially limited data)
- [ ] Picks include line movement context
- [ ] Can answer: "Are our 5★ picks beating the closing line?"

### Time Estimate: 4 hours

---

## Step 4C: CLV-Based Optimization

### Build

After collecting 2+ weeks of CLV data:

```typescript
if (await isEnabled('use_clv_optimization')) {
  // Adjust signal weights based on which signals produce positive CLV
  const signalCLV = await clvEngine.getCLVBySignal({ sport, days: 30 });
  
  for (const [signal, clvData] of Object.entries(signalCLV)) {
    if (clvData.avgCLV > 0.5) {
      // This signal consistently beats the close — boost its weight
      adjustedWeights[signal] = baseWeights[signal] * 1.2;
    } else if (clvData.avgCLV < -0.5) {
      // This signal consistently loses to the close — reduce its weight
      adjustedWeights[signal] = baseWeights[signal] * 0.8;
    }
  }
  
  // Renormalize weights to sum to 1.0
  normalizeWeights(adjustedWeights);
}
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit: weight adjustment | Mock CLV data | Positive CLV signals get boosted |
| Integration: adjusted weights | Flag ON with mock data | Convergence uses adjusted weights |
| A/B: optimized vs static | 50% rollout | Compare win rates |

### Success Criteria
- [ ] CLV-optimized weights differ from static weights
- [ ] A/B test shows CLV-optimized ≥ static performance
- [ ] Monitoring shows which signals are being boosted/reduced

### Time Estimate: 6 hours

---

## Phase 4 Deliverables Checklist

- [ ] `src/lib/clv-engine.ts` — CLV calculation and tracking
- [ ] Line snapshot cron job running
- [ ] CLV data on monitoring dashboard
- [ ] CLV-based weight optimization (behind flag)
- [ ] Answer to: "Which signals beat the closing line?"

### Phase 4 Gate:
1. CLV data is being captured for all picks
2. Dashboard shows CLV metrics
3. At least 1 week of CLV data collected before enabling optimization
4. CLV optimization shows promise in backtest

---

# PHASE 5: Market Intelligence Integration (Days 18–22)

> Add sharp money detection to the signal mix.

---

## Step 5A: Sharp Money Detection

### Build

**File:** `src/lib/signals/sharp-money.ts`

```typescript
export interface SharpMoneySignal {
  direction: 'home' | 'away' | 'over' | 'under';
  magnitude: number;    // 0-1 strength
  indicators: string[]; // what triggered the signal
  confidence: number;
}

export class SharpMoneyDetector {
  // Detect sharp action from line movement patterns
  async detect(gameId: string, sport: string): Promise<SharpMoneySignal | null> {
    const lineHistory = await getLineHistory(gameId);
    
    // Sharp indicators:
    // 1. Reverse line movement (line moves opposite to public %)
    // 2. Steam moves (sharp sudden line changes)
    // 3. Opening line value (sharp books vs public books divergence)
    
    const indicators: string[] = [];
    
    // Reverse line movement
    if (lineHistory.movement !== 0 && publicBettingDirection !== lineDirection) {
      indicators.push('reverse_line_movement');
    }
    
    // Steam move (>1 point move in <30 min)
    const steamMoves = detectSteamMoves(lineHistory);
    if (steamMoves.length > 0) {
      indicators.push('steam_move');
    }
    
    if (indicators.length === 0) return null;
    
    return {
      direction: lineDirection,
      magnitude: Math.min(indicators.length * 0.3, 1.0),
      indicators,
      confidence: indicators.length / 3,
    };
  }
}
```

**Data sources needed:**
- Line history (from LineSnapshot table — built in Phase 4)
- Public betting percentages (need new data source — Action Network API or scraping)

### Wire

In convergence scoring:
```typescript
if (await isEnabled('use_sharp_money_detection')) {
  const sharpSignal = await sharpDetector.detect(gameId, sport);
  if (sharpSignal) {
    signals.push({
      category: 'sharpMoney',
      direction: sharpSignal.direction,
      magnitude: sharpSignal.magnitude,
      weight: signalWeights.sharpMoney || 0.12, // Give sharp signals meaningful weight
    });
    monitor.log('sharp_signal_fired', { gameId, indicators: sharpSignal.indicators });
  }
}
```

Add `sharpMoney` to signal weights for each sport:
```typescript
// NCAAMB spread weights (updated)
sharpMoney: 0.10  // Take from marketEdge (0.08→0.03) and trendAngles (0.18→0.13)
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit: RLM detection | Known line movement + public % | Correctly identifies reverse movement |
| Unit: steam detection | Known line history | Detects >1pt/30min moves |
| Integration: signal in pipeline | Flag ON, game with sharp action | Sharp signal appears in convergence |
| Backtest: historical sharp | Last 30 days with flag ON | Picks aligned with sharp money win more |

### Success Criteria
- [ ] Sharp signals fire on 10-30% of games (not too rare, not too frequent)
- [ ] Sharp-aligned picks outperform sharp-opposed picks in backtest
- [ ] No regression in overall win rate
- [ ] Monitoring shows when and why sharp signals fire

### Time Estimate: 8 hours

---

## Step 5B: Pipeline Integration and Full Validation

### A/B Test Protocol
- Week 1: `rollout: 0.5` — 50% of picks incorporate sharp signals
- Compare: sharp-enhanced picks vs standard picks
- If positive: `rollout: 1.0`

### Monitoring Dashboard Additions
- Sharp signal fire rate by sport
- Sharp signal accuracy (% of sharp signals that were correct)
- Impact on convergence scores when sharp signals are included

### Success Criteria
- [ ] Sharp signals integrated into convergence scoring
- [ ] A/B test shows improvement or no regression
- [ ] Framework established for adding more market signals

### Time Estimate: 4 hours

---

## Phase 5 Deliverables Checklist

- [ ] `src/lib/signals/sharp-money.ts` — Sharp money detection
- [ ] Sharp signals wired into convergence scoring
- [ ] Public betting % data source established
- [ ] A/B test results documented
- [ ] Monitoring for sharp signal fire rate and accuracy

### Phase 5 Gate:
1. Sharp signals firing on real games
2. No regression in overall performance
3. Framework for additional market signals documented

---

# PHASE 6: Tournament Systems (Days 23–27)

> Get tournament-ready for March 15, 2026 Selection Sunday.

---

## Step 6A: Enhanced Tournament Logic

### Build

**File:** `src/lib/signals/tournament.ts`

```typescript
export interface TournamentContext {
  isTournament: boolean;
  tournamentName: string;          // "March Madness", "NIT", "Conference Tournament"
  round: number;                   // 1-6 for March Madness
  seedDiff: number;                // seed spread (positive = upset potential)
  historicalUnderRate: number;      // % of games that go UNDER in this round historically
  historicalUpsetRate: number;      // % of games that are upsets in this round
}

export class TournamentEngine {
  async getContext(gameId: string): Promise<TournamentContext | null>;
  
  // Adjust picks based on tournament context
  adjustPick(pick: Pick, context: TournamentContext): Pick {
    // Round-specific adjustments:
    // First round: UNDER boost (67% hit rate historically)
    // Sweet 16+: stronger team tends to cover
    // Championship games: unders hit at high rate
    
    if (context.round <= 2 && pick.type === 'total') {
      // First/second round: strong UNDER bias historically
      pick.metadata.tournamentAdjustment = 'under_boost';
      if (pick.direction === 'under') {
        pick.convergenceScore *= 1.15; // 15% boost for UNDER picks
      }
    }
    
    if (context.seedDiff > 8 && pick.type === 'spread') {
      // Large seed differential: public loves the underdog
      // Sharp money typically on the favorite to cover
      pick.metadata.tournamentAdjustment = 'seed_differential';
    }
    
    return pick;
  }
}
```

### Wire

```typescript
if (await isEnabled('enable_tournament_logic')) {
  const tournContext = await tournamentEngine.getContext(game.id);
  if (tournContext?.isTournament) {
    pick = tournamentEngine.adjustPick(pick, tournContext);
    monitor.log('tournament_adjustment', { gameId, round: tournContext.round, adjustment: pick.metadata.tournamentAdjustment });
  }
}
```

### Historical Validation

```bash
# Test against all March Madness games 2019-2025
bun run tests/integration/tournament-backtest.ts \
  --tournament "March Madness" \
  --years 2019,2020,2021,2022,2023,2024,2025 \
  --flag enable_tournament_logic=true
```

### Test

| Test | What | Expected |
|------|------|----------|
| Unit: tournament detection | March Madness games | Correctly identifies round, seeds |
| Unit: UNDER boost | First round game | UNDER picks get boosted convergence |
| Backtest: March Madness history | 2019-2025 tournaments | Tournament logic improves win rate |
| Integration: pipeline applies adjustments | Flag ON, tournament game | Adjustment logged and applied |

### Success Criteria
- [ ] Tournament detection works for March Madness, NIT, Conference tournaments
- [ ] Historical backtest shows improvement over non-adjusted picks
- [ ] UNDER boost in early rounds aligns with historical 60%+ UNDER rate
- [ ] No regression on non-tournament games

### Time Estimate: 8 hours

---

## Step 6B: Tournament Validation and Readiness

### Pre-March 15 Checklist

```markdown
## March 15 Readiness

### Data Pipeline
- [ ] KenPom data refreshing daily
- [ ] Odds data refreshing every 2 hours
- [ ] FanMatch predictions loading correctly
- [ ] Line snapshots capturing (for CLV)

### Models
- [ ] All feature flags reviewed and set
- [ ] Tournament logic enabled
- [ ] Ridge model (if extended to NCAAMB) trained on latest data
- [ ] Signal weights optimized based on CLV data

### Monitoring
- [ ] Dashboard accessible and showing real-time data
- [ ] Alerts configured for pipeline errors
- [ ] CLV tracking active
- [ ] Sharp money signals firing

### Performance Verification
- [ ] Current win rate documented (target: 55%+)
- [ ] Tournament backtest results reviewed
- [ ] Conference tournament picks generated successfully (March 10-15 warm-up)
- [ ] All integration tests passing
```

### Real-Time Adjustment System

```typescript
export class TournamentMonitor {
  // Track performance during tournament in real-time
  async checkPerformance(): Promise<TournamentPerformanceReport> {
    const recentPicks = await getRecentTournamentPicks(24); // last 24 hours
    
    return {
      totalPicks: recentPicks.length,
      wins: recentPicks.filter(p => p.result === 'win').length,
      currentWinRate: wins / totalPicks,
      underPerformance: recentPicks.filter(p => p.direction === 'under').winRate,
      overPerformance: recentPicks.filter(p => p.direction === 'over').winRate,
      // Auto-adjust recommendations
      recommendations: this.generateRecommendations(recentPicks),
    };
  }
  
  generateRecommendations(picks: Pick[]): string[] {
    const recs: string[] = [];
    if (underWinRate > 0.65) recs.push('UNDER boost is working — maintain');
    if (underWinRate < 0.40) recs.push('UNDER boost is failing — consider reducing');
    return recs;
  }
}
```

### Success Criteria
- [ ] Conference tournaments (March 10-14) used as live validation
- [ ] Real-time monitoring showing tournament performance
- [ ] Adjustment recommendations generated automatically
- [ ] Ready to generate March Madness picks March 15

### Time Estimate: 6 hours

---

## Phase 6 Deliverables Checklist

- [ ] `src/lib/signals/tournament.ts` — Tournament engine
- [ ] Historical validation against 2019-2025 March Madness
- [ ] Conference tournament live validation
- [ ] Real-time tournament monitoring
- [ ] March 15 readiness checklist completed

### Phase 6 Gate:
1. Historical backtest shows tournament logic improves March Madness pick accuracy
2. Conference tournaments used as live validation (March 10-14)
3. All systems operational for Selection Sunday

---

# Cross-Cutting Concerns

## Testing Pyramid (Apply to Every Phase)

```
                    ┌─────────────┐
                    │  Live A/B   │  ← Phase gate: 24-48h monitoring
                    │  Testing    │
                   ┌┴─────────────┴┐
                   │   Backtest     │  ← Historical validation
                   │   Comparison   │
                  ┌┴───────────────┴┐
                  │   Integration    │  ← Feature wired into pipeline
                  │   Tests          │
                 ┌┴─────────────────┴┐
                 │     Unit Tests      │  ← Individual function works
                 └─────────────────────┘
```

**Every feature must pass ALL FOUR levels before the phase gate opens.**

## Rollback Procedures

Every feature flag supports instant rollback:
```bash
# Emergency rollback
curl -X POST /api/admin/flags -d '{"key": "problematic_feature", "enabled": false}'
# Takes effect on next pipeline run (within 60 seconds)
```

## Daily Review Protocol

Each day during active development:
1. Check monitoring dashboard (2 min)
2. Review overnight pick performance (5 min)
3. Check feature utilization rates (2 min)
4. Review error logs (2 min)
5. Decision: proceed / pause / rollback (1 min)

## File Structure (Final)

```
src/lib/
├── feature-flags.ts          # Phase 1
├── pipeline-monitor.ts       # Phase 1
├── clv-engine.ts             # Phase 4
├── team-aliases.ts           # Phase 2 (enhanced)
├── models/
│   ├── nfl-ridge.ts          # Phase 3
│   ├── train-nfl-ridge.ts    # Phase 3
│   └── coefficients/
│       └── nfl-ridge.json    # Phase 3
├── signals/
│   ├── sharp-money.ts        # Phase 5
│   └── tournament.ts         # Phase 6
└── pick-engine.ts            # Modified throughout

tests/
├── unit/
│   ├── feature-flags.test.ts
│   ├── nfl-ridge.test.ts
│   ├── clv-engine.test.ts
│   ├── sharp-money.test.ts
│   └── tournament.test.ts
├── integration/
│   ├── pipeline.test.ts
│   ├── backtest.ts
│   ├── compare.ts
│   ├── tournament-backtest.ts
│   └── baseline.json
└── fixtures/
    └── mock-games.json

src/app/admin/
└── pipeline/
    └── page.tsx              # Monitoring dashboard
```

## Timeline Summary

| Phase | Days | Key Deliverable | Expected Win Rate |
|-------|------|-----------------|-------------------|
| 1: Foundation | 1-3 | Feature flags + monitoring + baseline | 41.8% (measured) |
| 2: Core Fixes | 4-7 | 4 bug fixes with measured impact | 48-52% |
| 3: NFL Ridge | 8-12 | Trained Ridge model for NFL | 50-54% |
| 4: CLV System | 13-17 | CLV tracking and optimization | 52-56% |
| 5: Market Intel | 18-22 | Sharp money signals | 54-58% |
| 6: Tournaments | 23-27 | March Madness ready | 56-60%+ |

**Total: 27 days → Target completion: March 14, 2026 (one day before Selection Sunday)**

---

## The Anti-Pattern We're Avoiding

> ❌ "Build 5 sophisticated systems in isolation, then try to wire them all together at the end"

> ✅ "Build one thing, prove it works in the pipeline, measure the improvement, then build the next thing"

Each phase builds on proven, integrated, measured improvements. No orphan code. No placeholder coefficients. No "we'll integrate it later."
