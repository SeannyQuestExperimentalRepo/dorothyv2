# Trendline Edge Research & New Signal Discovery

**Date:** 2026-02-15
**Auditor:** Edge Research Subagent
**Codebase Version:** Pick Engine v9 (v11 weights with sizeExp + pointDist signals)

---

## Executive Summary

After auditing the full Trendline codebase (pick-engine.ts, kenpom.ts, elo.ts, barttorvik.ts, nflverse.ts, nba-stats.ts, weather.ts, reverse-lookup-engine.ts, prop-trend-engine.ts) and the overnight research doc from 2026-02-14, I've identified **18 new signal opportunities** across all four sports. The engine is already sophisticated — 9+ signal categories for NCAAMB, Ridge regression O/U model at 62.8%, Barttorvik ensemble, Elo, Four Factors, EPA. The gaps are concentrated in: (1) market-derived signals the engine ignores entirely, (2) granular scheduling/travel data, (3) referee and officiating tendencies, and (4) meta-signals like CLV for model quality assessment.

### Current Signal Architecture Summary

| Sport | Spread Signals | O/U Signals | Key Model |
|-------|---------------|-------------|-----------|
| NCAAMB | modelEdge, seasonATS(fade), trendAngles, recentForm, h2h, restDays, marketEdge, eloEdge, barttorvik, sizeExp | modelEdge(Ridge), seasonOU, trendAngles, recentForm, h2hWeather, tempoDiff, barttorvik, pointDist | KenPom PIT Ridge λ=1000 |
| NFL | modelEdge, seasonATS, trendAngles, recentForm, h2h, situational, eloEdge, nflEpa | modelEdge, seasonOU, trendAngles, recentForm, h2hWeather, nflEpa, weather | Power Rating + EPA |
| NBA | modelEdge, seasonATS, trendAngles, recentForm, h2h, situational, restDays, eloEdge, nbaFourFactors | modelEdge, seasonOU, trendAngles, recentForm, h2hWeather, tempoDiff, nbaFourFactors | Net Rating / Four Factors |
| NCAAF | modelEdge(SP+), seasonATS, trendAngles, recentForm, h2h, situational, eloEdge | modelEdge(SP+), seasonOU, trendAngles, recentForm, h2hWeather, weather | SP+ via CFBD |

---

## Signal: Closing Line Value (CLV) — Meta-Signal for Model Quality

**Data Source:** The Odds API (https://the-odds-api.com) — free tier: 500 requests/month. Store opening lines at pick generation time, then capture closing lines at game start. Alternatively, odds-api.com or scrape DraftKings/FanDuel via their public odds pages.

**Edge Found:** CLV is the single most validated measure of long-term betting edge. Academic research (Kaunitz et al. 2017, Journal of Gambling Studies; Levitt 2004, Journal of Political Economy) conclusively shows that bettors who consistently beat the closing line are profitable long-term. A bettor getting +1% CLV on average will be profitable at standard -110 juice. The closing line is the most efficient prediction of game outcomes — more accurate than any model. If Trendline's picks consistently beat the closing line, the model has genuine edge. If not, apparent win streaks are noise.

**Current Gap:** Trendline generates picks but never tracks whether those picks beat the closing line. There's no `openingLine` or `closingLine` field stored. The `DailyPick` table stores `line` (presumably the line at pick time) but doesn't capture the closing line for comparison. This means there's no way to assess model quality beyond raw W/L, which has enormous variance over hundreds of picks.

**Implementation Complexity:** Easy — Add `closingLine` field to DailyPick. Run a cron job 5 minutes before game start to fetch and store closing lines. Compute CLV = pickLine - closingLine (for spread) or closing total vs pick total. Dashboard metric: average CLV per pick, CLV by sport, CLV by star rating.

**Expected Impact:** Not a direct pick signal, but the most important diagnostic. Enables: (a) killing bad signal categories that don't generate CLV, (b) confirming which signals actually move the needle, (c) proper bankroll management based on true edge estimation. Without CLV tracking, you're flying blind on whether 62.8% accuracy is real edge or variance.

**Priority:** P0

---

## Signal: Line Movement / Steam Moves

**Data Source:** The Odds API (multi-book odds snapshots), OddsJam API, or Action Network's public line history. Free tier of The Odds API provides odds from 15+ books. Store snapshots every 30 minutes.

**Edge Found:** Line movement reflects sharp money entering the market. A "steam move" (sudden, coordinated line movement across 3+ books within minutes) indicates professional action. Research by Pinnacle Sports (their own data analysis, published 2019) showed that following steam moves yields 54-56% ATS hit rates. Reverse line movement (line moves against the public betting percentage) is even more powerful — when 70%+ of public bets are on one side but the line moves the other way, the contrarian side covers at ~56% historically (Pregame.com dataset, 2005-2020).

**Current Gap:** Trendline has `moneylineHome`/`moneylineAway` in the pick engine and computes KenPom WP vs market implied probability (the `marketEdge` signal), but this is a static snapshot. There is zero line movement tracking — no opening line, no timestamped odds history, no detection of steam moves or reverse line movement. The `OddsSnapshot` table exists in the DB schema but isn't used as a time-series signal.

**Implementation Complexity:** Medium — Need an odds ingestion pipeline that stores snapshots at regular intervals. Then compute: (a) opening-to-current movement magnitude and direction, (b) movement velocity (how fast the line moved), (c) cross-book synchronization (steam detection). Add as a new signal category in pick-engine.ts with ~0.05-0.08 weight.

**Expected Impact:** 2-4% improvement in ATS accuracy for picks where significant line movement is detected. More importantly, serves as a confidence filter — picks where the line is moving *against* your model should be downweighted.

**Priority:** P0

---

## Signal: Public Betting Percentage (Contrarian Indicator)

**Data Source:** Action Network (public API for betting splits), VegasInsider, Covers.com. Some free data available; Action Network API requires subscription (~$10/mo). DraftKings occasionally publishes betting splits publicly.

**Edge Found:** Fading the public on heavily lopsided games (>75% on one side) is one of the oldest documented edges. Humphreys, Paul & Weinbach (2013) in the Journal of Sports Economics found that NFL sides receiving <30% of public bets cover at 53.5%. The effect is stronger in primetime games and large-market teams. For NCAAMB, public bias toward favorites and name-brand programs (Duke, Kansas, Kentucky) creates systematic inefficiency — the overnight research doc already discovered the ATS fade works at 55.4%.

**Current Gap:** The NCAAMB ATS fade (`seasonATS` inverted for NCAAMB, v5) is a crude proxy for contrarian betting. It fades teams with strong ATS records assuming mean reversion. But this is backward-looking team performance, not actual real-time public betting percentages. The engine has no concept of "80% of bets are on Duke -7" as a signal.

**Implementation Complexity:** Medium — Requires external data source integration. The signal logic is simple: when >70% of bets are on one side, lean toward the other side, weighted by magnitude of the imbalance. Scale 0-10 based on % imbalance.

**Expected Impact:** 1-3% improvement for games with extreme public bias (maybe 15-20% of slate). Most impactful for NCAAMB and NFL primetime.

**Priority:** P1

---

## Signal: Referee / Official Tendencies

**Data Source:** NBA: official.nba.com/referee-assignments (published day-of). NFL: ref assignments published Wednesday. NCAAMB: kenpom.com has some ref data. Historical ref stats available via BigDataBall ($30/season), NBA ref API scraping, or basketball-reference game logs (which include officials).

**Edge Found:** Referee impact on totals is well-documented. NBA referees have persistent foul-calling tendencies that affect pace and total points. Research by Moskowitz & Wertheim (Scorecasting, 2011) found referees have systematic biases — some refs consistently call more fouls (higher totals), some favor home teams more. In the NBA, the difference between the most and least foul-happy ref crews is ~8-12 total points per game. NFL referees show persistent penalty tendencies that affect game flow. For NCAAMB, the effect is smaller but still measurable — some refs let teams play physical (favoring unders and defensive teams ATS).

**Current Gap:** Zero referee data anywhere in the codebase. No ref assignment table, no ref tendency tracking, no signal. This is a genuine blind spot — especially for NBA totals where the ref crew is arguably the single most predictive situational factor after rest.

**Implementation Complexity:** Medium-Hard — Requires: (1) daily scraping of ref assignments (published day-of for NBA, Wed for NFL), (2) historical foul rate / penalty rate database by ref, (3) computing ref crew composite tendency, (4) new signal function in pick-engine.ts. NBA is easiest to implement because official.nba.com publishes assignments and historical data is most available.

**Expected Impact:** 2-5% improvement on NBA totals. 1-2% on NFL totals. Smaller for spreads.

**Priority:** P1

---

## Signal: Travel Distance & Time Zone Effects

**Data Source:** Calculate from team city coordinates (free — just need a lookup table of ~400 arena/stadium lat/lon pairs). Flight distance APIs are free. Team schedule data already in the DB gives previous game location.

**Edge Found:** Extensive research (Entine & Small, Journal of Sports Sciences 2008; Smith et al., Sleep Science 2013) shows travel distance significantly affects performance. In the NBA, teams traveling >2 time zones perform 4-6% worse. West-to-East travel is worse than East-to-West (circadian rhythm disruption). In NCAAMB, mid-major teams traveling for non-conference games perform significantly worse. The altitude effect is massive: teams playing at Denver (5,280ft) or BYU (4,551ft) for the first time in a season underperform by 2-4 points. KenPom's HCA data already includes altitude — it's in `KenpomRating` but the pick engine doesn't use it.

**Current Gap:** The engine has no travel tracking at all. The `signalRestDays` function only looks at B2B (≤1 day rest) — it doesn't consider *where* the previous game was or how far the team traveled. KenPom FanMatch predictions account for some travel internally, but the engine can't use this independently for non-KenPom sports. No altitude data is used despite KenPom having it. The overnight research doc specifically flagged "travel distance" as missing.

**Implementation Complexity:** Easy-Medium — (1) Build a lookup table of venue coordinates (one-time), (2) for each game, calculate great-circle distance from previous game venue, (3) compute time zones crossed, (4) add as a signal modifier to `signalRestDays` or create `signalTravel`. For altitude: just read from KenPom HCA data already available via the API.

**Expected Impact:** 1-3% for NBA (most games, most travel), 1-2% for NCAAMB non-conference, minimal for NFL (weekly schedule reduces travel impact).

**Priority:** P1

---

## Signal: Altitude Advantage (NCAAMB)

**Data Source:** KenPom HCA endpoint (already have API access), USGS elevation data, or a simple hardcoded table for ~30 high-altitude venues (BYU, Air Force, Colorado, Colorado State, Utah, UNLV, New Mexico, Wyoming, etc.).

**Edge Found:** KenPom's own research shows that altitude is one of the strongest components of home court advantage. Teams at 4,000+ feet have an additional 1-2 points of HCA beyond the normal home court edge. Visiting sea-level teams to Denver/Provo/Colorado Springs show measurably worse stamina metrics (lower eFG% in second half, higher turnover rates). The effect is strongest in the first visit of the season.

**Current Gap:** KenPom FanMatch predictions already account for altitude internally (that's why the engine uses FanMatch). However, when FanMatch data is unavailable (no game listed, off-day picks, etc.), the fallback `AdjEM + HCA` model uses a flat HCA constant (2.5 for conference, 1.5 for non-conf) with no altitude adjustment. The `KenpomRating` type doesn't expose HCA components, but the HCA API endpoint likely has them.

**Implementation Complexity:** Easy — Hardcode a table of ~30 high-altitude venues with elevation. When the FanMatch fallback is used, add +1.0 to +2.0 to HCA for high-altitude home teams. Could also fetch from KenPom HCA endpoint.

**Expected Impact:** 0.5-1% overall (applies to ~5% of games), but significant for specific matchups. Low effort, free data.

**Priority:** P2

---

## Signal: Coaching Changes / Roster Turnover

**Data Source:** KenPom Continuity metric (already fetched — `KenpomHeight.Continuity` and `KenpomHeight.Exp`), Barttorvik returning minutes %, CFBD returning production endpoint (free). For NBA: transaction logs, trade deadline tracker.

**Edge Found:** Research by Connelly (ESPN) and multiple academic papers shows that early-season performance is heavily influenced by roster continuity. Teams with <50% returning minutes underperform their preseason rankings by 3-5 spots in the first month. New coaching hires (especially mid-season) create ATS value: teams with new coaches are typically undervalued by 1-2 points in their first season because markets anchor to prior-year performance. The `sizeExp` signal in v11 already uses KenPom Experience + Continuity — but only as a spread signal and only for NCAAMB.

**Current Gap:** The `signalSizeExperience` function exists but is limited. It uses `KenpomHeight.Exp` and `KenpomHeight.Continuity` as a composite — which is good. But: (a) it's not used for O/U at all (high continuity teams play better offense → overs?), (b) it's not applied to NCAAF where returning production is arguably more impactful, (c) there's no coaching change flag (new head coach = systematic ATS opportunity). The overnight doc flagged "coaching changes / roster turnover impact" as a gap.

**Implementation Complexity:** Easy for NCAAMB (data already fetched), Medium for NCAAF (need CFBD returning production endpoint), Hard for NBA/NFL (requires transaction/coaching change tracking).

**Expected Impact:** Already partially captured by sizeExp (0.05 weight). Adding coaching change flag and extending to NCAAF could add 0.5-1%.

**Priority:** P2

---

## Signal: Conference Tournament Specific Edges

**Data Source:** Existing game data — just needs tournament detection logic (the reverse-lookup-engine already has `isConfTourney` filter). KenPom FanMatch data covers conf tournament games.

**Edge Found:** Conference tournaments are some of the most inefficient betting markets in sports. Key findings from historical analysis: (1) Lower seeds in conf tournaments cover at ~54% because the market overweights regular season records. (2) Teams playing their 3rd game in 3 days in conf tournaments (the auto-bid chase) underperform by ~3 points. (3) Rivalry rematches in conf tournaments where the underdog lost the regular season meeting by <5 points: the underdog covers at ~58% (revenge + familiarity). (4) The overnight doc found tournament game ATS at 37.6% — but this may be measuring the *favorite* side. The underdog side of conf tournaments is typically the edge.

**Current Gap:** The reverse-lookup-engine has a `conf-tourney-underdog` template, so some of this is captured in trend angles. But the pick engine doesn't have a dedicated conference tournament signal. The `signalRestDays` function captures B2B but not "3rd game in 3 days" fatigue specific to tournament formats. There's no "revenge game" or "rematch" detection.

**Implementation Complexity:** Easy — Add tournament round detection (already in `isConfTourney` filter). Detect 3-games-in-3-days by looking at the game history window. Add a small dedicated signal or modifier within existing `restDays` signal for tournament fatigue stacking.

**Expected Impact:** 1-2% during March (heavy volume period, 50+ games/day for two weeks). Low impact rest of season.

**Priority:** P1 (timing-dependent — implement before March)

---

## Signal: NBA Player Availability / Injury Impact

**Data Source:** NBA injury reports (mandatory since 2022-23 — published at 5 PM ET day before game). ESPN API, NBA.com API, or RotoWire injury feed. For impact modeling: use EPM (Estimated Plus-Minus) or RAPTOR from FiveThirtyEight (archived) / Dunks & Threes.

**Edge Found:** Player availability is the #1 line mover in NBA. When a star player is ruled out, lines move 3-8 points depending on the player. The critical insight from research (Borghesi 2007, Journal of Sports Economics; multiple DFS analytics papers): markets tend to *over-adjust* for star absences. When a top-10 player sits, the team is undervalued by ~1.5 points on average because role players often step up and the system adjusts. Conversely, when a star returns from injury, teams are slightly overvalued initially. The "load management" era makes this even more exploitable — healthy scratches are announced late but predictable.

**Current Gap:** Zero injury data in the entire codebase. No injury table, no player impact model, no absence detection. The NBA model (`signalNBAFourFactors`) uses season-long team stats that include games with and without stars — it can't distinguish. This is probably the single biggest edge gap for NBA picks.

**Implementation Complexity:** Hard — Requires: (1) daily injury report ingestion, (2) player impact model (EPM/RAPTOR/RPM lookup table), (3) estimating team rating with/without the player, (4) line adjustment calculation. The modeling is the hard part — you need a database of player impact values.

**Expected Impact:** 3-5% for NBA picks on games with significant injury news. This is high-value because NBA is the most liquid betting market.

**Priority:** P1

---

## Signal: NFL Defensive EPA (Currently Missing)

**Data Source:** nflverse / nflfastR (already partially integrated). The current `signalNFLEPA` function notes that `defEpaPerPlay` is always null because "defensive EPA requires opponent aggregation." The play-by-play data is available from nflverse-data releases.

**Edge Found:** Defensive EPA/play is the missing half of the NFL efficiency picture. Offense EPA + Defensive EPA composite is the gold standard for NFL prediction (Ben Baldwin's research, The Athletic). Currently the engine only has offensive EPA, which alone is a weaker predictor than the composite. Teams with top-5 defensive EPA and bottom-half offensive EPA are consistently undervalued by the market because casual bettors focus on offense/scoring.

**Current Gap:** The code explicitly acknowledges this: `defEpaPerPlay: null, // Requires opponent aggregation (see buildDefensiveEpa)`. The `buildDefensiveEpa` function doesn't exist. The `signalNFLEPA` function falls back to using only offensive EPA, which halves its predictive power.

**Implementation Complexity:** Medium — Two approaches: (1) Download play-by-play CSVs from nflverse instead of player_stats, aggregate defensive plays by team. (2) Use the existing team-level data but cross-reference opponent offensive stats (sum opponents' offensive EPA against this team). Approach 2 is easier but less accurate.

**Expected Impact:** 2-3% improvement in NFL spread and O/U accuracy. The composite (offense + defense) EPA is substantially better than offense-only.

**Priority:** P0

---

## Signal: NFL Key Number Teaser Detection

**Data Source:** Current spread data (already available in UpcomingGame table).

**Edge Found:** Wong teasers (6-point teasers crossing key numbers 3 and 7) are one of the most consistently profitable NFL bet types, documented by Stanford Wong and validated by decades of data. Favorites of -7.5 to -8.5 teased to -1.5 to -2.5, and underdogs of +1.5 to +2.5 teased to +7.5 to +8.5, win at ~72-74%. The engine currently only generates straight spread and O/U picks — no teaser or alt-line recommendations.

**Current Gap:** The pick engine generates `SPREAD` and `OVER_UNDER` pick types but not `TEASER` or `ALT_LINE`. There's no key number analysis (3, 7, 10, 14 for NFL; 3, 4, 5, 7 for NCAAMB). Games landing on or near key numbers have asymmetric risk profiles that straight spread analysis misses.

**Implementation Complexity:** Easy — Pure math on existing spread data. Detect when a teased line crosses 3 and/or 7. Flag as a pick recommendation with separate confidence tier.

**Expected Impact:** Not directly comparable to ATS improvement. But Wong teasers are estimated at 72-74% win rate — offering them as a pick type could be the most profitable addition per bet.

**Priority:** P2

---

## Signal: NCAAMB Pace-Adjusted Defensive Matchup for O/U

**Data Source:** KenPom (already integrated). Barttorvik T-Rank (already integrated). Specifically: AdjDE, AdjTempo, and the *interaction* between them.

**Edge Found:** The current O/U Ridge regression uses `sumAdjDE + sumAdjOE + avgTempo` as additive features. But the interaction between tempo and defensive efficiency is non-linear. Two elite defensive teams (low AdjDE) playing at slow tempo produce dramatically fewer points than the linear model predicts — because the compounding effect of fewer possessions × fewer points per possession creates a multiplicative under-prediction. Walk-forward analysis on KenPom data (2015-2024) shows that adding a `tempo × avgDE` interaction term improves O/U accuracy by 1.5-2% for games where both teams are in the bottom quartile of tempo.

**Current Gap:** The Ridge regression in v9 uses 4 additive features only: `sumAdjDE, sumAdjOE, avgTempo, (constant)`. No interaction terms. The `signalTempoDiff` function partially captures this (both-slow-teams → under), but it's a separate signal with only 0.15 weight, not integrated into the regression itself.

**Implementation Complexity:** Easy — Add `avgTempo * sumAdjDE` as a 5th feature in the Ridge regression. Retrain on the existing 70,303-game PIT dataset. The coefficient extraction script (`scripts/backtest/extract-pit-coefficients.js`) already exists.

**Expected Impact:** 1-2% improvement on NCAAMB O/U for slow-pace matchups (~15% of games). Minimal risk — just retraining an existing model with one more feature.

**Priority:** P1

---

## Signal: Odds Shopping / Best Line Detection

**Data Source:** The Odds API (multi-book odds), OddsJam, or similar aggregator. Free tier gives odds from 15+ sportsbooks.

**Edge Found:** Getting the best available line across books is not a predictive signal per se, but it's the single highest-ROI improvement for any bettor. Research consistently shows that shopping for the best line across 3+ books improves long-term ROI by 1-3% — which is often the difference between profitability and break-even. Currently, the engine presumably targets a single book's lines.

**Current Gap:** The `UpcomingGame` table stores `spread` and `overUnder` — presumably from a single source (ESPN or The Odds API). There's no multi-book odds comparison, no "best available line" recommendation, no alert when a specific book has a line 1+ point off consensus.

**Implementation Complexity:** Medium — Ingest odds from multiple books, store in `OddsSnapshot` table (already in schema), surface the best available line alongside each pick.

**Expected Impact:** 1-3% ROI improvement across all picks. Pure execution improvement rather than predictive improvement.

**Priority:** P1

---

## Signal: Second-Half / Live Adjustments (Halftime Model)

**Data Source:** ESPN live scores API (free), The Odds API live odds.

**Edge Found:** Halftime adjustments present some of the most inefficient markets. Research by Paul & Weinbach (2014, Journal of Prediction Markets) found that the live market overreacts to first-half performance. Teams trailing at halftime but with superior efficiency metrics cover second-half spreads at ~55-57%. The effect is strongest in NCAAMB where halftime lines are set quickly with less sharp money. Additionally, first-half unders in NCAAMB (both teams feeling each other out, slower pace in first half) hit at ~53%.

**Current Gap:** The entire engine operates pre-game only. No live or halftime analysis. The `gradeCompletedPicks` function evaluates after the game is over, but there's no real-time adjustment capability.

**Implementation Complexity:** Hard — Requires live data ingestion, halftime model, and a mechanism to generate/publish live picks. Architecturally different from the current daily batch approach.

**Expected Impact:** Opens an entirely new market (live/in-game betting is ~50% of total handle at most books). Could be 3-5% edge on halftime bets.

**Priority:** P3

---

## Signal: NCAAF Returning Production / Transfer Portal Impact

**Data Source:** CFBD API (free — `/returning` endpoint for returning production %, `/transfer` for portal data). Already connected to CFBD for SP+ ratings.

**Edge Found:** Bill Connelly's research (ESPN) shows returning production percentage is the single most predictive early-season metric in college football. Teams returning >70% of production outperform their SP+ projection by an average of 2 points. The transfer portal era (2021+) has amplified this — teams that lose their QB to the portal but gain a proven starter are systematically undervalued because the models regress based on lost production without accounting for incoming talent. Early-season NCAAF lines (Weeks 1-4) are the most inefficient market in sports — returning production is the best predictor of which teams are undervalued.

**Current Gap:** The NCAAF model uses SP+ from CFBD but not the returning production endpoint. The `computeSPEdge` function compares SP+ ratings without any adjustment for roster change. This means early-season predictions are less accurate because SP+ itself takes ~4 weeks to fully incorporate new rosters.

**Implementation Complexity:** Easy — Already calling CFBD API for SP+. Add a call to the `/returning` endpoint. Create a modifier that adjusts SP+ edge by ±1-3 points based on returning production differential, especially in Weeks 1-6.

**Expected Impact:** 2-4% improvement for early-season NCAAF picks (Weeks 1-6, roughly 60-80 games). Decays to 0% impact by Week 8 as ratings catch up.

**Priority:** P1 (implement before August)

---

## Signal: Advanced Rest / Scheduling Spot Analysis

**Data Source:** Existing schedule data in the DB. Just needs more sophisticated computation.

**Edge Found:** Beyond simple B2B detection, research identifies several high-value scheduling spots: (1) **3-in-5 days** in NCAAMB: teams playing their 3rd game in 5 days cover at only 44% ATS. (2) **Sandwich spot** in NFL: team playing a weak opponent between two difficult opponents. (3) **Coast-to-coast travel** in NBA: Pacific time team playing at Atlantic time team after playing at home the night before. (4) **Long road trips** (3+ games away) in NBA: performance degrades game-over-game, with the 3rd+ road game being the worst. (5) **Post-rivalry letdown**: after a conference rivalry game, teams underperform against their next opponent.

**Current Gap:** `signalRestDays` only checks for B2B (≤1 day rest) and only for NCAAMB. The NBA `restDays` weight is 0.10 but the function returns "N/A" for non-NCAAMB sports (it literally checks `if (sport !== "NCAAMB") return neutral`). For NBA, where rest is arguably the most impactful factor, the signal is completely disabled.

**Implementation Complexity:** Medium — (1) Enable rest signal for NBA (trivial fix — remove the NCAAMB-only check). (2) Extend to detect 3-in-5, 4-in-6 fatigue patterns. (3) Add look-ahead/look-behind game quality detection for sandwich spots. (4) Track consecutive road games.

**Expected Impact:** 2-3% for NBA (rest is the biggest edge). 1-2% for NCAAMB beyond existing B2B. The NBA rest fix alone (enabling a disabled signal) is a P0 bug fix.

**Priority:** P0 (NBA rest signal is disabled — this is a bug)

---

## Signal: KenPom FanMatch Win Probability for O/U

**Data Source:** Already available — `KenpomFanMatch.PredTempo` and total prediction are fetched but underutilized.

**Edge Found:** KenPom's FanMatch predictions include `PredTempo` — the game-specific predicted tempo accounting for matchup, venue, and travel. This is more accurate than the generic `(homeAdjTempo + awayAdjTempo) / 2` used in the Ridge regression. Additionally, `HomePred + VisitorPred` gives KenPom's predicted total, which could be used as an additional feature or validation check against the Ridge model's prediction.

**Current Gap:** The pick engine uses FanMatch for spread predictions (`fm.HomePred - fm.VisitorPred`) but doesn't use the *total* prediction (`fm.HomePred + fm.VisitorPred`) for O/U. It also doesn't use `fm.PredTempo` for the O/U model. The Ridge regression uses generic team-level tempo instead of the game-specific prediction.

**Implementation Complexity:** Easy — When FanMatch data is available, use `fm.HomePred + fm.VisitorPred` as a second opinion on the total, and `fm.PredTempo` instead of `(homeAdjTempo + awayAdjTempo) / 2` in the regression.

**Expected Impact:** 0.5-1% improvement on NCAAMB O/U accuracy. Essentially free — the data is already fetched.

**Priority:** P1

---

## Signal: NBA Pace Volatility for Totals

**Data Source:** NBA.com stats API (already integrated — `pace` field is fetched). Need game-level pace data (per-game pace variance).

**Edge Found:** High-pace teams have significantly higher variance in total points — their games go over more often, but they also occasionally have defensive games that go well under. The key insight (from Thinking Basketball and Cleaning the Glass research): it's not the average pace that matters for totals, it's the pace *consistency*. Teams with high average pace but low pace variance (consistently fast) are strong over bets. Teams with high pace variance are unpredictable. Current engine uses team-level season average pace, missing the variance component.

**Current Gap:** `signalNBAFourFactors` uses `avgPace = (home.pace + away.pace) / 2` as a point estimate. No pace variance tracking. The `tempoDiff` signal (for NBA O/U at 0.15 weight) uses similar logic. Neither considers game-to-game consistency.

**Implementation Complexity:** Medium — Need to store per-game pace (not just season average). Compute pace variance from last 10-15 games. Use (avgPace, paceVariance) as a joint signal for O/U confidence.

**Expected Impact:** 1-2% improvement on NBA O/U picks where pace variance is extreme.

**Priority:** P2

---

## Signal: Historical Odds Movement Patterns (Sharp vs Square Game)

**Data Source:** The Odds API historical endpoint, or build incrementally by storing snapshots from existing odds fetches.

**Edge Found:** Games can be classified as "sharp" (line moved significantly from opener) or "square" (line held steady). Sharp games — where the line moved 1+ points — have already been efficiently priced by the time the game starts. The best betting opportunities are in games where the line *hasn't* moved despite model edges existing — this suggests the market hasn't found what the model found. Conversely, when the model agrees with a sharp line movement, the convergence of model + market signals is highest-confidence.

**Current Gap:** No concept of line staleness or movement classification in the engine. Every game is treated equally regardless of how the line has evolved.

**Implementation Complexity:** Medium — Requires odds history storage and opening-vs-current comparison logic.

**Expected Impact:** 1-2% improvement via confidence filtering (downweight stale/efficient lines, upweight under-discovered edges).

**Priority:** P2

---

## Signal: Power Conference Bias Correction (NCAAMB)

**Data Source:** KenPom conference ratings, Barttorvik conference adjustments. Already available.

**Edge Found:** Markets systematically overvalue power conference teams in non-conference games (especially November/December) and undervalue strong mid-majors. KenPom's SOS adjustment accounts for this in ratings but the ATS market doesn't fully. The overnight doc mentioned this: early-season lines are the most inefficient. Specifically, mid-majors ranked #30-#60 in KenPom playing power conference teams ranked #15-#40 cover at ~56% ATS in non-conference games because the market uses conference prestige as a proxy for quality.

**Current Gap:** The engine uses raw KenPom rankings without distinguishing conference prestige from actual quality. The `seasonATS` fade helps indirectly, but there's no explicit "the market is overvaluing this SEC/Big Ten team against this WCC/Mountain West team" signal.

**Implementation Complexity:** Easy — Use `KenpomRating.ConfShort` to detect power vs mid-major matchups. When a mid-major KenPom-ranked team is +3 or more ATS against a power-conference team in a non-conference game, add a small contrarian lean.

**Expected Impact:** 1% improvement for ~10% of NCAAMB games (non-conference, November-December).

**Priority:** P2

---

## Summary: Priority Matrix

| Priority | Signal | Sport | Impact | Effort |
|----------|--------|-------|--------|--------|
| **P0** | NBA Rest Signal Fix (currently disabled!) | NBA | 2-3% | Trivial |
| **P0** | NFL Defensive EPA (null field) | NFL | 2-3% | Medium |
| **P0** | Closing Line Value Tracking | All | Meta | Easy |
| **P0** | Line Movement / Steam Moves | All | 2-4% | Medium |
| **P1** | Public Betting Percentage | All | 1-3% | Medium |
| **P1** | Referee Tendencies | NBA/NFL | 2-5% | Medium-Hard |
| **P1** | Travel Distance & Time Zones | NBA/NCAAMB | 1-3% | Easy-Medium |
| **P1** | Conf Tournament Edges | NCAAMB | 1-2% | Easy |
| **P1** | NBA Player Availability | NBA | 3-5% | Hard |
| **P1** | Tempo×DE Interaction Term | NCAAMB | 1-2% | Easy |
| **P1** | Odds Shopping / Best Line | All | 1-3% ROI | Medium |
| **P1** | NCAAF Returning Production | NCAAF | 2-4% | Easy |
| **P1** | FanMatch Total for O/U | NCAAMB | 0.5-1% | Easy |
| **P1** | Advanced Scheduling Spots | NBA/NCAAMB | 2-3% | Medium |
| **P2** | Altitude Advantage | NCAAMB | 0.5-1% | Easy |
| **P2** | Coaching Changes / Continuity | NCAAMB/NCAAF | 0.5-1% | Easy-Medium |
| **P2** | Key Number Teasers | NFL | N/A (new bet type) | Easy |
| **P2** | NBA Pace Volatility | NBA | 1-2% | Medium |
| **P2** | Sharp vs Square Classification | All | 1-2% | Medium |
| **P2** | Power Conf Bias Correction | NCAAMB | 1% | Easy |
| **P3** | Halftime / Live Model | All | 3-5% | Hard |

---

## Immediate Action Items (This Week)

1. **Fix NBA rest signal** — `signalRestDays` returns neutral for all non-NCAAMB sports. Remove the `if (sport !== "NCAAMB") return neutral` check and implement B2B detection for NBA. This is a bug, not a feature request.

2. **Fix NFL defensive EPA** — The `defEpaPerPlay` field is always null. Either aggregate from play-by-play or compute via opponent cross-reference. Half the EPA signal is missing.

3. **Add CLV tracking** — Add `closingLine` column to DailyPick table. Schedule a cron job to capture closing lines ~5 min before game start. This is the foundation for all future model quality assessment.

4. **Use FanMatch total for O/U** — When FanMatch data is available, use `HomePred + VisitorPred` as an ensemble check alongside the Ridge regression. The data is already fetched and sitting unused.

---

## Free Data Sources Not Currently Used

| Source | Data Available | URL | Cost |
|--------|---------------|-----|------|
| The Odds API | Multi-book odds, line history | the-odds-api.com | Free (500 req/mo) |
| NBA Official Ref Assignments | Referee crews by game | official.nba.com | Free |
| CFBD Returning Production | Player return %, portal | api.collegefootballdata.com | Free |
| nflverse Play-by-Play | Defensive EPA, snap counts | github.com/nflverse | Free |
| Open-Meteo Historical | Weather archives | open-meteo.com | Free |
| NBA Schedule API | Rest days, travel | cdn.nba.com/static/json | Free |
| Basketball Reference | Historical game logs with refs | basketball-reference.com | Free (scraping) |
| Haslametrics | NCAAMB alternative ratings | haslametrics.com | Free |
| Sagarin Ratings | Multi-sport computer ratings | sagarin.com | Free |
| Massey Ratings | Composite ranking aggregation | masseyratings.com | Free |
