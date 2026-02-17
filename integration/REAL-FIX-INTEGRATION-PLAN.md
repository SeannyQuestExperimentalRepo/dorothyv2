# Real Fix Integration Plan — Phases 3-5

**Date:** February 15, 2026  
**Codebase:** `/home/seannyquest/trendline` (commit `28246c9`)  
**Engine:** `src/lib/pick-engine.ts` (3,090 lines, monolith)  
**Target:** March 15, 2026 (Selection Sunday)  
**Current Win Rate:** 41.8% → **Target: 60%+**

---

## ⚠️ Critical Finding

**Phases 2-5 were never implemented.** The `/home/seannyquest/.openclaw/workspace/dorothyv2/prompts/` directory contains detailed implementation prompts, but zero code was written. Every file referenced below (`clv-engine.ts`, `sharp-money.ts`, `nfl-ridge.ts`, etc.) **does not exist** in the actual trendline codebase. This plan covers building them from scratch and wiring them into the existing pipeline.

---

## 1. Current Pipeline Architecture

### `generateDailyPicks(dateStr, sport)` — Step by Step

```
1. Query UpcomingGame for date + sport
2. Check odds freshness (>12h = stale warning)
3. Load historical games (cached), determine current season
4. Fetch data sources by sport:
   - NCAAMB: KenPom ratings, FanMatch, point distribution, height/experience
   - NCAAF: CFBD SP+ ratings
   - NFL: NFL EPA + weather
   - NBA: Four Factors
5. For each game (batched by 4):
   a. Resolve canonical team names
   b. Build team stats (ATS, form, H2H)
   c. Discover trend angles (reverse lookup)
   d. Compute MODEL EDGE:
      - NCAAMB → computeKenPomEdge() [Ridge regression for O/U, KenPom spread model]
      - NCAAF → computeSPEdge() [SP+ based]
      - NFL/NBA → computePowerRatingEdge() [napkin math: avgMargin diff]
   e. Fetch supplemental signals (Elo, EPA, Four Factors, Barttorvik, weather)
   f. SPREAD: Collect 8-11 signals → computeConvergenceScore() → tier (85=5★, 70=4★)
   g. O/U: Collect 5-8 signals → convergence OR PIT tier gates (NCAAMB only)
   h. Props: NFL only (discoverProps)
6. Sort by trendScore, return
```

### Signal Weights (per sport × spread/OU)

All weight sets sum to 1.00. Key weights for NCAAMB spread:
- `modelEdge: 0.23` | `seasonATS: 0.15` | `trendAngles: 0.18` | `recentForm: 0.12`
- `h2h: 0.03` | `restDays: 0.05` | `marketEdge: 0.08` | `eloEdge: 0.05` | `barttorvik: 0.05` | `sizeExp: 0.05`

### Convergence Scoring (`computeConvergenceScore`)

- Iterates signals, multiplies each magnitude × weight for its category
- Sums home vs away weighted magnitudes
- Score = `50 + (winningSum - losingSum) * scaleFactor`
- Falls back to `weight = 0.1` for unmapped categories (latent bug)
- Returns: `{ score, direction, reasons[] }`

### Why Ridge Models Aren't Used (for NFL/NBA/NCAAF spreads)

Only NCAAMB O/U has a trained Ridge regression (4-feature PIT model). All other sports use `computePowerRatingEdge()` which is literal napkin math: `(avgMargin_home - avgMargin_away) / 2 + HCA_adjustment`. The Phase 3 prompts proposed Ridge models for NFL/NBA/NCAAF but they were never built.

### NCAAMB O/U PIT Tier Gates (bypass convergence scoring)

```typescript
5★: UNDER + absEdge ≥ 12 + avgTempo ≤ 64  (82.3% OOS)
4★: UNDER + absEdge ≥ 10                   (74.9% OOS)
3★: absEdge ≥ 9                            (68.0% OOS — no directional filter!)
```

The 3★ tier has no directional filter → systematic OVER bias from the Ridge model's coefficients.

---

## 2. Root Cause Analysis — Why 41.8%

| Problem | Impact | Root Cause |
|---|---|---|
| OVER bias in 3★ O/U | ~60% of O/U picks are OVER (losing) | 3★ tier has no directional filter; Ridge coefficients predict high |
| Spread picks at 25% | Destroys overall record | KenPom home-edge faded to 20% magnitude after November — too aggressive |
| NFL/NBA napkin math | No real model edge for 2 sports | `computePowerRatingEdge()` is `avgMargin diff / 2 + 2.5` |
| FanMatch name mismatch | MoneylineEdge signal dead for most NCAAMB | `game.homeTeam` (ESPN) ≠ KenPom names; never matches FanMatch |
| No tournament logic | Zero March Madness awareness | No seed, neutral site, or UNDER boost logic |

---

## 3. Integration Plan

### Phase A: Critical Fixes (Days 1-2) — Immediate Win Rate Impact

These are surgical fixes to existing code, no new files needed.

#### A.1: Fix OVER Bias in 3★ O/U Tier
**File:** `src/lib/pick-engine.ts` lines ~2710-2722  
**Change:** Add OVER edge threshold to 3★ tier gate

```typescript
// CURRENT (broken):
} else if (absEdge >= 9) {
  confidence = 3;
}

// FIXED:
} else if (absEdge >= 9) {
  // Require larger edge for OVER picks at 3★ (OVER bias mitigation)
  if (ouDir === 'over' && absEdge < 12) {
    confidence = 0; // reject marginal OVERs
  } else {
    confidence = 3;
  }
}
```

**Testing:**
- Backtest Feb 5-15 data: count OVER vs UNDER 3★ picks before/after
- Expected: ~40% fewer 3★ picks, but win rate should jump from ~55% to ~65%+
- Validate 5★ and 4★ tiers unaffected (already UNDER-only)

**Success Criteria:** O/U win rate ≥ 65% on backtest period

---

#### A.2: Reduce Spread Fade Aggression
**File:** `src/lib/pick-engine.ts` lines ~508-525  
**Change:** Increase home-edge multiplier from 0.2 → 0.5

```typescript
// CURRENT (too aggressive):
adjustedMagnitude *= 0.2;
adjustedConfidence = 0.3;

// FIXED:
adjustedMagnitude *= 0.5;
adjustedConfidence = 0.5;
```

**Testing:**
- Backtest spread picks before/after
- Expected: More valid spread picks generated, accuracy should improve from 25% → 45%+
- Monitor for false positives (home favorites covering too often)

**Success Criteria:** Spread ATS ≥ 50% on backtest period

---

#### A.3: Fix FanMatch Name Mismatch
**File:** `src/lib/pick-engine.ts` line ~2555  
**Change:** Use resolved canonical names instead of raw ESPN names

```typescript
// CURRENT (broken — ESPN names vs KenPom names):
const gameFM = kenpomFanMatch?.find(
  (f) => f.Home.toLowerCase() === game.homeTeam.toLowerCase() && ...
);

// FIXED — use canonHome/canonAway (already resolved above):
const gameFM = kenpomFanMatch?.find(
  (f) => f.Home.toLowerCase() === canonHome.toLowerCase() &&
         f.Visitor.toLowerCase() === canonAway.toLowerCase()
);
```

Wait — FanMatch uses KenPom names, and `canonHome` uses team-resolver canonical names. Need to check if they match. **Better fix:** Resolve FanMatch names through the same team-resolver at fetch time in `kenpom.ts`, or add a KenPom-name reverse lookup.

**Testing:**
- Log FanMatch match rate before/after fix
- Expected: Match rate from ~30% → 90%+ of NCAAMB games
- Verify moneylineEdge signal now produces non-null values

**Success Criteria:** FanMatch lookup succeeds for ≥ 90% of NCAAMB games

---

#### A.4: Fix Convergence Score Fallback Weight
**File:** `src/lib/pick-engine.ts` line ~1905  
**Change:** Log warning on fallback, use 0.0 instead of 0.1

```typescript
// CURRENT (silent 0.1 default):
const w = weights[signal.category] || 0.1;

// FIXED:
const w = weights[signal.category];
if (w === undefined) {
  console.warn(`[convergence] Unknown signal category: ${signal.category}`);
  continue; // skip unmapped signals instead of giving them phantom weight
}
```

**Testing:** Run pick generation, verify no warnings (all categories mapped)

---

### Phase B: Ridge Model Integration (Days 3-7)

#### B.1: NFL Ridge Regression Model
**Create:** `src/lib/nfl-ridge.ts`  
**Integration point:** Replace `computePowerRatingEdge()` call for NFL in `generateDailyPicks()`

**Architecture:**
```typescript
// src/lib/nfl-ridge.ts
export interface NFLRidgeFeatures {
  offEPA: number;          // Offensive EPA/play (rolling 5-game)
  defEPA: number;          // Defensive EPA/play (rolling 5-game)
  pace: number;            // Plays per game
  redZoneTD: number;       // Red zone TD conversion rate
  turnoverDiff: number;    // TO forced - TO committed
  thirdDownRate: number;   // 3rd down conversion %
  sackRate: number;        // Sacks per dropback
  explosivePlayRate: number; // 20+ yard plays per game
}

export function computeNFLRidgeEdge(
  homeFeatures: NFLRidgeFeatures,
  awayFeatures: NFLRidgeFeatures,
  spread: number | null,
  overUnder: number | null,
  week: number
): { spread: SignalResult; ou: SignalResult; ouMeta?: OUMeta } {
  // Ridge regression: predicted_spread = β₀ + Σ(βᵢ * featureᵢ)
  // Coefficients TBD — need training pipeline
}
```

**Training Pipeline:**
1. Export nflverse EPA data (already in `src/lib/nflverse.ts`)
2. Join with game results from NFLGame table
3. Train Ridge regression (λ=1000) on 3+ seasons
4. Validate with walk-forward backtest
5. Extract coefficients into the model file

**Integration in pick-engine.ts:**
```typescript
// In generateDailyPicks(), replace:
: computePowerRatingEdge(allGames, canonHome, canonAway, sport, currentSeason, game.spread, game.overUnder)

// With:
: sport === 'NFL'
  ? await computeNFLRidgeEdge(homeFeatures, awayFeatures, game.spread, game.overUnder, week)
  : computePowerRatingEdge(...)
```

**Pre-requisite:** Need to pre-fetch NFL features before the game loop (like KenPom ratings are pre-fetched for NCAAMB).

**Testing:**
- Backtest against 2024-25 NFL season results
- Compare Ridge predictions vs `computePowerRatingEdge` predictions
- Expected: ATS improvement from ~48% to ~53%+

**Success Criteria:** NFL Ridge ATS ≥ 52% on walk-forward backtest

---

#### B.2: NBA Ridge Regression Model
**Create:** `src/lib/nba-ridge.ts`  
**Integration point:** Same pattern as NFL — replace `computePowerRatingEdge()` for NBA

**Features:**
```typescript
export interface NBARidgeFeatures {
  offRating: number;       // Offensive rating (pts/100 poss)
  defRating: number;       // Defensive rating
  pace: number;            // Possessions per game
  efgPct: number;          // Effective FG%
  tovPct: number;          // Turnover %
  orbPct: number;          // Offensive rebound %
  ftRate: number;          // Free throw rate
  threeRate: number;       // 3PA / FGA
}
```

**Data source:** Already have `src/lib/nba-stats.ts` with Four Factors integration.

**Testing:** Same walk-forward methodology as NFL

**Success Criteria:** NBA Ridge ATS ≥ 52% on walk-forward backtest

---

#### B.3: NCAAF Ridge Regression Model
**Create:** `src/lib/ncaaf-ridge.ts`  
**Integration point:** Replace `computeSPEdge()` (or augment it — SP+ is already a reasonable model)

**Features:** SP+ components + tempo + recent form  
**Data source:** `src/lib/cfbd.ts` (CFBD API)

**Decision:** SP+ is already a semi-sophisticated model. Consider keeping SP+ as the primary model edge and adding a Ridge correction factor rather than replacing it entirely.

**Success Criteria:** NCAAF ATS ≥ 53% on walk-forward backtest

---

### Phase C: CLV Tracking (Days 5-9)

#### C.1: Database Schema Updates
**File:** `prisma/schema.prisma`

```prisma
// Add to DailyPick model:
model DailyPick {
  // ... existing fields ...
  openingLine     Float?     // Line at pick generation time
  closingLine     Float?     // Line at game start
  clvPoints       Float?     // Closing line value (closing - opening, adjusted for direction)
  clvCalculatedAt DateTime?  // When CLV was calculated
}

// New table for odds history:
model OddsHistory {
  id          String   @id @default(cuid())
  gameId      String   // UpcomingGame.id
  sport       String
  timestamp   DateTime @default(now())
  spread      Float?
  overUnder   Float?
  moneylineHome Int?
  moneylineAway Int?
  source      String   @default("odds-api")
  
  @@index([gameId, timestamp])
  @@index([sport, timestamp])
}
```

**Migration:** `npx prisma migrate dev --name add-clv-tracking`

---

#### C.2: CLV Engine
**Create:** `src/lib/clv-engine.ts`

```typescript
export interface CLVResult {
  clvPoints: number;      // Points of CLV (positive = got better number)
  clvDirection: 'positive' | 'negative' | 'neutral';
  openingLine: number;
  closingLine: number;
}

// Calculate CLV for a pick
export function calculateCLV(
  pickType: 'SPREAD' | 'OVER_UNDER',
  pickSide: string,        // 'home' | 'away' | 'over' | 'under'
  openingLine: number,
  closingLine: number
): CLVResult {
  // For SPREAD: if we took home -3 and it closed at -4, we got 1 point of CLV
  // For O/U: if we took UNDER 145 and it closed at 143, we got 2 points of CLV
  let clvPoints: number;
  
  if (pickType === 'SPREAD') {
    // Positive CLV = line moved in our direction after we picked
    clvPoints = pickSide === 'home'
      ? openingLine - closingLine  // home side: line going more negative = CLV
      : closingLine - openingLine; // away side: line going more positive = CLV
  } else {
    clvPoints = pickSide === 'under'
      ? openingLine - closingLine  // under: total dropping = CLV
      : closingLine - openingLine; // over: total rising = CLV
  }
  
  return {
    clvPoints,
    clvDirection: clvPoints > 0.5 ? 'positive' : clvPoints < -0.5 ? 'negative' : 'neutral',
    openingLine,
    closingLine,
  };
}
```

**Integration Points:**

1. **At pick generation** (`generateDailyPicks`): Store `openingLine` on each pick
2. **At game start** (new cron or existing grading cron): Fetch closing line, calculate CLV
3. **At grading** (`gradeYesterdaysPicks`): Include CLV in grading output

**Implementation in pick-engine.ts:**
```typescript
// In the picks.push() calls, add:
openingLine: game.spread,  // or game.overUnder for O/U picks
```

**Batch CLV Calculation (new function):**
```typescript
export async function calculatePickCLV(): Promise<{ updated: number }> {
  // Find picks where closingLine is null and game has started
  // Fetch latest odds from OddsHistory
  // Calculate CLV and update picks
}
```

---

#### C.3: Odds History Tracking
**Create:** `src/lib/odds-monitor.ts`

```typescript
export async function snapshotCurrentOdds(sport: Sport): Promise<number> {
  // Fetch current odds from odds API
  // Store in OddsHistory table
  // Return count of snapshots taken
}
```

**Integration:** Add to cron pipeline — snapshot odds every 2 hours for upcoming games.

---

### Phase D: Market Intelligence (Days 8-12)

#### D.1: Sharp Money Detection
**Create:** `src/lib/sharp-money.ts`

**Core Logic:**
```typescript
export interface SharpMoneySignal {
  isSharpAction: boolean;
  direction: 'home' | 'away' | 'over' | 'under';
  confidence: number;       // 0-1
  indicators: string[];     // Which indicators triggered
}

export function detectSharpMoney(
  oddsHistory: OddsHistory[],  // Time-series of odds for this game
  publicBettingPct?: { home: number; away: number }
): SharpMoneySignal {
  const indicators: string[] = [];
  
  // Indicator 1: Reverse line movement (line moves against public)
  // If 70% on home but line moves toward away → sharp money on away
  
  // Indicator 2: Steam move (sudden large move in short time)
  // >1 point move in <30 minutes
  
  // Indicator 3: Line freeze (heavy public action but line doesn't move)
  // Books are balancing with sharp counter-action
  
  // Return signal with confidence
}
```

**Integration in pick-engine.ts:**
```typescript
// Add as new signal in spreadSignals array:
const sharpSignal = await detectSharpMoney(oddsHistory, publicPcts);
if (sharpSignal) spreadSignals.push({
  category: 'sharpMoney',
  magnitude: sharpSignal.confidence * 0.8,
  direction: sharpSignal.direction,
  confidence: sharpSignal.confidence,
  label: `Sharp money detected: ${sharpSignal.indicators.join(', ')}`,
});
```

**Weight allocation:** Add `sharpMoney` to weight maps. Suggested weight: 0.10. Reduce `trendAngles` from 0.18 → 0.13 and `seasonATS` from 0.15 → 0.10 to make room.

**Updated NCAAMB Spread Weights:**
```typescript
NCAAMB: {
  modelEdge: 0.23,    // unchanged
  seasonATS: 0.10,    // was 0.15
  trendAngles: 0.13,  // was 0.18
  recentForm: 0.12,   // unchanged
  h2h: 0.03,          // unchanged
  restDays: 0.05,     // unchanged
  marketEdge: 0.08,   // unchanged
  eloEdge: 0.05,      // unchanged
  barttorvik: 0.05,   // unchanged
  sizeExp: 0.05,      // unchanged
  sharpMoney: 0.06,   // NEW
  publicBias: 0.05,   // NEW
}
```

---

#### D.2: Public Bias Detection
**Create:** `src/lib/public-bias.ts`

```typescript
export function detectPublicBias(
  publicBettingPct: { home: number; away: number },
  spread: number,
  sport: Sport
): SignalResult {
  // Public tends to bet favorites, overs, and big-name teams
  // Fading heavy public action (>70% one side) is historically profitable
  // Signal direction = opposite of heavy public side
  
  const heavySide = publicBettingPct.home > 70 ? 'home' : 
                    publicBettingPct.away > 70 ? 'away' : null;
  
  if (!heavySide) return nullSignal;
  
  const fadeSide = heavySide === 'home' ? 'away' : 'home';
  const pctSkew = Math.max(publicBettingPct.home, publicBettingPct.away);
  
  return {
    category: 'publicBias',
    magnitude: (pctSkew - 65) / 35, // scale 65-100% to 0-1
    direction: fadeSide,
    confidence: Math.min(0.7, (pctSkew - 60) / 40),
    label: `Public bias: ${pctSkew}% on ${heavySide}, fading to ${fadeSide}`,
  };
}
```

**Data Source:** Need public betting percentages. Options:
1. Action Network API (paid)
2. Scrape from free sites (fragile)
3. Estimate from line movement vs. expected movement (feasible with odds history)

---

#### D.3: Market Timing
**Create:** `src/lib/market-timing.ts`

```typescript
export function getOptimalPickTiming(
  sport: Sport,
  gameDate: Date,
  oddsHistory: OddsHistory[]
): { isOptimalWindow: boolean; reason: string } {
  // NFL: Best value Sunday morning (line solidified, sharps done)
  // NCAAMB: Best value 2-4 hours before tip (steam moves complete)
  // NBA: Best value afternoon (injury reports finalized)
  
  const hoursToGame = (gameDate.getTime() - Date.now()) / (1000 * 60 * 60);
  
  // If line has been stable for 4+ hours, it's likely fair
  // If line just moved, wait for settlement
}
```

**Integration:** Use as a confidence modifier, not a filter. Games in optimal timing window get +5% convergence score boost.

---

### Phase E: Dynamic Systems (Days 10-14)

#### E.1: Dynamic HCA Tracker
**Create:** `src/lib/hca-tracker.ts`

```typescript
export interface DynamicHCA {
  sport: Sport;
  team: string;
  hcaPoints: number;      // Dynamic HCA value
  sampleSize: number;
  lastUpdated: Date;
}

export async function getDynamicHCA(
  sport: Sport,
  team: string,
  season: string
): Promise<number> {
  // Calculate actual HCA from this season's results
  // home_margin - away_margin for this team
  // Regress toward league average HCA based on sample size
  // Return blended HCA value
  
  const leagueHCA = { NFL: 2.5, NBA: 3.0, NCAAMB: 3.5, NCAAF: 3.0 };
  // ... query team's home/away splits this season
  // ... Bayesian regression toward league average
}
```

**Integration:** Replace static HCA constants in `computePowerRatingEdge()` and `computeKenPomEdge()` with dynamic values.

**Current static values in pick-engine.ts:**
```typescript
const HCA = { NFL: 2.5, NBA: 3.2, NCAAMB: 3.5, NCAAF: 3.0 };
```

Replace with: `const hca = await getDynamicHCA(sport, canonHome, currentSeason);`

---

#### E.2: Signal Weight Optimizer
**Create:** `src/lib/signal-optimizer.ts`

```typescript
export async function optimizeWeights(
  sport: Sport,
  pickType: 'SPREAD' | 'OVER_UNDER',
  lookbackDays: number = 30
): Promise<Record<string, number>> {
  // 1. Query graded picks from last N days with their signal breakdowns
  // 2. For each signal category, calculate:
  //    - Hit rate when signal agreed with outcome
  //    - CLV contribution when signal was strongest
  // 3. Adjust weights proportional to predictive value
  // 4. Normalize to sum to 1.0
  // 5. Apply Bayesian shrinkage toward current weights (prevent overfit)
}
```

**Integration:** Run weekly via cron. Store optimized weights in DB. Load at pick generation time.

**Constraint:** Weight changes capped at ±0.03 per week to prevent whiplash.

**Pre-requisite:** CLV tracking (Phase C) must be live first — need CLV data to optimize.

---

#### E.3: Tournament Logic
**File:** `src/lib/pick-engine.ts` (inline, or new `src/lib/tournament.ts`)

```typescript
export interface TournamentContext {
  isTournament: boolean;
  round?: number;           // 1-6 for March Madness
  seedHome?: number;
  seedAway?: number;
  isNeutralSite: boolean;
  seedMismatch?: number;    // abs(seedHome - seedAway)
  conference?: string;      // Conference tournament name
}

export function getTournamentAdjustments(
  ctx: TournamentContext,
  sport: Sport
): { underBoost: number; spreadAdj: number; hcaOverride?: number } {
  if (!ctx.isTournament || sport !== 'NCAAMB') {
    return { underBoost: 0, spreadAdj: 0 };
  }
  
  let underBoost = 0;
  let spreadAdj = 0;
  
  // 1. UNDER bias in tournament (historically profitable)
  underBoost += 0.15; // boost UNDER magnitude by 15%
  
  // 2. Seed mismatch (12-5, 11-6 upsets)
  if (ctx.seedMismatch && ctx.seedMismatch >= 5) {
    spreadAdj += 0.10; // boost underdog magnitude
  }
  
  // 3. Neutral site = zero HCA
  const hcaOverride = ctx.isNeutralSite ? 0 : undefined;
  
  // 4. Late rounds (Elite 8+) → even more UNDER
  if (ctx.round && ctx.round >= 4) {
    underBoost += 0.10;
  }
  
  return { underBoost, spreadAdj, hcaOverride };
}
```

**Integration in pick-engine.ts:**
1. Before model edge computation: detect tournament context
2. Apply HCA override to model edge calculation
3. After O/U convergence: apply UNDER boost to magnitude
4. After spread convergence: apply seed mismatch adjustment

**Tournament Detection:**
```typescript
function detectTournament(game: UpcomingGame): TournamentContext {
  const month = game.gameDate.getMonth() + 1; // 1-indexed
  const isNeutral = game.isNeutralSite ?? false;
  
  // March Madness: mid-March through early April, neutral site
  const isMarchMadness = (month === 3 && game.gameDate.getDate() >= 15) || 
                          (month === 4 && game.gameDate.getDate() <= 7);
  
  // Conference tournaments: early-mid March, neutral site
  const isConfTourney = month === 3 && game.gameDate.getDate() < 15 && isNeutral;
  
  return {
    isTournament: (isMarchMadness || isConfTourney) && isNeutral,
    isNeutralSite: isNeutral,
    // Seeds: parse from game.homeRank / game.awayRank if available
    seedHome: game.homeRank ?? undefined,
    seedAway: game.awayRank ?? undefined,
    seedMismatch: (game.homeRank && game.awayRank) 
      ? Math.abs(game.homeRank - game.awayRank) : undefined,
  };
}
```

---

### Phase F: Architecture & Performance (Days 12-16)

#### F.1: Split Cron Architecture
**Current:** Single monolithic cron at `src/app/api/cron/daily-sync/route.ts`  
**Problem:** 300-second timeout, one failure blocks all, no retry logic

**New cron routes:**
```
src/app/api/cron/sync-games/route.ts      — Refresh upcoming games from ESPN
src/app/api/cron/sync-completed/route.ts   — Sync completed game results
src/app/api/cron/generate-picks/route.ts   — Generate daily picks
src/app/api/cron/grade-picks/route.ts      — Grade yesterday's picks
src/app/api/cron/grade-bets/route.ts       — Grade pending bets
src/app/api/cron/snapshot-odds/route.ts    — Snapshot current odds (for CLV)
src/app/api/cron/calculate-clv/route.ts    — Calculate CLV for graded picks
src/app/api/cron/optimize-weights/route.ts — Weekly weight optimization
```

**Vercel cron schedule (`vercel.json`):**
```json
{
  "crons": [
    { "path": "/api/cron/sync-games",      "schedule": "0 11,17,21 * * *" },
    { "path": "/api/cron/sync-completed",   "schedule": "15 11,17,21 * * *" },
    { "path": "/api/cron/generate-picks",   "schedule": "30 11,17,21 * * *" },
    { "path": "/api/cron/grade-picks",      "schedule": "45 11 * * *" },
    { "path": "/api/cron/grade-bets",       "schedule": "50 11 * * *" },
    { "path": "/api/cron/snapshot-odds",    "schedule": "0 */2 * * *" },
    { "path": "/api/cron/calculate-clv",    "schedule": "0 12 * * *" },
    { "path": "/api/cron/optimize-weights", "schedule": "0 10 * * 1" }
  ]
}
```

**Each cron route pattern:**
```typescript
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  try {
    const result = await specificTask();
    return Response.json({ success: true, ...result });
  } catch (error) {
    captureException(error);
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}
```

---

#### F.2: Caching Layer
**Create:** `src/lib/cache.ts`

```typescript
// Simple in-memory cache with TTL (no Redis dependency for Vercel)
const cache = new Map<string, { value: any; expires: number }>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}
```

**Integration:** Already partially implemented (KenPom ratings cached for 6h). Extend to:
- Team stats: cache for 2h per sport+season
- Elo ratings: cache for 6h
- Barttorvik data: cache for 6h

---

#### F.3: Monitoring
**Create:** `src/lib/monitoring.ts`

```typescript
export interface PickGenerationMetrics {
  sport: Sport;
  date: string;
  gamesProcessed: number;
  picksGenerated: number;
  avgConvergenceScore: number;
  confidenceDistribution: Record<number, number>; // { 5: 3, 4: 8, 3: 15 }
  signalCoverage: Record<string, number>;          // { modelEdge: 0.95, elo: 0.88, ... }
  executionTimeMs: number;
}

export function logPickGenerationMetrics(metrics: PickGenerationMetrics): void {
  console.log(`[monitoring] ${JSON.stringify(metrics)}`);
  // Optionally send to external monitoring (Datadog, etc.)
}
```

**Integration:** Wrap `generateDailyPicks()` with timing and metric collection.

---

## 4. Implementation Priority Matrix

| Priority | Task | Impact | Effort | Dependencies |
|---|---|---|---|---|
| **P0** | A.1: Fix OVER bias | **HIGH** | 30 min | None |
| **P0** | A.2: Reduce spread fade | **HIGH** | 30 min | None |
| **P0** | A.3: Fix FanMatch names | **MEDIUM** | 1 hour | None |
| **P0** | A.4: Fix fallback weight | **LOW** | 15 min | None |
| **P1** | E.3: Tournament logic | **HIGH** | 4-6 hours | None |
| **P1** | C.1: CLV schema | **MEDIUM** | 1 hour | None |
| **P1** | C.2: CLV engine | **MEDIUM** | 3 hours | C.1 |
| **P2** | B.1: NFL Ridge model | **HIGH** | 8-12 hours | Training data |
| **P2** | B.2: NBA Ridge model | **HIGH** | 8-12 hours | Training data |
| **P2** | C.3: Odds monitoring | **MEDIUM** | 3 hours | C.1 |
| **P3** | D.1: Sharp money | **MEDIUM** | 6-8 hours | C.3 |
| **P3** | D.2: Public bias | **MEDIUM** | 4-6 hours | Data source TBD |
| **P3** | E.1: Dynamic HCA | **MEDIUM** | 4 hours | None |
| **P4** | F.1: Split crons | **LOW** | 4 hours | None |
| **P4** | D.3: Market timing | **LOW** | 3 hours | C.3 |
| **P4** | E.2: Signal optimizer | **LOW** | 6 hours | CLV data (30 days) |
| **P5** | F.2: Caching | **LOW** | 2 hours | None |
| **P5** | F.3: Monitoring | **LOW** | 2 hours | None |
| **P5** | B.3: NCAAF Ridge | **LOW** | 8 hours | Off-season |

---

## 5. Testing Strategy

### Unit Tests (Create Before Any Changes)
```
tests/unit/convergence-score.test.ts   — Test computeConvergenceScore with known inputs
tests/unit/tier-gates.test.ts          — Test O/U tier gate logic
tests/unit/clv-engine.test.ts          — Test CLV calculation
tests/unit/tournament.test.ts          — Test tournament detection and adjustments
tests/unit/sharp-money.test.ts         — Test sharp money detection
```

### Backtest Validation
For each change:
1. Run `generateDailyPicks()` for Feb 5-15 (10-day backtest period)
2. Compare picks before/after change
3. Grade against actual results
4. Calculate: win rate, CLV, confidence tier accuracy

### A/B Testing (Production)
- Feature flags for each integration:
  ```typescript
  const FEATURE_FLAGS = {
    USE_NFL_RIDGE: process.env.FF_NFL_RIDGE === 'true',
    USE_SHARP_MONEY: process.env.FF_SHARP_MONEY === 'true',
    USE_TOURNAMENT_LOGIC: process.env.FF_TOURNAMENT === 'true',
    USE_DYNAMIC_HCA: process.env.FF_DYNAMIC_HCA === 'true',
    USE_CLV_TRACKING: process.env.FF_CLV === 'true',
    OVER_BIAS_FIX: process.env.FF_OVER_FIX === 'true',
  };
  ```
- Enable one feature at a time, monitor for 3+ days
- Rollback if win rate drops

---

## 6. Success Metrics

| Metric | Current | Week 1 Target | Week 2 Target | Final Target |
|---|---|---|---|---|
| Overall Win Rate | 41.8% | 52%+ | 55%+ | 60%+ |
| 5★ Accuracy | Unknown | 70%+ | 72%+ | 75%+ |
| 4★ Accuracy | Unknown | 60%+ | 63%+ | 65%+ |
| 3★ Accuracy | Unknown | 55%+ | 57%+ | 58%+ |
| O/U OVER Ratio | ~60% | 45-55% | 45-55% | 45-55% |
| Spread ATS | 25% | 48%+ | 50%+ | 53%+ |
| CLV (avg) | N/A | Tracked | +0.3 pts | +0.5 pts |
| Signal Coverage | ~70% | 80%+ | 90%+ | 95%+ |
| Features Active | 0/12 | 4/12 | 8/12 | 12/12 |

---

## 7. Timeline

### Week 1 (Feb 16-22): Critical Fixes + Foundation
- **Day 1:** P0 fixes (A.1-A.4) — immediate win rate improvement
- **Day 2:** Tournament logic (E.3) — March readiness
- **Day 3:** CLV schema + engine (C.1-C.2) — start tracking
- **Day 4-5:** Unit tests for all changes
- **Day 6-7:** Backtest validation, iterate thresholds

### Week 2 (Feb 23-Mar 1): Model Accuracy + Market Signals
- **Day 8-9:** NFL Ridge model (B.1) — training + integration
- **Day 10-11:** NBA Ridge model (B.2)
- **Day 12:** Odds monitoring (C.3) + Sharp money (D.1) start
- **Day 13-14:** Dynamic HCA (E.1) + Public bias (D.2)

### Week 3 (Mar 2-8): Architecture + Conference Tournaments
- **Day 15:** Split cron architecture (F.1)
- **Day 16:** Caching + monitoring (F.2, F.3)
- **Day 17:** Market timing (D.3)
- **Day 18-19:** Conference tournament validation (live games!)
- **Day 20-21:** Performance tuning, threshold adjustments

### Week 4 (Mar 9-15): Final Prep
- **Day 22-24:** Comprehensive backtest with all features enabled
- **Day 25-26:** Signal optimizer initial run (E.2) if CLV data sufficient
- **Day 27-28:** Final threshold tuning, feature flag review
- **Mar 15:** Selection Sunday — system ready

---

## 8. Risk Mitigation

### Rollback Procedures
Each integration has a feature flag. Rollback = set env var to `false` and redeploy.

```bash
# Emergency rollback (Vercel)
vercel env rm FF_SHARP_MONEY production
vercel --prod
```

### Known Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Ridge models overfit | Medium | High | Walk-forward validation, regularization (λ=1000) |
| Public betting data unavailable | High | Medium | Estimate from line movement instead |
| CLV calculation errors | Low | Medium | Unit tests + manual spot-checks |
| Cron timeout on split routes | Low | Low | Each route is <60s, well under Vercel limits |
| Tournament detection false positives | Medium | Medium | Whitelist known tournament dates/venues |
| Weight optimization instability | Medium | High | Cap changes at ±0.03/week, Bayesian shrinkage |

### Safeguards
- **No changes to production without passing backtest** (win rate must not decrease)
- **Feature flags for every new integration** — gradual rollout
- **Daily monitoring** of pick performance during integration
- **Automated alerts** if win rate drops below 45% for any 3-day window

---

## 9. File Manifest — What Gets Created/Modified

### New Files (13)
```
src/lib/nfl-ridge.ts           — NFL Ridge regression model
src/lib/nba-ridge.ts           — NBA Ridge regression model
src/lib/clv-engine.ts          — CLV calculation engine
src/lib/odds-monitor.ts        — Odds history tracking
src/lib/sharp-money.ts         — Sharp money detection
src/lib/public-bias.ts         — Public bias detection
src/lib/market-timing.ts       — Market timing signals
src/lib/hca-tracker.ts         — Dynamic HCA tracking
src/lib/signal-optimizer.ts    — CLV-based weight optimization
src/lib/tournament.ts          — Tournament detection + adjustments
src/lib/cache.ts               — Caching layer
src/lib/monitoring.ts          — Pick generation metrics
src/app/api/cron/snapshot-odds/route.ts  — Odds snapshot cron
```

### Modified Files (4)
```
src/lib/pick-engine.ts         — Integration points for all new features
prisma/schema.prisma           — CLV fields + OddsHistory table
src/app/api/cron/daily-sync/route.ts  — Split into separate routes
vercel.json                    — New cron schedules
```

### Test Files (5)
```
tests/unit/convergence-score.test.ts
tests/unit/tier-gates.test.ts
tests/unit/clv-engine.test.ts
tests/unit/tournament.test.ts
tests/unit/sharp-money.test.ts
```

---

## 10. Quick Start — What to Do Right Now

**Estimated time to first measurable improvement: 2 hours**

```bash
cd /home/seannyquest/trendline

# Step 1: Fix OVER bias (30 min)
# Edit src/lib/pick-engine.ts lines ~2710-2722
# Add: if (ouDir === 'over' && absEdge < 12) confidence = 0;

# Step 2: Reduce spread fade (30 min)
# Edit src/lib/pick-engine.ts lines ~508-525
# Change: 0.2 → 0.5 magnitude, 0.3 → 0.5 confidence

# Step 3: Fix FanMatch names (30 min)
# Edit src/lib/pick-engine.ts line ~2555
# Use canonHome/canonAway instead of game.homeTeam/game.awayTeam

# Step 4: Fix convergence fallback (15 min)
# Edit src/lib/pick-engine.ts line ~1905
# Change: || 0.1 → log warning + skip

# Step 5: Backtest
npx ts-node analysis/quick-10day-backtest.ts

# Step 6: Deploy
git add -A && git commit -m "fix: OVER bias, spread fade, FanMatch names, convergence fallback"
vercel --prod
```

These four fixes alone should push win rate from **41.8% → 52-55%** based on the root cause analysis. Everything else is optimization on top of a working foundation.
