# 📊 Week 2 Day 1: Market Intelligence + CLV Integration

**Context:**
- Week 1: Built systematic improvement infrastructure (feature flags, A/B testing, monitoring)
- Current performance: ~56-59% estimated (up from 53.5% baseline)
- Week 2 focus: Market intelligence signals + closing line value optimization

**Next Level Opportunities:**
1. **CLV tracking:** Use closing line movement to validate pick quality
2. **Sharp money detection:** Identify when pros disagree with public
3. **Market timing:** Optimal bet placement based on line movement patterns
4. **Signal weight optimization:** Adjust based on actual CLV performance

**Goal:** Integrate market intelligence to push 56-59% → 62%+ performance

**Time Estimate:** ~10 minutes (market intelligence is where edges come from!)

---

## TASK 1: CLV (Closing Line Value) Integration (5 minutes)

### The CLV Edge
**What CLV Tells Us:**
- Positive CLV = We got better odds than closing (sharp bet)
- Negative CLV = We got worse odds than closing (square bet)
- CLV predicts long-term profitability better than short-term win rate

**Current Issue:** We're generating picks but not tracking if the market agrees with us by close.

### CLV Database Schema Enhancement:
```sql
-- Already exists in schema, but ensure these fields are populated:
ALTER TABLE "DailyPick" ADD COLUMN IF NOT EXISTS "openingLine" FLOAT;
ALTER TABLE "DailyPick" ADD COLUMN IF NOT EXISTS "closingLine" FLOAT;  
ALTER TABLE "DailyPick" ADD COLUMN IF NOT EXISTS "clv" FLOAT;
ALTER TABLE "DailyPick" ADD COLUMN IF NOT EXISTS "lineMovement" FLOAT;
ALTER TABLE "DailyPick" ADD COLUMN IF NOT EXISTS "steamMove" BOOLEAN DEFAULT FALSE;

-- New table for real-time line tracking
CREATE TABLE IF NOT EXISTS "LineSnapshot" (
    "id" TEXT PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "marketType" TEXT NOT NULL, -- "spread", "total", "moneyline"
    "sportsbook" TEXT NOT NULL,
    "line" FLOAT NOT NULL,
    "odds" INTEGER, -- American odds
    "timestamp" TIMESTAMP NOT NULL DEFAULT NOW(),
    
    INDEX "idx_line_snapshot_game_market" ("gameId", "marketType", "timestamp")
);
```

### CLV Calculation Service:
```typescript
// File: src/lib/clv-service.ts
import "server-only";
import { prisma } from "./db";

export interface CLVResult {
  pickId: string;
  openingLine: number;
  closingLine: number;
  clv: number;
  lineMovement: number;
  steamMove: boolean;
  marketAgreement: 'agrees' | 'disagrees' | 'neutral';
}

/**
 * Calculate CLV for a pick after game closes
 */
export async function calculatePickCLV(pickId: string): Promise<CLVResult | null> {
  // Get the pick
  const pick = await prisma.dailyPick.findUnique({
    where: { id: pickId }
  });
  
  if (!pick) return null;
  
  // Get opening and closing lines for this game/market
  const gameId = `${pick.homeTeam}_${pick.awayTeam}_${pick.gameDate.toISOString().split('T')[0]}`;
  const marketType = pick.pickType === 'SPREAD' ? 'spread' : 'total';
  
  const [openingSnapshot, closingSnapshot] = await Promise.all([
    prisma.lineSnapshot.findFirst({
      where: { gameId, marketType },
      orderBy: { timestamp: 'asc' } // Earliest = opening
    }),
    prisma.lineSnapshot.findFirst({
      where: { gameId, marketType },
      orderBy: { timestamp: 'desc' } // Latest = closing  
    })
  ]);
  
  if (!openingSnapshot || !closingSnapshot) return null;
  
  const openingLine = openingSnapshot.line;
  const closingLine = closingSnapshot.line;
  const lineMovement = closingLine - openingLine;
  
  // Calculate CLV based on pick side and line movement
  let clv = 0;
  let marketAgreement: 'agrees' | 'disagrees' | 'neutral' = 'neutral';
  
  if (pick.pickType === 'OVER_UNDER') {
    if (pick.pickSide === 'over') {
      clv = openingLine - closingLine; // Better if line went down (easier over)
      marketAgreement = clv > 0 ? 'agrees' : (clv < -0.5 ? 'disagrees' : 'neutral');
    } else if (pick.pickSide === 'under') {  
      clv = closingLine - openingLine; // Better if line went up (easier under)
      marketAgreement = clv > 0 ? 'agrees' : (clv < -0.5 ? 'disagrees' : 'neutral');
    }
  } else if (pick.pickType === 'SPREAD') {
    if (pick.pickSide === 'home') {
      clv = closingLine - openingLine; // Better if spread moved toward home
      marketAgreement = clv > 0 ? 'agrees' : (clv < -0.5 ? 'disagrees' : 'neutral');
    } else {
      clv = openingLine - closingLine; // Better if spread moved toward away  
      marketAgreement = clv > 0 ? 'agrees' : (clv < -0.5 ? 'disagrees' : 'neutral');
    }
  }
  
  const steamMove = Math.abs(lineMovement) >= 2.0; // 2+ point move
  
  // Update pick with CLV data
  await prisma.dailyPick.update({
    where: { id: pickId },
    data: {
      openingLine,
      closingLine,
      clv,
      lineMovement,
      steamMove
    }
  });
  
  return {
    pickId,
    openingLine,
    closingLine,
    clv,
    lineMovement,
    steamMove,
    marketAgreement
  };
}

/**
 * Get CLV performance by signal category
 */
export async function getCLVBySignal(sport: string, days: number = 30): Promise<Map<string, { avgCLV: number; count: number; winRate: number }>> {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - days);
  
  const picks = await prisma.dailyPick.findMany({
    where: {
      sport,
      gameDate: { gte: dateThreshold },
      clv: { not: null },
      result: { not: null }
    }
  });
  
  const signalPerformance = new Map<string, { clvSum: number; count: number; wins: number }>();
  
  picks.forEach(pick => {
    // Extract primary signal from reasoning (simplified)
    const primarySignal = extractPrimarySignal(pick.reasoning || '');
    
    if (!signalPerformance.has(primarySignal)) {
      signalPerformance.set(primarySignal, { clvSum: 0, count: 0, wins: 0 });
    }
    
    const data = signalPerformance.get(primarySignal)!;
    data.clvSum += pick.clv || 0;
    data.count++;
    if (pick.result === 'WIN') data.wins++;
  });
  
  // Convert to final format
  const result = new Map<string, { avgCLV: number; count: number; winRate: number }>();
  
  signalPerformance.forEach((data, signal) => {
    result.set(signal, {
      avgCLV: data.count > 0 ? data.clvSum / data.count : 0,
      count: data.count,
      winRate: data.count > 0 ? data.wins / data.count : 0
    });
  });
  
  return result;
}

function extractPrimarySignal(reasoning: string): string {
  // Extract dominant signal from reasoning text
  if (reasoning.includes('KenPom')) return 'kenpom';
  if (reasoning.includes('tempo')) return 'tempo';  
  if (reasoning.includes('tournament')) return 'tournament';
  if (reasoning.includes('ATS')) return 'ats';
  if (reasoning.includes('injury')) return 'injury';
  return 'other';
}
```

### CLV-Based Signal Optimization:
```typescript
// File: src/lib/signal-weight-optimizer.ts
import { getCLVBySignal } from "./clv-service";

/**
 * Optimize signal weights based on CLV performance
 */
export async function optimizeWeightsBasedOnCLV(sport: string): Promise<Record<string, number>> {
  console.log(`🔬 Optimizing ${sport} signal weights based on CLV performance`);
  
  const clvPerformance = await getCLVBySignal(sport, 30);
  
  // Base weights (current system)
  const baseWeights = {
    kenpom: 0.35,
    tempo: 0.15,
    tournament: 0.20,
    ats: 0.15,
    injury: 0.10,
    other: 0.05
  };
  
  // Adjust based on CLV performance
  const optimizedWeights: Record<string, number> = { ...baseWeights };
  
  clvPerformance.forEach((performance, signal) => {
    if (performance.count >= 10) { // Require minimum sample size
      const clvMultiplier = Math.max(0.5, Math.min(2.0, 1 + performance.avgCLV / 2));
      optimizedWeights[signal] = (baseWeights[signal] || 0.05) * clvMultiplier;
      
      console.log(`${signal}: CLV ${performance.avgCLV.toFixed(2)} → weight ${baseWeights[signal]?.toFixed(2)} → ${optimizedWeights[signal].toFixed(2)}`);
    }
  });
  
  // Normalize to sum to 1.0
  const totalWeight = Object.values(optimizedWeights).reduce((sum, w) => sum + w, 0);
  Object.keys(optimizedWeights).forEach(signal => {
    optimizedWeights[signal] /= totalWeight;
  });
  
  return optimizedWeights;
}
```

---

## TASK 2: Sharp Money Detection + Public Bias Integration (5 minutes)

### Sharp vs Public Detection Logic:
```typescript
// File: src/lib/sharp-detection.ts
import "server-only";

export interface SharpSignal {
  gameId: string;
  marketType: string;
  sharpSide: 'home' | 'away' | 'over' | 'under';
  confidence: number; // 0-1
  indicators: string[];
}

/**
 * Detect sharp money based on line movement + betting percentages
 */
export async function detectSharpMoney(
  gameId: string,
  marketType: string,
  publicBettingPercentage?: number
): Promise<SharpSignal | null> {
  
  // Get line movement history
  const lineSnapshots = await prisma.lineSnapshot.findMany({
    where: { gameId, marketType },
    orderBy: { timestamp: 'asc' }
  });
  
  if (lineSnapshots.length < 2) return null;
  
  const opening = lineSnapshots[0];
  const closing = lineSnapshots[lineSnapshots.length - 1];
  const movement = closing.line - opening.line;
  
  const indicators: string[] = [];
  let confidence = 0;
  let sharpSide: 'home' | 'away' | 'over' | 'under' | null = null;
  
  // 1. Reverse Line Movement (strongest signal)
  if (publicBettingPercentage) {
    const publicSide = publicBettingPercentage > 50 ? 'home' : 'away'; // Simplified
    const lineMoveDirection = movement > 0 ? 'home' : 'away';
    
    if (publicSide !== lineMoveDirection && Math.abs(movement) >= 1) {
      indicators.push('reverse_line_movement');
      confidence += 0.6;
      sharpSide = lineMoveDirection === 'home' ? 'home' : 'away';
    }
  }
  
  // 2. Steam Move (rapid large movement)
  const recentMovement = getRecentMovement(lineSnapshots, 30); // Last 30 min
  if (Math.abs(recentMovement) >= 2) {
    indicators.push('steam_move');
    confidence += 0.4;
    if (!sharpSide) {
      sharpSide = recentMovement > 0 ? 'home' : 'away';
    }
  }
  
  // 3. Closing line significance (sharp books move lines late)
  const lateMovement = getRecentMovement(lineSnapshots, 60); // Last hour
  if (Math.abs(lateMovement) >= 1) {
    indicators.push('late_movement');
    confidence += 0.3;
  }
  
  if (confidence < 0.4 || !sharpSide) return null;
  
  return {
    gameId,
    marketType,
    sharpSide,
    confidence: Math.min(confidence, 1.0),
    indicators
  };
}

function getRecentMovement(snapshots: any[], minutesBack: number): number {
  const cutoff = new Date(Date.now() - minutesBack * 60000);
  const recentSnapshots = snapshots.filter(s => new Date(s.timestamp) >= cutoff);
  
  if (recentSnapshots.length < 2) return 0;
  
  const start = recentSnapshots[0];
  const end = recentSnapshots[recentSnapshots.length - 1];
  
  return end.line - start.line;
}

/**
 * Public team bias detection
 */
const PUBLIC_TEAMS = {
  NCAAMB: ['Duke', 'Kentucky', 'Kansas', 'North Carolina', 'UCLA', 'Michigan State', 'Syracuse'],
  NFL: ['Cowboys', 'Patriots', 'Packers', 'Steelers', '49ers', 'Giants'],
  NBA: ['Lakers', 'Warriors', 'Celtics', 'Knicks', 'Heat', 'Bulls']
};

export function getPublicBias(homeTeam: string, awayTeam: string, sport: string): {
  biasTeam: string | null;
  contrarian: string;
  confidence: number;
} {
  const publicTeams = PUBLIC_TEAMS[sport as keyof typeof PUBLIC_TEAMS] || [];
  
  const homeIsPublic = publicTeams.includes(homeTeam);
  const awayIsPublic = publicTeams.includes(awayTeam);
  
  if (homeIsPublic && !awayIsPublic) {
    return { biasTeam: homeTeam, contrarian: 'away', confidence: 0.3 };
  } else if (awayIsPublic && !homeIsPublic) {
    return { biasTeam: awayTeam, contrarian: 'home', confidence: 0.3 };
  }
  
  return { biasTeam: null, contrarian: '', confidence: 0 };
}
```

### Integration into Pick Engine:
```typescript
// In pick-engine.ts, add market intelligence signals:
import { detectSharpMoney, getPublicBias } from "./sharp-detection";
import { calculatePickCLV, optimizeWeightsBasedOnCLV } from "./clv-service";

// Add to signal generation section:
async function generateMarketIntelligenceSignals(
  homeTeam: string,
  awayTeam: string,
  sport: string,
  gameId: string,
  flags: Record<string, boolean>
): Promise<SignalResult[]> {
  const signals: SignalResult[] = [];
  
  if (flags.enable_market_intelligence) {
    // Sharp money detection
    const sharpSignal = await detectSharpMoney(gameId, 'total');
    if (sharpSignal && sharpSignal.confidence > 0.5) {
      signals.push({
        category: 'sharpMoney',
        direction: sharpSignal.sharpSide === 'over' ? 'over' : 'under',
        magnitude: sharpSignal.confidence * 8, // Scale to match other signals
        confidence: sharpSignal.confidence,
        label: `Sharp money: ${sharpSignal.indicators.join(', ')}`,
        strength: sharpSignal.confidence > 0.7 ? 'strong' : 'moderate'
      });
    }
    
    // Public bias (contrarian signal)
    const publicBias = getPublicBias(homeTeam, awayTeam, sport);
    if (publicBias.confidence > 0.2) {
      signals.push({
        category: 'publicBias',
        direction: 'neutral', // Applied in convergence logic
        magnitude: publicBias.confidence * 5,
        confidence: publicBias.confidence,
        label: `Public bias: fade ${publicBias.biasTeam}`,
        strength: 'moderate',
        metadata: { contrarian: publicBias.contrarian }
      });
    }
  }
  
  return signals;
}

// Update signal weights based on CLV performance (run periodically)
if (flags.optimize_weights_via_clv) {
  const optimizedWeights = await optimizeWeightsBasedOnCLV(sport);
  // Apply optimized weights to convergence calculation
}
```

### Feature Flag Setup:
```typescript
// Initialize market intelligence flags
await setFlag("enable_market_intelligence", false, {
  rollout: 0.4, // 40% test
  sport: "NCAAMB", 
  metadata: {
    description: "Sharp money detection + public bias signals",
    signals: ["reverse_line_movement", "steam_moves", "public_team_bias"],
    expectedImpact: "+2% win rate via market edge detection"
  }
});

await setFlag("optimize_weights_via_clv", false, {
  rollout: 0.3, // 30% test
  sport: "NCAAMB",
  metadata: {
    description: "Adjust signal weights based on CLV performance",
    mechanism: "Positive CLV signals get higher weights",
    expectedImpact: "+1.5% win rate via signal optimization"
  }
});
```

---

## VALIDATION & TESTING

### CLV Validation Script:
```typescript
// File: scripts/validate-clv-integration.ts
async function validateCLVIntegration() {
  console.log("💰 Validating CLV Integration");
  
  // Test CLV calculation on recent completed picks
  const recentPicks = await prisma.dailyPick.findMany({
    where: {
      gameDate: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      result: { not: null }
    },
    take: 20
  });
  
  console.log(`Testing CLV calculation on ${recentPicks.length} picks`);
  
  for (const pick of recentPicks) {
    const clvResult = await calculatePickCLV(pick.id);
    if (clvResult) {
      console.log(`${pick.homeTeam} vs ${pick.awayTeam}: CLV ${clvResult.clv.toFixed(2)} (${clvResult.marketAgreement})`);
    }
  }
  
  // Test signal weight optimization
  const optimizedWeights = await optimizeWeightsBasedOnCLV('NCAAMB');
  console.log("\n🎯 Optimized Signal Weights:");
  Object.entries(optimizedWeights).forEach(([signal, weight]) => {
    console.log(`${signal}: ${weight.toFixed(3)}`);
  });
}
```

### Expected Performance Impact:
- **CLV optimization:** +1-2% win rate via signal weight tuning
- **Sharp money detection:** +1-1.5% win rate via contrarian edge  
- **Public bias fading:** +0.5-1% win rate via systematic contrarian plays
- **Combined:** 56-59% → 60-62% overall performance

---

## SUCCESS CRITERIA

### CLV System ✅
- [ ] CLV calculated for all picks within 2 hours of game completion
- [ ] Signal weight optimization shows positive CLV correlation
- [ ] Picks with positive CLV outperform picks with negative CLV
- [ ] CLV tracking integrated into performance monitoring

### Market Intelligence ✅
- [ ] Sharp money detection identifies reverse line movement
- [ ] Public bias signals correctly identify contrarian opportunities  
- [ ] Market intelligence signals contribute positively to pick accuracy
- [ ] A/B testing shows improvement over baseline

### Performance Target ✅
- [ ] Overall system performance: 60%+ (up from 56-59% baseline)
- [ ] CLV-optimized signals outperform non-optimized
- [ ] Market intelligence adds measurable edge
- [ ] System ready for Week 2 Day 2 advanced features

**The market intelligence layer is where serious handicappers separate from casual bettors. Time to get sharp!** 📊🌪️