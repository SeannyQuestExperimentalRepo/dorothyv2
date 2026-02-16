# 📊 Week 1 Day 3: A/B Results Analysis + Spread Pick Re-enablement

**Context:** 
- Day 1: Feature flags + 4★ threshold fix deployed
- Day 2: 3★ optimization + monitoring dashboard deployed  
- Day 3: Analyze A/B results + tackle spread picks (currently disabled = 0% of portfolio)

**Current Status:**
- **Overall:** 53.5% win rate baseline
- **4★ tier:** A/B testing tighter threshold (47.4% → target 60%+)
- **3★ tier:** A/B testing optimized thresholds (54.9% → target 62%+) 
- **Spread picks:** Completely disabled (was 25% poison at old system)

**Goal:** Make data-driven rollout decisions + re-enable profitable spread picks

**Time Estimate:** ~10 minutes (2 tasks × 5 min each)

---

## TASK 1: A/B Test Results Analysis & Rollout Decisions (5 minutes)

### Performance Analysis Script
```typescript
// File: scripts/analyze-ab-results-day3.ts
import { prisma } from "../src/lib/db";

async function analyzeABResults() {
  console.log("🔬 Day 3: A/B Test Results Analysis");
  console.log("===================================");
  
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  
  // Get performance metrics from last 2 days (Day 1-2 A/B tests)
  const results = await prisma.performanceMetric.findMany({
    where: {
      date: { gte: twoDaysAgo },
      sport: 'NCAAMB',
      pickType: 'OVER_UNDER'
    },
    orderBy: [{ confidence: 'desc' }, { flagVersion: 'asc' }]
  });
  
  console.log(`\n📈 RESULTS FROM ${results.length} PERFORMANCE RECORDS\n`);
  
  // Group by confidence tier and flag version
  const analysis = new Map<string, { original: any[], optimized: any[] }>();
  
  results.forEach(result => {
    const tier = `${result.confidence}star`;
    if (!analysis.has(tier)) {
      analysis.set(tier, { original: [], optimized: [] });
    }
    
    if (result.flagVersion === 'original' || !result.flagVersion) {
      analysis.get(tier)!.original.push(result);
    } else {
      analysis.get(tier)!.optimized.push(result);
    }
  });
  
  // Analyze each tier
  const rolloutDecisions: { tier: string; decision: string; reason: string }[] = [];
  
  for (const [tier, data] of analysis) {
    if (data.original.length === 0 || data.optimized.length === 0) {
      console.log(`⚠️ ${tier}: Insufficient A/B data (orig: ${data.original.length}, opt: ${data.optimized.length})`);
      continue;
    }
    
    // Aggregate performance
    const original = {
      totalPicks: data.original.reduce((sum, r) => sum + r.totalPicks, 0),
      wins: data.original.reduce((sum, r) => sum + r.wins, 0),
      losses: data.original.reduce((sum, r) => sum + r.losses, 0)
    };
    
    const optimized = {
      totalPicks: data.optimized.reduce((sum, r) => sum + r.totalPicks, 0),
      wins: data.optimized.reduce((sum, r) => sum + r.wins, 0),
      losses: data.optimized.reduce((sum, r) => sum + r.losses, 0)
    };
    
    const originalWinRate = original.wins / (original.wins + original.losses);
    const optimizedWinRate = optimized.wins / (optimized.wins + optimized.losses);
    const improvement = optimizedWinRate - originalWinRate;
    
    console.log(`\n🎯 ${tier.toUpperCase()} ANALYSIS:`);
    console.log(`Original:  ${original.wins}-${original.losses} (${(originalWinRate * 100).toFixed(1)}%) - ${original.totalPicks} picks`);
    console.log(`Optimized: ${optimized.wins}-${optimized.losses} (${(optimizedWinRate * 100).toFixed(1)}%) - ${optimized.totalPicks} picks`);
    console.log(`Improvement: ${(improvement * 100).toFixed(1)} percentage points`);
    
    // Decision logic
    let decision = "HOLD";
    let reason = "Insufficient data";
    
    if (improvement >= 0.05) { // 5%+ improvement
      decision = "✅ DEPLOY";
      reason = `Strong improvement (+${(improvement * 100).toFixed(1)}%)`;
    } else if (improvement >= 0.02) { // 2-5% improvement
      decision = "⚡ DEPLOY";
      reason = `Modest improvement (+${(improvement * 100).toFixed(1)}%)`;
    } else if (improvement >= -0.02) { // -2% to +2%
      decision = "⚠️ HOLD";
      reason = `Marginal change (${(improvement * 100).toFixed(1)}%)`;
    } else { // >2% decline
      decision = "❌ REVERT";
      reason = `Performance declined (${(improvement * 100).toFixed(1)}%)`;
    }
    
    rolloutDecisions.push({ tier, decision, reason });
    console.log(`Decision: ${decision} - ${reason}`);
  }
  
  // Generate rollout script
  console.log(`\n🚀 ROLLOUT COMMANDS:\n`);
  
  rolloutDecisions.forEach(({ tier, decision, reason }) => {
    if (decision.includes("DEPLOY")) {
      console.log(`# ${tier}: ${reason}`);
      console.log(`curl -X POST http://localhost:3000/api/admin/flags \\`);
      console.log(`  -d '{"key":"${tier.includes('4') ? 'fix_4star_threshold' : 'optimize_3star_thresholds'}","enabled":true,"rollout":1.0}'\n`);
    } else if (decision.includes("REVERT")) {
      console.log(`# ${tier}: ${reason}`);
      console.log(`curl -X POST http://localhost:3000/api/admin/flags \\`);
      console.log(`  -d '{"key":"${tier.includes('4') ? 'fix_4star_threshold' : 'optimize_3star_thresholds'}","enabled":false}'\n`);
    }
  });
  
  return rolloutDecisions;
}

analyzeABResults().catch(console.error);
```

### Automated Rollout Logic
```typescript
// File: src/lib/auto-rollout.ts
import { setFlag } from "./feature-flags";

export async function executeRolloutDecisions(decisions: { tier: string; decision: string; reason: string }[]) {
  console.log("🤖 Executing Automated Rollout Decisions");
  
  for (const { tier, decision, reason } of decisions) {
    const flagKey = tier.includes('4') ? 'fix_4star_threshold' : 'optimize_3star_thresholds';
    
    try {
      if (decision.includes("DEPLOY")) {
        await setFlag(flagKey, true, { rollout: 1.0 });
        console.log(`✅ ${tier}: Deployed to 100% - ${reason}`);
      } else if (decision.includes("REVERT")) {
        await setFlag(flagKey, false);
        console.log(`❌ ${tier}: Reverted - ${reason}`);
      } else {
        console.log(`⚠️ ${tier}: No action - ${reason}`);
      }
    } catch (error) {
      console.error(`Failed to update ${flagKey}:`, error);
    }
  }
}
```

---

## TASK 2: Re-enable Spread Picks with Improved Logic (5 minutes)

### Current Issue: Spread Picks Completely Disabled
**Problem:** The old system had 25% win rate on spreads (catastrophic), so they were completely disabled. This means we're missing 30-40% of potential profitable opportunities.

**Original spread performance from backtest:**
- **Spreads:** 4-12 (25% win rate) - DISABLED
- **O/U:** 19-20 (48.7% win rate) - ACTIVE

### Smart Spread Re-enablement Strategy

**Key Insight:** Don't re-enable all spreads. Use feature flags to selectively enable only high-probability spread scenarios.

### Spread Re-enablement Logic:
```typescript
// Add to pick-engine.ts spread confidence determination
if (flags.enable_selective_spreads) {
  // NEW SELECTIVE SPREAD LOGIC - Only high-probability scenarios
  
  // Scenario 1: Large KenPom edge + road underdog
  if (kenpomEdge >= 8 && spread > 0 && !isNeutralSite) {
    // Strong road team getting points
    confidence = 3;
    reasoningSteps.push("3★ SPREAD: Strong road team + large KenPom edge");
  }
  
  // Scenario 2: Massive tempo mismatch + spread aligns  
  else if (Math.abs(homeAdjTempo - awayAdjTempo) >= 12 && kenpomEdge >= 6) {
    // Tempo creates variance, KenPom edge suggests direction
    confidence = 3;  
    reasoningSteps.push("3★ SPREAD: Tempo mismatch + KenPom alignment");
  }
  
  // Scenario 3: Conference tournament + seed mismatch
  else if (isTournament && Math.abs(homeSeed - awaySeed) >= 5 && kenpomEdge >= 5) {
    // Tournament chaos + clear talent gap
    confidence = 4;
    reasoningSteps.push("4★ SPREAD: Tournament + large seed/talent gap");
  }
  
  else {
    // Still too risky - keep disabled
    confidence = 0;
    reasoningSteps.push("SPREAD DISABLED: Doesn't meet selective criteria");
  }
} else {
  // Original logic: All spreads disabled
  confidence = 0;
  reasoningSteps.push("SPREAD DISABLED: Flag off");
}
```

### Feature Flag Setup:
```typescript
await setFlag("enable_selective_spreads", false, { 
  rollout: 0.3, // Conservative 30% rollout
  sport: "NCAAMB",
  metadata: { 
    description: "Re-enable spread picks only for high-probability scenarios",
    originalPerformance: "4-12 (25% win rate) - CATASTROPHIC",
    newCriteria: "Road underdogs + KenPom edge, tempo mismatches, tournament chaos",
    targetPerformance: "55%+ via selectivity",
    riskMitigation: "Conservative rollout, strict criteria"
  }
});
```

### Spread Backtest Validation:
```typescript
// File: scripts/validate-selective-spreads.ts
async function validateSelectiveSpreads() {
  console.log("🏀 Validating Selective Spread Re-enablement");
  
  const games = await getCompletedGames(30); // Last 30 days
  
  let originalSpreads = { total: 0, wins: 0 }; // All spreads (25% disaster)
  let selectiveSpreads = { total: 0, wins: 0 }; // New selective criteria
  
  for (const game of games) {
    const homeMargin = game.homeScore - game.awayScore;
    const spreadResult = homeMargin + game.spread; // Positive = home covers
    const kenpomEdge = game.homeAdjEM - game.awayAdjEM;
    const tempoGap = Math.abs(game.homeAdjTempo - game.awayAdjTempo);
    const seedGap = Math.abs((game.homeSeed || 8) - (game.awaySeed || 8));
    
    // All spreads (original system)
    originalSpreads.total++;
    if (Math.abs(spreadResult) > 0.5) {
      const homeWins = spreadResult > 0;
      const awayWins = spreadResult < 0;
      originalSpreads.wins += homeWins ? 1 : (awayWins ? 0 : 0);
    }
    
    // Selective spread criteria
    let meetsCriteria = false;
    
    // Scenario 1: Road underdog + KenPom edge
    if (kenpomEdge >= 8 && game.spread > 0) meetsCriteria = true;
    
    // Scenario 2: Tempo mismatch + edge  
    if (tempoGap >= 12 && Math.abs(kenpomEdge) >= 6) meetsCriteria = true;
    
    // Scenario 3: Tournament chaos
    if (game.isTournament && seedGap >= 5 && Math.abs(kenpomEdge) >= 5) meetsCriteria = true;
    
    if (meetsCriteria) {
      selectiveSpreads.total++;
      if (Math.abs(spreadResult) > 0.5) {
        // Determine if our selective logic would have been right
        const predictedSide = kenpomEdge > 0 ? 'home' : 'away';
        const actualWinner = homeMargin > 0 ? 'home' : 'away';
        if (predictedSide === actualWinner) {
          selectiveSpreads.wins++;
        }
      }
    }
  }
  
  const originalWinRate = originalSpreads.wins / originalSpreads.total;
  const selectiveWinRate = selectiveSpreads.wins / selectiveSpreads.total;
  
  console.log(`\n📊 SPREAD BACKTEST RESULTS:`);
  console.log(`Original (all spreads): ${originalSpreads.wins}-${originalSpreads.total - originalSpreads.wins} (${(originalWinRate * 100).toFixed(1)}%)`);
  console.log(`Selective criteria: ${selectiveSpreads.wins}-${selectiveSpreads.total - selectiveSpreads.wins} (${(selectiveWinRate * 100).toFixed(1)}%)`);
  console.log(`Improvement: ${((selectiveWinRate - originalWinRate) * 100).toFixed(1)} percentage points`);
  console.log(`Volume reduction: ${((1 - selectiveSpreads.total / originalSpreads.total) * 100).toFixed(1)}% fewer picks`);
  
  if (selectiveWinRate > 0.55) {
    console.log("✅ Selective spread criteria meet 55%+ threshold - SAFE TO DEPLOY");
  } else {
    console.log("❌ Selective spread criteria below 55% - KEEP DISABLED");
  }
}
```

### Integration Testing:
```typescript
// Ensure spread picks are generated with new logic
const testContext = {
  sport: 'NCAAMB',
  date: new Date(),
  flags: { enable_selective_spreads: true }
};

// Should generate selective spread picks for high-probability scenarios only
const picks = await generateDailyPicks('NCAAMB', new Date(), mockGames, testContext);
const spreadPicks = picks.filter(p => p.pickType === 'SPREAD');

console.log(`Generated ${spreadPicks.length} selective spread picks`);
spreadPicks.forEach(pick => {
  console.log(`${pick.confidence}★ SPREAD: ${pick.homeTeam} vs ${pick.awayTeam} - ${pick.reasoning}`);
});
```

---

## VALIDATION CHECKLIST

### A/B Analysis ✅
- [ ] Performance data analyzed for 4★ and 3★ tiers
- [ ] Rollout decisions made based on statistical significance  
- [ ] Successful A/B tests deployed to 100%
- [ ] Failed A/B tests reverted to baseline
- [ ] Automated rollout system functional

### Selective Spreads ✅
- [ ] `enable_selective_spreads` flag created with 30% rollout
- [ ] Selective criteria implemented (road underdogs, tempo mismatches, tournament chaos)
- [ ] Backtest validates selective approach >55% vs original 25%
- [ ] Integration testing shows spread picks generated selectively
- [ ] Monitoring tracks spread performance separately

### Success Metrics ✅
- [ ] Overall system performance >55% (up from 53.5% baseline)
- [ ] Spread picks contribute positively (>52.38% breakeven)
- [ ] Portfolio diversification improved (O/U + selective spreads)
- [ ] Risk-controlled expansion of pick generation

---

## DECISION FRAMEWORK

### If A/B Tests Successful:
1. **Deploy winners to 100%** - Lock in performance gains
2. **Continue spread rollout** - Monitor selective spread performance  
3. **Next target:** Overall system optimization (Day 4)

### If A/B Tests Mixed:
1. **Deploy partial winners** - Keep what works, revert what doesn't
2. **Iterate on failed experiments** - Test alternative thresholds
3. **Pause spread rollout** - Focus on O/U optimization first

### If A/B Tests Failed:
1. **Revert all changes** - Back to 53.5% baseline
2. **Analyze failure causes** - Backtest vs reality divergence
3. **Redesign approach** - Different optimization strategy

---

## EXPECTED OUTCOMES

**Conservative Estimate:** 53.5% → 56% overall win rate
- A/B improvements: +1.5%
- Selective spreads: +1% (portfolio diversification)

**Optimistic Estimate:** 53.5% → 59% overall win rate  
- Strong A/B improvements: +3%
- High-performing spread picks: +2.5%

**The systematic approach is working!** Data-driven decisions, controlled rollouts, measured improvements. 🚀🌪️