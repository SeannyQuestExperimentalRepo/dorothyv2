# dorothyv2 — New Data Sources & Schema Additions

> **Context prompt for Claude/coding agents working on this codebase.**
> Updated: 2026-02-15

---

## What Changed

We just integrated **7 free data sources** into the dorothyv2 pick engine. This involved adding 7 new database tables, 6 new library modules, expanding 1 existing module, and wiring everything into the pick engine and cron job. **All sources are free ($0/month).**

---

## New Database Tables (Prisma Models)

### 1. `NBATeamStats` — NBA Four Factors + Efficiency Ratings
Stores daily snapshots of NBA team advanced stats from NBA.com.

| Column | Type | Description |
|--------|------|-------------|
| `teamId` | Int (FK → Team) | Links to canonical Team |
| `date` | Date | Snapshot date |
| `netRating` | Float? | Offensive rating − Defensive rating |
| `offRating` | Float? | Points per 100 possessions |
| `defRating` | Float? | Points allowed per 100 possessions |
| `pace` | Float? | Possessions per 48 minutes |
| `efgPct` | Float? | Effective FG% (offense) |
| `tovPct` | Float? | Turnover % (offense) |
| `orbPct` | Float? | Offensive rebound % |
| `ftRate` | Float? | Free throw rate FTA/FGA (offense) |
| `oppEfgPct` | Float? | Opponent effective FG% (defense) |
| `oppTovPct` | Float? | Opponent turnover % (defense) |
| `oppOrbPct` | Float? | Opponent offensive rebound % (defense) |
| `oppFtRate` | Float? | Opponent free throw rate (defense) |
| `wins`, `losses` | Int? | Team record |

**Unique constraint:** `[teamId, date]`
**Source:** NBA.com stats API (`stats.nba.com/stats/leaguedashteamstats`)
**Fetched by:** `src/lib/nba-stats.ts` → `syncNBATeamStats()`

---

### 2. `NFLTeamEPA` — NFL Expected Points Added Metrics
Stores per-team, per-week EPA and efficiency stats from nflverse.

| Column | Type | Description |
|--------|------|-------------|
| `teamId` | Int (FK → Team) | Links to canonical Team |
| `season` | Int | NFL season year |
| `week` | Int | Week number (0 = season aggregate) |
| `offEpaPerPlay` | Float? | Offensive EPA per play |
| `defEpaPerPlay` | Float? | Defensive EPA per play |
| `passEpa` | Float? | Passing EPA |
| `rushEpa` | Float? | Rushing EPA |
| `successRate` | Float? | % of plays with positive EPA |
| `cpoe` | Float? | Completion Probability Over Expected |
| `redZoneTdPct` | Float? | Red zone TD conversion % |
| `thirdDownPct` | Float? | Third down conversion % |
| `explosivePlayRate` | Float? | Plays of 20+ yards / total plays |
| `turnoverMargin` | Int? | Turnovers forced − turnovers committed |

**Unique constraint:** `[teamId, season, week]`
**Source:** nflverse GitHub releases (`nflverse-data/releases/download/stats/team_stats_{season}.csv`)
**Fetched by:** `src/lib/nflverse.ts` → `syncNFLTeamEPA()`

---

### 3. `EloRating` — Universal Elo Ratings (All Sports)
Stores daily Elo ratings computed from game history for all 4 sports.

| Column | Type | Description |
|--------|------|-------------|
| `teamId` | Int (FK → Team) | Links to canonical Team |
| `sport` | Sport (enum) | NFL, NCAAF, NCAAMB, or NBA |
| `date` | Date | Rating as of this date |
| `elo` | Float | Elo rating (default 1500) |

**Unique constraint:** `[teamId, sport, date]`
**Source:** Computed internally from game results in NCAAMBGame, NBAGame, NFLGame, NCAAFGame tables
**Fetched by:** `src/lib/elo.ts` → `recalculateElo(sport)`

**Elo configs by sport:**
- NFL: K=20, HFA=48 Elo pts, 33% season regression
- NBA: K=20, HFA=100 Elo pts, 25% season regression
- NCAAMB: K=32, HFA=100 Elo pts, 50% season regression
- NCAAF: K=25, HFA=55 Elo pts, 50% season regression

---

### 4. `NCAAFAdvancedStats` — College Football Advanced Metrics
Stores per-team, per-season advanced stats from CFBD API.

| Column | Type | Description |
|--------|------|-------------|
| `teamId` | Int (FK → Team) | Links to canonical Team |
| `season` | Int | Season year |
| `spOverall` | Float? | SP+ overall rating |
| `spOffense` | Float? | SP+ offensive rating |
| `spDefense` | Float? | SP+ defensive rating |
| `elo` | Float? | CFBD Elo rating |
| `srs` | Float? | Simple Rating System |
| `talentComposite` | Float? | 247Sports recruiting composite |
| `ppaOverall` | Float? | Predicted Points Added (overall) |
| `ppaPass` | Float? | PPA (passing) |
| `ppaRush` | Float? | PPA (rushing) |
| `ppaDef` | Float? | PPA (defensive, negative = good) |

**Unique constraint:** `[teamId, season]`
**Source:** CFBD API (`/ratings/elo`, `/talent`, `/ppa/teams`, `/ratings/srs`)
**Fetched by:** `src/lib/cfbd.ts` → `syncCFBDAdvancedStats()`

---

### 5. `BarttovikSnapshot` — NCAAMB Barttorvik T-Rank Ratings
Stores daily T-Rank snapshots scraped from barttorvik.com for ensemble modeling with KenPom.

| Column | Type | Description |
|--------|------|-------------|
| `teamId` | Int (FK → Team) | Links to canonical Team |
| `date` | Date | Snapshot date |
| `season` | Int | Season year |
| `tRank` | Int? | Overall T-Rank ranking |
| `tRankRating` | Float? | Overall T-Rank rating value |
| `adjOE` | Float? | Adjusted offensive efficiency |
| `adjDE` | Float? | Adjusted defensive efficiency |
| `barthag` | Float? | Pythagorean win probability |
| `adjTempo` | Float? | Adjusted tempo |
| `luck` | Float? | Luck factor |
| `sos` | Float? | Strength of schedule |
| `wins`, `losses` | Int? | Team record |

**Unique constraint:** `[teamId, date]`
**Source:** Scraped from `barttorvik.com/trank.php` using cheerio
**Fetched by:** `src/lib/barttorvik.ts` → `syncBarttovikRatings()`

---

### 6. `GameWeather` — Weather Conditions for Outdoor Games
Stores game-day weather for NFL and NCAAF outdoor games.

| Column | Type | Description |
|--------|------|-------------|
| `sport` | Sport (enum) | NFL or NCAAF |
| `gameDate` | Date | Game date |
| `homeTeam` | String | Home team canonical name |
| `awayTeam` | String | Away team canonical name |
| `temperatureF` | Float? | Temperature in Fahrenheit |
| `windSpeedMph` | Float? | Wind speed in MPH |
| `windGustMph` | Float? | Wind gust speed in MPH |
| `precipitationIn` | Float? | Precipitation in inches |
| `humidityPct` | Int? | Humidity percentage |
| `conditions` | String? | "Clear", "Rain", "Snow", "Windy", etc. |
| `isDome` | Boolean | Whether game is in a dome (skip weather) |
| `fetchedAt` | DateTime | When weather was fetched |

**Unique constraint:** `[sport, gameDate, homeTeam, awayTeam]`
**Source:** Open-Meteo API (free, no API key needed)
**Fetched by:** `src/lib/weather.ts` → `fetchWeatherForUpcomingGames()`

---

### 7. `Venue` — Stadium/Arena Data with Coordinates
Static venue data for travel/fatigue calculations and weather lookups.

| Column | Type | Description |
|--------|------|-------------|
| `name` | String | Stadium/arena name |
| `city` | String | City |
| `state` | String? | State |
| `sport` | Sport (enum) | Which sport |
| `teamName` | String | Home team canonical name |
| `latitude` | Float | GPS latitude |
| `longitude` | Float | GPS longitude |
| `altitudeFt` | Int | Altitude in feet (default 0) |
| `isDome` | Boolean | Dome or outdoor |
| `surface` | String? | "grass", "turf", "hardwood" |
| `capacity` | Int? | Seating capacity |

**Unique constraint:** `[sport, teamName]`
**Source:** Static data hardcoded in `src/lib/venue.ts` (32 NFL + 30 NBA stadiums)

---

## New Library Modules

### `src/lib/nba-stats.ts`
- Fetches NBA team advanced stats + Four Factors from NBA.com stats API
- Requires specific headers (`Referer: https://www.nba.com/`, browser UA) — NBA.com blocks without them
- 1-second delay between requests, 6-hour in-memory cache
- **Exports:** `getNBATeamStats()`, `syncNBATeamStats()`, `signalNBAFourFactors()`, `clearNBACache()`

### `src/lib/nflverse.ts`
- Downloads nflverse pre-aggregated team stats CSV from GitHub releases
- Caches CSV on disk at `/tmp/nflverse/`, refreshes weekly
- **Exports:** `getNFLTeamEPA()`, `syncNFLTeamEPA()`, `signalNFLEPA()`, `clearNFLCache()`

### `src/lib/barttorvik.ts`
- Scrapes T-Rank ratings from barttorvik.com HTML using cheerio
- 6-hour in-memory cache
- Used for NCAAMB ensemble modeling (60% KenPom + 40% Barttorvik)
- **Exports:** `getBarttovikRatings()`, `lookupBarttovikRating()`, `syncBarttovikRatings()`, `signalBarttovikEnsemble()`, `clearBarttovikCache()`

### `src/lib/elo.ts`
- Builds Elo ratings from scratch using completed game results already in the DB
- Per-sport configs for K-factor, home-field advantage, season regression, MOV multiplier
- Uses FiveThirtyEight's margin-of-victory formula
- **Exports:** `recalculateElo()`, `getCurrentElo()`, `signalEloEdge()`, `expectedWinProb()`, `eloToSpread()`

### `src/lib/weather.ts`
- Fetches weather from Open-Meteo API (free, no key) for outdoor NFL/NCAAF games
- Skips dome games automatically using venue data
- **Exports:** `getGameWeather()`, `fetchWeatherForUpcomingGames()`, `signalWeather()`

### `src/lib/venue.ts`
- Static venue data for all 32 NFL stadiums and 30 NBA arenas
- Haversine distance calculation, timezone change detection
- Fatigue scoring (0-10 composite of distance + timezone + back-to-back)
- **Exports:** `getVenue()`, `getAllVenues()`, `haversineDistance()`, `getTravelInfo()`

### `src/lib/cfbd.ts` (expanded — existing file)
- Added 5 new CFBD API endpoint functions + sync function
- **New exports:** `getCFBDElo()`, `getCFBDTalent()`, `getCFBDPPA()`, `getCFBDSRS()`, `getCFBDAdvancedStats()`, `syncCFBDAdvancedStats()`

---

## Pick Engine Changes (`src/lib/pick-engine.ts`)

### New Signals Added
| Signal | Sports | Source | Description |
|--------|--------|--------|-------------|
| `signalEloEdge` | ALL | `elo.ts` | Elo rating differential → predicted spread |
| `signalNBAFourFactors` | NBA | `nba-stats.ts` | Net Rating + Four Factors edge (spread + O/U) |
| `signalNFLEPA` | NFL | `nflverse.ts` | EPA composite efficiency model (spread + O/U) |
| `signalBarttovikEnsemble` | NCAAMB | `barttorvik.ts` | 60% KenPom + 40% Barttorvik blend |
| `signalWeather` | NFL, NCAAF | `weather.ts` | Wind/temp/precip impact on scoring |

### Updated Weight Configs (Spread)
```
NBA:    { modelEdge: 0.30, seasonATS: 0.10, trendAngles: 0.20, recentForm: 0.15, h2h: 0.05, situational: 0.05, restDays: 0.10, eloEdge: 0.05 }
NFL:    { modelEdge: 0.30, seasonATS: 0.10, trendAngles: 0.20, recentForm: 0.15, h2h: 0.05, situational: 0.10, eloEdge: 0.05, weather: 0.05 }
NCAAF:  { modelEdge: 0.35, seasonATS: 0.10, trendAngles: 0.15, recentForm: 0.15, h2h: 0.05, situational: 0.10, eloEdge: 0.05, weather: 0.05 }
NCAAMB: { modelEdge: 0.35, seasonATS: 0.10, trendAngles: 0.20, recentForm: 0.10, h2h: 0.05, situational: 0.00, restDays: 0.05, marketEdge: 0.10, eloEdge: 0.05 }
```

### Graceful Fallback
If any new data source fails to load (returns null), its weight is redistributed to `modelEdge` so weights always sum to 1.0. The pick engine never crashes due to a missing data source.

---

## Cron Job Changes (`src/app/api/cron/daily-sync/route.ts`)

### New Sync Steps (added as step 2.8, before pick generation)
| Step | Frequency | Condition | Source |
|------|-----------|-----------|--------|
| NBA stats sync | Daily | NBA season active | `syncNBATeamStats()` |
| Barttorvik sync | Daily | NCAAMB in SPORTS array | `syncBarttovikRatings()` |
| Elo recalculation | Daily | Always (all sports) | `recalculateElo(sport)` |
| Weather fetch | Daily | Always (outdoor games) | `fetchWeatherForUpcomingGames()` |
| NFL EPA sync | Weekly (Monday) | NFL season active | `syncNFLTeamEPA()` |
| CFBD advanced sync | Weekly (Sunday) | NCAAF season active | `syncCFBDAdvancedStats()` |

**NBA was added to the SPORTS array** — the cron now syncs NBA games alongside NFL, NCAAF, and NCAAMB.

All new steps are wrapped in try/catch — a single source failure doesn't kill the entire cron run.

---

## Team Model Relations

The `Team` model now has these additional reverse relations:
```prisma
nbaTeamStats       NBATeamStats[]       @relation("NBATeamStats")
nflTeamEpa         NFLTeamEPA[]         @relation("NFLTeamEPA")
eloRatings         EloRating[]          @relation("EloRating")
ncaafAdvancedStats NCAAFAdvancedStats[] @relation("NCAAFAdvancedStats")
barttovikSnapshots BarttovikSnapshot[]  @relation("BarttovikSnapshot")
```

---

## Data Source Summary

| Source | Sport | Cost | API Key Needed | Module |
|--------|-------|------|----------------|--------|
| NBA.com stats | NBA | Free | No (needs headers) | `nba-stats.ts` |
| nflverse CSVs | NFL | Free | No | `nflverse.ts` |
| Barttorvik.com | NCAAMB | Free | No (scraping) | `barttorvik.ts` |
| CFBD API | NCAAF | Free tier | Yes (existing `CFBD_API_KEY`) | `cfbd.ts` |
| Open-Meteo | NFL/NCAAF | Free | No | `weather.ts` |
| Elo (internal) | All | Free | N/A (computed) | `elo.ts` |
| Venue (static) | All | Free | N/A (hardcoded) | `venue.ts` |

**Total monthly cost: $0**

---

## Database Connection

- **Prod (primary, writable):** `ep-patient-sea-aisxwpbp` (direct) / `ep-patient-sea-aisxwpbp-pooler` (pooler)
- **Dev branch:** `ep-long-feather-aivl5dc8` (can be deleted now)
- **Old read replica (DO NOT USE for writes):** `ep-soft-lab-aih6phu5`

---

## What's NOT Done Yet (Future Work)

1. **Seeding Elo ratings** — `recalculateElo()` needs to be run once to process all historical games and populate the EloRating table
2. **Venue table seeding** — The Venue table is empty; static data is in `venue.ts` as a hardcoded map but hasn't been inserted into the DB table yet
3. **Testing on live data** — All modules compile but haven't been tested against live APIs yet
4. **KenPom pointdist/height signals** — Unused KenPom data already in DB (shooting profiles, experience/continuity) hasn't been wired into pick engine yet
5. **Team naming unification** — Multiple mapping systems still exist; canonical naming prompt is in progress
