# Phase 2: Tests + Architecture

> **Context Management:** When context reaches 70%, compact the conversation and continue.

This phase builds the testing foundation and refactors architecture for scale. With tournament logic now live (Phase 1.5), we need confidence that the engine works correctly under load. Conference tournaments start ~March 3 (16 days) — this gives us a 10-day validation window.

**Timeline:** 6 days (Feb 16-21)  
**Goal:** Bulletproof the engine before tournament season. Tests catch regressions, architecture handles tournament volume.

The testing is **critical** — 22k lines of pick engine logic with zero unit tests is a disaster waiting to happen during March Madness.

---

## Task 1: Unit Tests for Pick Engine Core Logic

**Why:** The pick engine has complex betting math, confidence tiers, weight calculations, and signal convergence. One bug in confidence tier logic could tank tournament performance. We need to catch regressions before they go live.

**What to test:**
- Confidence tier calculations (especially NCAAMB O/U tournament logic)
- Weight normalization (must sum to 1.0)
- Signal convergence scoring
- Edge calculations (spread and O/U)
- HCA adjustments (neutral site vs home/away)
- Tournament-specific boosts (UNDER 1.3x multiplier)

**Where:** Create `tests/pick-engine.test.ts`

**Test framework setup:**
Install Jest + TypeScript support if not already available:

    npm install --save-dev jest @types/jest ts-jest
    npx jest --init

Create jest.config.js:

    module.exports = {
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/tests'],
      testMatch: ['**/*.test.ts'],
      collectCoverageFrom: [
        'src/lib/**/*.{ts,js}',
        '!src/lib/**/*.d.ts',
      ],
    };

**Key test cases to write:**

    // tests/pick-engine.test.ts
    import { generateDailyPicks } from '../src/lib/pick-engine';
    
    describe('Pick Engine Core', () => {
      describe('NCAAMB O/U Confidence Tiers', () => {
        test('5★ tier: UNDER + edge ≥ 12 + tempo ≤ 64', () => {
          const mockGame = {
            sport: 'NCAAMB',
            isNeutralSite: false,
            gameDate: new Date('2026-02-20'),
            // ... other required fields
          };
          // Mock the ouMeta to return UNDER, absEdge=13, avgTempo=63
          // Verify confidence=5
        });
    
        test('Tournament UNDER boost: 1.3x multiplier for March neutral site', () => {
          const mockGame = {
            sport: 'NCAAMB',
            isNeutralSite: true,
            gameDate: new Date('2026-03-20'), // March tournament
            // ... other required fields
          };
          // Mock ouMeta with absEdge=8, ouDir='under'
          // Verify boosted edge = 8 * 1.3 = 10.4
          // Verify confidence=4 (meets lowered gate of ≥8)
        });
    
        test('4★ tier: UNDER + edge ≥ 10 (regular season)', () => {
          // Test regular season 4★ gate
        });
    
        test('3★ tier: any direction edge ≥ 9', () => {
          // Test general 3★ gate
        });
      });
    
      describe('Weight Calculations', () => {
        test('NCAAMB spread weights sum to 1.0', () => {
          // Import SPREAD_WEIGHTS, verify NCAAMB object sums to 1.0
        });
    
        test('NCAAMB O/U weights sum to 1.0', () => {
          // Import OU_WEIGHTS, verify NCAAMB object sums to 1.0
        });
    
        test('Weight fallback: ?? 0.1 allows explicit 0.0 weights', () => {
          // Test that eloEdge: 0.0 stays 0.0, doesn't become 0.1
        });
      });
    
      describe('Signal Convergence', () => {
        test('Convergence score combines weighted signals correctly', () => {
          // Mock multiple signals with known weights
          // Verify the math: sum(signal.magnitude * weight * confidence)
        });
    
        test('Direction consensus: majority rules', () => {
          // 3 signals say "home", 2 say "away" → direction should be "home"
        });
      });
    
      describe('Tournament Logic', () => {
        test('Neutral site detection: HCA = 0', () => {
          // Mock isNeutralSite=true, verify HCA adjustment
        });
    
        test('Seed mismatch signal: 12v5 upset potential', () => {
          // Mock 12-seed with better KenPom rank than 5-seed
          // Verify signalSeedMismatch fires correctly
        });
      });
    });

**Run the tests:**

    npm test
    npm run test:coverage

Target: **>80% code coverage** on core pick engine functions.

---

## Task 2: Test Team Name Resolution

**Why:** Team name mismatches have been a recurring source of bugs (22 known KenPom↔DB mismatches). The resolver handles ESPN → canonical → KenPom mapping with fuzzy matching. Complex logic, needs tests.

**Where:** Create `tests/team-resolver.test.ts`

**Key test cases:**

    // tests/team-resolver.test.ts
    import { resolveTeamName } from '../src/lib/team-resolver';
    
    describe('Team Name Resolver', () => {
      test('Exact match: Duke → Duke', async () => {
        const result = await resolveTeamName('Duke', 'NCAAMB', 'espn');
        expect(result).toBe('Duke');
      });
    
      test('Alias resolution: St. Bonaventure → Saint Bonaventure', async () => {
        const result = await resolveTeamName('St. Bonaventure', 'NCAAMB', 'kenpom');
        expect(result).toBe('Saint Bonaventure');
      });
    
      test('Fuzzy matching: UNC Chapel Hill → North Carolina', async () => {
        const result = await resolveTeamName('UNC Chapel Hill', 'NCAAMB', 'espn');
        expect(result).toBe('North Carolina');
      });
    
      test('State variations: Michigan St. → Michigan State', async () => {
        const result = await resolveTeamName('Michigan St.', 'NCAAMB', 'espn');
        expect(result).toBe('Michigan State');
      });
    
      test('Conference name in team: SMU (AAC) → SMU', async () => {
        const result = await resolveTeamName('SMU (AAC)', 'NCAAMB', 'espn');
        expect(result).toBe('SMU');
      });
    
      test('Unknown team: returns original name', async () => {
        const result = await resolveTeamName('Fake University', 'NCAAMB', 'espn');
        expect(result).toBe('Fake University');
      });
    
      test('Cross-sport: NFL team names work', async () => {
        const result = await resolveTeamName('Kansas City', 'NFL', 'espn');
        expect(result).toBe('Kansas City Chiefs');
      });
    });

---

## Task 3: Architecture Refactor - Split Pick Engine

**Why:** `pick-engine.ts` is 3,095 lines. It's hard to navigate, test, and maintain. Break it into logical modules.

**Target structure:**

    src/lib/pick-engine/
    ├── index.ts              # Main entry point, exports generateDailyPicks
    ├── types.ts              # Interfaces (GamePrediction, SignalResult, etc.)
    ├── weights.ts            # SPREAD_WEIGHTS, OU_WEIGHTS constants
    ├── confidence-tiers.ts   # Confidence tier logic (5★, 4★, 3★ gates)
    ├── convergence.ts        # Signal convergence scoring
    ├── signals/
    │   ├── model-edge.ts     # signalModelEdge* functions
    │   ├── season-ats.ts     # signalSeasonATS
    │   ├── trend-angles.ts   # signalTrendAngles
    │   ├── recent-form.ts    # signalRecentForm
    │   ├── rest-days.ts      # signalRestDays
    │   ├── market-edge.ts    # signalMoneylineEdge
    │   ├── elo.ts            # signalEloEdge, signalEloOU
    │   ├── seed-mismatch.ts  # signalSeedMismatch (tournament)
    │   └── index.ts          # Export all signals
    ├── grading.ts            # gradeYesterdaysPicks, gradeGamePick
    └── reasoning.ts          # buildSpreadHeadline*, buildOUHeadline*

**Migration approach:**
1. Create the new directory structure
2. Move functions into appropriate files
3. Update imports in `index.ts`
4. Verify tests still pass
5. Delete old `pick-engine.ts`

**Start with weights.ts:**

    // src/lib/pick-engine/weights.ts
    export const SPREAD_WEIGHTS: Record<string, Record<string, number>> = {
      NCAAMB: {
        modelEdge: 0.31,  // Updated in Phase 1.5
        seasonATS: 0.14,
        trendAngles: 0.15,  // Reduced for seedMismatch
        // ... rest of weights
      },
      // ... other sports
    };
    
    export const OU_WEIGHTS: Record<string, Record<string, number>> = {
      // ... O/U weights
    };

**Update the main index.ts:**

    // src/lib/pick-engine/index.ts
    export { generateDailyPicks } from './generator';
    export { gradeYesterdaysPicks } from './grading';
    export type { GamePrediction, SignalResult } from './types';

This makes the codebase much more maintainable.

---

## Task 4: Redis Rate Limiting

**Why:** The current rate limiting uses in-memory Maps. On Vercel serverless, each function invocation is a separate process — rate limits reset on every request. Useless for protection.

**Where:** Create `src/lib/redis-rate-limit.ts`

**Implementation:**

    // src/lib/redis-rate-limit.ts
    import { Redis } from '@upstash/redis';
    
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    
    export async function checkRateLimit(
      key: string,
      limit: number,
      windowMs: number
    ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const redisKey = `rate_limit:${key}:${window}`;
    
      const current = await redis.incr(redisKey);
      
      if (current === 1) {
        // First request in this window, set expiration
        await redis.expire(redisKey, Math.ceil(windowMs / 1000));
      }
    
      const allowed = current <= limit;
      const remaining = Math.max(0, limit - current);
      const resetTime = (window + 1) * windowMs;
    
      return { allowed, remaining, resetTime };
    }
    
    // Usage in API routes:
    export async function withRateLimit(
      request: Request,
      limit: number,
      windowMs: number = 60000 // 1 minute default
    ) {
      const ip = request.headers.get('x-forwarded-for') || 'unknown';
      const result = await checkRateLimit(ip, limit, windowMs);
      
      if (!result.allowed) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded' }),
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((result.resetTime - Date.now()) / 1000)),
              'Content-Type': 'application/json',
            },
          }
        );
      }
      
      return null; // Allow request
    }

**Add to environment variables:**

    UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
    UPSTASH_REDIS_REST_TOKEN=your-token

**Use in API routes:**

    // src/app/api/picks/route.ts
    import { withRateLimit } from '@/lib/redis-rate-limit';
    
    export async function GET(request: Request) {
      const rateLimitResponse = await withRateLimit(request, 10, 60000); // 10 req/min
      if (rateLimitResponse) return rateLimitResponse;
      
      // ... rest of API logic
    }

---

## Task 5: Redis Game Cache

**Why:** KenPom API calls are expensive (rate limited, slow). Game data doesn't change much once fetched. Cache it in Redis with smart invalidation.

**Where:** Create `src/lib/redis-cache.ts`

**Implementation:**

    // src/lib/redis-cache.ts
    import { Redis } from '@upstash/redis';
    
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    
    export async function cacheGet<T>(key: string): Promise<T | null> {
      try {
        const cached = await redis.get(key);
        return cached as T;
      } catch (error) {
        console.error('Cache get error:', error);
        return null;
      }
    }
    
    export async function cacheSet(
      key: string,
      value: any,
      ttlSeconds: number = 3600
    ): Promise<void> {
      try {
        await redis.setex(key, ttlSeconds, JSON.stringify(value));
      } catch (error) {
        console.error('Cache set error:', error);
      }
    }
    
    export async function cacheInvalidate(pattern: string): Promise<void> {
      try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (error) {
        console.error('Cache invalidate error:', error);
      }
    }
    
    // Game-specific cache helpers
    export function gamesCacheKey(sport: string, date: string): string {
      return `games:${sport}:${date}`;
    }
    
    export function kenpomCacheKey(team: string, date: string): string {
      return `kenpom:${team}:${date}`;
    }
    
    // Cache with automatic invalidation
    export async function getCachedGames<T>(
      cacheKey: string,
      fetchFn: () => Promise<T>,
      ttlSeconds: number = 3600
    ): Promise<T> {
      const cached = await cacheGet<T>(cacheKey);
      if (cached) return cached;
    
      const fresh = await fetchFn();
      await cacheSet(cacheKey, fresh, ttlSeconds);
      return fresh;
    }

**Usage in data fetching:**

    // src/lib/kenpom.ts
    import { getCachedGames, kenpomCacheKey } from './redis-cache';
    
    export async function getKenPomRatings(date: string) {
      const cacheKey = kenpomCacheKey('ratings', date);
      
      return getCachedGames(
        cacheKey,
        () => fetchKenPomRatingsFromAPI(date),
        3600 // 1 hour TTL
      );
    }

---

## Task 6: Split Cron Jobs

**Why:** The daily-sync cron job does everything: fetch games, sync odds, update KenPom, generate picks, send notifications. One failure kills the whole pipeline. Split into independent jobs.

**Target structure:**

    src/app/api/cron/
    ├── sync-games/route.ts       # Fetch upcoming games (ESPN, etc.)
    ├── sync-odds/route.ts        # Update betting lines
    ├── sync-kenpom/route.ts      # KenPom ratings, FanMatch predictions
    ├── generate-picks/route.ts   # Run pick engine, save DailyPicks
    ├── grade-picks/route.ts      # Grade yesterday's picks
    └── notify-picks/route.ts     # Send notifications (Discord, etc.)

**Each job becomes a separate Vercel cron:**

    // vercel.json
    {
      "crons": [
        {
          "path": "/api/cron/sync-games",
          "schedule": "0 6 * * *"  // 6 AM daily
        },
        {
          "path": "/api/cron/sync-odds",
          "schedule": "*/15 * * * *"  // Every 15 minutes
        },
        {
          "path": "/api/cron/sync-kenpom",
          "schedule": "0 7 * * *"  // 7 AM daily (after games)
        },
        {
          "path": "/api/cron/generate-picks",
          "schedule": "0 8 * * *"  // 8 AM daily (after data sync)
        },
        {
          "path": "/api/cron/grade-picks",
          "schedule": "0 9 * * *"  // 9 AM daily
        },
        {
          "path": "/api/cron/notify-picks",
          "schedule": "0 10 * * *"  // 10 AM daily
        }
      ]
    }

**Benefits:**
- Failure isolation (odds sync failing doesn't kill pick generation)
- Different schedules (odds update frequently, KenPom once daily)
- Easier debugging (smaller, focused functions)
- Tournament scaling (can increase odds sync frequency during March)

**Implementation:**
1. Copy current daily-sync logic
2. Split each section into its own route file
3. Add error handling and status reporting to each
4. Update vercel.json cron config
5. Test each endpoint independently

---

## Task 7: Sentry Error Tracking Integration

**Why:** Currently errors disappear into Vercel logs. During tournament season, we need real-time error alerting and detailed error context for quick fixes.

**Setup:**

    npm install @sentry/nextjs

**Configure Sentry:**

    // sentry.client.config.ts
    import * as Sentry from '@sentry/nextjs';
    
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 1.0,
      beforeSend(event) {
        // Filter out noisy errors
        if (event.exception) {
          const error = event.exception.values?.[0];
          if (error?.value?.includes('AbortError')) {
            return null; // Don't send timeout errors
          }
        }
        return event;
      },
    });

**Add to API error handling:**

    // src/lib/error-handler.ts
    import * as Sentry from '@sentry/nextjs';
    
    export function handleAPIError(error: Error, context: Record<string, any>) {
      Sentry.withScope((scope) => {
        scope.setTag('api', 'pick-engine');
        scope.setContext('request', context);
        Sentry.captureException(error);
      });
      
      console.error('API Error:', error, context);
    }

**Use in pick engine:**

    // src/lib/pick-engine/index.ts
    import { handleAPIError } from '@/lib/error-handler';
    
    export async function generateDailyPicks(sport: Sport, date: Date) {
      try {
        // ... pick generation logic
      } catch (error) {
        handleAPIError(error, {
          sport,
          date: date.toISOString(),
          function: 'generateDailyPicks'
        });
        throw error; // Re-throw after logging
      }
    }

**Tournament-specific monitoring:**
- Custom Sentry alerts for March (tournament month)
- Dashboard for pick generation success rates
- Real-time notifications to Discord on critical errors

---

## Task 8: Performance Monitoring

**Why:** Tournament days will have 32+ games to analyze. Pick generation needs to complete within reasonable time limits.

**Add performance tracking:**

    // src/lib/performance.ts
    export class PerformanceTracker {
      private startTimes: Map<string, number> = new Map();
      
      start(operation: string) {
        this.startTimes.set(operation, Date.now());
      }
      
      end(operation: string): number {
        const start = this.startTimes.get(operation);
        if (!start) return 0;
        
        const duration = Date.now() - start;
        this.startTimes.delete(operation);
        
        // Log slow operations
        if (duration > 5000) {
          console.warn(`Slow operation: ${operation} took ${duration}ms`);
        }
        
        return duration;
      }
      
      async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
        this.start(operation);
        try {
          const result = await fn();
          return result;
        } finally {
          this.end(operation);
        }
      }
    }

**Use in pick engine:**

    const perf = new PerformanceTracker();
    
    export async function generateDailyPicks(sport: Sport, date: Date) {
      return perf.measure(`generatePicks:${sport}`, async () => {
        const games = await perf.measure('fetchGames', () => getGames(sport, date));
        const picks = await perf.measure('runEngine', () => runPickEngine(games));
        await perf.measure('savePicks', () => savePicks(picks));
        return picks;
      });
    }

---

## Task 9: Integration Tests

**Why:** Unit tests verify individual functions. Integration tests verify the full pipeline works end-to-end.

**Create `tests/integration.test.ts`:**

    // tests/integration.test.ts
    import { generateDailyPicks } from '../src/lib/pick-engine';
    import { gradeYesterdaysPicks } from '../src/lib/pick-engine';
    
    describe('Pick Engine Integration', () => {
      test('Full pipeline: fetch games → generate picks → grade picks', async () => {
        const testDate = new Date('2026-02-01'); // Historical date with known results
        
        // Generate picks for the test date
        const picks = await generateDailyPicks('NCAAMB', testDate);
        expect(picks.length).toBeGreaterThan(0);
        
        // Verify picks have required fields
        picks.forEach(pick => {
          expect(pick.sport).toBe('NCAAMB');
          expect(pick.confidence).toBeGreaterThanOrEqual(3);
          expect(pick.confidence).toBeLessThanOrEqual(5);
          expect(['SPREAD', 'OVER_UNDER']).toContain(pick.pickType);
        });
        
        // Test grading (on next day)
        const nextDate = new Date('2026-02-02');
        const gradingResults = await gradeYesterdaysPicks(nextDate);
        
        expect(gradingResults.graded).toBeGreaterThanOrEqual(0);
        expect(gradingResults.ungraded).toBeGreaterThanOrEqual(0);
      });
      
      test('Tournament scenario: neutral site games get tournament boost', async () => {
        const tournamentDate = new Date('2026-03-20'); // March Madness
        const picks = await generateDailyPicks('NCAAMB', tournamentDate);
        
        // Filter for O/U picks
        const ouPicks = picks.filter(p => p.pickType === 'OVER_UNDER');
        
        // Tournament games should have UNDER bias
        const underPicks = ouPicks.filter(p => p.pickSide === 'under');
        const overPicks = ouPicks.filter(p => p.pickSide === 'over');
        
        // Should have more UNDER picks due to tournament boost
        expect(underPicks.length).toBeGreaterThanOrEqual(overPicks.length);
      });
    });

---

## Verification Checklist

After completing all tasks, verify:

**Testing:**
- [ ] Unit tests pass: `npm test`
- [ ] Coverage >80%: `npm run test:coverage`
- [ ] Integration tests pass
- [ ] Team resolver tests cover edge cases

**Architecture:**
- [ ] Pick engine is split into logical modules
- [ ] All imports updated and working
- [ ] No circular dependencies

**Redis:**
- [ ] Rate limiting works in production
- [ ] Game cache reduces API calls
- [ ] Cache invalidation works correctly

**Cron Jobs:**
- [ ] All 6 cron endpoints deploy successfully
- [ ] Each job can run independently
- [ ] Error handling works in each job

**Monitoring:**
- [ ] Sentry captures errors with context
- [ ] Performance tracking logs slow operations
- [ ] Tournament-specific alerts configured

**Integration:**
- [ ] Full pipeline works end-to-end
- [ ] Tournament games get proper boosts
- [ ] Grading pipeline works correctly

Timeline target: **Complete by Feb 21** for 10-day validation window before conference tournaments.