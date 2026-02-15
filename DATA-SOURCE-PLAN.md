# Dorothy v2 — Data Source Expansion Plan

*Generated: 2026-02-14*

---

## 1. Executive Summary

### Biggest Gaps (by expected edge improvement)

1. **NBA has no advanced model** — No efficiency metrics, no Four Factors, no player impact. This is the single biggest gap. NBA.com stats API (via `nba_api`) provides everything needed for free.
2. **NFL lacks play-by-play analytics** — nflverse provides EPA, CPOE, win probability, and all advanced metrics for free via CSV/parquet. This is a DVOA-equivalent you can build yourself.
3. **No public betting percentages** — Sharp/public money splits are one of the strongest betting signals. Action Network PRO ($120/yr) or scraping are the main options.
4. **No player impact quantification** — When a star is out, how much does the line move? EPM (Dunks & Threes) for NBA, nflverse WAR for NFL.
5. **No Elo ratings** — Easy to build from game results already in the DB. FiveThirtyEight's historical Elo data is on GitHub (CC-BY-4.0, but stopped updating June 2023).
6. **Referee data** — Significant edge for totals. Available via scraping from Basketball-Reference, Pro-Football-Reference, and Ref Stats sites.

### Highest-ROI Additions (in order)

| Priority | Source | Sport | Cost | Edge Signal |
|----------|--------|-------|------|-------------|
| 1 | `nba_api` (NBA.com Stats) | NBA | Free | Four Factors, Net Rating, Pace, player on/off |
| 2 | nflverse data | NFL | Free | EPA/play, CPOE, success rate, red zone %, advanced metrics |
| 3 | Dunks & Threes EPM | NBA | $5/mo | Player impact metric (best public NBA metric) |
| 4 | Action Network PRO | All | $120/yr | Public betting %, sharp money indicators |
| 5 | Build Elo ratings | All | Free (dev time) | Power rankings with recency weighting |
| 6 | OpenWeatherMap | NFL/NCAAF | Free tier | Wind speed, precipitation, temp for outdoor games |
| 7 | Referee scraping | NBA/NFL | Free (scraping) | O/U tendencies, foul rates by official |
| 8 | Barttorvik (NCAAMB) | NCAAMB | Free | T-Rank, game predictions, player stats, transfer portal |
| 9 | SportsDataIO | All | $25-50/mo | Injuries, lineups, depth charts, projections |
| 10 | Massey Composite | NCAAF/NCAAMB | Free | Aggregate of 100+ computer rankings |

---

## 2. Sport-by-Sport Breakdown

---

### 🏀 NBA (HIGHEST PRIORITY — Weakest Current Model)

#### FREE Sources

**A. `nba_api` Python Package (NBA.com Official Stats)**
- **URL:** https://github.com/swar/nba_api
- **Data:** Team Four Factors (eFG%, TOV%, ORB%, FT rate), Net Rating, Pace, Offensive/Defensive ratings, player on/off splits, lineup data, shot charts, play-by-play, clutch stats, hustle stats, tracking data (speed, distance, touches, passes)
- **Cost:** Free. Rate limit ~1 req/sec (be polite, use caching)
- **Signals enabled:**
  - Four Factors efficiency model (the basketball equivalent of KenPom)
  - Pace-adjusted efficiency ratings
  - Player on/off court impact
  - Lineup net ratings
  - Rest/fatigue from tracking data
- **Priority:** 🔴 CRITICAL — This single source transforms your NBA model
- **Integration:** Easy — Python package, returns DataFrames. Cache daily.
- **Key endpoints:**
  - `leaguedashteamstats` — Team stats with Four Factors
  - `teamestimatedmetrics` — NBA's own estimated metrics
  - `leaguedashlineups` — Lineup combinations and net ratings
  - `leaguedashplayerstats` — All player stats
  - `boxscoreadvancedv3` — Advanced box score per game
  - `leaguehustlestatsplayer` — Hustle stats (deflections, loose balls)

**B. Basketball-Reference**
- **URL:** https://www.basketball-reference.com
- **Data:** Historical stats, advanced stats (PER, WS, BPM, VORP), team ratings, referee stats
- **Cost:** Free to scrape (respect robots.txt, rate limit). ToS prohibits automated scraping for commercial use — use for personal/research.
- **Signals enabled:**
  - Historical team SRS (Simple Rating System)
  - Referee tendencies (pace, foul rate, O/U results)
  - Player advanced metrics (BPM is best free catch-all)
- **Priority:** 🟡 HIGH
- **Integration:** Medium — HTML scraping, structured tables. Cache aggressively.

**C. CleaningTheGlass.com (Free tier)**
- **URL:** https://cleaningtheglass.com
- **Data:** Filtered stats removing garbage time and end-of-quarter heaves. Lineup data, on/off, shooting zones.
- **Cost:** Free tier has limited data. Full: $10/mo.
- **Signals:** Garbage-time-filtered efficiency is significantly more predictive.
- **Priority:** 🟡 HIGH
- **Integration:** Hard — No API, would need scraping. Better to use nba_api and filter yourself.

**D. Dunks & Threes — EPM (Estimated Plus-Minus)**
- **URL:** https://dunksandthrees.com/epm
- **Data:** EPM ratings (the best publicly available all-in-one NBA player metric), team ratings, projections
- **Cost:** Subscription for full access — ~$5/month
- **Signals:** Player impact quantification. When a player is out, you know exactly how many points of impact.
- **Priority:** 🔴 CRITICAL for injury-adjusted spreads
- **Integration:** Medium — May need scraping or manual export. Check if they have an API.

**E. NBA Injury Impact Model (build yourself)**
- Using EPM + lineup data from nba_api, calculate: if Player X (EPM +5.0) is out, the team loses ~5 points per 100 possessions × their minutes share.
- This is THE edge for NBA betting — most public models don't adjust properly for injuries.

#### PAID Sources

**F. BallDontLie API**
- **URL:** https://www.balldontlie.io
- **Data:** NBA stats, live scores, odds, player props. Covers NBA, NFL, NCAAB, NCAAF.
- **Cost:** Free tier available. Paid tiers for higher rate limits and live data.
- **Signals:** Consolidated API, but nba_api is more detailed for NBA specifically.
- **Priority:** 🟢 MEDIUM — useful as backup/consolidated source
- **Integration:** Easy — REST API with good docs

**G. SportsDataIO**
- **URL:** https://sportsdata.io
- **Data:** Injuries, depth charts, lineups, projections, DFS salaries
- **Cost:** ~$25-50/month for developer tier (varies by sport)
- **Signals:** Real-time lineup confirmations, projected starters, injury severity
- **Priority:** 🟡 HIGH for lineup data
- **Integration:** Easy — REST API, JSON responses

---

### 🏈 NFL (SECOND PRIORITY — Missing Advanced Metrics)

#### FREE Sources

**A. nflverse (CRITICAL)**
- **URL:** https://github.com/nflverse/nflverse-data
- **Data repos (direct CSV/parquet downloads):**
  - `nflreadr` — Play-by-play with EPA, WPA, CPOE, air yards, xPass
  - Player stats (weekly & seasonal)
  - Roster data, draft picks, contracts
  - Next Gen Stats (AWS) — when available
  - Injuries, depth charts
  - Win probabilities per play
  - Combine data
- **Cost:** Completely free. Data hosted on GitHub releases as parquet/CSV.
- **Signals enabled:**
  - **EPA/play** (offensive and defensive) — THE advanced NFL metric, equivalent to DVOA
  - **CPOE** (Completion Probability Over Expected) — QB quality metric
  - **Success rate** — % of plays with positive EPA
  - **Red zone efficiency** from play-by-play
  - **3rd down conversion rates** with EPA context
  - **Explosive play rate**
  - **Turnover-adjusted efficiency**
  - You can literally build your own DVOA-equivalent from this data
- **Priority:** 🔴 CRITICAL — This is the #1 addition for NFL
- **Integration:** Easy — Download parquet files, load into pandas/postgres
- **Notes:** Updated weekly during season. Historical data back to 1999.

**B. Pro-Football-Reference**
- **URL:** https://www.pro-football-reference.com
- **Data:** Team & player stats, referee stats, advanced passing/rushing/receiving, draft data, game logs
- **Cost:** Free (scraping, same ToS concerns as Basketball-Reference)
- **Signals:**
  - Referee tendencies (penalty rates, game pace)
  - Advanced passing stats (ANY/A, passer rating in context)
  - Expected points models
- **Priority:** 🟡 HIGH for referee data
- **Integration:** Medium — HTML scraping

**C. NFL Weather Data**
- **Open-Meteo API:** https://open-meteo.com — Free, no API key needed. Historical + forecast weather. Wind speed, precipitation, temperature, humidity.
- **OpenWeatherMap:** https://openweathermap.org — Free tier: 1,000 calls/day. One Call 3.0: first 1,000 calls/day free.
- **Signals:** Wind >15mph significantly impacts passing/kicking. Cold weather affects totals. Rain increases fumbles.
- **Priority:** 🟡 HIGH for totals and game totals
- **Integration:** Easy — REST API, cache forecasts by stadium/date

**D. NFL Elo Ratings (build yourself)**
- Start with nflverse game results. Apply standard Elo formula with:
  - K-factor of 20
  - Home-field advantage of ~48 points (has been declining)
  - Margin-of-victory multiplier
  - Season regression to mean (1/3 toward 1500)
- FiveThirtyEight's historical Elo CSV: https://github.com/fivethirtyeight/data/tree/master/nfl-elo (stopped updating June 2023, but historical data is CC-BY-4.0)
- **Priority:** 🟡 HIGH — Easy to build, adds predictive signal
- **Integration:** Easy — pure math on existing game data

**E. Stadium/Venue Data**
- Compile a static table: stadium name, city, dome/outdoor, altitude, capacity, surface type
- Altitude matters: Denver (5,280 ft) affects kicking and passing
- Surface: turf vs grass affects injury rates and speed
- **Priority:** 🟢 MEDIUM
- **Integration:** Easy — one-time static table

#### PAID Sources

**F. PFF (Pro Football Focus)**
- **URL:** https://www.pff.com
- **Data:** Player grades (0-100) for every play, pass-blocking grades, coverage grades, WAR
- **Cost:** Premium: $39.99/yr (limited data). Elite: $79.99/yr. API access: enterprise pricing ($$$$).
- **Signals:** Player-level grades are gold for prop bets and injury impact. No public API — would need scraping from premium account.
- **Priority:** 🟡 HIGH but expensive/hard to integrate
- **Integration:** Hard — No API, scraping required from paid account

**G. Football Outsiders (DVOA)**
- **URL:** https://www.footballoutsiders.com
- **Data:** DVOA (Defense-adjusted Value Over Average) — team and unit level
- **Cost:** Premium: $49.99/season. No API.
- **Signals:** DVOA is THE gold-standard NFL efficiency metric, but you can approximate it with nflverse EPA data for free.
- **Priority:** 🟢 MEDIUM — nflverse EPA is a good substitute
- **Integration:** Hard — scraping from paid site

---

### 🏈 NCAAF (College Football)

#### FREE Sources (Expanding Beyond CFBD)

**A. CollegeFootballData.com (already have — expand usage)**
- **Additional endpoints to use:**
  - `/play/stats` — Play-by-play with EPA
  - `/ppa` — Predicted Points Added (their EPA equivalent)
  - `/ratings/sp` — SP+ (already using)
  - `/ratings/srs` — Simple Rating System
  - `/ratings/elo` — Elo ratings!
  - `/talent` — Recruiting talent composite
  - `/metrics/wp` — Win probability
  - `/stats/categories` — Granular team stats
- **You're under-utilizing this API.** It has Elo, SRS, talent ratings, PPA, and more.
- **Priority:** 🔴 CRITICAL — Free data you already have access to
- **Integration:** Easy — same API you already use

**B. Massey Ratings Composite**
- **URL:** https://masseyratings.com/ranks
- **Data:** Aggregate of 100+ computer rating systems for NCAAF and NCAAMB
- **Cost:** Free to view. Bulk download may require permission. Scrapeable.
- **Signals:** Consensus ranking is more stable/predictive than any single model
- **Priority:** 🟡 HIGH
- **Integration:** Medium — scraping (Cloudflare protected)

**C. Bill Connelly's SP+ (via CFBD)**
- Already have this. Make sure you're using all components:
  - Overall SP+ rating
  - Offensive SP+
  - Defensive SP+
  - Special Teams SP+
  - Second-order wins (expected W-L based on play-by-play)

**D. Recruiting Rankings (247Sports Composite)**
- **URL:** https://247sports.com/Season/2025-Football/CompositeTeamRankings/
- **Data:** Recruiting talent by team — correlates heavily with future performance
- **Cost:** Free to view. Scraping required. CFBD has `/talent` endpoint with composite data.
- **Signals:** Talent composite is one of the best predictors of NCAAF success (R² ~0.7 with win %)
- **Priority:** 🟡 HIGH — use CFBD's talent endpoint
- **Integration:** Easy via CFBD

**E. Sagarin Ratings**
- **URL:** https://sagarin.com/sports/cfsend.htm
- **Data:** Sagarin rating, schedule strength, pure points rating
- **Cost:** Free to view. Scraping required.
- **Priority:** 🟢 MEDIUM (Massey composite includes Sagarin)

**F. cfbfastR (R/Python package)**
- **URL:** https://github.com/sportsdataverse/cfbfastR
- **Data:** Wrapper around CFBD + ESPN data with EPA calculations
- **Python equivalent:** `cfbd` Python package
- **Priority:** 🟢 MEDIUM — useful if building in R/Python

---

### 🏀 NCAAMB (College Basketball)

#### FREE Sources (Expanding Beyond KenPom)

**A. Barttorvik (T-Rank)**
- **URL:** https://barttorvik.com
- **Data:** T-Rank (alternative to KenPom), game predictions, player stats, transfer portal impact, wacky game logs, tempo-free stats, tournament projections
- **Key pages:**
  - `/trank.php` — Full T-Rank ratings
  - `/gamestat.php` — Game-level stats
  - `/playerstat.php` — Player-level stats
  - `/trankpre.php` — Preseason predictions
- **Cost:** Free! No API but well-structured HTML tables (easy to scrape).
- **Signals:**
  - Second opinion on KenPom (ensemble models beat single models)
  - Player-level stats KenPom doesn't provide
  - Transfer portal impact ratings
  - "Luck" measured differently than KenPom
- **Priority:** 🔴 CRITICAL — Free KenPom alternative/complement
- **Integration:** Medium — scraping required, but tables are clean HTML

**B. Haslametrics**
- **URL:** https://haslametrics.com
- **Data:** Another tempo-free efficiency model, game predictions, team ratings
- **Cost:** Free
- **Signals:** Third efficiency model for ensemble. Their game predictions are independently generated.
- **Priority:** 🟡 HIGH
- **Integration:** Medium — scraping

**C. EvanMiya.com**
- **URL:** https://evanmiya.com
- **Data:** BPR (Box Plus-Minus Rating) for players, team ratings, game predictions
- **Cost:** Free tier with some data. Premium: $9.99/month for full player data.
- **Signals:** Player-level impact metrics (like EPM but for college). Critical for injury-adjusted predictions.
- **Priority:** 🟡 HIGH
- **Integration:** Medium — scraping or manual export

**D. Warren Nolan (waNelo)**
- **URL:** https://warrennolan.com
- **Data:** RPI, SOS, NET rankings, Quad records, bracket projections
- **Cost:** Free
- **Signals:** Schedule strength context, quality of wins/losses
- **Priority:** 🟢 MEDIUM (KenPom SOS is better)

**E. KenPom (already have — ensure full utilization)**
- Make sure you're capturing:
  - FanMatch predictions (game-level spread/total predictions)
  - Luck rating (games closer than efficiency suggests → regression candidate)
  - Conference-only stats vs overall stats
  - Experience/height/bench minutes

**F. hoopR (R package for CBB data)**
- **URL:** https://github.com/sportsdataverse/hoopR
- **Data:** Play-by-play, box scores, team stats from ESPN + KenPom
- **Priority:** 🟢 MEDIUM

---

### 🏈🏀 Cross-Sport Sources

#### Public Betting / Sharp Money

**A. Action Network PRO**
- **URL:** https://actionnetwork.com
- **Data:** Public betting percentages (% of bets and % of money on each side), sharp action alerts, PRO projections, referee data, systems
- **Cost:** $120/year (PRO subscription)
- **Signals:**
  - **Contrarian betting** — Fading the public when 70%+ is on one side
  - **Sharp money indicators** — When money % diverges from bet %, sharps are on the other side
  - **Steam moves** — Coordinated sharp line moves
- **Priority:** 🔴 CRITICAL — Public betting % is one of the strongest betting signals
- **Integration:** Hard — No API. Would need scraping from paid account, or manual daily exports.
- **Referee page:** https://www.actionnetwork.com/nfl/officials — O/U tendencies per ref

**B. Pregame.com / VegasInsider.com**
- **Data:** Consensus betting percentages, line history
- **Cost:** Free (limited). Premium for real-time.
- **Signals:** Similar to Action Network but less granular
- **Priority:** 🟢 MEDIUM (Action Network is better)

**C. COVERS.com**
- **URL:** https://covers.com
- **Data:** Consensus picks, ATS records, historical closing lines
- **Cost:** Free to view. Scrapeable.
- **Signals:** Historical closing lines for CLV (Closing Line Value) analysis
- **Priority:** 🟡 HIGH for historical closing lines
- **Integration:** Medium — scraping

#### Referee / Officials Data

**D. NBA Referee Stats**
- **Source 1:** Basketball-Reference game logs include officials
- **Source 2:** NBA.com official assignments
- **Source 3:** NBAstuffer.com/referee-stats (free, scrapeable)
- **Data:** Pace, foul rates, home team win %, O/U results per referee crew
- **Signals:** Some refs consistently call more fouls → higher totals. 2-3 point O/U edge possible.
- **Priority:** 🟡 HIGH for totals
- **Integration:** Medium — compile from multiple sources

**E. NFL Referee Stats**
- **Source:** Pro-Football-Reference, footballzebras.com
- **Data:** Penalties per game, penalty yards, home/away bias
- **Signals:** Some crews average 2-3 more penalties → affects game flow and totals
- **Priority:** 🟡 HIGH for totals

#### Weather

**F. Open-Meteo (Recommended)**
- **URL:** https://open-meteo.com/en/docs
- **Data:** Hourly weather: temperature, wind speed/direction/gusts, precipitation, humidity, cloud cover
- **Cost:** FREE for non-commercial. No API key needed. 10,000 requests/day.
- **Signals:** Wind >15mph, temp <20°F, rain/snow all significantly impact football totals and passing
- **Priority:** 🟡 HIGH for NFL/NCAAF outdoor games
- **Integration:** Easy — simple REST API: `https://api.open-meteo.com/v1/forecast?latitude=X&longitude=Y&hourly=temperature_2m,windspeed_10m,precipitation`
- **Stadium coordinates:** Build a static lookup table

**G. Visual Crossing Weather**
- **URL:** https://www.visualcrossing.com/weather-api
- **Data:** Historical + forecast weather, more detailed than Open-Meteo
- **Cost:** Free tier: 1,000 records/day. $21/mo for 10,000/day.
- **Priority:** 🟢 MEDIUM (Open-Meteo is sufficient)

#### Travel / Fatigue

**H. Venue & Travel Distance (build yourself)**
- Create a static table with every NBA/NFL/NCAAF/NCAAMB venue: lat/lon, timezone, altitude
- Calculate great-circle distance between consecutive game venues
- Factor in timezone changes (west-to-east travel is worse)
- **Data needed:** Schedule (already have from ESPN) + venue coordinates
- **Signals:**
  - NBA: Teams traveling >1,500 miles on a back-to-back lose at higher rates
  - NFL: West coast teams playing 1pm ET games (effectively 10am body clock)
  - NCAAMB: Mid-major teams traveling across country for tournament
- **Priority:** 🟡 HIGH for NBA
- **Integration:** Easy — static data + distance calculation

#### Elo Ratings (All Sports)

**I. Build Elo System (recommended)**
- Use game results from your DB
- Parameters to tune per sport:
  - **NFL:** K=20, HFA=48, MOV multiplier=ln(MOV+1)×2.2/((winner_elo-loser_elo)×0.001+2.2)
  - **NBA:** K=20, HFA=100, regress 25% to mean each season
  - **NCAAMB:** K=32, HFA=100, account for neutral-site games
  - **NCAAF:** K=25, HFA=55, incorporate preseason from recruiting rankings
- **FiveThirtyEight historical data:** https://github.com/fivethirtyeight/data — Elo for NFL (1920-2023), NBA (1946-2023) as CSV. Stopped updating but great for backtesting.
- **Priority:** 🟡 HIGH — adds independent power rating signal
- **Integration:** Easy — Pure math, implement in Python, store in DB

---

## 3. Cost Estimates

### Tier 1: Free Only
| Source | Sport | Monthly Cost |
|--------|-------|-------------|
| nba_api | NBA | $0 |
| nflverse | NFL | $0 |
| CFBD (expand usage) | NCAAF | $0 |
| Barttorvik (scraping) | NCAAMB | $0 |
| Open-Meteo | NFL/NCAAF | $0 |
| Build Elo ratings | All | $0 (dev time) |
| ESPN API (existing) | All | $0 |
| Build venue/travel table | All | $0 (dev time) |
| **Total** | | **$0/month** |

**Estimated dev time:** 40-60 hours to integrate all free sources.

### Tier 2: Free + Light Paid
| Source | Sport | Monthly Cost |
|--------|-------|-------------|
| Everything in Tier 1 | All | $0 |
| Action Network PRO | All | $10/mo ($120/yr) |
| Dunks & Threes EPM | NBA | ~$5/mo |
| EvanMiya Premium | NCAAMB | $10/mo |
| **Total** | | **~$25/month ($300/yr)** |

### Tier 3: Full Paid Stack
| Source | Sport | Monthly Cost |
|--------|-------|-------------|
| Everything in Tier 2 | All | $25/mo |
| SportsDataIO (lineups/injuries) | All | $25-50/mo |
| Cleaning the Glass | NBA | $10/mo |
| PFF Premium | NFL | $7/mo ($80/yr) |
| Football Outsiders | NFL | $4/mo ($50/yr) |
| BallDontLie Pro | All | $10-30/mo |
| **Total** | | **~$80-130/month ($960-1,560/yr)** |

**Recommendation: Tier 2 is the sweet spot.** $25/month gets you 90% of the value.

---

## 4. Implementation Priority Order

### Phase 1: Quick Wins (Week 1-2) — $0
1. **`nba_api` integration** — Pull Four Factors, Net Rating, Pace for all NBA teams. Store daily snapshots. Build efficiency model.
2. **nflverse integration** — Download current season play-by-play parquet. Calculate team EPA/play offense and defense. Store in DB.
3. **CFBD expansion** — Start pulling Elo, talent composite, PPA, and SRS from endpoints you already have access to.
4. **Build Elo ratings** — Implement Elo calculator for all 4 sports using historical game data in your DB.

### Phase 2: Second Wave (Week 3-4) — $0
5. **Barttorvik scraper** — Scrape T-Rank ratings for NCAAMB ensemble model.
6. **Open-Meteo weather** — Build stadium coordinate lookup. Pull weather for upcoming outdoor NFL/NCAAF games.
7. **Venue/travel table** — Build static venue data. Calculate travel distance for each game.
8. **NBA player impact model** — Using nba_api on/off data, calculate per-player point impact for injury adjustments.

### Phase 3: Paid Edge (Month 2) — $25/mo
9. **Action Network PRO** — Subscribe. Build scraper for public betting percentages and sharp indicators.
10. **Dunks & Threes EPM** — Subscribe. Integrate EPM ratings for injury impact model.
11. **EvanMiya** — Subscribe. Player-level NCAAMB impact metrics.

### Phase 4: Refinements (Month 3+)
12. **Referee scraping** — Build referee tendency database from Basketball-Reference and Pro-Football-Reference.
13. **Closing line tracking** — Scrape historical closing lines from Covers.com for CLV analysis.
14. **Ensemble model** — Combine multiple rating systems (KenPom + Barttorvik + Haslametrics for NCAAMB; EPA + Elo for NFL) with weighted averaging.
15. **Situational factors** — Revenge games, letdown spots, conference tournament motivation (metadata enrichment).

---

## 5. Technical Integration Notes

### API Formats & Access Patterns

| Source | Format | Auth | Rate Limit | Caching Strategy |
|--------|--------|------|-----------|-----------------|
| nba_api | JSON (Python) | None | ~1 req/sec | Daily snapshot of team/player stats |
| nflverse | Parquet/CSV | None | N/A (file download) | Weekly download during season |
| CFBD | JSON REST | API key (have) | 1,000/mo free | Cache all responses, refresh weekly |
| Open-Meteo | JSON REST | None | 10,000/day | Cache forecast per stadium per game day |
| Barttorvik | HTML scrape | None | Be polite (~1/sec) | Daily scrape during season |
| Basketball-Ref | HTML scrape | None | ~1 req/3sec | Cache aggressively, scrape weekly |
| BallDontLie | JSON REST | API key | Varies by tier | Real-time for live, daily for historical |
| Action Network | HTML scrape | Login cookie | Be polite | Scrape 2x daily during active game days |

### Database Schema Additions

```sql
-- NBA Four Factors snapshots
CREATE TABLE NBATeamAdvancedStats (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES Team(id),
  date DATE NOT NULL,
  net_rating DECIMAL(6,2),
  off_rating DECIMAL(6,2),
  def_rating DECIMAL(6,2),
  pace DECIMAL(6,2),
  efg_pct DECIMAL(5,3),
  tov_pct DECIMAL(5,3),
  orb_pct DECIMAL(5,3),
  ft_rate DECIMAL(5,3),
  opp_efg_pct DECIMAL(5,3),
  opp_tov_pct DECIMAL(5,3),
  opp_orb_pct DECIMAL(5,3),
  opp_ft_rate DECIMAL(5,3),
  UNIQUE(team_id, date)
);

-- Elo ratings (all sports)
CREATE TABLE EloRating (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES Team(id),
  sport VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1500,
  UNIQUE(team_id, date)
);

-- NFL EPA metrics
CREATE TABLE NFLTeamEPA (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES Team(id),
  season INTEGER NOT NULL,
  week INTEGER,
  off_epa_per_play DECIMAL(6,4),
  def_epa_per_play DECIMAL(6,4),
  pass_epa DECIMAL(6,4),
  rush_epa DECIMAL(6,4),
  success_rate DECIMAL(5,3),
  cpoe DECIMAL(6,3),
  red_zone_td_pct DECIMAL(5,3),
  third_down_pct DECIMAL(5,3),
  UNIQUE(team_id, season, week)
);

-- Weather for games
CREATE TABLE GameWeather (
  id SERIAL PRIMARY KEY,
  game_id INTEGER,
  sport VARCHAR(10) NOT NULL,
  temperature_f DECIMAL(5,1),
  wind_speed_mph DECIMAL(5,1),
  wind_gust_mph DECIMAL(5,1),
  precipitation_in DECIMAL(5,2),
  humidity_pct INTEGER,
  conditions VARCHAR(50),
  dome BOOLEAN DEFAULT FALSE
);

-- Public betting percentages
CREATE TABLE PublicBetting (
  id SERIAL PRIMARY KEY,
  game_id INTEGER,
  sport VARCHAR(10) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  spread_bet_pct_home DECIMAL(5,2),
  spread_money_pct_home DECIMAL(5,2),
  total_bet_pct_over DECIMAL(5,2),
  total_money_pct_over DECIMAL(5,2),
  ml_bet_pct_home DECIMAL(5,2)
);

-- Referee tendencies
CREATE TABLE RefereeStats (
  id SERIAL PRIMARY KEY,
  referee_name VARCHAR(100) NOT NULL,
  sport VARCHAR(10) NOT NULL,
  season INTEGER NOT NULL,
  games_officiated INTEGER,
  avg_total_points DECIMAL(6,2),
  over_pct DECIMAL(5,3),
  avg_fouls_per_game DECIMAL(5,2),
  avg_penalties_per_game DECIMAL(5,2),
  home_win_pct DECIMAL(5,3)
);

-- Player impact metrics
CREATE TABLE PlayerImpact (
  id SERIAL PRIMARY KEY,
  player_name VARCHAR(100) NOT NULL,
  team_id INTEGER REFERENCES Team(id),
  sport VARCHAR(10) NOT NULL,
  season INTEGER NOT NULL,
  metric_name VARCHAR(20) NOT NULL, -- EPM, BPM, WAR, etc.
  metric_value DECIMAL(6,2),
  minutes_pct DECIMAL(5,3),
  estimated_point_impact DECIMAL(5,2), -- points per game impact
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Caching Strategy

- **Daily cron jobs:**
  - NBA: Pull team advanced stats and player stats from nba_api (~30 API calls)
  - NCAAMB: Scrape Barttorvik T-Rank (~5 page fetches)
  - All sports: Update Elo ratings from yesterday's results
- **Weekly cron jobs:**
  - NFL (in-season): Download nflverse play-by-play, recalculate EPA
  - NCAAF (in-season): Pull CFBD PPA, Elo, talent from API
  - Referee stats: Scrape updated season referee stats
- **Game-day jobs:**
  - Weather: Pull 3 hours before kickoff for outdoor games
  - Public betting: Scrape Action Network 2x (morning + 1hr before game)
  - Lineup confirmations: Check injury reports 90min before tip/kickoff
- **Store everything in Neon DB** with timestamps for historical analysis

### Key Implementation Notes

1. **nba_api throttling:** Add 0.6-1.0 second delay between requests. NBA.com will temporarily block you if you hammer it.
2. **nflverse files are large:** Play-by-play parquet for one season is ~150MB. Store processed aggregates, not raw PBP.
3. **Scraping legal considerations:** Basketball-Reference and Pro-Football-Reference (Sports Reference LLC) have strict ToS against scraping. Use for personal/research only. Cache everything to minimize requests.
4. **Action Network scraping:** They actively fight scrapers. Use rotating user agents, respect rate limits, consider Playwright/Puppeteer for JS-rendered content.
5. **Ensemble modeling:** When you have 2+ rating systems per sport, a simple weighted average often outperforms any single system. Weights can be optimized via backtesting against historical spreads.

---

## 6. Expected Edge Improvement by Addition

| Addition | Expected ATS Improvement | Confidence |
|----------|------------------------|------------|
| NBA Four Factors model (nba_api) | +3-5% hit rate | High |
| NFL EPA model (nflverse) | +2-4% hit rate | High |
| Public betting contrarian signals | +1-3% on heavy public sides | Medium |
| Player injury impact quantification | +2-4% when key players out | High |
| Elo ratings (ensemble signal) | +1-2% overall | Medium |
| Weather integration (outdoor football) | +1-3% on weather-affected games | Medium |
| Referee tendencies (totals) | +1-2% on O/U bets | Medium |
| Barttorvik ensemble (NCAAMB) | +1-2% over KenPom alone | Medium |
| Travel/fatigue modeling (NBA) | +1-2% on B2B/travel spots | Medium |

**Cumulative estimated improvement: +5-10% ATS hit rate** with full implementation, which is enormous in sports betting (55%+ is profitable, 60%+ is elite).

---

## Summary

**Do these first (free, high impact):**
1. `nba_api` → NBA Four Factors model
2. nflverse → NFL EPA model
3. CFBD expansion → NCAAF Elo, talent, PPA
4. Barttorvik → NCAAMB ensemble
5. Build Elo for all sports
6. Open-Meteo → Weather for outdoor games

**Then add these ($25/mo):**
7. Action Network PRO → Public betting %
8. Dunks & Threes → NBA player impact
9. EvanMiya → NCAAMB player impact

**The NBA model is your biggest opportunity.** Going from basic power ratings to a Four Factors + player impact + pace-adjusted model could alone justify the entire effort.
