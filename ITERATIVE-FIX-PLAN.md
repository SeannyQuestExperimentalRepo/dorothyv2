# 🌪️ DorothyV2 Iterative Fix Plan
## Multi-Pass Development Prompt with Testing, Debugging & Security

Each pass builds on the previous. Do NOT proceed to the next pass until all tests pass and all checks clear from the current pass. After each pass, run all accumulated tests from previous passes to ensure no regressions.

---

## PASS 1: Security Hardening
**Goal:** Fix all critical security vulnerabilities before touching any feature code.
**Depends on:** Nothing — this is the foundation.

### Tasks

1. **Fix admin password bypass in `auth.ts`**
   - The admin password check at `auth.ts:27-49` ignores the email field entirely. Anyone who knows `ADMIN_PASSWORD` can authenticate as admin regardless of email input.
   - Fix: Validate that the provided email matches an authorized admin email OR restrict admin login to a specific email pattern. The admin check should not bypass the normal email/password flow.
   - Add a test that verifies: non-admin email + admin password = REJECTED.

2. **Fix timing-safe comparison in `src/app/api/gate/route.ts`**
   - Line 11 uses `password !== sitePassword` — vulnerable to timing attacks.
   - Replace with `timingSafeEqual` from Node.js `crypto` module (same pattern used in admin login).
   - Handle the edge case where lengths differ (timingSafeEqual throws on length mismatch — pad or length-check first).

3. **Fix CRON_SECRET comparison in `src/app/api/games/refresh/route.ts`**
   - Line 30 uses `===` for `authHeader === Bearer ${cronSecret}`.
   - A `verifyCronSecret()` helper already exists that uses `timingSafeEqual`. Use it.
   - Audit ALL other API routes for inconsistent auth patterns — grep for `=== \`Bearer` and `!==` comparisons on secrets.

4. **Add input validation on bet creation (`src/app/api/bets/route.ts`)**
   - Add max length validation: `homeTeam` (100), `awayTeam` (100), `notes` (500), `pickSide` (20), `sportsbook` (100).
   - Validate `oddsValue` is between -10000 and +10000.
   - Validate `stake` is positive and <= 100000.
   - Validate `sport` is a valid enum value.
   - Apply same validation to the PATCH handler in `src/app/api/bets/[id]/route.ts`.

5. **Make critical env vars fail-fast (`src/lib/config.ts`)**
   - Change `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL` to `required: true`.
   - The app should crash at startup if these are missing, not silently fail.

### Tests for Pass 1

```
TEST 1.1: Security — Admin login with wrong email + correct admin password → 401
TEST 1.2: Security — Admin login with correct email + correct admin password → 200
TEST 1.3: Security — Gate route rejects incorrect password (verify timing-safe)
TEST 1.4: Security — Gate route accepts correct password
TEST 1.5: Security — Refresh route rejects missing/invalid CRON_SECRET
TEST 1.6: Security — Refresh route accepts valid CRON_SECRET via verifyCronSecret()
TEST 1.7: Validation — Bet creation rejects homeTeam > 100 chars
TEST 1.8: Validation — Bet creation rejects negative stake
TEST 1.9: Validation — Bet creation rejects odds outside range
TEST 1.10: Validation — Bet creation rejects invalid sport enum
TEST 1.11: Config — App throws on missing DATABASE_URL
TEST 1.12: Grep audit — No remaining `=== \`Bearer` patterns for secret comparison
```

### Debugging Checklist
- [ ] Run `grep -rn "!== " src/app/api/ | grep -i "password\|secret\|token\|key"` — zero results expected
- [ ] Run `grep -rn "=== \`Bearer" src/app/api/` — zero results expected (all should use helper)
- [ ] Verify all API routes that accept POST/PATCH/PUT have input validation

---

## PASS 2: Data Pipeline Fix (EOS → PIT)
**Goal:** Fix the critical look-ahead bias. Make the live prediction pipeline use point-in-time KenPom data.
**Depends on:** Pass 1 (security fixes in place).
**Learnings from Pass 1:** You now know the auth and validation patterns. Apply similar rigor to data integrity.

### Context from Pass 1
The security audit revealed inconsistent patterns across routes. The same inconsistency exists in the data layer — the NCAAMBGame table stores current KenPom ratings instead of point-in-time snapshots. This is the root cause of the 36.8% live performance vs 62-75% backtest accuracy.

### Tasks

1. **Create a PIT KenPom lookup function**
   - New file: `src/lib/kenpom-pit.ts`
   - Function: `getKenpomPIT(teamName: string, gameDate: Date): Promise<KenpomRating | null>`
   - Queries `KenpomSnapshot` for the most recent snapshot ON OR BEFORE `gameDate` for the given team
   - Falls back to live KenPom API data if no snapshot exists (for today's games)
   - Add caching: cache PIT lookups for the same team+date combo (they're immutable for past dates)

2. **Update pick engine to use PIT data for predictions**
   - In `src/lib/pick-engine.ts`, the `computeKenPomEdge()` function currently receives a `Map<string, KenpomRating>` from the live KenPom API
   - For TODAY's games, this is correct (live ratings ARE the PIT ratings)
   - Verify the live prediction path uses `getKenpomRatings()` (live API) not NCAAMBGame fields
   - Add a comment documenting: "Live predictions use real-time KenPom API = true PIT data"

3. **Fix the backtest pipeline to use PIT snapshots**
   - In all `scripts/backtest/*.ts` and `scripts/backtest/*.js` files:
   - Replace any reference to `NCAAMBGame.homeAdjEM/awayAdjEM/etc.` with a KenpomSnapshot lookup by game date
   - Create helper: `getSnapshotForGame(teamName: string, gameDate: Date, season: number)`
   - This should query: `SELECT * FROM "KenpomSnapshot" WHERE "teamName" = $1 AND "snapshotDate" <= $2 AND "season" = $3 ORDER BY "snapshotDate" DESC LIMIT 1`

4. **Fix the NCAAMBGame KenPom population in the sync pipeline**
   - Find where NCAAMBGame KenPom fields are populated (likely in `src/lib/espn-sync.ts` or `src/app/api/cron/daily-sync/route.ts`)
   - When a game completes, stamp it with the KenpomSnapshot from the game date, NOT the current live ratings
   - If no snapshot exists for that exact date, use the most recent prior snapshot

5. **Add a data integrity check script**
   - New script: `scripts/verify-pit-integrity.ts`
   - For each NCAAMBGame in 2026, verify that `homeAdjEM` matches the KenpomSnapshot for that team on that date
   - Report mismatches with game ID, expected value (from snapshot), actual value (on game record)
   - This becomes a regression test — run it after any data pipeline changes

### Tests for Pass 2

```
TEST 2.1: PIT lookup returns correct snapshot for a known historical date
TEST 2.2: PIT lookup returns most recent snapshot when exact date doesn't exist
TEST 2.3: PIT lookup returns null when no snapshots exist before the date
TEST 2.4: PIT lookup for today's date falls back to live API
TEST 2.5: Backtest helper uses PIT snapshots, not NCAAMBGame fields
TEST 2.6: Data integrity script reports 0 mismatches after pipeline fix
TEST 2.7: Pick engine for today's games still uses live KenPom API (no regression)
TEST 2.8: Completed game gets KenPom data from game-date snapshot, not current
TEST 2.9: Run ALL Pass 1 tests — zero regressions
```

### Debugging Checklist
- [ ] `grep -rn "homeAdjEM\|awayAdjEM\|homeAdjOE\|awayAdjOE\|homeAdjDE\|awayAdjDE\|homeAdjTempo\|awayAdjTempo" src/lib/pick-engine.ts` — should NOT reference NCAAMBGame fields for predictions
- [ ] Run `scripts/verify-pit-integrity.ts` on 2026 season — document mismatch count
- [ ] Verify KenpomSnapshot has data for every game date in 2026 (no gaps)
- [ ] Run a single-game prediction manually and verify the KenPom values used match the expected PIT snapshot

---

## PASS 3: Honest Backtest & Tier Recalibration
**Goal:** Re-run backtests with true PIT data. Recalibrate confidence tiers based on honest results.
**Depends on:** Pass 2 (PIT pipeline is correct).
**Learnings from Pass 2:** You now have a verified PIT lookup. Use it to get honest accuracy numbers. The old backtest numbers (62-75%) are invalid.

### Context from Pass 2
The PIT pipeline is now fixed. But the confidence tiers in pick-engine.ts were calibrated on EOS-biased backtests. They need recalibration with honest data.

### Tasks

1. **Run honest PIT backtest on 2025 season (in-sample)**
   - Use `scripts/backtest/honest-backtest.js` but verify it uses the new PIT lookup
   - Record: overall accuracy, accuracy by tier, accuracy by pick type, accuracy by direction (OVER vs UNDER)
   - Record: monthly accuracy (Nov, Dec, Jan, Feb, Mar)
   - Record: accuracy by edge bucket (1.5-3, 3-5, 5-7, 7-10, 10+)

2. **Run honest PIT backtest on 2026 season (out-of-sample)**
   - Same metrics as above
   - This is the validation set — if 2025 and 2026 are within ~5pp, the model is not overfit
   - If gap > 8pp, the model is still overfit and needs simplification

3. **Calculate bootstrap confidence intervals**
   - For each strategy/tier, run 10,000 bootstrap resamples
   - Report 95% CI for accuracy and ROI
   - If 95% CI for any tier includes break-even (52.4%), that tier should not be offered to users

4. **Recalibrate confidence tiers**
   - Based on honest PIT results, update the tier gates in `pick-engine.ts`
   - The v9 NCAAMB O/U tiers (`5★: UNDER + edge >= 12 + avgTempo <= 64`) were calibrated on PIT data — verify they still hold
   - For spreads: if no tier achieves >54% honestly, DISABLE spread picks entirely until the model improves
   - For O/U: implement the asymmetric strategy from iteration findings (UNDER e≥2, OVER only line<140 e≥5)

5. **Update BACKTEST-RESULTS.md with honest numbers**
   - Replace all old results with PIT-honest results
   - Clearly label: "All results use point-in-time KenPom snapshots (no look-ahead)"
   - Include bootstrap CIs for every metric

6. **Add a backtest regression test**
   - Script that runs a minimal backtest (e.g., 100 games from 2025) and verifies accuracy is within expected range
   - If accuracy on the same 100 games changes after code changes, something broke

### Tests for Pass 3

```
TEST 3.1: Honest 2025 backtest completes without errors
TEST 3.2: Honest 2026 backtest completes without errors
TEST 3.3: In-sample/OOS gap is < 8pp (model is not severely overfit)
TEST 3.4: At least one tier achieves > 52.4% accuracy on OOS data
TEST 3.5: Bootstrap 95% CI lower bound > 50% for at least one strategy
TEST 3.6: UNDER accuracy > OVER accuracy at same edge levels (confirms asymmetry)
TEST 3.7: Backtest regression test passes on 100-game sample
TEST 3.8: Run ALL Pass 1 + Pass 2 tests — zero regressions
```

### Debugging Checklist
- [ ] Verify backtest uses PIT snapshots by logging the KenPom values used for 5 specific games and manually checking against KenpomSnapshot table
- [ ] Check that no backtest script imports or references NCAAMBGame KenPom fields
- [ ] Compare old backtest results to new honest results — document the delta (expected: significant drop)
- [ ] If a tier is disabled, verify the API no longer generates picks at that tier

---

## PASS 4: Code Architecture & Testing Foundation
**Goal:** Split the monolithic pick engine, add unit tests, eliminate code duplication.
**Depends on:** Pass 3 (honest tiers are set — we know what code is actually needed).
**Learnings from Pass 3:** The honest backtest revealed which signals/strategies actually work. Dead code can now be identified and removed.

### Context from Pass 3
After honest recalibration, some signals may have been shown to be useless. Remove dead code rather than carrying it forward. The 2,450-line pick engine needs modularization for testability.

### Tasks

1. **Split `pick-engine.ts` into modules**
   ```
   src/lib/picks/
   ├── signals/
   │   ├── model-edge.ts      (computeKenPomEdge, computePowerRatingEdge, computeSPEdge)
   │   ├── season-stats.ts    (signalSeasonATS, signalSeasonOU)
   │   ├── trend-angles.ts    (discoverTeamAngles, signalTrendAnglesSpread, signalTrendAnglesOU)
   │   ├── recent-form.ts     (signalRecentForm, signalRecentFormOU)
   │   ├── h2h.ts             (signalH2HSpread, signalH2HWeatherOU)
   │   ├── situational.ts     (signalSituational, signalRestDays, signalTempoDiff)
   │   └── market-edge.ts     (signalMoneylineEdge)
   ├── scoring.ts             (computeConvergenceScore, confidence tier logic)
   ├── headlines.ts           (buildHeadlineV3, buildOUHeadlineV3)
   ├── props.ts               (discoverProps, POSITION_PROPS, PROP_LABELS)
   ├── grading.ts             (gradeYesterdaysPicks, gradePendingBets, gradeGamePick, gradePropPick)
   ├── helpers.ts             (resolveCanonicalName, NAME_ALIASES, buildTeamStats, buildH2H, etc.)
   ├── types.ts               (all interfaces and type definitions)
   ├── config.ts              (SPREAD_WEIGHTS, OU_WEIGHTS, regression coefficients with version labels)
   └── index.ts               (generateDailyPicks — orchestrator only, no business logic)
   ```

2. **Extract shared utilities**
   - `todayET()` → `src/lib/utils.ts` (currently duplicated 5+ times)
   - `resolveCanonicalName()` + `NAME_ALIASES` → `src/lib/picks/helpers.ts` (duplicated in pick-engine.ts and matchup/route.ts)
   - `oddsToPayoutMultiplier()` + `calculateProfit()` → `src/lib/utils.ts` (duplicated in bets/route.ts and bets/[id]/route.ts)
   - Update all import sites

3. **Batch team name resolution**
   - Replace the N+1 `resolveCanonicalName()` calls with a batch function
   - `resolveCanonicalNames(names: string[], sport: string): Promise<Map<string, string>>`
   - Single DB query: `SELECT name FROM Team WHERE sport = $1 AND name IN ($2...)`
   - Call once at the start of `generateDailyPicks` with all team names

4. **Add unit tests for each signal module**
   - Each signal function should have at least 3 tests: positive signal, negative signal, neutral/noise case
   - Test `computeConvergenceScore` with known inputs and verify the score
   - Test `gradeGamePick` with known game results
   - Test regression coefficient output with known inputs (deterministic — no DB needed)

5. **Move regression coefficients to versioned config**
   ```typescript
   // src/lib/picks/config.ts
   export const REGRESSION_MODELS = {
     v9_pit_ridge: {
       version: "v9",
       trainedOn: "70,303 games (2012-2025 PIT snapshots)",
       lambda: 1000,
       intercept: -233.5315,
       coefficients: {
         sumAdjDE: 0.4346,
         sumAdjOE: 0.4451,
         avgTempo: 2.8399,
       },
     },
   } as const;
   ```

6. **Remove dead code**
   - If Pass 3 showed spread picks are unprofitable, remove or disable the spread signal pipeline (don't delete — feature-flag it)
   - Remove any signals that were shown to be noise in honest backtest
   - Archive completed experiment scripts from `scripts/backtest/` to `scripts/backtest/archive/`

### Tests for Pass 4

```
TEST 4.1: All signal functions return correct SignalResult structure
TEST 4.2: computeKenPomEdge with known inputs produces expected edge value
TEST 4.3: computeConvergenceScore with all-agreeing signals → high score
TEST 4.4: computeConvergenceScore with mixed signals → moderate score
TEST 4.5: computeConvergenceScore with insufficient signals → score 50 (neutral)
TEST 4.6: Regression model with known inputs produces exact expected total
TEST 4.7: gradeGamePick correctly grades WIN, LOSS, PUSH scenarios
TEST 4.8: resolveCanonicalNames batch returns same results as individual calls
TEST 4.9: todayET() returns correct date in ET timezone
TEST 4.10: No import of old monolithic pick-engine.ts remains (all routes use new modules)
TEST 4.11: generateDailyPicks produces same output before/after refactor (snapshot test on 5 games)
TEST 4.12: Run ALL Pass 1 + 2 + 3 tests — zero regressions
```

### Debugging Checklist
- [ ] `wc -l src/lib/pick-engine.ts` — file should no longer exist (replaced by modules)
- [ ] `grep -rn "pick-engine" src/` — all imports updated to new module paths
- [ ] `grep -rn "todayET" src/ | wc -l` — should show 1 definition + N imports (no duplication)
- [ ] `grep -rn "resolveCanonicalName" src/ | wc -l` — should show 1 definition + N imports
- [ ] Run full E2E test suite — all 5 existing tests pass
- [ ] Run new unit test suite — all tests pass

---

## PASS 5: Performance & Infrastructure
**Goal:** Fix N+1 queries, rate limiting, caching, missing indexes, and deployment issues.
**Depends on:** Pass 4 (code is modular and testable).
**Learnings from Pass 4:** Modular code revealed which DB queries are hot paths. Optimize those.

### Context from Pass 4
With the codebase split into modules, you can now see exactly which functions hit the DB and how often. The N+1 patterns in team resolution and prop discovery are the biggest performance bottlenecks.

### Tasks

1. **Replace in-memory rate limiter with Upstash Redis**
   - Install `@upstash/ratelimit` and `@upstash/redis`
   - Update `src/lib/rate-limit.ts` to use Upstash sliding window
   - Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to `.env.example`
   - Configure limits: 30 requests/minute for authenticated, 10/minute for unauthenticated

2. **Add missing Prisma indexes**
   ```prisma
   // DailyPick — queries filter by confidence
   @@index([date, sport, confidence])
   
   // Bet — grading joins on dailyPickId
   @@index([dailyPickId])
   
   // OddsSnapshot — common query pattern
   @@index([sport, gameDate])
   ```
   - Run `npx prisma migrate dev --name add-missing-indexes`

3. **Add pagination to grading functions**
   - `gradeYesterdaysPicks`: process in batches of 100
   - `gradePendingBets`: process in batches of 50
   - Add a safety limit: max 1000 picks/bets per grading run

4. **Fix service worker cache invalidation**
   - Update `CACHE_NAME` in `public/sw.js` to include a build hash or version
   - Add `activate` event handler that deletes old caches
   - Set max-age on HTML cache entries (e.g., 1 hour)

5. **Fix unbounded trend engine cache**
   - In `src/lib/trend-engine.ts`, add a max cache size (e.g., 50,000 entries)
   - Use LRU eviction or just clear cache when size exceeded
   - Alternatively, move to Redis cache for cross-invocation sharing

6. **Add missing error boundaries**
   - Create `error.tsx` files for: `ncaamb/`, `nba/`, `nfl/`, `ncaaf/`, `community/`, `parlays/`, `props/`, `search/`
   - Each should display a user-friendly error message with retry button

7. **Fix race condition on pick generation**
   - In `src/app/api/picks/today/route.ts`, add a distributed lock (Redis) or database-level deduplication
   - Before generating picks, check if picks already exist for this date+sport (already partially done with `skipDuplicates`, but generation still runs twice)

### Tests for Pass 5

```
TEST 5.1: Rate limiter rejects request #31 within 1 minute (authenticated)
TEST 5.2: Rate limiter rejects request #11 within 1 minute (unauthenticated)
TEST 5.3: Prisma migration applies cleanly with new indexes
TEST 5.4: Grading processes exactly 100 picks per batch, not all at once
TEST 5.5: Service worker activates and deletes old cache versions
TEST 5.6: Error boundary renders on each page when API throws
TEST 5.7: Concurrent pick generation requests don't produce duplicate picks
TEST 5.8: Trend engine cache doesn't exceed max size
TEST 5.9: Run ALL Pass 1-4 tests — zero regressions
```

### Debugging Checklist
- [ ] `EXPLAIN ANALYZE` on the 5 most common queries — verify indexes are used
- [ ] Load test: 50 concurrent requests to `/api/picks/today` — no 500 errors, no duplicates
- [ ] Verify Upstash Redis connection works in Vercel environment
- [ ] Check service worker in Chrome DevTools → Application → Cache Storage — old caches removed

---

## PASS 6: New Features & Model Improvements
**Goal:** Add CLV tracking, Kelly sizing, tournament suppression, and seasonal weighting.
**Depends on:** Pass 5 (infrastructure is solid).
**Learnings from Pass 5:** The infrastructure can now handle the load. Add features that improve model quality and user experience.

### Context from Pass 5
Performance is optimized, security is solid, tests are passing. Now add the features that make the model actually profitable.

### Tasks

1. **Add CLV (Closing Line Value) tracking**
   - New fields on `DailyPick`: `openingLine Float?`, `closingLine Float?`, `clv Float?`
   - When a pick is generated, store the current line as `openingLine`
   - Add a cron job (or extend daily-sync) that snapshots closing lines ~5 minutes before game time
   - Calculate CLV: `closingLine - openingLine` (positive = you got a better number)
   - Display CLV on the picks page and in stats summary

2. **Add Kelly Criterion bet sizing**
   - New function: `calculateKellySize(winProbability: number, odds: number, bankroll: number): number`
   - Formula: `f* = (b*p - q) / b` where b = decimal odds - 1
   - Use fractional Kelly (1/4 Kelly) by default
   - Surface on pick cards: "Suggested bet: $X (based on $Y bankroll)"
   - Let user set their bankroll in user settings

3. **Suppress tournament game picks**
   - In `generateDailyPicks`, skip games where `isConferenceTourney = true` or `isTournament = true`
   - Research showed 37.6% ATS in tournament games — actively harmful
   - Add a config flag to re-enable if model improves for tournaments

4. **Add seasonal weighting**
   - November/December picks: allow lower edge thresholds (lines are softest)
   - January: standard thresholds
   - February+: raise edge thresholds by 0.5 (market tightens)
   - March (tournament): see #3 — suppress entirely
   - Implement as a `seasonalEdgeAdjustment(gameDate: Date): number` function

5. **Implement asymmetric O/U strategy**
   - Based on 604-iteration findings:
   - UNDER picks: accept edge ≥ 2.0 (all games)
   - OVER picks: only accept when line < 140 AND edge ≥ 5.0
   - This was the "Hybrid U2/O5+lowline" strategy: 70.7% accuracy, Sharpe 0.401
   - Make this configurable so it can be A/B tested

6. **Enable NBA in cron sync**
   - Add "NBA" to the SPORTS array in `src/app/api/cron/daily-sync/route.ts`
   - Ensure ESPN sync handles NBA games
   - Add B2B detection: flag games where a team played yesterday
   - NBA stub model (power ratings) is already in place — just needs data flowing

### Tests for Pass 6

```
TEST 6.1: CLV is calculated correctly for a known opening/closing line pair
TEST 6.2: Kelly sizing returns correct fraction for known edge (55% at -110 → 4.18%)
TEST 6.3: Kelly sizing returns 0 for edge below break-even
TEST 6.4: Fractional Kelly (1/4) returns 1/4 of full Kelly
TEST 6.5: Tournament games are excluded from pick generation
TEST 6.6: November picks allow lower edge threshold than February picks
TEST 6.7: UNDER picks accepted at edge 2.0; OVER rejected at edge 2.0 when line > 140
TEST 6.8: OVER picks accepted at edge 5.0 when line < 140
TEST 6.9: NBA games appear in cron sync output
TEST 6.10: B2B flag correctly identifies NBA back-to-back games
TEST 6.11: Run ALL Pass 1-5 tests — zero regressions
```

### Debugging Checklist
- [ ] Verify CLV calculation on 10 historical picks manually
- [ ] Kelly sizing edge cases: 100% win probability, 0% win probability, exactly break-even
- [ ] Confirm tournament suppression by generating picks for a known tournament date — zero picks
- [ ] Verify seasonal adjustment changes edge thresholds for November vs March dates
- [ ] NBA cron sync runs without errors and populates UpcomingGame table

---

## PASS 7: Frontend Polish & Accessibility
**Goal:** Fix frontend issues, add missing error boundaries, improve UX.
**Depends on:** Pass 6 (new features need UI).
**Learnings from Pass 6:** New features (CLV, Kelly, tournament suppression) need to be surfaced in the UI. The existing UI has accessibility gaps.

### Tasks

1. **Surface CLV on picks page**
   - Add CLV column to picks table/cards
   - Color code: green for positive CLV, red for negative
   - Add CLV to stats summary (average CLV across all picks)

2. **Surface Kelly bet sizing on pick cards**
   - Add "Suggested: $X" below each pick (configurable bankroll)
   - Add bankroll setting in user menu/settings

3. **Add ARIA labels to sport selection tabs**
   - Add `role="tablist"` to container, `role="tab"` + `aria-selected` to each button
   - Add `aria-label` to icon-only buttons

4. **Add loading states to all pages missing them**
   - Check every page has a corresponding `loading.tsx`
   - Add skeleton loading for pick cards, stats, odds tables

5. **Fix PWA manifest**
   - Add PNG fallback icons (192x192, 512x512) alongside SVG
   - Test on Android and iOS

6. **Update service worker version**
   - Tie `CACHE_NAME` to build version from `package.json`
   - Test cache invalidation on deploy

### Tests for Pass 7

```
TEST 7.1: CLV displays correctly on picks page (positive, negative, null)
TEST 7.2: Kelly sizing updates when bankroll setting changes
TEST 7.3: Screen reader can navigate sport tabs (ARIA test)
TEST 7.4: All pages render loading skeletons before data arrives
TEST 7.5: PWA installs correctly on Android (manual test)
TEST 7.6: Service worker updates after deployment (manual test)
TEST 7.7: Run ALL Pass 1-6 tests — zero regressions
TEST 7.8: Lighthouse accessibility score > 90
TEST 7.9: Lighthouse performance score > 80
```

---

## PASS 8: Final Validation & Deployment
**Goal:** Full regression test, performance audit, security scan, and deploy.
**Depends on:** All previous passes.

### Tasks

1. **Run full test suite** — ALL tests from ALL passes (70+ tests)
2. **Run Lighthouse audit** — performance, accessibility, SEO, best practices
3. **Run `npm audit`** — fix any high/critical vulnerabilities
4. **Run TypeScript strict mode check** — `npx tsc --noEmit --strict`
5. **Run ESLint** — `npx eslint src/ --max-warnings 0`
6. **Run the backtest regression test** — verify model accuracy hasn't changed from Pass 3
7. **Run the data integrity script** — verify PIT data is correct
8. **Deploy to Vercel preview** — smoke test all routes
9. **Deploy to production** — monitor Sentry for 24h
10. **Generate first day of honest picks** — compare to old system

### Final Checklist
- [ ] All 70+ tests passing
- [ ] Zero security vulnerabilities (npm audit)
- [ ] Zero TypeScript errors
- [ ] Zero ESLint warnings
- [ ] Lighthouse: Performance > 80, Accessibility > 90
- [ ] Backtest regression: accuracy within expected range
- [ ] PIT data integrity: 0 mismatches
- [ ] Sentry: no new errors in 24h
- [ ] First honest picks generated and displayed correctly

---

## Cross-Pass Regression Test Summary

After EVERY pass, run all accumulated tests:

| Pass | New Tests | Cumulative Tests |
|------|-----------|-----------------|
| 1 | 12 | 12 |
| 2 | 9 | 21 |
| 3 | 8 | 29 |
| 4 | 12 | 41 |
| 5 | 9 | 50 |
| 6 | 11 | 61 |
| 7 | 9 | 70 |
| 8 | Final validation | 70+ |

**Rule: NEVER proceed to the next pass if any previous test fails.**

---

## Architecture After All Passes

```
src/lib/
├── picks/
│   ├── signals/
│   │   ├── model-edge.ts
│   │   ├── season-stats.ts
│   │   ├── trend-angles.ts
│   │   ├── recent-form.ts
│   │   ├── h2h.ts
│   │   ├── situational.ts
│   │   └── market-edge.ts
│   ├── scoring.ts
│   ├── headlines.ts
│   ├── props.ts
│   ├── grading.ts
│   ├── helpers.ts
│   ├── types.ts
│   ├── config.ts          (versioned coefficients, weights, tier gates)
│   ├── kelly.ts           (bankroll management)
│   ├── clv.ts             (closing line value tracking)
│   └── index.ts           (generateDailyPicks orchestrator)
├── kenpom.ts              (live API)
├── kenpom-pit.ts          (point-in-time snapshot lookups)
├── utils.ts               (todayET, odds helpers, shared functions)
└── ... (other existing files)

tests/
├── e2e/                   (existing 5 tests)
└── unit/
    ├── signals/
    │   ├── model-edge.test.ts
    │   ├── season-stats.test.ts
    │   └── ...
    ├── scoring.test.ts
    ├── grading.test.ts
    ├── kelly.test.ts
    ├── clv.test.ts
    ├── helpers.test.ts
    ├── security.test.ts
    └── data-integrity.test.ts
```
