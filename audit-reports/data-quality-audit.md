# Data Quality & Pipeline Audit — Trendline

**Date:** 2026-02-15  
**Auditor:** Subagent (automated code review)  
**Scope:** Data ingestion pipelines, team resolution, schema integrity, sync logic

---

## [SEVERITY: HIGH] NBA Alias Table Is Empty — All NBA Team Resolution Will Fail

**File:** `src/lib/team-aliases.generated.ts:1497`  
**What:** The `NBA` key in `TEAM_ALIASES` is an empty object `{}`. No NBA team aliases exist. Any Odds API or ESPN name that doesn't exactly match a DB canonical name will pass through unresolved.  
**Impact:** NBA games will have mismatched team names, broken odds joins, phantom duplicate teams created in the DB. Since NBA support appears to be newer, this could silently corrupt all NBA data.  
**Fix:** Run the consolidation script for NBA, or manually populate NBA aliases (there are only 30 teams).

---

## [SEVERITY: HIGH] Race Condition — Concurrent Cron Runs Can Create Duplicate Games

**File:** `src/lib/espn-sync.ts:195-230` (batch dedup logic)  
**What:** The completed-game sync uses a read-then-write pattern: it queries existing games, builds `existingSet`, then batch-creates new ones. If two cron runs overlap (e.g., Vercel cold-start retry, or manual trigger during scheduled run), both can read the same empty set and both insert the same games. The `createMany({ skipDuplicates: true })` at line ~235 mitigates this for the batch path, and the `@@unique` constraint provides a DB-level safety net, but the older `insertCompletedGame()` function (line ~370) uses a `findFirst` + `create` pattern with no transaction, leaving a TOCTOU window.  
**Impact:** In practice, `skipDuplicates` and the unique constraint prevent actual duplicates in most paths. The `insertCompletedGame` path (used by `syncTeamSeason`) has a real race window but would throw a unique constraint error caught by the `try/catch`. Risk is low but not zero — the game would be silently skipped on the second run.  
**Fix:** Wrap `insertCompletedGame` in a transaction with an upsert, or remove it in favor of the batch path. Consider adding a distributed lock (e.g., advisory lock or Redis) for the daily cron.

---

## [SEVERITY: HIGH] `dayOfWeek` Computed Using Server Locale, Not ET

**File:** `src/lib/espn-sync.ts:253` (NFL/NCAAF data mapping)  
**What:** `gameDate.toLocaleDateString("en-US", { weekday: "long" })` uses the server's timezone (UTC on Vercel). A Thursday Night Football game at 8:20 PM ET (01:20 UTC Friday) would be stored as `"Friday"` instead of `"Thursday"`.  
**Impact:** All trend queries filtering by `dayOfWeek` (Thursday games, Sunday games, MNF) will have incorrect data for games after ~7 PM ET. This affects NFL primetime analysis directly.  
**Fix:** Add `timeZone: "America/New_York"` to the `toLocaleDateString` options.

---

## [SEVERITY: HIGH] FanMatch Predictions Matched by Date Only, Not by Team

**File:** `src/app/api/cron/daily-sync/route.ts:115-138` (step 1.6)  
**What:** The FanMatch capture updates ALL `UpcomingGame` rows matching the date with `fmHomePred: null`, regardless of which teams the FanMatch prediction is for. There's no `homeTeam`/`awayTeam` filter in the `updateMany` WHERE clause.  
**Impact:** FanMatch predictions get assigned to the wrong games. If Duke vs UNC and Kansas vs Baylor are both on the same date, one game's predictions could overwrite the other's.  
**Fix:** Add `homeTeam` and `awayTeam` (resolved to canonical names) to the `updateMany` WHERE clause.

---

## [SEVERITY: MEDIUM] KenPom Supplemental Data Delete+Re-insert Without Transaction

**File:** `src/app/api/cron/daily-sync/route.ts:195-230` (step 2.67)  
**What:** `deleteMany` then `createMany` for `KenpomPointDist` and `KenpomHeight` is not wrapped in a transaction. If the process crashes between delete and create, the table is empty until the next successful run.  
**Impact:** Any queries hitting these tables during the window (or after a crash) get no data. Since the cron runs 3x daily, the window is small but real.  
**Fix:** Wrap in `prisma.$transaction([deleteMany, createMany])`.

---

## [SEVERITY: MEDIUM] Team Resolver Caches Misses Permanently (Process Lifetime)

**File:** `src/lib/team-resolver.ts:135`  
**What:** When a team name can't be resolved, it's cached as `resolvedCache.set(cacheKey, name)` — caching the original (unresolved) name. If the alias table is later updated or the team is added to the DB, the stale cache entry persists until the process restarts.  
**Impact:** In a long-running server (not Vercel serverless), newly added teams or alias fixes won't take effect without a restart. On Vercel this is less of an issue due to cold starts.  
**Fix:** Either don't cache misses, or add a TTL to the miss cache entries.

---

## [SEVERITY: MEDIUM] Odds API Supplement Only Looks at Today + 2 Days Ahead

**File:** `src/lib/odds-api-sync.ts:141-147`  
**What:** The `supplementUpcomingGamesFromOddsApi` function queries existing UpcomingGame records for `today → dayAfterTomorrow` (2-day window), but The Odds API can return games 7+ days out. Games beyond the 2-day window won't be matched against existing records and will always be treated as "ESPN missed this game."  
**Impact:** Duplicate UpcomingGame entries for games 3+ days away (one from ESPN, one from Odds API with slightly different timestamps). The unique constraint on `(sport, gameDate, homeTeam, awayTeam)` prevents actual duplicates if team names match, but any name resolution difference creates a real duplicate.  
**Fix:** Expand the query window to match the Odds API's lookahead, or filter `oddsGames` to only the 2-day window before processing.

---

## [SEVERITY: MEDIUM] No Index on `OddsSnapshot.fetchedAt` Alone

**File:** `prisma/schema.prisma` (OddsSnapshot model)  
**What:** The `/api/odds` route queries `fetchedAt: { gte: cutoff }` combined with `sport` and `gameDate > now`. There's a composite index on `[sport, homeTeam, awayTeam, fetchedAt]` but the primary query pattern (`sport + fetchedAt + gameDate`) doesn't have an optimal index.  
**Impact:** As the OddsSnapshot table grows (hundreds of snapshots per day × hundreds of games), the cache-check query may slow down. Currently manageable but will degrade.  
**Fix:** Add `@@index([sport, fetchedAt, gameDate])` to the OddsSnapshot model.

---

## [SEVERITY: MEDIUM] `SavedTrend` Uses `onDelete: Restrict` — Users Can't Delete Their Accounts

**File:** `prisma/schema.prisma:363`  
**What:** `SavedTrend.user` relation uses `onDelete: Restrict`, and `Bet.user` also uses `onDelete: Restrict`. This means deleting a User will fail if they have any saved trends or bets.  
**Impact:** Account deletion (GDPR compliance, user request) will throw a foreign key error. Admin must manually delete trends and bets first.  
**Fix:** Change to `onDelete: Cascade` for SavedTrend and Bet, or implement a soft-delete/cleanup flow.

---

## [SEVERITY: MEDIUM] Stale Odds Served Without Indication of Staleness

**File:** `src/app/api/odds/route.ts:42-65`  
**What:** When the Odds API returns no data (empty array) or fails, the route falls through to return an empty `games: []` response with `success: true`. There's no distinction between "no games today" and "API failed." The 5-minute cache also means if the API key runs out of credits mid-day, stale data from the last successful fetch keeps being served with `cached: true` — no warning.  
**Impact:** Users see stale odds without knowing. If the API key is exhausted, odds freeze at the last snapshot.  
**Fix:** Track `creditsRemaining` from response headers. Add a `staleWarning` field when cached data is older than a configurable threshold. Return `success: false` when the API fails (don't silently degrade).

---

## [SEVERITY: MEDIUM] `PlayerGameLog` Has No Unique Constraint

**File:** `prisma/schema.prisma:416-440`  
**What:** `PlayerGameLog` has no `@@unique` constraint. There's nothing preventing the same player+season+week combination from being inserted twice if the ingestion script runs multiple times.  
**Impact:** Duplicate player game logs would inflate stat aggregations (double-counting yards, TDs, etc.) and corrupt prop analysis.  
**Fix:** Add `@@unique([playerId, season, week, seasonType])` to PlayerGameLog.

---

## [SEVERITY: MEDIUM] ESPN Sync `getSeason()` Doesn't Handle NCAAMB May-October Games

**File:** `src/lib/espn-sync.ts:393-401`  
**What:** `getSeason` for NCAAMB returns `month >= 11 ? year + 1 : year`. This means May-October games (e.g., foreign exhibition tours, NIT Season Tip-Off early events) would be assigned to the current year's season, which is correct. However, there's no handling for the edge case where a game in October (month 10) should be the upcoming season — the function assigns it to the current year's ending season rather than the next.  
**Impact:** Low — very few NCAAMB games happen May-October. But any that do would be assigned to the wrong season.  
**Fix:** Add month 10 (October) to the `>= 11` check: `month >= 10 ? year + 1 : year`.

---

## [SEVERITY: LOW] `db-trend-loader.ts` Caches TeamMap Forever (Memory Leak in Long-Running Processes)

**File:** `src/lib/db-trend-loader.ts:21-30`  
**What:** `teamMap` is a module-level variable that's populated once and never invalidated. If a new team is added to the DB (e.g., via `resolveTeamId` creating a non-D1 team), the trend loader won't see it until process restart.  
**Impact:** Newly created teams will show as empty strings in trend results. On Vercel serverless, cold starts mitigate this. In dev or long-running processes, stale team data.  
**Fix:** Add a `clearTeamMapCache()` export called alongside the other cache clears in the cron, or add TTL.

---

## [SEVERITY: LOW] `insertCompletedGame` Is Dead Code (Unreachable in Normal Flow)

**File:** `src/lib/espn-sync.ts:320-390`  
**What:** The `insertCompletedGame` function is only used by `syncTeamSeason` (the team schedule backfill). The main `syncCompletedGames` pipeline uses the batch path. Having two code paths for game insertion means bugs fixed in one may not be fixed in the other.  
**Impact:** `insertCompletedGame` doesn't capture moneylines, FanMatch predictions, or conference game flags that the batch path does. Games backfilled via `syncTeamSeason` will have less data than daily-synced games.  
**Fix:** Refactor `syncTeamSeason` to use the batch path, or keep `insertCompletedGame` in sync with the batch path's data fields.

---

## [SEVERITY: LOW] Odds Snapshot Table Grows Unboundedly — No Cleanup

**File:** `prisma/schema.prisma` (OddsSnapshot model), `src/app/api/odds/route.ts`  
**What:** Every API call that misses the 5-minute cache creates new OddsSnapshot rows. There's no cleanup job. The `/api/odds/snapshots` route only queries 7 days, but old data accumulates forever.  
**Impact:** DB storage grows linearly. At ~200 games/day × 3 sports × ~12 fetches/day = ~7,200 rows/day. Over a season (~200 days), that's ~1.4M rows of snapshot data.  
**Fix:** Add a cleanup step to the daily cron that deletes OddsSnapshot rows older than 14 days (or whatever the max useful lookback is).

---

## [SEVERITY: LOW] No NBA Game Sync Pipeline

**File:** `src/app/api/cron/daily-sync/route.ts:19`  
**What:** `SPORTS` is defined as `["NFL", "NCAAF", "NCAAMB"]` — NBA is excluded. The schema has `NBAGame` model and NBA is in the `Sport` enum, but no sync pipeline exists.  
**Impact:** NBA games never get synced. The NBAGame table stays empty. NBA odds refresh works (via `refreshUpcomingGames`) but completed games are never recorded.  
**Fix:** Add `"NBA"` to the SPORTS array once the NBA sync logic is ready, or add a note/TODO.

---

## [SEVERITY: LOW] Historical Odds Backfill Only Runs for NCAAMB

**File:** `src/lib/odds-api-sync.ts:177-260`  
**What:** `backfillYesterdayOdds` is hardcoded to `basketball_ncaab` sport key and only queries `NCAAMBGame`. NFL and NCAAF games that complete without odds are never backfilled.  
**Impact:** NFL/NCAAF games without pre-captured odds permanently lack spread data, affecting trend analysis accuracy for those games.  
**Fix:** Extend backfill to NFL (`americanfootball_nfl`) and NCAAF (`americanfootball_ncaaf`), or document this as a known gap.

---

## [SEVERITY: LOW] `espn-injuries.ts` Returns ESPN Display Names, Not Canonical Names

**File:** `src/lib/espn-injuries.ts:133`  
**What:** `getInjuriesForTeam` does substring matching against ESPN display names (e.g., "Kansas Jayhawks") but the caller likely passes canonical names from the DB (e.g., "Kansas"). The substring matching handles this, but it's fragile.  
**Impact:** Could fail for teams where the canonical name is a substring of multiple ESPN names (e.g., "Miami" matching both "Miami Hurricanes" and "Miami Heat"). Currently mitigated by sport-level filtering upstream.  
**Fix:** Accept sport parameter and use the team resolver for matching.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 4     |
| MEDIUM   | 6     |
| LOW      | 6     |

**Top priorities:**
1. Fix FanMatch date-only matching (assigning predictions to wrong games)
2. Fix `dayOfWeek` timezone bug (corrupts day-of-week trend analysis)
3. Populate NBA aliases (blocking NBA data quality)
4. Add `@@unique` to PlayerGameLog (prevents duplicate stat rows)
