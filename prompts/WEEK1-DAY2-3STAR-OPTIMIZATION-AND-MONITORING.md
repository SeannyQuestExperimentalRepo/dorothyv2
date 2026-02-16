# 🎯 Week 1 Day 2: 3★ Tier Optimization + Performance Monitoring

**Context:** Feature flag system deployed. 4★ threshold fix in A/B testing. Next priority: optimize 3★ tier performance and build monitoring.

**Current 3★ Performance (from backtest):**
- **OVER picks:** 34 picks (17-17, 50.0%) - exactly breakeven 
- **UNDER picks:** 48 picks (28-20, 58.3%) - profitable
- **Combined:** 82 picks (45-37, 54.9%) - decent but improvable

**Goal:** Push 3★ tier from 54.9% → 62%+ via threshold optimization + monitoring dashboard

**Time Estimate:** ~10 minutes total (2 prompts × 5 min each) 

---

## TASK 1: 3★ OVER/UNDER Threshold Optimization (5 minutes)

### Current Logic Issues:
```typescript
// Current (suboptimal):
WHEN ABS(ou_edge) >= 9 THEN
  CASE 
    WHEN ou_edge < 0 THEN 3  -- UNDER at edge >= 9 (58.3% win rate ✅)
    WHEN ou_edge >= 12 THEN 3  -- OVER needs edge >= 12 (50.0% win rate ⚠️)
    ELSE 0  -- Filter weak OVER picks
  END
```

**Problems:**
1. **OVER threshold too low** - 50.0% is breakeven, need 52.38%+ 
2. **UNDER threshold might be too high** - 58.3% suggests room to capture more picks
3. **No context filters** - tempo, conference, date don't matter

### Optimized A/B Test Logic:

**Add to pick-engine.ts after the existing 4★ A/B test:**

```typescript
// 3★ tier: A/B test optimized thresholds
if (ABS(ou_edge) >= 8.5) {  // Slightly lower floor to capture more
  if (flags.optimize_3star_thresholds) {
    // NEW OPTIMIZED LOGIC
    if (ou_edge < 0) {
      // UNDER: Lower threshold since 58.3% suggests we're being too conservative
      if (absEdge >= 8.5) {
        confidence = 3;
        reasoningSteps.push("3★ UNDER: optimized threshold (≥8.5 edge)");
      }
    } else {
      // OVER: Much higher threshold + context filters
      if (absEdge >= 15 && avgTempo >= 68) {
        // OVER only in high-tempo games with huge edge
        confidence = 3;
        reasoningSteps.push("3★ OVER: high threshold + fast tempo requirement");
      }
    }
  } else {
    // ORIGINAL LOGIC (known performance: OVER 50.0%, UNDER 58.3%)
    if (ou_edge < 0 && absEdge >= 9) {
      confidence = 3;
      reasoningSteps.push("3★ UNDER: original threshold");
    } else if (ou_edge >= 12) {
      confidence = 3;
      reasoningSteps.push("3★ OVER: original threshold");
    }
  }
}
```

### Feature Flag Setup:
```typescript
await setFlag("optimize_3star_thresholds", false, { 
  rollout: 0.5, // A/B test
  sport: "NCAAMB",
  metadata: { 
    description: "Optimize 3★ O/U thresholds for better performance",
    currentPerformance: "OVER 50.0% (17-17), UNDER 58.3% (28-20)",
    changes: "UNDER: 9→8.5 edge, OVER: 12→15 edge + tempo≥68",
    targetPerformance: "Both tiers >55%"
  }
});
```

### Backtest Validation Script:
```typescript
// File: scripts/validate-3star-optimization.ts
async function validate3StarOptimization() {
  // Test last 30 days with both threshold sets
  // Expected results:
  // - UNDER picks increase (8.5 vs 9 threshold) 
  // - UNDER win rate stays ~58%+ (more picks, same quality)
  // - OVER picks decrease but win rate improves (15 vs 12 threshold + tempo filter)
  // - Overall 3★ performance: 54.9% → 60%+
  
  console.log("🎯 Testing 3★ Threshold Optimization");
  
  let originalResults = { over: {total:0, wins:0}, under: {total:0, wins:0} };
  let optimizedResults = { over: {total:0, wins:0}, under: {total:0, wins:0} };
  
  for (const game of games) {
    const actualTotal = game.homeScore + game.awayScore;
    const avgTempo = (game.homeAdjTempo + game.awayAdjTempo) / 2;
    const ouEdge = ((game.homeAdjOE + game.awayAdjOE) * avgTempo / 200) - game.overUnder;
    const absEdge = Math.abs(ouEdge);
    const isWin = (ouEdge < 0 && actualTotal < game.overUnder) || (ouEdge > 0 && actualTotal > game.overUnder);
    
    // Original thresholds
    if (ouEdge < 0 && absEdge >= 9) {
      originalResults.under.total++;
      if (isWin) originalResults.under.wins++;
    }
    if (ouEdge > 0 && absEdge >= 12) {
      originalResults.over.total++;
      if (isWin) originalResults.over.wins++;
    }
    
    // Optimized thresholds
    if (ouEdge < 0 && absEdge >= 8.5) {
      optimizedResults.under.total++;
      if (isWin) optimizedResults.under.wins++;
    }
    if (ouEdge > 0 && absEdge >= 15 && avgTempo >= 68) {
      optimizedResults.over.total++;
      if (isWin) optimizedResults.over.wins++;
    }
  }
  
  // Report results...
}
```

---

## TASK 2: Real-Time Performance Monitoring Dashboard (5 minutes)

### Performance Tracking Schema:
```prisma
// Add to schema.prisma
model PerformanceMetric {
  id          String   @id @default(cuid())
  date        DateTime
  sport       String
  pickType    String   // "SPREAD", "OVER_UNDER"  
  confidence  Int      // 3, 4, 5
  flagVersion String?  // "original", "optimized", null
  
  // Performance data
  totalPicks  Int
  wins        Int
  losses      Int  
  winRate     Float    // calculated win percentage
  
  // Context
  avgEdge     Float?
  avgTempo    Float?
  
  createdAt   DateTime @default(now())
  
  @@unique([date, sport, pickType, confidence, flagVersion])
  @@map("PerformanceMetric")
}
```

### Performance Tracking Service:
```typescript
// File: src/lib/performance-tracker.ts
import { prisma } from "./db";

export interface PerformanceData {
  date: Date;
  sport: string;
  pickType: string;
  confidence: number;
  flagVersion?: string;
  totalPicks: number;
  wins: number;
  losses: number;
  avgEdge?: number;
  avgTempo?: number;
}

export async function trackPickPerformance(data: PerformanceData) {
  const winRate = data.totalPicks > 0 ? data.wins / (data.wins + data.losses) : 0;
  
  await prisma.performanceMetric.upsert({
    where: {
      date_sport_pickType_confidence_flagVersion: {
        date: data.date,
        sport: data.sport,
        pickType: data.pickType,
        confidence: data.confidence,
        flagVersion: data.flagVersion || null
      }
    },
    update: {
      totalPicks: data.totalPicks,
      wins: data.wins,
      losses: data.losses,
      winRate,
      avgEdge: data.avgEdge,
      avgTempo: data.avgTempo
    },
    create: {
      date: data.date,
      sport: data.sport,
      pickType: data.pickType,
      confidence: data.confidence,
      flagVersion: data.flagVersion,
      totalPicks: data.totalPicks,
      wins: data.wins,
      losses: data.losses,
      winRate,
      avgEdge: data.avgEdge,
      avgTempo: data.avgTempo
    }
  });
}

// Daily performance summary
export async function getDailyPerformanceSummary(date: Date, sport: string) {
  const metrics = await prisma.performanceMetric.findMany({
    where: { date, sport },
    orderBy: [{ confidence: 'desc' }, { flagVersion: 'asc' }]
  });
  
  return metrics.map(m => ({
    tier: `${m.confidence}★`,
    type: m.pickType,
    version: m.flagVersion || 'baseline',
    record: `${m.wins}-${m.losses}`,
    winRate: `${(m.winRate * 100).toFixed(1)}%`,
    picks: m.totalPicks,
    avgEdge: m.avgEdge?.toFixed(1),
    avgTempo: m.avgTempo?.toFixed(1)
  }));
}
```

### Integration into Pick Engine:
```typescript
// In generateDailyPicks(), after pick generation:
import { trackPickPerformance } from "./performance-tracker";

// Track performance by confidence tier and flag version
const performanceData = new Map<string, {confidence: number, flagVersion: string, picks: any[], edges: number[], tempos: number[]}>();

for (const pick of allGeneratedPicks) {
  const key = `${pick.confidence}_${pick.flagVersion || 'baseline'}`;
  if (!performanceData.has(key)) {
    performanceData.set(key, {
      confidence: pick.confidence,
      flagVersion: pick.flagVersion || 'baseline',
      picks: [],
      edges: [],
      tempos: []
    });
  }
  
  const data = performanceData.get(key)!;
  data.picks.push(pick);
  if (pick.edge) data.edges.push(pick.edge);
  if (pick.tempo) data.tempos.push(pick.tempo);
}

// Submit tracking data
for (const [key, data] of performanceData) {
  await trackPickPerformance({
    date: targetDate,
    sport,
    pickType: 'OVER_UNDER', // Or split by type
    confidence: data.confidence,
    flagVersion: data.flagVersion,
    totalPicks: data.picks.length,
    wins: 0, // Will be updated when games complete
    losses: 0,
    avgEdge: data.edges.length > 0 ? data.edges.reduce((a,b) => a+b) / data.edges.length : undefined,
    avgTempo: data.tempos.length > 0 ? data.tempos.reduce((a,b) => a+b) / data.tempos.length : undefined
  });
}
```

### Performance Dashboard API:
```typescript
// File: src/app/api/admin/performance/route.ts
import { getDailyPerformanceSummary } from "@/lib/performance-tracker";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '7');
  const sport = searchParams.get('sport') || 'NCAAMB';
  
  const summaries = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    
    const summary = await getDailyPerformanceSummary(date, sport);
    if (summary.length > 0) {
      summaries.push({
        date: date.toISOString().split('T')[0],
        performance: summary
      });
    }
  }
  
  return NextResponse.json({ summaries });
}
```

### Performance Analysis Script:
```typescript
// File: scripts/performance-analysis.ts
export async function analyzeABTestResults() {
  console.log("📊 A/B Test Performance Analysis");
  console.log("=================================");
  
  // Compare original vs optimized for each tier
  const results = await prisma.performanceMetric.findMany({
    where: {
      date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      sport: 'NCAAMB'
    },
    orderBy: [{ confidence: 'desc' }, { flagVersion: 'asc' }]
  });
  
  const byTier: { [key: string]: { original?: any, optimized?: any } } = {};
  
  results.forEach(result => {
    const tierKey = `${result.confidence}star`;
    if (!byTier[tierKey]) byTier[tierKey] = {};
    
    if (result.flagVersion === 'original' || !result.flagVersion) {
      byTier[tierKey].original = result;
    } else {
      byTier[tierKey].optimized = result;
    }
  });
  
  // Generate recommendations
  console.log("\n🎯 A/B TEST RESULTS & RECOMMENDATIONS:");
  
  for (const [tier, data] of Object.entries(byTier)) {
    if (data.original && data.optimized) {
      const improvement = data.optimized.winRate - data.original.winRate;
      const status = improvement > 0.02 ? "✅ DEPLOY" : improvement > 0 ? "⚠️ MARGINAL" : "❌ REVERT";
      
      console.log(`\n${tier}:`);
      console.log(`  Original: ${data.original.wins}-${data.original.losses} (${(data.original.winRate * 100).toFixed(1)}%)`);
      console.log(`  Optimized: ${data.optimized.wins}-${data.optimized.losses} (${(data.optimized.winRate * 100).toFixed(1)}%)`);
      console.log(`  Improvement: ${(improvement * 100).toFixed(1)}% | ${status}`);
    }
  }
}
```

---

## VALIDATION CHECKLIST

### 3★ Optimization ✅
- [ ] A/B test flag created: `optimize_3star_thresholds`
- [ ] New logic: UNDER ≥8.5 edge, OVER ≥15 edge + tempo≥68
- [ ] Backtest shows improvement over original (54.9% → 60%+)
- [ ] Pick generation logs show A/B version for each 3★ pick

### Performance Monitoring ✅  
- [ ] `PerformanceMetric` model added to schema
- [ ] Performance tracking integrated into pick generation
- [ ] API endpoint `/api/admin/performance` functional
- [ ] Daily performance summaries generated
- [ ] A/B test analysis script shows clear recommendations

### Success Criteria ✅
- [ ] 3★ OVER picks improve from 50.0% → 55%+
- [ ] 3★ UNDER picks maintain 58%+ with more volume
- [ ] Overall 3★ performance improves from 54.9% → 62%+
- [ ] Monitoring dashboard shows real-time A/B performance
- [ ] Can make data-driven decisions on flag rollouts

---

## NEXT STEPS (Day 3)

Based on monitoring results:
1. **If 3★ optimization successful:** Roll out to 100%, move to spread picks
2. **If marginal improvement:** Test alternative thresholds (OVER ≥16, tempo ≥70)  
3. **If no improvement:** Revert flags, analyze why backtest didn't predict live performance
4. **Build:** Automated flag rollout based on performance thresholds

The systematic improvement engine is working! 🚀🌪️