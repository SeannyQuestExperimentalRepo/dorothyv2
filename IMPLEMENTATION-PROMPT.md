# Implementation Prompt: Free Data Source Integration for dorothyv2

> **Use this prompt with a coding agent (Claude Code, Cursor, etc.) pointed at the dorothyv2 repo.**

---

## Context

You are working on `dorothyv2`, a Next.js 14 sports betting pick engine with Prisma ORM and PostgreSQL (Neon). The app generates daily ATS, O/U, and moneyline picks for NFL, NCAAF, NCAAMB, and NBA.

### Current Architecture
- **Framework:** Next.js 14, TypeScript, Prisma ORM
- **DB:** PostgreSQL on Neon (`DATABASE_URL` in env)
- **Existing data sources:** KenPom API (NCAAMB), CFBD API (NCAAF SP+), The Odds API (all sports odds), ESPN API (scores/schedules/injuries)
- **Pick engine:** `src/lib/pick-engine.ts` (2,450 lines) — generates picks using weighted signal scoring
- **Cron:** `src/app/api/cron/daily-sync/route.ts` — runs 3x daily (11:00, 17:00, 21:00 UTC)
- **Key dependencies already installed:** `cheerio` (for scraping), `zod`, `prisma`

### Signal Weights (current)
The pick engine uses per-sport weight configs for spread and O/U signals. After this implementation, new signal categories will be added to these weights.

```typescript
// Current spread weights (example — NBA)
NBA: {
  modelEdge: 0.25,
  seasonATS: 0.15,
  trendAngles: 0.25,
  recentForm: 0.15,
  h2h: 0.05,
  situational: 0.05,
  restDays: 0.10,
}
```

### What We're Adding (All Free, $0/month)
1. **NBA Four Factors model** via `nba_api` proxy (NBA.com stats)
2. **NFL EPA/play model** via nflverse CSV/parquet downloads
3. **CFBD expansion** — Elo, talent composite, PPA (already have API key)
4. **NCAAMB Barttorvik T-Rank** scraping for ensemble model
5. **Elo ratings** — build from scratch for all 4 sports using game results in DB
6. **Weather integration** via Open-Meteo API (free, no key)
7. **Venue/travel/fatigue model** — static venue data + distance calculations

---

## Task 1: Database Schema Additions

Add the following models to `prisma/schema.prisma`. Follow existing patterns (look at `KenpomSnapshot`, `OddsSnapshot` for reference).

### New Models

```prisma
// NBA advanced team stats (Four Factors + ratings)
model NBATeamStats {
  id          Int      @id @default(autoincrement())
  teamId      Int
  team        Team     @relation("NBATeamStats", fields: [teamId], references: [id])
  date        DateTime @db.Date
  // Ratings
  netRating   Float?   // Off rating - Def rating
  offRating   Float?   // Points per 100 possessions
  defRating   Float?   // Points allowed per 100 possessions  
  pace        Float?   // Possessions per 48 minutes
  // Four Factors (offense)
  efgPct      Float?   // Effective FG%
  tovPct      Float?   // Turnover %
  orbPct      Float?   // Offensive rebound %
  ftRate      Float?   // Free throw rate (FTA/FGA)
  // Four Factors (defense / opponent)
  oppEfgPct   Float?
  oppTovPct   Float?
  oppOrbPct   Float?
  oppFtRate   Float?
  // Record
  wins        Int?
  losses      Int?
  
  @@unique([teamId, date])
  @@index([teamId])
  @@index([date])
}

// NFL advanced team metrics from nflverse
model NFLTeamEPA {
  id              Int    @id @default(autoincrement())
  teamId          Int
  team            Team   @relation("NFLTeamEPA", fields: [teamId], references: [id])
  season          Int
  week            Int    // 0 = season aggregate
  // EPA metrics
  offEpaPerPlay   Float?
  defEpaPerPlay   Float?
  passEpa         Float?
  rushEpa         Float?
  // Efficiency
  successRate     Float? // % of plays with positive EPA
  cpoe            Float? // Completion Probability Over Expected
  // Situational
  redZoneTdPct    Float?
  thirdDownPct    Float?
  explosivePlayRate Float? // plays of 20+ yards
  // Turnover
  turnoverMargin  Int?

  @@unique([teamId, season, week])
  @@index([teamId, season])
}

// Elo ratings for all sports
model EloRating {
  id      Int      @id @default(autoincrement())
  teamId  Int
  team    Team     @relation("EloRating", fields: [teamId], references: [id])
  sport   Sport
  date    DateTime @db.Date
  elo     Float    @default(1500)
  
  @@unique([teamId, sport, date])
  @@index([teamId, sport])
  @@index([sport, date])
}

// NCAAF expanded metrics from CFBD
model NCAAFAdvancedStats {
  id              Int    @id @default(autoincrement())
  teamId          Int
  team            Team   @relation("NCAAFAdvancedStats", fields: [teamId], references: [id])
  season          Int
  // SP+ (already fetched, but store locally for consistency)
  spOverall       Float?
  spOffense       Float?
  spDefense       Float?
  // Additional CFBD metrics
  elo             Float?
  srs             Float? // Simple Rating System
  talentComposite Float? // 247 recruiting composite
  ppaOverall      Float? // Predicted Points Added
  ppaPass         Float?
  ppaRush         Float?
  ppaDef          Float?

  @@unique([teamId, season])
  @@index([teamId])
}

// NCAAMB Barttorvik T-Rank ratings
model BarttovikSnapshot {
  id          Int      @id @default(autoincrement())
  teamId      Int
  team        Team     @relation("BarttovikSnapshot", fields: [teamId], references: [id])
  date        DateTime @db.Date
  season      Int
  // T-Rank metrics
  tRank       Int?     // Overall ranking
  tRankRating Float?   // Overall rating
  adjOE       Float?   // Adjusted offensive efficiency
  adjDE       Float?   // Adjusted defensive efficiency
  barthag     Float?   // Win probability (like Pythag)
  adjTempo    Float?
  luck        Float?
  sos         Float?   // Strength of schedule
  // Record
  wins        Int?
  losses      Int?

  @@unique([teamId, date])
  @@index([teamId])
  @@index([date])
}

// Weather for outdoor games
model GameWeather {
  id              Int      @id @default(autoincrement())
  sport           Sport
  gameDate        DateTime @db.Date
  homeTeam        String   // canonical team name
  awayTeam        String
  // Weather data
  temperatureF    Float?
  windSpeedMph    Float?
  windGustMph     Float?
  precipitationIn Float?
  humidityPct     Int?
  conditions      String?  // "Clear", "Rain", "Snow", etc.
  isDome          Boolean  @default(false)
  fetchedAt       DateTime @default(now())

  @@unique([sport, gameDate, homeTeam, awayTeam])
  @@index([sport, gameDate])
}

// Static venue data
model Venue {
  id          Int     @id @default(autoincrement())
  name        String
  city        String
  state       String?
  sport       Sport
  teamName    String  // canonical team name (home team)
  latitude    Float
  longitude   Float
  altitudeFt  Int     @default(0)
  isDome      Boolean @default(false)
  surface     String? // "grass", "turf", "hardwood"
  capacity    Int?

  @@unique([sport, teamName])
  @@index([sport])
}
```

Also add the reverse relations to the existing `Team` model:
```prisma
// Add to Team model
nbaTeamStats       NBATeamStats[]      @relation("NBATeamStats")
nflTeamEpa         NFLTeamEPA[]        @relation("NFLTeamEPA")
eloRatings         EloRating[]         @relation("EloRating")
ncaafAdvancedStats NCAAFAdvancedStats[] @relation("NCAAFAdvancedStats")
barttovikSnapshots BarttovikSnapshot[] @relation("BarttovikSnapshot")
```

Run `npx prisma migrate dev --name add-advanced-stats` after schema changes.

---

## Task 2: NBA Four Factors Integration (`src/lib/nba-stats.ts`)

Create a new module that fetches NBA team advanced stats from NBA.com's stats API. **Do NOT use Python's `nba_api` package** — we're a Node.js app. Instead, hit the NBA.com stats endpoints directly via fetch (the `nba_api` Python package just wraps these same HTTP endpoints).

### Key NBA.com Endpoints

```
Base: https://stats.nba.com/stats/

Team Advanced Stats (Four Factors + Ratings):
GET /leaguedashteamstats?Season=2025-26&SeasonType=Regular+Season&MeasureType=Advanced
Headers required:
  Referer: https://www.nba.com/
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
  Accept: application/json

Team Estimated Metrics:
GET /teamestimatedmetrics?Season=2025-26&SeasonType=Regular+Season

Team Four Factors:
GET /leaguedashteamstats?Season=2025-26&SeasonType=Regular+Season&MeasureType=Four+Factors
```

**Implementation requirements:**
- Add 1-second delay between requests (NBA.com rate limits aggressively)
- Cache results for 6 hours (in-memory, same pattern as `kenpom.ts`)
- Parse NBA.com's response format: `{ resultSets: [{ headers: [...], rowSet: [[...], ...] }] }`
- Map team names to your canonical Team table names (NBA team names are straightforward — "Los Angeles Lakers", "Boston Celtics", etc.)
- Export: `getNBATeamStats(season?: string): Promise<Map<string, NBATeamAdvanced>>`
- Export: `lookupNBAStats(stats: Map<string, NBATeamAdvanced>, teamName: string): NBATeamAdvanced | null`

### NBATeamAdvanced interface:
```typescript
interface NBATeamAdvanced {
  teamName: string;
  wins: number;
  losses: number;
  netRating: number;
  offRating: number;
  defRating: number;
  pace: number;
  efgPct: number;
  tovPct: number;
  orbPct: number;
  ftRate: number;
  oppEfgPct: number;
  oppTovPct: number;
  oppOrbPct: number;
  oppFtRate: number;
}
```

### New Pick Engine Signal: `signalNBAFourFactors`

Add to `pick-engine.ts`:

```typescript
function signalNBAFourFactors(
  homeStats: NBATeamAdvanced | null,
  awayStats: NBATeamAdvanced | null,
  spread: number,
  overUnder: number
): { spreadSignal: SignalResult; ouSignal: SignalResult }
```

**Spread logic:**
1. Calculate predicted margin using Net Rating differential: `predictedMargin = (homeNetRating - awayNetRating) / 2.5 + HCA` (HCA ≈ 2.5 for NBA)
2. Compare to spread: `edge = predictedMargin - (-spread)` (negative spread means home favored)
3. Calculate Four Factors edge: compare eFG%, TOV%, ORB%, FT rate differentials
4. Weight: Net Rating model gets 60%, Four Factors edge gets 40%
5. Map to SignalResult with magnitude 0-10 based on edge size

**O/U logic:**
1. Calculate predicted total: `(homePace + awayPace) / 2 * (homeOffRating + awayOffRating) / 200` (simplified pace-adjusted total)
2. More accurate: use the average pace to estimate possessions, then `possessions * (homeOE + awayOE) / 100`
3. Compare to posted O/U
4. Tempo differential: if both teams are top-10 pace → lean over; both bottom-10 → lean under

### Weight Config Update

Update NBA spread weights:
```typescript
NBA: {
  modelEdge: 0.30,    // UP from 0.25 — now powered by Four Factors
  seasonATS: 0.10,    // DOWN from 0.15
  trendAngles: 0.20,  // DOWN from 0.25
  recentForm: 0.15,
  h2h: 0.05,
  situational: 0.05,
  restDays: 0.10,
  eloEdge: 0.05,      // NEW — Elo rating differential
}
```

Update NBA O/U weights:
```typescript
NBA: {
  modelEdge: 0.30,    // UP from 0.25
  seasonOU: 0.15,     // DOWN from 0.20
  trendAngles: 0.15,  // DOWN from 0.20
  recentForm: 0.10,   // DOWN from 0.15
  h2hWeather: 0.05,
  tempoDiff: 0.20,    // UP from 0.15 — pace data is much better now
  eloEdge: 0.05,      // NEW
}
```

---

## Task 3: NFL EPA Model (`src/lib/nflverse.ts`)

Create a module that downloads and processes nflverse play-by-play data to calculate team EPA metrics.

### Data Source

nflverse publishes weekly CSV and parquet files on GitHub releases:
```
Player stats (easier to work with):
https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{season}.csv

Play-by-play:
https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz
```

**For our purposes, use the pre-aggregated team stats which are much smaller:**
```
https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_pass_{season}.csv
https://github.com/nflverse/nflverse-data/releases/download/pfr_advstats/advstats_season_rush_{season}.csv
```

**Or better yet — compute team-level EPA from the play-by-play CSV.** The play-by-play CSV has columns: `posteam`, `defteam`, `epa`, `success`, `pass`, `rush`, `week`, etc.

### Implementation

1. **Download & cache:** Download the current season's play-by-play CSV (gzipped, ~150MB). Cache on disk (e.g., `/tmp/nflverse/pbp_2025.csv`). Re-download weekly during NFL season.
2. **Parse & aggregate:** Group by team (as `posteam` for offense, `defteam` for defense), calculate:
   - `offEpaPerPlay` = mean(EPA) where team is `posteam` and play is not a penalty/timeout
   - `defEpaPerPlay` = mean(EPA) where team is `defteam`
   - `passEpa` = mean(EPA) where `pass == 1`
   - `rushEpa` = mean(EPA) where `rush == 1`
   - `successRate` = mean(EPA > 0)
   - `cpoe` = mean(cpoe) from passing plays
   - `redZoneTdPct` = TDs / red zone trips
   - `thirdDownPct` = conversions / third down attempts
   - `explosivePlayRate` = plays with yards_gained >= 20 / total plays
3. **Also aggregate by week** — store both season totals and per-week for recency weighting
4. **Export:** `getNFLTeamEPA(season?: number): Promise<Map<string, NFLTeamEPAData>>`

**Alternative approach (simpler, recommended for v1):** Instead of downloading the massive PBP file, scrape the team-level EPA from Pro-Football-Reference or use a lighter endpoint. The PBP approach is more powerful but heavier.

**Simplest v1 approach:** Use the nflverse `team_stats` file which is already pre-aggregated:
```
https://github.com/nflverse/nflverse-data/releases/download/stats/team_stats_{season}.csv
```

This CSV has per-team per-week stats. Just sum/average them.

### New Pick Engine Signal: `signalNFLEPA`

```typescript
function signalNFLEPA(
  homeEPA: NFLTeamEPAData | null, 
  awayEPA: NFLTeamEPAData | null,
  spread: number,
  overUnder: number
): { spreadSignal: SignalResult; ouSignal: SignalResult }
```

**Spread logic:**
1. Calculate composite efficiency: `teamRating = (offEpaPerPlay * 0.6 + (-defEpaPerPlay) * 0.4)` (offense matters more)
2. Predicted margin: `(homeRating - awayRating) * averagePlaysPerGame + HCA` (HCA ≈ 2.5 for NFL)
3. Compare to spread for edge

**O/U logic:**
1. Predicted scoring from combined offensive EPA vs combined defensive EPA
2. Factor in success rate and explosive play rate
3. Red zone TD% adjustments (high red zone TD% = more points per drive)

### Weight Config Update

```typescript
NFL: {
  modelEdge: 0.30,    // UP from 0.20 — now EPA-powered
  seasonATS: 0.10,    // DOWN from 0.15
  trendAngles: 0.20,  // DOWN from 0.25
  recentForm: 0.15,   // DOWN from 0.20
  h2h: 0.05,          // DOWN from 0.10
  situational: 0.10,
  eloEdge: 0.05,      // NEW
  weather: 0.05,       // NEW (pulled from situational)
}
```

---

## Task 4: CFBD Expansion (`src/lib/cfbd.ts`)

Expand the existing CFBD module to fetch additional endpoints you already have access to.

### New Endpoints to Add

```typescript
// 1. Elo ratings
export async function getCFBDElo(season?: number): Promise<Map<string, number>>
// GET /ratings/elo?year={season}
// Returns team Elo ratings

// 2. Talent composite (recruiting rankings)
export async function getCFBDTalent(season?: number): Promise<Map<string, number>>
// GET /talent?year={season}
// Returns 247Sports composite talent rating per team

// 3. PPA (Predicted Points Added — their EPA equivalent)
export async function getCFBDPPA(season?: number): Promise<Map<string, CFBDPPAData>>
// GET /ppa/teams?year={season}
// Returns offensive/defensive/overall PPA per team

// 4. SRS (Simple Rating System)
export async function getCFBDSRS(season?: number): Promise<Map<string, number>>
// GET /ratings/srs?year={season}

// 5. Advanced team stats
export async function getCFBDAdvancedStats(season?: number): Promise<Map<string, CFBDAdvancedTeamStats>>
// GET /stats/season/advanced?year={season}
// Returns success rate, explosiveness, rushing/passing efficiency
```

### Interface for PPA:
```typescript
interface CFBDPPAData {
  team: string;
  overall: number;
  passing: number;
  rushing: number;
  defense: number;  // defensive PPA (negative is good)
}
```

### Update NCAAF Pick Engine Signals

Enhance `signalModelEdge` for NCAAF to use the full picture:
- SP+ rating (already have) — 40% weight
- PPA — 25% weight  
- Talent composite — 15% weight (especially important early season)
- SRS — 10% weight
- Elo — 10% weight

Update NCAAF spread weights:
```typescript
NCAAF: {
  modelEdge: 0.35,    // UP from 0.30 — richer model
  seasonATS: 0.10,    // DOWN from 0.15
  trendAngles: 0.15,  // DOWN from 0.20
  recentForm: 0.15,
  h2h: 0.05,          // DOWN from 0.10
  situational: 0.10,
  eloEdge: 0.05,      // NEW
  weather: 0.05,       // NEW
}
```

---

## Task 5: Barttorvik T-Rank Scraper (`src/lib/barttorvik.ts`)

Scrape T-Rank ratings from barttorvik.com for NCAAMB ensemble modeling.

### Target URL
```
https://barttorvik.com/trank.php?year=2026&sort=&lastx=0&hession=All&shots=0&conyes=0&venue=All&type=All&mingames=0#
```

### Implementation

Use `cheerio` (already installed) to parse the HTML table.

```typescript
import "server-only";
import * as cheerio from "cheerio";

interface BarttovikRating {
  rank: number;
  teamName: string;
  conference: string;
  rating: number;    // T-Rank overall rating  
  adjOE: number;
  adjDE: number;
  barthag: number;   // Win probability
  adjTempo: number;
  luck: number;
  sos: number;
  wins: number;
  losses: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let cache: { data: Map<string, BarttovikRating>; fetchedAt: number } | null = null;

export async function getBarttovikRatings(season?: number): Promise<Map<string, BarttovikRating>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  
  const year = season ?? new Date().getFullYear();
  const url = `https://barttorvik.com/trank.php?year=${year}&sort=&lastx=0&hession=All&shots=0&conyes=0&venue=All&type=All&mingames=0`;
  
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  
  if (!res.ok) throw new Error(`Barttorvik fetch failed: ${res.status}`);
  
  const html = await res.text();
  const $ = cheerio.load(html);
  const ratings = new Map<string, BarttovikRating>();
  
  // Parse the table — inspect the actual HTML structure and adjust selectors
  // The main table typically has id="ratings-table" or similar
  // Each row contains: Rank, Team, Conf, Record, AdjOE, AdjDE, Barthag, ...
  
  // TODO: Inspect actual HTML and finalize selectors
  // This is a starting point — verify against live page
  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;
    
    const rank = parseInt($(cells[0]).text().trim(), 10);
    const teamName = $(cells[1]).text().trim();
    const conf = $(cells[2]).text().trim();
    const record = $(cells[3]).text().trim();
    const [wins, losses] = record.split("-").map(Number);
    const adjOE = parseFloat($(cells[4]).text().trim());
    const adjDE = parseFloat($(cells[5]).text().trim());
    const barthag = parseFloat($(cells[6]).text().trim());
    const adjTempo = parseFloat($(cells[7]).text().trim());
    const luck = parseFloat($(cells[8]).text().trim());
    const sos = parseFloat($(cells[9]).text().trim());
    
    if (!teamName || isNaN(rank)) return;
    
    ratings.set(teamName, {
      rank, teamName, conference: conf,
      rating: adjOE - adjDE, // Net efficiency
      adjOE, adjDE, barthag, adjTempo, luck, sos,
      wins: wins || 0, losses: losses || 0,
    });
  });
  
  cache = { data: ratings, fetchedAt: Date.now() };
  return ratings;
}

export function lookupBarttorvik(
  ratings: Map<string, BarttovikRating>, 
  teamName: string
): BarttovikRating | null {
  // Try exact match, then fuzzy match (same pattern as lookupRating in kenpom.ts)
  return ratings.get(teamName) ?? 
    [...ratings.values()].find(r => 
      r.teamName.toLowerCase() === teamName.toLowerCase()
    ) ?? null;
}
```

### Ensemble Model in Pick Engine

For NCAAMB, create an ensemble `modelEdge` that combines KenPom + Barttorvik:

```typescript
// In pick-engine.ts, modify NCAAMB modelEdge calculation:
// kenpomEdge * 0.6 + barttovikEdge * 0.4
// The two models use different methodologies — ensemble reduces variance
```

Update NCAAMB spread weights:
```typescript
NCAAMB: {
  modelEdge: 0.35,    // UP from 0.30 — ensemble is stronger
  seasonATS: 0.10,    // DOWN from 0.15
  trendAngles: 0.20,  // DOWN from 0.25
  recentForm: 0.10,
  h2h: 0.05,
  situational: 0.00,
  restDays: 0.05,
  marketEdge: 0.10,
  eloEdge: 0.05,      // NEW
}
```

---

## Task 6: Elo Rating System (`src/lib/elo.ts`)

Build an Elo rating system from scratch using game results already in the database.

### Implementation

```typescript
import "server-only";

interface EloConfig {
  kFactor: number;           // How much a single game changes ratings
  homefieldAdvantage: number; // Elo points for home team
  seasonRegression: number;   // % regression to mean between seasons (0-1)
  initialElo: number;         // Starting Elo
  movMultiplier: boolean;     // Use margin-of-victory adjustment?
}

const SPORT_CONFIGS: Record<string, EloConfig> = {
  NFL:    { kFactor: 20, homefieldAdvantage: 48, seasonRegression: 0.33, initialElo: 1500, movMultiplier: true },
  NBA:    { kFactor: 20, homefieldAdvantage: 100, seasonRegression: 0.25, initialElo: 1500, movMultiplier: true },
  NCAAMB: { kFactor: 32, homefieldAdvantage: 100, seasonRegression: 0.50, initialElo: 1500, movMultiplier: true },
  NCAAF:  { kFactor: 25, homefieldAdvantage: 55, seasonRegression: 0.50, initialElo: 1500, movMultiplier: true },
};

// Margin of victory multiplier (FiveThirtyEight formula)
function movMultiplier(mov: number, eloDiff: number): number {
  return Math.log(Math.abs(mov) + 1) * 2.2 / ((eloDiff * 0.001) + 2.2);
}

// Expected win probability from Elo difference
export function expectedWinProb(ratingDiff: number): number {
  return 1 / (1 + Math.pow(10, -ratingDiff / 400));
}

// Calculate Elo-predicted spread from rating difference
export function eloToSpread(eloDiff: number, sport: string): number {
  // Rough conversion: 25 Elo points ≈ 1 point of spread (varies by sport)
  const pointsPer25Elo: Record<string, number> = {
    NFL: 1, NBA: 1, NCAAMB: 1, NCAAF: 1,
  };
  return (eloDiff / 25) * (pointsPer25Elo[sport] ?? 1);
}

// Main function: recalculate all Elo ratings from game history
export async function recalculateElo(sport: string): Promise<Map<string, number>> {
  // 1. Fetch all completed games for this sport, ordered by date
  // 2. Initialize all teams at 1500 (or carry over from last season with regression)
  // 3. Process each game chronologically:
  //    a. Get home/away Elo
  //    b. Add homefield advantage to home Elo for expected result
  //    c. Calculate expected win prob
  //    d. Update based on actual result (with MOV multiplier if enabled)
  // 4. Store current ratings in EloRating table
  // 5. Return Map<teamName, currentElo>
}

// Get current Elo ratings for a sport (from DB, fast)
export async function getCurrentElo(sport: string): Promise<Map<string, number>> {
  // Query latest EloRating entry per team for this sport
}
```

### Pick Engine Integration

Add `signalEloEdge` function:

```typescript
function signalEloEdge(
  homeElo: number | null,
  awayElo: number | null, 
  spread: number,
  sport: string
): SignalResult {
  if (!homeElo || !awayElo) return neutral;
  
  const config = SPORT_CONFIGS[sport];
  const eloDiff = homeElo - awayElo + (config?.homefieldAdvantage ?? 0);
  const predictedSpread = eloToSpread(eloDiff, sport);
  const edge = predictedSpread - (-spread);
  
  // Map edge to magnitude/direction
  // ...
}
```

### Cron Integration

Add Elo recalculation to the daily-sync cron job — run after completed games are synced.

---

## Task 7: Weather Integration (`src/lib/weather.ts`)

Fetch weather data from Open-Meteo for outdoor NFL and NCAAF games.

### Open-Meteo API (free, no key needed)

```
GET https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/Chicago&start_date={date}&end_date={date}
```

### Implementation

1. Create a static `STADIUM_DATA` map in the module (or use the Venue table) with lat/lon for every NFL and NCAAF stadium
2. For each upcoming outdoor game, fetch weather for the game's kickoff hour
3. Cache results per game (fetch once, ~3 hours before kickoff)
4. Export: `getGameWeather(sport: Sport, homeTeam: string, gameDate: string, kickoffHour?: number): Promise<WeatherData | null>`

### WeatherData interface:
```typescript
interface WeatherData {
  temperatureF: number;
  windSpeedMph: number;
  windGustMph: number;
  precipitationIn: number;
  humidityPct: number;
  conditions: string; // derived: "Clear", "Rain", "Snow", "Windy"
  isDome: boolean;
}
```

### Pick Engine Integration

Enhance the existing `signalH2HWeather` (or create separate `signalWeather`):

**Spread impact:**
- Wind >20mph: reduces passing efficiency → favors run-heavy teams and unders
- Temp <20°F: slight under lean, QB accuracy drops
- Rain/snow: under lean, favors rushing teams
- Altitude >4,000ft (Denver): passing game boost, slight over lean

**O/U impact (bigger edge):**
- Wind >15mph: O/U under hits at ~56% historically
- Wind >25mph: O/U under hits at ~62%
- Snow: under ~58%
- Dome game: no weather adjustment

---

## Task 8: Venue & Travel Model (`src/lib/venue.ts`)

### Static Venue Data

Create a comprehensive venue lookup. At minimum, cover all 30 NBA, 32 NFL stadiums. NCAAF/NCAAMB can be added incrementally.

```typescript
interface VenueInfo {
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  altitudeFt: number;
  isDome: boolean;
  surface: string;
}

// Example entries
const NBA_VENUES: Record<string, VenueInfo> = {
  "Los Angeles Lakers": { name: "Crypto.com Arena", city: "Los Angeles", state: "CA", lat: 34.043, lon: -118.267, altitudeFt: 285, isDome: true, surface: "hardwood" },
  "Denver Nuggets": { name: "Ball Arena", city: "Denver", state: "CO", lat: 39.749, lon: -104.999, altitudeFt: 5280, isDome: true, surface: "hardwood" },
  // ... all 30 teams
};

const NFL_VENUES: Record<string, VenueInfo> = {
  "Denver Broncos": { name: "Empower Field", city: "Denver", state: "CO", lat: 39.744, lon: -105.020, altitudeFt: 5280, isDome: false, surface: "grass" },
  // ... all 32 teams
};
```

### Travel Distance Calculation

```typescript
// Haversine formula for great-circle distance
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Returns distance in miles
}

// Calculate travel info for a game
export function getTravelInfo(
  sport: Sport,
  homeTeam: string,
  awayTeam: string,
  awayPreviousGame?: { opponent: string; date: string }
): TravelInfo {
  // Return: distance traveled, timezone changes, back-to-back flag
}

interface TravelInfo {
  distanceMiles: number;
  timezoneChange: number; // positive = traveling east (harder)
  isBackToBack: boolean;
  fatigueScore: number;   // 0-10, composite of distance + timezone + B2B
}
```

### Pick Engine Integration

Enhance `signalRestDays` to incorporate travel fatigue:
- NBA: B2B + >1,500 mile travel = significant fade signal (historically ~42% ATS)
- NFL: West coast team at 1pm ET = body clock disadvantage
- Travel >2 time zones on short rest = amplified fatigue effect

---

## Task 9: Daily Sync Cron Updates

Update `src/app/api/cron/daily-sync/route.ts` to include new data fetches:

### Add to daily sync flow (after existing steps):

```typescript
// --- New data source sync steps ---

// Step: NBA Four Factors (if NBA season is active)
if (isNBASeason()) {
  await withCheckIn("cron.nba-stats", async () => {
    const { syncNBATeamStats } = await import("@/lib/nba-stats");
    await syncNBATeamStats(); // Fetches from NBA.com, stores in NBATeamStats table
  });
}

// Step: Barttorvik T-Rank (if NCAAMB season is active) 
if (isNCAAMBSeason()) {
  await withCheckIn("cron.barttorvik", async () => {
    const { syncBarttovikRatings } = await import("@/lib/barttorvik");
    await syncBarttovikRatings(); // Scrapes T-Rank, stores in BarttovikSnapshot table
  });
}

// Step: Update Elo ratings (all sports with completed games)
await withCheckIn("cron.elo", async () => {
  const { recalculateElo } = await import("@/lib/elo");
  for (const sport of ["NFL", "NCAAF", "NCAAMB", "NBA"]) {
    await recalculateElo(sport);
  }
});

// Step: Weather for upcoming outdoor games
await withCheckIn("cron.weather", async () => {
  const { fetchWeatherForUpcomingGames } = await import("@/lib/weather");
  await fetchWeatherForUpcomingGames(); // Fetches from Open-Meteo for NFL/NCAAF outdoor games today
});
```

**NFL EPA sync is different** — it should run weekly (once per week after games complete), not daily. Add a separate check:

```typescript
// Step: NFL EPA (weekly, Monday after games)
if (isMonday() && isNFLSeason()) {
  await withCheckIn("cron.nfl-epa", async () => {
    const { syncNFLTeamEPA } = await import("@/lib/nflverse");
    await syncNFLTeamEPA(); // Downloads nflverse CSV, calculates EPA, stores in NFLTeamEPA table
  });
}

// Step: CFBD expanded stats (weekly during NCAAF season)
if (isNCAAFSeason() && isSunday()) {
  await withCheckIn("cron.cfbd-expanded", async () => {
    const { syncCFBDAdvancedStats } = await import("@/lib/cfbd");
    await syncCFBDAdvancedStats(); // Fetches Elo, PPA, talent, SRS from CFBD
  });
}
```

---

## Task 10: Pick Engine Integration (Putting It All Together)

### Modify `generateDailyPicks` in `pick-engine.ts`

In the main pick generation function, add data loading for new sources:

```typescript
// Existing loads
const kenpomRatings = sport === "NCAAMB" ? await getKenpomRatings() : null;
const cfbdRatings = sport === "NCAAF" ? await getCFBDRatings() : null;

// NEW: Load additional data sources
const nbaStats = sport === "NBA" ? await getNBATeamStats() : null;
const nflEpa = sport === "NFL" ? await getNFLTeamEPA() : null;
const barttovikRatings = sport === "NCAAMB" ? await getBarttovikRatings() : null;
const eloRatings = await getCurrentElo(sport);
const cfbdPPA = sport === "NCAAF" ? await getCFBDPPA() : null;
const cfbdTalent = sport === "NCAAF" ? await getCFBDTalent() : null;
```

### Per-Game Signal Calculation

For each game, add new signal calculations:

```typescript
// Existing signals
const modelEdgeSignal = signalModelEdge(...);
const atsSignal = signalSeasonATS(...);
// ... etc

// NEW signals
const eloSignal = signalEloEdge(
  eloRatings.get(canonHome), 
  eloRatings.get(canonAway), 
  spread, sport
);

// Sport-specific new signals
let fourFactorsSignal: SignalResult | null = null;
let epaSignal: SignalResult | null = null;

if (sport === "NBA" && nbaStats) {
  const result = signalNBAFourFactors(
    lookupNBAStats(nbaStats, canonHome),
    lookupNBAStats(nbaStats, canonAway),
    spread, overUnder
  );
  fourFactorsSignal = result.spreadSignal;
  // Merge into modelEdge or keep separate
}

if (sport === "NFL" && nflEpa) {
  const result = signalNFLEPA(
    lookupNFLEPA(nflEpa, canonHome),
    lookupNFLEPA(nflEpa, canonAway),
    spread, overUnder
  );
  epaSignal = result.spreadSignal;
}

if (sport === "NCAAMB" && barttovikRatings) {
  // Enhance modelEdge with Barttorvik ensemble
  // Blend: 60% KenPom edge + 40% Barttorvik edge
}

if (sport === "NCAAF" && cfbdPPA) {
  // Enhance modelEdge with PPA + talent composite
}
```

### Include New Signals in Weighted Score

Add new signal categories to the weighted score calculation. The new categories (`eloEdge`, `weather`) should be included in the weight configs (already specified above in each task).

### Signal Labels for UI

Each new signal should produce human-readable labels for the pick detail cards:
- NBA: "Four Factors edge: Lakers eFG% 54.2% vs Celtics 52.1%, Net Rating +3.4 vs -1.2"
- NFL: "EPA model: Chiefs OFF EPA +0.15 (3rd) vs Ravens DEF EPA -0.08 (5th)"
- Elo: "Elo edge: Alabama 1650 vs Auburn 1520 → predicted 5.2pt margin vs 3pt spread"
- Weather: "Wind 22mph, Temp 28°F → under lean (wind games go under 58%)"
- Barttorvik: "T-Rank ensemble: KenPom +4.2, Barttorvik +5.1 → blended +4.56"

---

## Testing Strategy

1. **Unit tests for each new module:** Elo calculation accuracy, weather data parsing, NBA stats parsing
2. **Integration test:** Run `generateDailyPicks` for each sport and verify new signals appear in output
3. **Backtest comparison:** Compare pick accuracy before/after new signals on the last 30 days of data (if available)
4. **Spot-check:** For a few known games, verify that:
   - NBA Four Factors data matches nba.com/stats
   - Elo ratings produce reasonable spreads
   - Weather data matches actual conditions

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Modify | Add 6 new models + Team relations |
| `src/lib/nba-stats.ts` | Create | NBA.com Four Factors fetcher |
| `src/lib/nflverse.ts` | Create | nflverse EPA data downloader/processor |
| `src/lib/cfbd.ts` | Modify | Add Elo, PPA, talent, SRS endpoints |
| `src/lib/barttorvik.ts` | Create | T-Rank scraper for NCAAMB |
| `src/lib/elo.ts` | Create | Elo rating system for all sports |
| `src/lib/weather.ts` | Create | Open-Meteo weather integration |
| `src/lib/venue.ts` | Create | Static venue data + travel calculations |
| `src/lib/pick-engine.ts` | Modify | Add new signals, update weight configs |
| `src/app/api/cron/daily-sync/route.ts` | Modify | Add new data sync steps |

### Order of Implementation
1. Schema migration (must be first)
2. Elo system (no external dependencies, uses existing DB data)
3. Venue/travel model (static data, no API calls)
4. NBA Four Factors (biggest impact)
5. Barttorvik scraper (NCAAMB ensemble)
6. CFBD expansion (easy — same API)
7. Weather integration (outdoor games only)
8. NFL EPA (largest data download, can wait for NFL season)
9. Pick engine integration (wire everything together)
10. Cron updates (last — once everything works)

---

## Environment Variables Needed

None new! All free sources require no API keys:
- NBA.com stats: No auth (just needs proper headers)
- nflverse: Public GitHub releases
- CFBD: Already have `CFBD_API_KEY`
- Barttorvik: No auth
- Open-Meteo: No auth
- Elo: Built from existing data

---

## Important Notes

1. **NBA.com is finicky** — They block requests without proper `Referer` and `User-Agent` headers. If you get 403s, rotate user agents. Add 1-second delays between requests.
2. **Barttorvik HTML structure may change** — Scraper selectors should be tested against the live page and may need adjustment. Include error handling that gracefully degrades if scraping fails.
3. **nflverse files are large** — Download the pre-aggregated team stats file, not the full play-by-play, unless you specifically need play-level data.
4. **Elo ratings need historical data** — First run should process ALL historical games in the DB. Subsequent runs only process new games. Include a "full rebuild" mode and an "incremental update" mode.
5. **Don't break existing picks** — All new signals should be additive. If a new data source fails to load, the pick engine should gracefully fall back to existing signals with adjusted weights that still sum to 1.0.
6. **Team name mapping** — Each new source will have slightly different team names. Build name resolution into each module (same pattern as `lookupRating` in `kenpom.ts`). Common issues: "UConn" vs "Connecticut", "LSU" vs "Louisiana State", NBA team city+name format.
