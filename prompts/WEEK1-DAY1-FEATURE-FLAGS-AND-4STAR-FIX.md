# 🚀 Week 1 Day 1: Feature Flag System + 4★ Threshold Fix

**Context:** Current system at 53.5% win rate. Major issue: 4★ tier performing at 47.4% (9-10 record). Need infrastructure to systematically improve without breaking what works.

**Goal:** Build feature flag infrastructure + fix bleeding 4★ threshold issue via A/B testing

**Time Estimate:** 6-8 hours

**Success Criteria:**
- Feature flag system operational with admin API
- 4★ threshold A/B test deployed  
- Monitoring shows which code paths are executing
- Backtest validates improvement potential

---

## TASK 1: Feature Flag System Infrastructure (3-4 hours)

### Step 1A: Database Schema

**Add to `prisma/schema.prisma`:**

```prisma
model FeatureFlag {
  id        String   @id @default(cuid())
  key       String   @unique       // e.g. "fix_4star_threshold"
  enabled   Boolean  @default(false)
  rollout   Float    @default(0.0) // 0-1 for percentage rollout
  sport     String?                // null = all sports, "NCAAMB" = basketball only
  metadata  Json?                  // arbitrary config data
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("FeatureFlag")
}

// Add to existing PickGenerationRun model:
model PickGenerationRun {
  // ... existing fields
  activeFlags Json? // Store which flags were active for this run
  
  // ... rest of model
}
```

**Run migration:**
```bash
npx prisma migrate dev --name add_feature_flags
```

### Step 1B: Feature Flag Engine

**File: `src/lib/feature-flags.ts`**

```typescript
import "server-only";
import { prisma } from "./db";

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  rollout: number;
  sport: string | null;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlagContext {
  sport?: string;
  gameId?: string;
  userId?: string;
  date?: Date;
}

// In-memory cache with TTL
const flagCache = new Map<string, { flag: FeatureFlag; expires: number }>();
const CACHE_TTL_MS = 60000; // 60 seconds

/**
 * Check if a feature flag is enabled for the given context
 */
export async function isEnabled(key: string, context?: FlagContext): Promise<boolean> {
  const flag = await getFlag(key);
  if (!flag) return false;
  
  // Check sport filter
  if (flag.sport && context?.sport && flag.sport !== context.sport) {
    return false;
  }
  
  // Simple enabled/disabled check
  if (!flag.enabled) return false;
  
  // Rollout percentage check
  if (flag.rollout <= 0) return false;
  if (flag.rollout >= 1) return true;
  
  // Hash-based deterministic rollout
  // Use gameId or userId for consistency, fallback to random
  const seed = context?.gameId || context?.userId || Math.random().toString();
  const hash = simpleHash(seed + key);
  const percentage = (hash % 100) / 100;
  
  return percentage < flag.rollout;
}

/**
 * Get a specific feature flag
 */
export async function getFlag(key: string): Promise<FeatureFlag | null> {
  // Check cache first
  const cached = flagCache.get(key);
  if (cached && Date.now() < cached.expires) {
    return cached.flag;
  }
  
  // Fetch from database
  const flag = await prisma.featureFlag.findUnique({
    where: { key }
  });
  
  if (flag) {
    // Cache for TTL
    flagCache.set(key, {
      flag,
      expires: Date.now() + CACHE_TTL_MS
    });
  }
  
  return flag;
}

/**
 * Set/update a feature flag
 */
export async function setFlag(
  key: string, 
  enabled: boolean, 
  options?: { rollout?: number; sport?: string; metadata?: any }
): Promise<FeatureFlag> {
  const flag = await prisma.featureFlag.upsert({
    where: { key },
    update: {
      enabled,
      rollout: options?.rollout ?? (enabled ? 1.0 : 0.0),
      sport: options?.sport ?? null,
      metadata: options?.metadata ?? null
    },
    create: {
      key,
      enabled,
      rollout: options?.rollout ?? (enabled ? 1.0 : 0.0),
      sport: options?.sport ?? null,
      metadata: options?.metadata ?? null
    }
  });
  
  // Invalidate cache
  flagCache.delete(key);
  
  return flag;
}

/**
 * Load all flags for a context (used by pick engine)
 */
export async function loadActiveFlags(context?: FlagContext): Promise<Record<string, boolean>> {
  const flags = await prisma.featureFlag.findMany({
    where: {
      enabled: true,
      sport: context?.sport ? { in: [null, context.sport] } : undefined
    }
  });
  
  const result: Record<string, boolean> = {};
  
  for (const flag of flags) {
    result[flag.key] = await isEnabled(flag.key, context);
  }
  
  return result;
}

/**
 * Simple hash function for deterministic rollouts
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Clear flag cache (for testing)
 */
export function clearFlagCache(): void {
  flagCache.clear();
}
```

### Step 1C: Admin API Endpoints

**File: `src/app/api/admin/flags/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getFlag, setFlag } from "@/lib/feature-flags";
import { prisma } from "@/lib/db";

// GET /api/admin/flags - List all flags
export async function GET() {
  try {
    const flags = await prisma.featureFlag.findMany({
      orderBy: { key: 'asc' }
    });
    
    return NextResponse.json({ flags });
  } catch (error) {
    console.error('Failed to fetch flags:', error);
    return NextResponse.json(
      { error: 'Failed to fetch flags' }, 
      { status: 500 }
    );
  }
}

// POST /api/admin/flags - Create or update flag
export async function POST(request: NextRequest) {
  try {
    const { key, enabled, rollout, sport, metadata } = await request.json();
    
    if (!key || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Key and enabled are required' },
        { status: 400 }
      );
    }
    
    const flag = await setFlag(key, enabled, { rollout, sport, metadata });
    
    return NextResponse.json({ flag });
  } catch (error) {
    console.error('Failed to set flag:', error);
    return NextResponse.json(
      { error: 'Failed to set flag' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/flags/[key] 
export async function DELETE(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    await prisma.featureFlag.delete({
      where: { key: params.key }
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete flag:', error);
    return NextResponse.json(
      { error: 'Failed to delete flag' },
      { status: 500 }
    );
  }
}
```

### Step 1D: Integration into Pick Engine

**Modify `src/lib/pick-engine.ts`:**

**At the top of the file, add imports:**
```typescript
import { loadActiveFlags, isEnabled } from "./feature-flags";
```

**In `generateDailyPicks()` function, after the initial setup:**
```typescript
export async function generateDailyPicks(
  sport: Sport,
  targetDate: Date,
  upcomingGames: UpcomingGame[],
  context: PickGenerationContext
): Promise<DailyPickResult[]> {
  // ... existing setup code

  // Load feature flags for this generation run
  const flags = await loadActiveFlags({ sport, date: targetDate });
  console.log(`[${sport}] Active flags:`, Object.keys(flags).filter(k => flags[k]));
  
  // Store active flags in context for logging
  context.activeFlags = flags;

  // ... rest of function
```

**Pass flags through the pipeline to functions that need them.**

### Step 1E: Testing the Feature Flag System

**File: `src/lib/__tests__/feature-flags.test.ts`**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { isEnabled, setFlag, getFlag, clearFlagCache } from "../feature-flags";
import { prisma } from "../db";

describe("Feature Flags", () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.featureFlag.deleteMany({
      where: { key: { startsWith: "test_" } }
    });
    clearFlagCache();
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.featureFlag.deleteMany({
      where: { key: { startsWith: "test_" } }
    });
    clearFlagCache();
  });

  test("should create and retrieve feature flags", async () => {
    await setFlag("test_basic_flag", true);
    
    const flag = await getFlag("test_basic_flag");
    expect(flag).toBeTruthy();
    expect(flag?.enabled).toBe(true);
    expect(flag?.key).toBe("test_basic_flag");
  });

  test("should respect enabled/disabled state", async () => {
    await setFlag("test_enabled", true);
    await setFlag("test_disabled", false);
    
    expect(await isEnabled("test_enabled")).toBe(true);
    expect(await isEnabled("test_disabled")).toBe(false);
    expect(await isEnabled("test_nonexistent")).toBe(false);
  });

  test("should handle rollout percentages", async () => {
    await setFlag("test_rollout_50", true, { rollout: 0.5 });
    
    // Test multiple times with same context - should be deterministic
    const context = { gameId: "test_game_123" };
    const result1 = await isEnabled("test_rollout_50", context);
    const result2 = await isEnabled("test_rollout_50", context);
    
    expect(result1).toBe(result2); // Should be deterministic
  });

  test("should respect sport filters", async () => {
    await setFlag("test_ncaamb_only", true, { sport: "NCAAMB" });
    
    expect(await isEnabled("test_ncaamb_only", { sport: "NCAAMB" })).toBe(true);
    expect(await isEnabled("test_ncaamb_only", { sport: "NFL" })).toBe(false);
    expect(await isEnabled("test_ncaamb_only")).toBe(true); // No context = allowed
  });

  test("should cache flags with TTL", async () => {
    await setFlag("test_cache", true);
    
    // First call should hit database
    const start = Date.now();
    await getFlag("test_cache");
    const firstCallTime = Date.now() - start;
    
    // Second call should hit cache (much faster)
    const start2 = Date.now();
    await getFlag("test_cache");
    const secondCallTime = Date.now() - start2;
    
    expect(secondCallTime).toBeLessThan(firstCallTime);
  });
});
```

**File: `src/lib/__tests__/flag-integration.test.ts`**

```typescript
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { setFlag, clearFlagCache } from "../feature-flags";
import { generateDailyPicks } from "../pick-engine";
import { prisma } from "../db";

describe("Feature Flag Integration", () => {
  beforeEach(async () => {
    await prisma.featureFlag.deleteMany({
      where: { key: { startsWith: "test_" } }
    });
    clearFlagCache();
  });

  afterEach(async () => {
    await prisma.featureFlag.deleteMany({
      where: { key: { startsWith: "test_" } }
    });
    clearFlagCache();
  });

  test("should load flags in pick generation", async () => {
    // Create test flag
    await setFlag("test_integration_flag", true, { sport: "NCAAMB" });
    
    // Mock context and games
    const context = {
      date: new Date(),
      sport: "NCAAMB" as const,
      gamesAvailable: 1,
      gamesProcessed: 0,
      picksGenerated: 0,
      rejectedInsufficientSignals: 0,
      rejectedLowConfidence: 0,
      kenpomAvailable: true,
      cfbdAvailable: false,
      fanmatchAvailable: false,
      gamesErrored: 0
    };
    
    const mockGames = [{
      id: "test_game",
      sport: "NCAAMB" as const,
      homeTeam: "Duke",
      awayTeam: "UNC", 
      gameDate: new Date(),
      spread: -5.5,
      overUnder: 155.5,
      homeRank: 1,
      awayRank: 5,
      isNeutralSite: false
    }];
    
    // This should not throw and should load flags
    const result = await generateDailyPicks("NCAAMB", new Date(), mockGames, context);
    
    // Verify flags were loaded (check context or logs)
    expect(context.activeFlags).toBeDefined();
    expect(context.activeFlags?.test_integration_flag).toBe(true);
  });
});
```

---

## TASK 2: Fix 4★ Threshold Issue via A/B Testing (2-3 hours)

### Step 2A: Create 4★ Threshold Fix Flag

**Initialize the flag:**
```typescript
// Add this to a setup script or run manually
await setFlag("fix_4star_threshold", false, { 
  rollout: 0.5, // Start with 50% A/B test
  sport: "NCAAMB",
  metadata: { 
    description: "Fix 4★ O/U threshold from -12/-15 to -14/-16",
    originalThreshold: "ou_edge <= -12 AND ou_edge >= -15",
    newThreshold: "ou_edge <= -14 AND ou_edge >= -16",
    currentPerformance: "9-10 (47.4%)",
    targetPerformance: ">60%"
  }
});
```

### Step 2B: Implement A/B Test in Pick Engine

**In `src/lib/pick-engine.ts`, find the 4★ O/U confidence logic (around line 3603):**

**Replace this:**
```typescript
} else if (ouDir === "under" && absEdge >= tier4Threshold) {
  confidence = 4; // 74.9% OOS, ~16.7/wk (boosted in March tourneys)
```

**With this:**
```typescript
} else if (ouDir === "under") {
  // 4★ tier: A/B test improved threshold
  if (flags.fix_4star_threshold) {
    // New tighter threshold + tempo requirement
    if (absEdge >= 14 && absEdge <= 16 && avgTempo <= 66) {
      confidence = 4;
      reasoningSteps.push("4★ UNDER: tight edge + slow tempo (A/B test)");
    }
  } else {
    // Original threshold (known to underperform)
    if (absEdge >= 12 && absEdge <= 15) {
      confidence = 4;
      reasoningSteps.push("4★ UNDER: original threshold");
    }
  }
```

### Step 2C: Monitoring and Logging

**Add logging to track A/B performance:**

```typescript
// In pick generation, after determining confidence:
if (confidence === 4) {
  const flagVersion = flags.fix_4star_threshold ? "new_threshold" : "original_threshold";
  
  // Log for analysis
  console.log(`[4★ A/B] ${flagVersion}: ${homeTeam} vs ${awayTeam} | Edge: ${absEdge} | Tempo: ${avgTempo}`);
  
  // Store in metadata for analysis
  metadata = {
    ...metadata,
    fourStarABTest: {
      version: flagVersion,
      edge: absEdge,
      tempo: avgTempo,
      reasoning: reasoningSteps
    }
  };
}
```

### Step 2D: Backtest Validation Script

**File: `scripts/validate-4star-fix.ts`**

```typescript
/**
 * Validate 4★ threshold fix against last 30 days
 */
import { prisma } from "../src/lib/db";

async function validate4StarFix() {
  console.log("🏀 Validating 4★ Threshold Fix");
  console.log("================================");
  
  // Get last 30 days of NCAAMB games
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const games = await prisma.nCAAMBGame.findMany({
    where: {
      gameDate: { gte: thirtyDaysAgo },
      homeScore: { not: null },
      awayScore: { not: null },
      homeAdjOE: { not: null },
      awayAdjOE: { not: null },
      homeAdjTempo: { not: null },
      awayAdjTempo: { not: null },
      overUnder: { not: null }
    }
  });
  
  console.log(`📊 Testing ${games.length} completed games`);
  
  let originalPicks = { total: 0, wins: 0 };
  let newPicks = { total: 0, wins: 0 };
  
  for (const game of games) {
    const actualTotal = (game.homeScore || 0) + (game.awayScore || 0);
    const avgTempo = ((game.homeAdjTempo || 0) + (game.awayAdjTempo || 0)) / 2;
    const ouEdge = ((game.homeAdjOE || 0) + (game.awayAdjOE || 0)) * avgTempo / 200 - (game.overUnder || 0);
    const absEdge = Math.abs(ouEdge);
    
    // Original threshold
    if (ouEdge < 0 && absEdge >= 12 && absEdge <= 15) {
      originalPicks.total++;
      if (actualTotal < (game.overUnder || 0)) {
        originalPicks.wins++;
      }
    }
    
    // New threshold
    if (ouEdge < 0 && absEdge >= 14 && absEdge <= 16 && avgTempo <= 66) {
      newPicks.total++;
      if (actualTotal < (game.overUnder || 0)) {
        newPicks.wins++;
      }
    }
  }
  
  const originalWinRate = originalPicks.total > 0 ? (originalPicks.wins / originalPicks.total * 100) : 0;
  const newWinRate = newPicks.total > 0 ? (newPicks.wins / newPicks.total * 100) : 0;
  
  console.log("\n📈 BACKTEST RESULTS");
  console.log(`Original Threshold: ${originalPicks.wins}-${originalPicks.total - originalPicks.wins} (${originalWinRate.toFixed(1)}%)`);
  console.log(`New Threshold: ${newPicks.wins}-${newPicks.total - newPicks.wins} (${newWinRate.toFixed(1)}%)`);
  console.log(`Improvement: ${(newWinRate - originalWinRate).toFixed(1)} percentage points`);
  
  if (newWinRate > 60) {
    console.log("✅ New threshold meets 60%+ target");
  } else {
    console.log("⚠️ New threshold below 60% target - may need further adjustment");
  }
}

validate4StarFix().catch(console.error);
```

---

## TASK 3: Testing and Validation (1-2 hours)

### Step 3A: Unit Tests
```bash
# Run feature flag tests
npm test src/lib/__tests__/feature-flags.test.ts

# Run integration tests  
npm test src/lib/__tests__/flag-integration.test.ts
```

### Step 3B: Backtest Validation
```bash
# Validate the 4★ fix shows improvement
npx tsx scripts/validate-4star-fix.ts
```

### Step 3C: API Testing
```bash
# Test admin endpoints
curl -X GET http://localhost:3000/api/admin/flags

# Create test flag
curl -X POST http://localhost:3000/api/admin/flags \
  -H "Content-Type: application/json" \
  -d '{"key":"test_api","enabled":true,"rollout":0.5}'

# Verify it was created
curl -X GET http://localhost:3000/api/admin/flags
```

### Step 3D: Integration Test in Development
```bash
# Generate picks with flags enabled
npm run dev
# Navigate to pick generation interface
# Verify logs show "Active flags: fix_4star_threshold" 
# Verify 4★ picks use new threshold reasoning
```

---

## SUCCESS CRITERIA CHECKLIST

### Feature Flag System ✅
- [ ] Database schema deployed with FeatureFlag model
- [ ] `isEnabled()` function works with rollout percentages  
- [ ] Admin API endpoints functional (GET, POST, DELETE)
- [ ] Pick engine loads flags without errors
- [ ] Unit tests pass (flags.test.ts, flag-integration.test.ts)
- [ ] Cache working (second call faster than first)

### 4★ Threshold Fix ✅  
- [ ] A/B test flag created and configured
- [ ] Pick engine uses new logic when flag enabled
- [ ] Backtest shows improvement over original threshold
- [ ] Logging captures A/B test version for each 4★ pick
- [ ] New threshold targets 60%+ win rate (vs 47.4% current)

### Operational Readiness ✅
- [ ] Can toggle A/B test on/off without code deployment
- [ ] Monitoring shows which version of code is executing
- [ ] Rollback procedure tested (set flag to false)
- [ ] Performance impact negligible (<10ms per pick generation)

---

## NEXT STEPS (Day 2)

1. **Deploy A/B Test:** Start with 50% rollout, monitor for 24-48 hours
2. **Performance Analysis:** Compare new vs original threshold performance
3. **Scale Decision:** If new threshold performs >60%, increase rollout to 100%
4. **Iterate:** If still underperforming, test alternative thresholds (edge 15-17, tempo ≤64, etc.)

---

## ROLLBACK PLAN

If anything breaks:
```bash
# Emergency disable all flags
curl -X POST http://localhost:3000/api/admin/flags \
  -d '{"key":"fix_4star_threshold","enabled":false}'

# Or via database
psql $DATABASE_URL -c "UPDATE \"FeatureFlag\" SET enabled = false WHERE key = 'fix_4star_threshold';"
```

System will immediately revert to original behavior within 60 seconds (cache TTL).

---

This is **integration-first development** in action. Infrastructure before optimization. Testing before deployment. Measurement before celebration. 🌪️