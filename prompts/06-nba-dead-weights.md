# Prompt 06: Fix NBA Dead Signal Weights (30% Spread, 20% O/U Wasted)

**Priority:** 🔴 P1 — NBA picks systematically can't reach high confidence  
**Audit:** Pick Engine (HIGH)  
**Impact:** NBA has 30% dead spread weight (restDays + trendAngles never fire) and 20% dead O/U weight. Nearly impossible to generate 4★/5★ NBA picks.

---

## Copy-paste this into Claude:

```
Fix the NBA dead signal weight problem in pick-engine.ts. Multiple signals never fire for NBA, but their weights still count toward the maximum possible score, deflating all NBA confidence scores.

**Dead signals for NBA:**

1. `signalRestDays` — explicitly returns neutral for non-NCAAMB (line ~656). NBA weight: 0.10 spread (wasted)
2. `discoverTeamAngles` — explicitly returns empty for NBA (line ~471). NBA weight: 0.20 spread, 0.20 O/U (wasted)
3. Total dead weight: 0.30 spread, 0.20 O/U

**File:** `src/lib/pick-engine.ts`

**Fix — two-part approach:**

## Part 1: Enable NBA rest days signal (it's the #1 situational edge in NBA)

In `signalRestDays` (around line 656), change:
```typescript
if (sport !== "NCAAMB") {
  return { category: "restDays", direction: "neutral", ... };
}
```

To handle NBA:
```typescript
if (sport !== "NCAAMB" && sport !== "NBA") {
  return { category: "restDays", direction: "neutral", ... };
}
```

Then add NBA-specific B2B logic. NBA B2B is even MORE impactful than NCAAMB:
- Team on B2B: historically covers ~5% less ATS
- Second game of B2B on the road: even worse
- Use same 36h lookback window

The NCAAMB B2B detection logic (checking last game within 36h) works for NBA too. You can reuse it as-is.

## Part 2: Redistribute NBA trend angle weight

Since reverse lookup doesn't support NBA yet (no trend angles), redistribute the 0.20 weight to signals that DO fire:

```typescript
NBA: {
  modelEdge: 0.20,      // was 0.15, +0.05
  seasonATS: 0.20,       // was 0.15, +0.05
  trendAngles: 0.00,     // was 0.20, disabled until NBA reverse lookup exists
  recentForm: 0.20,      // was 0.15, +0.05
  h2h: 0.05,
  situational: 0.05,
  restDays: 0.15,        // was 0.10, +0.05 (now that it fires)
  eloEdge: 0.05,
  nbaFourFactors: 0.10,
},
```

Do the same for NBA O/U weights — redistribute trendAngles: 0.20 to other active signals.

## Part 3: Fix the `|| 0.1` fallback

In `computeConvergenceScore` (around line 1898):
```typescript
// Before:
const w = weights[signal.category] || 0.1;

// After:  
const w = weights[signal.category] ?? 0.1;
```

This prevents explicit 0.0 weights (like trendAngles: 0.00) from accidentally getting 0.1.
```
