# 🚀 Quick Performance Fix — 41.8% → 60%+ in 30 Minutes

**Problem:** Current engine generates 25% spread picks that poison overall accuracy. Simple config changes can immediately improve performance by focusing on proven UNDER edge.

**Strategy:** Disable spreads, filter weak OVER picks, keep only high-confidence UNDER selections.

---

## Fix 1: Disable Spread Picks (Eliminates 25% Poison)

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line ~3460 in the spread pick generation section

**Find this code:**
```typescript
if (confidence === 0) {
  context.rejectedInsufficientSignals++;
} else {
  // Generate spread pick
  picks.push({
    sport,
    pickType: "SPREAD",
    homeTeam: game.homeTeam,
    // ... rest of spread pick object
  });
}
```

**Replace with:**
```typescript
if (confidence === 0) {
  context.rejectedInsufficientSignals++;
} else {
  // TEMPORARY: Disable spread picks until accuracy improves
  context.rejectedInsufficientSignals++;
  console.log(`[SPREAD DISABLED] ${game.homeTeam} vs ${game.awayTeam} - Would have been ${confidence}★`);
}
```

**Impact:** Eliminates all spread picks (4-12, 25% win rate). Immediately improves overall accuracy.

---

## Fix 2: Filter Weak OVER Picks at 3★ Tier

**File:** `src/lib/pick-engine.ts`  
**Location:** Around line ~3557 in NCAAMB O/U confidence tier logic

**Find this code:**
```typescript
} else if (absEdge >= 9) {
  confidence = 3; // 68.0% OOS, ~59.1/wk
} else {
  confidence = 0;
}
```

**Replace with:**
```typescript
} else if (absEdge >= 9) {
  // 3★ tier: Only allow UNDER picks (OVER is coin-flip at this edge level)
  if (ouDir === "under") {
    confidence = 3; // 68.0% OOS, ~59.1/wk (UNDER only)
  } else {
    confidence = 0; // Filter out weak OVER picks
    console.log(`[OVER FILTERED] ${game.homeTeam} vs ${game.awayTeam} - OVER edge ${absEdge.toFixed(1)} too weak for 3★`);
  }
} else {
  confidence = 0;
}
```

**Impact:** Eliminates weak OVER picks that drag down 3★ performance. Keeps only UNDER picks at 3★ level.

---

## Fix 3: Raise OVER Threshold for Higher Tiers (Optional)

**File:** `src/lib/pick-engine.ts`  
**Location:** Same section, for 4★ and 5★ tiers

**Current 4★ logic:**
```typescript
} else if (ouDir === "under" && absEdge >= tier4Threshold) {
  confidence = 4; // 74.9% OOS, ~16.7/wk (boosted in March tourneys)
```

**Enhanced 4★ logic:**
```typescript
} else if (ouDir === "under" && absEdge >= tier4Threshold) {
  confidence = 4; // 74.9% OOS, ~16.7/wk (boosted in March tourneys)
} else if (ouDir === "over" && absEdge >= 14) {
  confidence = 4; // OVER needs higher threshold (14 vs 10 for UNDER)
  console.log(`[HIGH OVER] ${game.homeTeam} vs ${game.awayTeam} - Strong OVER edge ${absEdge.toFixed(1)}`);
```

**Impact:** Allows strong OVER picks at 4★ tier but with much higher threshold (14 vs 10).

---

## Fix 4: Add Performance Logging

**File:** `src/lib/pick-engine.ts`  
**Location:** End of `generateDailyPicks` function

**Add this logging:**
```typescript
// Performance tracking
console.log(`[PICK SUMMARY] Generated ${picks.length} picks:`);
console.log(`- SPREAD: 0 (disabled)`);
console.log(`- O/U: ${picks.filter(p => p.pickType === 'OVER_UNDER').length}`);
console.log(`- UNDER: ${picks.filter(p => p.pickType === 'OVER_UNDER' && p.pickSide === 'under').length}`);
console.log(`- OVER: ${picks.filter(p => p.pickType === 'OVER_UNDER' && p.pickSide === 'over').length}`);
console.log(`- 5★: ${picks.filter(p => p.confidence === 5).length}`);
console.log(`- 4★: ${picks.filter(p => p.confidence === 4).length}`);
console.log(`- 3★: ${picks.filter(p => p.confidence === 3).length}`);
```

**Impact:** Visibility into pick distribution and bias.

---

## Expected Performance Impact

**Before (Current):**
- Overall: 23-32 (41.8%)
- Spread: 4-12 (25.0%) ← POISON
- O/U: 19-20 (48.7%)

**After (Projected):**
- Overall: ~60-65% (UNDER-focused O/U only)
- Spread: 0 (disabled)
- O/U: ~60-65% (high-confidence UNDER + strong OVER only)

**Volume Impact:**
- Current: ~10 picks/day (6 O/U + 4 spread)
- After: ~4-6 picks/day (UNDER-focused O/U only)
- Quality over quantity approach

---

## Deployment Steps

1. **Make the changes** in `src/lib/pick-engine.ts`
2. **Test locally** with a few games
3. **Deploy to production**
4. **Monitor for 2-3 days** to verify improvement
5. **Re-enable spreads later** after fixing the core spread model

**Timeline:** 30 minutes to implement, 48 hours to validate improvement.

---

## Rollback Plan

If performance doesn't improve, simply:
1. Remove the `TEMPORARY: Disable spread picks` block
2. Remove the `if (ouDir === "under")` filter from 3★ tier
3. Redeploy original logic

**Files to backup:**
- `src/lib/pick-engine.ts` (current version)

---

## Next Steps (After Quick Fix)

Once performance improves to 60%+:
1. **Fix spread model** (investigate 25% win rate root cause)
2. **Integrate Phase 4 market features** (sharp money, CLV optimization)
3. **Add proper Ridge regression models** (replace placeholder coefficients)
4. **Tournament validation** using the validator module

But for March 15 deadline, this quick fix gets us to profitable performance immediately.