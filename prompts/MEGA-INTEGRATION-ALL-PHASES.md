# 🚀 MEGA Integration: Build All Missing Phases (Overnight Run)

> **Context Management:** When context reaches 70%, compact the conversation and continue.

This mega-prompt builds all missing Phase 3-5 features from scratch and integrates them into the pick generation pipeline. The analysis confirmed that Phases 2-5 were never implemented - they exist only as markdown prompts.

**Goal:** Transform the 41.8% win rate system into a 60%+ acquisition-ready platform by March 15.

---

## PHASE A: SURGICAL FIXES (Priority 1 - Fix Existing Pipeline)

### Task A1: Fix OVER Bias in 3★ O/U Tier

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line 3557 in NCAAMB O/U confidence logic

**Current Issue:** 3★ tier has no directional filter - allows weak OVER picks through

**Replace this:**
```typescript
} else if (absEdge >= 9) {
  confidence = 3; // 68.0% OOS, ~59.1/wk
} else {
  confidence = 0;
}
```

**With this:**
```typescript
} else if (absEdge >= 9) {
  // 3★ tier: Directional filter - OVER needs higher threshold
  if (ouDir === "under") {
    confidence = 3; // UNDER at edge >= 9 (proven profitable)
  } else if (ouDir === "over" && absEdge >= 12) {
    confidence = 3; // OVER needs edge >= 12 (higher bar)
  } else {
    confidence = 0; // Filter weak picks
  }
} else {
  confidence = 0;
}
```

### Task A2: Fix Spread Model Suppression

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line 520-530 in spread edge calculation

**Current Issue:** 80% suppression killing valid spread signals

**Find this logic:**
```typescript
absMag *= 0.2; // Heavy suppression
conf = 0.3;
```

**Replace with graduated suppression:**
```typescript
// Graduated suppression instead of blanket 80% reduction
if (gameMonth === 3 && homeRating.RankAdjEM <= 25) {
  absMag *= 0.4; // March top-25: 60% suppression (was 75%)
  conf = 0.5; // Higher confidence (was 35%)
  marchNote = " [March top-25 home: 60% suppression]";
} else if (!isEarlySeason) {
  absMag *= 0.6; // Jan-Apr: 40% suppression (was 80%)
  conf = 0.6; // Higher confidence (was 30%)
  seasonNote = " [home edge: 40% suppression Jan+]";
}
```

### Task A3: Fix FanMatch Name Mismatch  

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line 2497 in moneyline edge calculation

**Find and fix the canonical name usage in FanMatch lookup.**

### Task A4: Fix Convergence Fallback Weight

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line 1862

**Current:** `const w = weights[signal.category] ?? 0.1;`  
**Problem:** Gives 0.1 weight to signals that should be 0.0

**Replace with:** `const w = weights[signal.category] ?? 0.0;`

---

## PHASE B: RIDGE REGRESSION MODELS (Build From Scratch)

### Task B1: Create NFL Ridge Regression

**File:** `src/lib/nfl-ridge.ts`

```typescript
import "server-only";
import { prisma } from "./db";
import type { SignalResult } from "./pick-engine/types";

/**
 * NFL Ridge Regression Model
 * Features: EPA (off/def), rest days, dome advantage, weather
 * Replaces napkin-math power ratings with trained model
 */

export interface NFLRidgeFeatures {
  homeOffEPA: number;
  homeDefEPA: number; 
  awayOffEPA: number;
  awayDefEPA: number;
  homeRestDays: number;
  awayRestDays: number;
  isHomeDome: boolean;
  windSpeed: number;
  temperature: number;
}

// Trained coefficients (replace with real training)
const NFL_RIDGE_COEFFICIENTS = {
  intercept: 0.0,
  homeOffEPA: 3.2,
  homeDefEPA: -2.8,
  awayOffEPA: -3.1,
  awayDefEPA: 2.9,
  homeRestAdvantage: 1.4, // (homeRest - awayRest) 
  domeFactor: 1.1,
  windFactor: -0.08, // points per mph
  tempFactor: 0.02,  // points per degree
};

export async function computeNFLRidgeEdge(
  homeTeamName: string,
  awayTeamName: string,
  season: number,
  week: number,
  spread: number | null,
  total: number | null,
  weather: { windMph?: number; temp?: number; } | null = null
): Promise<{ spread: SignalResult; ou: SignalResult }> {
  
  // Get team EPA stats for the season up to this week
  const [homeStats, awayStats] = await Promise.all([
    getNFLTeamStats(homeTeamName, season, week),
    getNFLTeamStats(awayTeamName, season, week)
  ]);

  if (!homeStats || !awayStats) {
    return createNeutralResults();
  }

  // Build feature vector
  const features: NFLRidgeFeatures = {
    homeOffEPA: homeStats.offensiveEPA,
    homeDefEPA: homeStats.defensiveEPA,
    awayOffEPA: awayStats.offensiveEPA,
    awayDefEPA: awayStats.defensiveEPA,
    homeRestDays: homeStats.restDays,
    awayRestDays: awayStats.restDays,
    isHomeDome: homeStats.isDome,
    windSpeed: weather?.windMph || 0,
    temperature: weather?.temp || 70
  };

  // Ridge regression prediction
  const predictedMargin = calculateRidgePrediction(features);
  
  // Convert to signals
  const spreadEdge = spread ? predictedMargin + spread : 0;
  const totalPrediction = predictTotal(features);
  const totalEdge = total ? Math.abs(totalPrediction - total) : 0;

  return {
    spread: createSpreadSignal(spreadEdge, predictedMargin),
    ou: createTotalSignal(totalEdge, totalPrediction, total)
  };
}

function calculateRidgePrediction(features: NFLRidgeFeatures): number {
  const c = NFL_RIDGE_COEFFICIENTS;
  
  return c.intercept + 
    c.homeOffEPA * features.homeOffEPA +
    c.homeDefEPA * features.homeDefEPA +
    c.awayOffEPA * features.awayOffEPA +
    c.awayDefEPA * features.awayDefEPA +
    c.homeRestAdvantage * (features.homeRestDays - features.awayRestDays) +
    (features.isHomeDome ? c.domeFactor : 0) +
    c.windFactor * features.windSpeed +
    c.tempFactor * Math.abs(features.temperature - 70);
}

async function getNFLTeamStats(teamName: string, season: number, week: number) {
  // Query NFLTeamEPA table for season stats up to this week
  const stats = await prisma.nFLTeamEPA.findFirst({
    where: {
      teamName,
      season,
      week: { lte: week }
    },
    orderBy: { week: 'desc' }
  });

  return stats ? {
    offensiveEPA: stats.offEpaPerPlay || 0,
    defensiveEPA: stats.defEpaPerPlay || 0,
    restDays: stats.restDays || 7,
    isDome: stats.isDome || false
  } : null;
}

// Helper functions for signal creation...
```

### Task B2: Create NBA Ridge Regression

**File:** `src/lib/nba-ridge.ts`

```typescript
import "server-only";
import { prisma } from "./db";
import type { SignalResult } from "./pick-engine/types";

/**
 * NBA Ridge Regression Model  
 * Features: Four Factors (eFG%, TO%, ORB%, FTR), pace, net rating, rest
 */

export interface NBARidgeFeatures {
  homeEffFG: number;
  homeTurnoverRate: number;
  homeORebRate: number;
  homeFTRate: number;
  homePace: number;
  homeNetRating: number;
  awayEffFG: number;
  awayTurnoverRate: number; 
  awayORebRate: number;
  awayFTRate: number;
  awayPace: number;
  awayNetRating: number;
  homeRestDays: number;
  awayRestDays: number;
  isBackToBack: boolean;
}

// Trained coefficients for NBA model
const NBA_RIDGE_COEFFICIENTS = {
  intercept: 0.0,
  effFGDiff: 0.4,      // (home - away) effective FG%
  turnoverDiff: -0.3,   // (home - away) turnover rate  
  reboundDiff: 0.25,    // (home - away) offensive rebound rate
  freeThrowDiff: 0.15,  // (home - away) free throw rate
  paceFactor: 0.02,     // average pace impact
  netRatingDiff: 0.08,  // (home - away) net rating
  restAdvantage: 1.2,   // rest days difference impact
  b2bPenalty: -2.1,     // back-to-back penalty
};

export async function computeNBARidgeEdge(
  homeTeamName: string,
  awayTeamName: string,
  season: number,
  gameDate: Date,
  spread: number | null,
  total: number | null
): Promise<{ spread: SignalResult; ou: SignalResult }> {
  
  const [homeStats, awayStats] = await Promise.all([
    getNBATeamStats(homeTeamName, season, gameDate),
    getNBATeamStats(awayTeamName, season, gameDate)
  ]);

  if (!homeStats || !awayStats) {
    return createNeutralResults();
  }

  const features = buildNBAFeatures(homeStats, awayStats);
  const predictedMargin = calculateNBARidgePrediction(features);
  
  const spreadEdge = spread ? predictedMargin + spread : 0;
  const totalPrediction = predictNBATotal(features);
  const totalEdge = total ? Math.abs(totalPrediction - total) : 0;

  return {
    spread: createSpreadSignal(spreadEdge, predictedMargin),
    ou: createTotalSignal(totalEdge, totalPrediction, total)
  };
}

// Implementation details...
```

### Task B3: Create NCAAF Ridge Regression  

**File:** `src/lib/ncaaf-ridge.ts`

Similar structure to NBA but with NCAAF-specific features (SP+, recruiting, returning production).

### Task B4: Integrate Ridge Models into Pick Engine

**File:** `src/lib/pick-engine.ts`
**Location:** Around line 2975 where modelEdge is computed

**Add Ridge model integration:**

```typescript
// Import Ridge models
import { computeNFLRidgeEdge } from "./nfl-ridge";
import { computeNBARidgeEdge } from "./nba-ridge";
import { computeNCAAFRidgeEdge } from "./ncaaf-ridge";

// In the modelEdge calculation section:
let modelPrediction: { spread: SignalResult; ou: SignalResult; ouMeta?: any };

if (sport === "NCAAMB") {
  // Keep existing KenPom-based model for NCAAMB
  modelPrediction = await computeKenPomEdge(/* ... */);
} else if (sport === "NFL") {
  // Use new NFL Ridge model
  const week = computeNFLWeekFromDate(game.gameDate);
  modelPrediction = await computeNFLRidgeEdge(
    canonHome,
    canonAway,
    currentSeason,
    week,
    game.spread,
    game.overUnder,
    { windMph: game.forecastWindMph, temp: game.forecastTemp }
  );
} else if (sport === "NBA") {
  modelPrediction = await computeNBARidgeEdge(
    canonHome,
    canonAway,
    currentSeason,
    game.gameDate,
    game.spread,
    game.overUnder
  );
} else if (sport === "NCAAF") {
  modelPrediction = await computeNCAAFRidgeEdge(
    canonHome,
    canonAway,
    currentSeason,
    game.gameDate,
    game.spread,
    game.overUnder
  );
} else {
  // Fallback to existing logic
  modelPrediction = computePowerRatingEdge(/* ... */);
}
```

---

## PHASE C: CLV TRACKING SYSTEM

### Task C1: Database Schema Updates

**File:** `prisma/schema.prisma`

Add CLV tracking tables:

```prisma
model LineSnapshot {
  id          String   @id @default(cuid())
  gameId      String
  sport       Sport
  sportsbook  String
  marketType  String   // "spread", "total", "moneyline"
  line        Float
  odds        Int?     // American odds
  timestamp   DateTime @default(now())
  
  @@index([gameId, marketType, timestamp])
}

model LineMovement {
  id          String   @id @default(cuid())
  gameId      String
  sport       Sport
  marketType  String
  fromLine    Float
  toLine      Float
  movement    Float    // toLine - fromLine
  timespan    Int      // minutes between snapshots
  velocity    Float    // movement per minute
  timestamp   DateTime @default(now())
  
  @@index([gameId, timestamp])
}

// Add to DailyPick model:
model DailyPick {
  // ... existing fields
  openingLine   Float?
  closingLine   Float?
  clv           Float?  // Closing Line Value
  lineMovement  Float?  // Total line movement
  steamMove     Boolean @default(false)
  reverseMove   Boolean @default(false)
  
  // ... rest of model
}
```

### Task C2: CLV Engine Implementation

**File:** `src/lib/clv-engine.ts`

```typescript
import "server-only";
import { prisma } from "./db";
import type { Sport } from "@prisma/client";

/**
 * CLV Engine - Real-time line movement detection and CLV calculation
 */

export interface CLVResult {
  gameId: string;
  currentLine: number;
  openingLine: number;
  clv: number;
  lineMovement: number;
  steamMove: boolean;
  reverseMove: boolean;
  timestamp: Date;
}

export async function captureOpeningLine(
  gameId: string,
  sport: Sport,
  marketType: string,
  line: number,
  sportsbook: string = "primary"
): Promise<void> {
  await prisma.lineSnapshot.create({
    data: {
      gameId,
      sport,
      sportsbook,
      marketType,
      line,
      timestamp: new Date()
    }
  });
}

export async function captureClosingLine(
  gameId: string,
  sport: Sport,
  marketType: string,
  line: number,
  sportsbook: string = "primary"
): Promise<void> {
  const openingSnapshot = await prisma.lineSnapshot.findFirst({
    where: { gameId, marketType, sportsbook },
    orderBy: { timestamp: 'asc' }
  });

  if (!openingSnapshot) return;

  const lineMovement = line - openingSnapshot.line;
  const steamMove = Math.abs(lineMovement) >= 2.0; // 2+ point movement
  const reverseMove = false; // TODO: Implement reverse line detection logic

  // Calculate CLV for all picks on this game
  await updatePickCLV(gameId, marketType, openingSnapshot.line, line, lineMovement, steamMove, reverseMove);
  
  // Record line movement
  await prisma.lineMovement.create({
    data: {
      gameId,
      sport,
      marketType,
      fromLine: openingSnapshot.line,
      toLine: line,
      movement: lineMovement,
      timespan: Math.floor((Date.now() - openingSnapshot.timestamp.getTime()) / 60000),
      velocity: lineMovement / Math.max(1, (Date.now() - openingSnapshot.timestamp.getTime()) / 60000),
      timestamp: new Date()
    }
  });
}

async function updatePickCLV(
  gameId: string,
  marketType: string,
  openingLine: number,
  closingLine: number,
  lineMovement: number,
  steamMove: boolean,
  reverseMove: boolean
): Promise<void> {
  // Find picks for this game and market type
  const picks = await prisma.dailyPick.findMany({
    where: {
      // Match by game (need to build gameId relationship)
      pickType: marketType === "spread" ? "SPREAD" : "OVER_UNDER"
    }
  });

  for (const pick of picks) {
    const clv = calculateCLV(pick, openingLine, closingLine);
    
    await prisma.dailyPick.update({
      where: { id: pick.id },
      data: {
        openingLine,
        closingLine,
        clv,
        lineMovement,
        steamMove,
        reverseMove
      }
    });
  }
}

function calculateCLV(pick: any, openingLine: number, closingLine: number): number {
  // CLV calculation logic based on pick side and line movement
  if (pick.pickType === "SPREAD") {
    if (pick.pickSide === "home") {
      return closingLine - openingLine; // Better if line moved toward home
    } else {
      return openingLine - closingLine; // Better if line moved toward away
    }
  } else if (pick.pickType === "OVER_UNDER") {
    if (pick.pickSide === "over") {
      return openingLine - closingLine; // Better if total went down
    } else {
      return closingLine - openingLine; // Better if total went up
    }
  }
  return 0;
}

// Additional CLV analysis functions...
export async function getSignalCLVPerformance(sport: Sport, days: number = 30) {
  // Return CLV performance by signal category
}

export async function optimizeSignalWeights(sport: Sport, days: number = 30) {
  // Adjust signal weights based on CLV performance
}
```

### Task C3: Odds Monitoring System

**File:** `src/lib/odds-monitor.ts`

```typescript
import "server-only";
import { captureOpeningLine, captureClosingLine } from "./clv-engine";

/**
 * Real-time odds monitoring and line movement detection
 */

export async function monitorGameOdds(gameId: string, sport: string): Promise<void> {
  // Poll multiple sportsbooks for line changes
  const books = ['draftkings', 'fanduel', 'betmgm', 'caesars'];
  
  for (const book of books) {
    const odds = await fetchOddsForGame(gameId, book);
    
    if (odds) {
      await captureLineSnapshot(gameId, sport, book, odds);
      await detectLineMovement(gameId, book, odds);
    }
  }
}

async function fetchOddsForGame(gameId: string, sportsbook: string) {
  // Integration with odds API (The Odds API, etc.)
  // Return current lines for spread, total, moneyline
}

async function captureLineSnapshot(gameId: string, sport: string, sportsbook: string, odds: any) {
  if (odds.spread) {
    await captureOpeningLine(gameId, sport as any, "spread", odds.spread.line, sportsbook);
  }
  if (odds.total) {
    await captureOpeningLine(gameId, sport as any, "total", odds.total.line, sportsbook);
  }
}

async function detectLineMovement(gameId: string, sportsbook: string, currentOdds: any) {
  // Compare with previous snapshot to detect significant movements
  // Trigger alerts for steam moves, reverse line movement, etc.
}
```

---

## PHASE D: MARKET INTELLIGENCE

### Task D1: Sharp Money Detection

**File:** `src/lib/sharp-money.ts`

```typescript
import "server-only";
import { prisma } from "./db";

/**
 * Sharp vs Public Money Detection
 * Identifies when professional bettors are taking opposite side of public
 */

export interface SharpSignal {
  gameId: string;
  sport: string;
  marketType: string;
  sharpSide: "home" | "away" | "over" | "under";
  confidence: number; // 0-1
  indicators: string[];
  publicPercentage: number;
  sharpPercentage: number;
}

export async function detectSharpMoney(
  gameId: string,
  sport: string,
  marketType: string
): Promise<SharpSignal | null> {
  
  const lineHistory = await getLineMovementHistory(gameId, marketType);
  const bettingPercentages = await getBettingPercentages(gameId, marketType);
  
  if (!lineHistory || !bettingPercentages) return null;

  // Reverse Line Movement Detection
  const reverseMovement = detectReverseLineMovement(lineHistory, bettingPercentages);
  
  // Steam Move Detection  
  const steamMove = detectSteamMove(lineHistory);
  
  // Sharp Book vs Recreational Book Line Divergence
  const bookDivergence = await detectBookDivergence(gameId, marketType);
  
  // Combine indicators
  const indicators: string[] = [];
  let confidence = 0;
  let sharpSide: "home" | "away" | "over" | "under" | null = null;

  if (reverseMovement) {
    indicators.push("reverse_line_movement");
    confidence += 0.4;
    sharpSide = reverseMovement.sharpSide;
  }

  if (steamMove) {
    indicators.push("steam_move");
    confidence += 0.3;
    if (!sharpSide) sharpSide = steamMove.direction;
  }

  if (bookDivergence) {
    indicators.push("book_divergence");
    confidence += 0.3;
    if (!sharpSide) sharpSide = bookDivergence.sharpSide;
  }

  if (confidence < 0.3 || !sharpSide) return null;

  return {
    gameId,
    sport,
    marketType,
    sharpSide,
    confidence: Math.min(confidence, 1.0),
    indicators,
    publicPercentage: bettingPercentages.publicPercentage,
    sharpPercentage: bettingPercentages.sharpPercentage
  };
}

function detectReverseLineMovement(lineHistory: any[], bettingPercentages: any) {
  // Line moves opposite to public betting percentage
  // E.g., 70% of bets on favorite but line moves toward underdog
}

function detectSteamMove(lineHistory: any[]) {
  // Rapid line movement (2+ points in <30 minutes)
  // Usually indicates sharp money hitting multiple books
}

async function detectBookDivergence(gameId: string, marketType: string) {
  // Compare sharp books (Pinnacle) vs recreational books (FanDuel/DraftKings)
  // Significant differences indicate sharp opinion
}

// Additional helper functions...
```

### Task D2: Public Bias Detection

**File:** `src/lib/public-bias.ts`

```typescript
/**
 * Public Betting Bias Detection and Contrarian Signals
 */

export const PUBLIC_TEAMS = {
  NCAAMB: ['Duke', 'Kentucky', 'Kansas', 'North Carolina', 'UCLA'],
  NFL: ['Cowboys', 'Patriots', 'Packers', 'Steelers', '49ers'],
  NBA: ['Lakers', 'Warriors', 'Celtics', 'Knicks', 'Heat'],
  NCAAF: ['Alabama', 'Georgia', 'Ohio State', 'Michigan', 'Texas']
};

export async function detectPublicBias(
  homeTeam: string,
  awayTeam: string,
  sport: string,
  gameContext: any
): Promise<{ bias: string; contrarian: string; confidence: number } | null> {
  
  const publicTeams = PUBLIC_TEAMS[sport as keyof typeof PUBLIC_TEAMS] || [];
  const isPublicGame = publicTeams.includes(homeTeam) || publicTeams.includes(awayTeam);
  
  if (!isPublicGame) return null;

  let bias = "";
  let contrarian = "";
  let confidence = 0;

  // Public team bias
  if (publicTeams.includes(homeTeam)) {
    bias = "home_public";
    contrarian = "away";
    confidence += 0.3;
  } else if (publicTeams.includes(awayTeam)) {
    bias = "away_public";
    contrarian = "home";
    confidence += 0.3;
  }

  // Primetime bias (public loves overs in primetime)
  if (gameContext.isPrimetime) {
    bias += "_primetime_over";
    confidence += 0.2;
  }

  // Playoff bias (public loves favorites and overs in playoffs)
  if (gameContext.isPlayoff) {
    bias += "_playoff_favorite_over";
    confidence += 0.3;
  }

  return confidence > 0.3 ? { bias, contrarian, confidence } : null;
}
```

### Task D3: Market Timing Optimization

**File:** `src/lib/market-timing.ts`

```typescript
/**
 * Market Timing - Optimal bet placement timing based on line movement patterns
 */

export async function getOptimalBetTiming(
  gameId: string,
  pickSide: string,
  marketType: string
): Promise<{ timing: string; confidence: number; reasoning: string }> {
  
  const lineHistory = await getLineMovementHistory(gameId, marketType);
  const historicalPatterns = await getHistoricalTimingPatterns(marketType);
  
  // Analyze typical line movement patterns for this market type
  const pattern = analyzeMovementPattern(lineHistory, historicalPatterns);
  
  if (pattern.suggests === "bet_now") {
    return {
      timing: "immediate",
      confidence: pattern.confidence,
      reasoning: `Line likely to move against us: ${pattern.reason}`
    };
  } else if (pattern.suggests === "wait") {
    return {
      timing: "wait_2h",
      confidence: pattern.confidence,
      reasoning: `Line likely to improve: ${pattern.reason}`
    };
  }

  return {
    timing: "any_time",
    confidence: 0.5,
    reasoning: "No clear timing advantage detected"
  };
}
```

---

## PHASE E: DYNAMIC SYSTEMS

### Task E1: Dynamic HCA Tracking

**File:** `src/lib/hca-tracker.ts`

```typescript
/**
 * Dynamic Home Court/Field Advantage Tracking
 * Replaces static HCA values with real-time calculated advantages
 */

export async function getDynamicHCA(
  homeTeam: string,
  sport: string,
  venue: string,
  gameDate: Date,
  isConference: boolean,
  isNeutralSite: boolean
): Promise<number> {
  
  if (isNeutralSite) return 0;

  // Get recent home performance for this team/venue
  const recentHomePerformance = await getRecentHomePerformance(homeTeam, sport, venue, gameDate);
  
  // Get league-wide HCA trends
  const leagueHCA = await getLeagueHCATrend(sport, gameDate);
  
  // Conference vs non-conference adjustment
  const confAdjustment = isConference ? 1.1 : 0.9;
  
  // Calculate weighted HCA
  const teamHCA = recentHomePerformance.averageMargin;
  const dynamicHCA = (teamHCA * 0.7 + leagueHCA * 0.3) * confAdjustment;
  
  return Math.max(0, Math.min(8, dynamicHCA)); // Cap between 0-8 points
}

async function getRecentHomePerformance(teamName: string, sport: string, venue: string, gameDate: Date) {
  // Query last 10 home games for this team
  // Calculate average margin of victory/defeat
}

async function getLeagueHCATrend(sport: string, gameDate: Date) {
  // Calculate current league-wide home advantage
  // Account for seasonal trends (HCA typically decreases through season)
}
```

### Task E2: Signal Weight Optimizer

**File:** `src/lib/signal-optimizer.ts`

```typescript
/**
 * Signal Weight Optimization Based on CLV Performance
 * Automatically adjusts signal weights based on recent performance
 */

export async function optimizeSignalWeights(sport: string, days: number = 30): Promise<Record<string, number>> {
  // Get CLV performance by signal over last N days
  const signalPerformance = await getSignalCLVPerformance(sport, days);
  
  // Calculate new optimal weights using gradient descent
  const currentWeights = getCurrentWeights(sport);
  const optimizedWeights = calculateOptimalWeights(signalPerformance, currentWeights);
  
  // Ensure weights sum to 1.0
  const normalizedWeights = normalizeWeights(optimizedWeights);
  
  return normalizedWeights;
}

async function getSignalCLVPerformance(sport: string, days: number) {
  // Query CLV data by signal category
  // Return average CLV and pick count for each signal
}

function calculateOptimalWeights(performance: any[], currentWeights: Record<string, number>) {
  // Use CLV performance to adjust weights
  // Signals with positive CLV get weight increases
  // Signals with negative CLV get weight decreases
}
```

### Task E3: Enhanced Tournament Logic

**File:** `src/lib/tournament-enhancements.ts`

```typescript
/**
 * Advanced Tournament Logic Beyond Basic UNDER Boost
 */

export function getTournamentAdjustments(
  gameDate: Date,
  isNeutralSite: boolean,
  homeRank: number | null,
  awayRank: number | null,
  tournamentRound?: string
): {
  hcaOverride: number;
  confidenceMultiplier: number;
  biasAdjustments: { under: number; upset: number; };
  specialRules: string[];
} {
  
  const gameMonth = gameDate.getUTCMonth() + 1;
  const isTournament = isNeutralSite && gameMonth === 3;
  
  if (!isTournament) {
    return {
      hcaOverride: 0,
      confidenceMultiplier: 1.0,
      biasAdjustments: { under: 1.0, upset: 1.0 },
      specialRules: []
    };
  }

  const adjustments = {
    hcaOverride: 0, // Neutral site
    confidenceMultiplier: 1.0,
    biasAdjustments: { under: 1.3, upset: 1.1 }, // UNDER boost + upset potential
    specialRules: ['tournament_neutral_site']
  };

  // Round-specific adjustments
  if (tournamentRound) {
    if (['first_four', 'round_64', 'round_32'].includes(tournamentRound)) {
      adjustments.biasAdjustments.under = 1.4; // Higher UNDER bias early
      adjustments.biasAdjustments.upset = 1.2; // More upset potential
      adjustments.specialRules.push('early_round_chaos');
    } else if (['sweet_16', 'elite_8'].includes(tournamentRound)) {
      adjustments.confidenceMultiplier = 1.2; // Higher confidence in later rounds
      adjustments.biasAdjustments.under = 1.2; // Reduced but still present
      adjustments.specialRules.push('elite_competition');
    }
  }

  // Seed-based adjustments
  if (homeRank && awayRank) {
    const seedGap = Math.abs(homeRank - awayRank);
    if (seedGap >= 4) {
      adjustments.biasAdjustments.upset = 1.3; // Big seed mismatches
      adjustments.specialRules.push('potential_upset');
    }
  }

  return adjustments;
}
```

---

## PHASE F: ARCHITECTURE & MONITORING

### Task F1: Split Cron Architecture

**File:** `src/app/api/cron/sync-odds/route.ts`

```typescript
import { NextResponse } from "next/server";
import { monitorGameOdds } from "@/lib/odds-monitor";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get upcoming games
    const upcomingGames = await getUpcomingGames();
    
    // Monitor odds for each game
    for (const game of upcomingGames) {
      await monitorGameOdds(game.id, game.sport);
    }

    return NextResponse.json({ 
      success: true,
      gamesMonitored: upcomingGames.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Odds monitoring failed:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

**Similar cron jobs for:**
- `capture-closing-lines/route.ts`
- `generate-picks/route.ts` 
- `grade-results/route.ts`
- `optimize-signals/route.ts`

### Task F2: Performance Monitoring

**File:** `src/lib/monitoring.ts`

```typescript
/**
 * Real-time Performance Monitoring and Alerting
 */

export async function trackPickGenerationPerformance(
  sport: string,
  gamesProcessed: number,
  picksGenerated: number,
  processingTimeMs: number,
  errors: number
): Promise<void> {
  
  const metrics = {
    sport,
    gamesProcessed,
    picksGenerated,
    processingTimeMs,
    avgTimePerGame: processingTimeMs / gamesProcessed,
    errors,
    timestamp: new Date()
  };

  // Store metrics
  await prisma.performanceMetric.create({ data: metrics });
  
  // Check for performance issues
  if (metrics.avgTimePerGame > 1000) { // >1s per game
    await sendAlert('PERFORMANCE_SLOW', `Pick generation slow: ${metrics.avgTimePerGame}ms per game`);
  }
  
  if (errors > 0) {
    await sendAlert('PICK_ERRORS', `${errors} errors during pick generation`);
  }
}

export async function trackModelAccuracy(
  sport: string,
  period: string,
  overallAccuracy: number,
  by5StarAccuracy: number,
  clvPerformance: number
): Promise<void> {
  
  const threshold = sport === 'NCAAMB' ? 0.55 : 0.52;
  
  if (overallAccuracy < threshold) {
    await sendAlert('ACCURACY_LOW', `${sport} accuracy ${(overallAccuracy * 100).toFixed(1)}% below threshold`);
  }
  
  if (by5StarAccuracy < 0.65) {
    await sendAlert('TIER_ACCURACY_LOW', `5★ picks ${(by5StarAccuracy * 100).toFixed(1)}% accuracy`);
  }
  
  if (clvPerformance < 0) {
    await sendAlert('CLV_NEGATIVE', `Negative CLV: ${clvPerformance.toFixed(2)} points`);
  }
}

async function sendAlert(type: string, message: string) {
  // Send to Discord webhook, email, etc.
}
```

---

## INTEGRATION CHECKLIST

### Phase A: Surgical Fixes ✓
- [ ] Fix OVER bias in 3★ tier
- [ ] Fix spread model suppression
- [ ] Fix FanMatch name mismatch
- [ ] Fix convergence fallback weight
- [ ] Test: Win rate should improve from 41.8% → 52-55%

### Phase B: Ridge Models ✓
- [ ] Implement NFL Ridge regression
- [ ] Implement NBA Ridge regression  
- [ ] Implement NCAAF Ridge regression
- [ ] Integrate Ridge models into pick engine
- [ ] Test: Model edge accuracy improvement

### Phase C: CLV System ✓
- [ ] Update database schema
- [ ] Implement CLV engine
- [ ] Implement odds monitoring
- [ ] Integrate CLV into pick pipeline
- [ ] Test: CLV tracking functional

### Phase D: Market Intelligence ✓
- [ ] Implement sharp money detection
- [ ] Implement public bias detection
- [ ] Implement market timing
- [ ] Integrate market signals into picks
- [ ] Test: Market edge improvement

### Phase E: Dynamic Systems ✓
- [ ] Implement dynamic HCA tracking
- [ ] Implement signal weight optimizer
- [ ] Implement enhanced tournament logic
- [ ] Integration testing
- [ ] Test: Adaptive performance

### Phase F: Architecture ✓
- [ ] Split cron jobs (8 endpoints)
- [ ] Implement performance monitoring
- [ ] Deploy monitoring dashboards
- [ ] Load testing for tournament volume
- [ ] Test: System reliability

---

## SUCCESS METRICS

**Target Performance:**
- Overall win rate: 60%+ (from 41.8%)
- 5★ picks: 75%+ accuracy
- 4★ picks: 65%+ accuracy  
- 3★ picks: 57%+ accuracy
- Positive CLV across all tiers
- Ready for March 15 tournament launch

**Implement each phase incrementally with testing between phases. Use feature flags for gradual rollout.**