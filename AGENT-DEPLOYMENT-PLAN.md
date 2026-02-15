# Agent Deployment Plan: Free Data Source Integration

*Generated: 2026-02-15*

---

## Overview

Deploy **5 coding agents** in parallel to build all 7 free data integrations from `IMPLEMENTATION-PROMPT.md`. Each agent gets an isolated task with clear boundaries. Total estimated time: **2-3 hours** (parallel), vs 40-60 hours sequential.

### Architecture

```
Dorothy (orchestrator)
├── Agent 1: Schema + Elo System (foundation — runs first)
├── Agent 2: NBA Four Factors (biggest impact)
├── Agent 3: NFL EPA + Weather + Venue (outdoor sports bundle)
├── Agent 4: CFBD Expansion + Barttorvik (college bundle)
└── Agent 5: Pick Engine Wiring + Cron Updates (runs last, after 2-4)
```

---

## Phase 1: Foundation (Agent 1 — runs first, others wait)

### Agent 1: Schema Migration + Elo Rating System

**Scope:**
- Add 7 new Prisma models to `schema.prisma` (NBATeamStats, NFLTeamEPA, EloRating, NCAAFAdvancedStats, BarttovikSnapshot, GameWeather, Venue)
- Add reverse relations to existing `Team` model
- Run `npx prisma migrate dev --name add-advanced-stats`
- Build `src/lib/elo.ts` — full Elo system with:
  - Per-sport configs (K-factor, HFA, regression)
  - MOV multiplier (FiveThirtyEight formula)
  - `recalculateElo(sport)` — full rebuild from game history
  - `getCurrentElo(sport)` — fast DB lookup
  - `eloToSpread(eloDiff, sport)` — convert to predicted margin
  - `expectedWinProb(ratingDiff)` — win probability
- Seed initial Elo from all historical games in DB
- Create `signalEloEdge()` function (standalone, exported)

**Input files:** `prisma/schema.prisma`, `IMPLEMENTATION-PROMPT.md` (Tasks 1, 6)
**Output files:** Modified `schema.prisma`, new `src/lib/elo.ts`
**Validation:** Migration runs clean, `recalculateElo("NCAAMB")` produces reasonable rankings

**Why first:** Every other agent needs the new tables to exist.

---

## Phase 2: Data Fetchers (Agents 2-4 — run in parallel after Phase 1)

### Agent 2: NBA Four Factors

**Scope:**
- Create `src/lib/nba-stats.ts`
  - Hit NBA.com stats endpoints directly (no Python dependency)
  - Proper headers (`Referer: https://www.nba.com/`, browser UA)
  - 1-second delay between requests
  - 6-hour in-memory cache
  - Parse NBA.com's `{ resultSets: [{ headers, rowSet }] }` format
  - `getNBATeamStats()` → `Map<string, NBATeamAdvanced>`
  - `syncNBATeamStats()` → fetch + store in `NBATeamStats` table
  - Team name mapping (NBA names are clean — "Los Angeles Lakers", etc.)
- Create `signalNBAFourFactors()` function:
  - Spread: Net Rating differential → predicted margin, Four Factors edge (60/40 blend)
  - O/U: Pace-adjusted total prediction using combined efficiency ratings
- Export both for pick engine consumption

**Input files:** `IMPLEMENTATION-PROMPT.md` (Task 2), `schema.prisma` (for model shape)
**Output files:** New `src/lib/nba-stats.ts`
**Validation:** Fetch stats for current NBA season, verify net rating for top teams looks right

### Agent 3: NFL EPA + Weather + Venue (Outdoor Sports Bundle)

**Scope:**
- Create `src/lib/nflverse.ts`
  - Download nflverse pre-aggregated team stats CSV from GitHub releases
  - `https://github.com/nflverse/nflverse-data/releases/download/stats/team_stats_{season}.csv`
  - Parse CSV, aggregate by team: offEPA, defEPA, passEPA, rushEPA, successRate, CPOE
  - Cache CSV on disk (`/tmp/nflverse/`)
  - `getNFLTeamEPA()` → `Map<string, NFLTeamEPAData>`
  - `syncNFLTeamEPA()` → store in `NFLTeamEPA` table
  - `signalNFLEPA()` — spread + O/U signals
- Create `src/lib/weather.ts`
  - Open-Meteo API integration (free, no key)
  - `getGameWeather(sport, homeTeam, gameDate, kickoffHour)` → `WeatherData | null`
  - `fetchWeatherForUpcomingGames()` → batch fetch + store in `GameWeather` table
  - Dome detection (skip weather for dome games)
  - `signalWeather()` — wind/temp/precip impact on spreads and O/U
- Create `src/lib/venue.ts`
  - Static venue data for all 32 NFL + 30 NBA stadiums
  - Haversine distance calculation
  - Timezone change detection
  - `getTravelInfo(sport, home, away, prevGame?)` → `TravelInfo`
  - Fatigue score: distance + timezone + B2B composite

**Input files:** `IMPLEMENTATION-PROMPT.md` (Tasks 3, 7, 8), `schema.prisma`
**Output files:** New `src/lib/nflverse.ts`, `src/lib/weather.ts`, `src/lib/venue.ts`
**Validation:** NFL EPA numbers match Pro-Football-Reference, weather returns sane data for a Denver game

### Agent 4: CFBD Expansion + Barttorvik (College Bundle)

**Scope:**
- Modify `src/lib/cfbd.ts` — add 5 new endpoint functions:
  - `getCFBDElo(season)` — `/ratings/elo`
  - `getCFBDTalent(season)` — `/talent`
  - `getCFBDPPA(season)` — `/ppa/teams`
  - `getCFBDSRS(season)` — `/ratings/srs`
  - `getCFBDAdvancedStats(season)` — `/stats/season/advanced`
  - `syncCFBDAdvancedStats()` → store in `NCAAFAdvancedStats` table
- Create `src/lib/barttorvik.ts`
  - Cheerio scraper for `barttorvik.com/trank.php`
  - 6-hour cache
  - `getBarttovikRatings()` → `Map<string, BarttovikRating>`
  - `syncBarttovikRatings()` → store in `BarttovikSnapshot` table
  - Name resolution against NCAAMB team names (KenPom canonical)
  - `signalBarttovikEnsemble()` — blend with KenPom: 60% KenPom + 40% Barttorvik

**Input files:** `IMPLEMENTATION-PROMPT.md` (Tasks 4, 5), existing `src/lib/cfbd.ts`, `src/lib/kenpom.ts` (for pattern reference)
**Output files:** Modified `src/lib/cfbd.ts`, new `src/lib/barttorvik.ts`
**Validation:** Barttorvik scraper returns 350+ teams, CFBD Elo returns all FBS teams

---

## Phase 3: Integration (Agent 5 — runs after Phases 1-2 complete)

### Agent 5: Pick Engine Wiring + Cron Updates

**Scope:**
- Modify `src/lib/pick-engine.ts`:
  - Import all new modules (nba-stats, nflverse, weather, venue, elo, barttorvik, cfbd expanded)
  - Add data loading in `generateDailyPicks()` — load per-sport data sources
  - Wire new signal functions into per-game signal calculation
  - Update weight configs for all 4 sports (spread + O/U):
    - NBA: modelEdge 0.30, eloEdge 0.05 (new)
    - NFL: modelEdge 0.30, eloEdge 0.05 (new), weather 0.05 (new)
    - NCAAF: modelEdge 0.35, eloEdge 0.05 (new), weather 0.05 (new)
    - NCAAMB: modelEdge 0.35, eloEdge 0.05 (new)
  - Graceful fallback: if any new data source fails, redistribute its weight to modelEdge
  - Signal labels for UI cards (human-readable descriptions of each signal's finding)
- Modify `src/app/api/cron/daily-sync/route.ts`:
  - Add NBA stats sync (daily, NBA season only)
  - Add Barttorvik sync (daily, NCAAMB season only)
  - Add Elo recalculation (daily, after completed games)
  - Add weather fetch (daily, NFL/NCAAF outdoor games)
  - Add NFL EPA sync (weekly, Monday, NFL season only)
  - Add CFBD expanded sync (weekly, Sunday, NCAAF season only)
  - Add NBA to SPORTS array (currently only NFL, NCAAF, NCAAMB)
  - Helper functions: `isNBASeason()`, `isNFLSeason()`, `isNCAAFSeason()`, `isNCAAMBSeason()`, `isMonday()`, `isSunday()`

**Input files:** All new modules from Agents 2-4, `IMPLEMENTATION-PROMPT.md` (Tasks 9, 10)
**Output files:** Modified `pick-engine.ts`, modified `daily-sync/route.ts`
**Validation:** `generateDailyPicks("NBA")` includes Four Factors signal, weights sum to 1.0

---

## Execution Plan

### Step 1: Deploy Agent 1 (Foundation)
```
Task: Execute IMPLEMENTATION-PROMPT.md Tasks 1 and 6 in the dorothyv2 repo.
- Add all new Prisma models (NBATeamStats, NFLTeamEPA, EloRating, NCAAFAdvancedStats, BarttovikSnapshot, GameWeather, Venue)
- Run migration
- Build complete Elo system in src/lib/elo.ts
- Test: verify migration succeeds and Elo recalc produces ratings
```

Wait for completion. Verify migration ran clean.

### Step 2: Deploy Agents 2, 3, 4 (Parallel)
Launch all three simultaneously after schema migration is confirmed.

Each agent works on isolated files — no merge conflicts:
- Agent 2: `src/lib/nba-stats.ts` (new file)
- Agent 3: `src/lib/nflverse.ts`, `src/lib/weather.ts`, `src/lib/venue.ts` (all new files)
- Agent 4: `src/lib/cfbd.ts` (modify), `src/lib/barttorvik.ts` (new file)

### Step 3: Deploy Agent 5 (Integration)
After Agents 2-4 complete, wire everything together in pick-engine and cron.

### Step 4: Testing & Deploy
- Run `npx tsc --noEmit` — type check
- Run `npx next build` — build check
- Manual spot-check: trigger daily-sync locally, verify new data populates
- Git commit all changes, push to GitHub
- Vercel auto-deploys from main branch

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| NBA.com blocks requests | Rotate user agents, add retry with backoff, graceful degradation |
| Barttorvik HTML changes | Selector-based scraper with error handling, log warnings don't crash |
| nflverse CSV format changes | Pin to known-good column names, validate headers before parsing |
| Schema migration fails | Test locally before pushing to Neon, keep rollback SQL ready |
| New signals break picks | All new signals are additive — weight fallback redistributes to existing signals |
| Merge conflicts in pick-engine | Agent 5 runs last, owns all pick-engine changes |
| Rate limits (NBA.com, Barttorvik) | Respect delays, cache aggressively (6h TTL), run in off-peak hours |

---

## Post-Deploy Validation Checklist

- [ ] Prisma migration applied to Neon prod DB
- [ ] Elo ratings populated for all 4 sports
- [ ] NBA Four Factors data fetching (verify against nba.com/stats)
- [ ] NFL EPA data fetching (compare to PFR)
- [ ] Barttorvik scraper returning 350+ teams
- [ ] CFBD expanded endpoints working (Elo, PPA, talent, SRS)
- [ ] Weather data for upcoming outdoor games
- [ ] Venue data covering all NFL + NBA stadiums
- [ ] Pick engine generates picks with new signals visible
- [ ] Signal labels appear in pick detail UI
- [ ] Weights sum to 1.0 for all sport/bet-type combos
- [ ] Cron runs at 11/17/21 UTC without errors
- [ ] Graceful fallback works when a source is unavailable
- [ ] `next build` passes clean
- [ ] Sentry not flooded with new errors

---

## Cost

**$0/month.** Every data source is free:
- NBA.com stats API — free (public endpoints)
- nflverse — free (GitHub releases, CC-BY-4.0)
- CFBD — free tier (already have key)
- Barttorvik — free (public website)
- Open-Meteo — free (no key required)
- Elo — built from existing DB data
- Venue — static data, no API calls

Only cost is compute (Vercel functions) which is already covered by existing plan.
