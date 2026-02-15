# Phase 3: Model Accuracy

> **Context Management:** When context reaches 70%, compact the conversation and continue.
> Compaction summary should include: completed tasks, current task progress, key decisions made.

This phase transforms Trendline from "functional" to "sharp." Phase 1 fixed bugs, Phase 1.5 added tournament logic, Phase 2 added tests and architecture. Phase 3 attacks the core problem: **model accuracy.** The pick engine currently uses napkin math for NFL/NBA/NCAAF spreads while NCAAMB has a proper Ridge regression. We fix that asymmetry, add CLV tracking, refine ATS signals, and build the validation pipeline for conference tournaments.

**Timeline:** Feb 16–28 (13 days). Conference tournaments start ~March 3 — this must ship before then.
**Goal:** Every sport gets a real regression model. CLV tracking proves (or disproves) we have edge. Tournament validation pipeline is ready.

**Context budget estimate:**
- This prompt: ~8k tokens
- `src/lib/pick-engine.ts`: ~25k tokens (required — nearly every task touches this)
- `prisma/schema.prisma`: ~9k tokens (needed for CLV fields)
- `src/lib/nflverse.ts`, `nba-stats.ts`, `cfbd.ts`: ~3k each
- `src/lib/kenpom.ts` + `kenpom-pit.ts`: ~5k tokens
- **Total: ~56k tokens (~28% of 200k)**

Load files in this priority order:
1. `src/lib/pick-engine.ts` — required for every task
2. `prisma/schema.prisma` — needed for Task 3 (CLV schema)
3. Sport-specific files as needed per task

---

## Task 1: NFL Ridge Regression Model

**Why:** NFL spread prediction currently uses `(avgMargin_home - avgMargin_away) / 2 + 2.5` — literal napkin math. This is our weakest sport model. A proper Ridge regression with EPA features should add 3-5% ATS accuracy.

**Where:** Create `src/lib/nfl-ridge.ts`, integrate into `pick-engine.ts` where NFL `modelEdge` is computed.

**Data source:** nflverse (https://github.com/nflverse/nflverse-data) — free, CSV downloads. The engine already has `src/lib/nflverse.ts` for EPA data.

**Features to extract (per team, per game):**

    interface NFLRidgeFeatures {
        offEPA: number;          // Offensive EPA per play (rolling 5-game)
        defEPA: number;          // Defensive EPA per play (rolling 5-game)
        pace: number;            // Plays per game
        redZoneTD: number;       // Red zone TD conversion rate
        turnoverDiff: number;    // Turnovers forced - turnovers committed
        thirdDownRate: number;   // 3rd down conversion rate
        sackRate: number;        // Sacks per dropback (off + def)
        explosivePlayRate: number; // Plays of 20+ yards per game
    }

**Training pipeline:**

    // src/lib/nfl-ridge.ts
    import { Ridge } from 'ml-regression';  // or implement manually
    
    // Ridge regression is just OLS with L2 penalty:
    // β = (X'X + λI)^(-1) X'y
    // We can implement without a library:
    
    function ridgeRegression(X: number[][], y: number[], lambda: number): number[] {
        // X: feature matrix [n_games x n_features]
        // y: actual point differentials (home - away)
        // lambda: regularization strength
        
        const n = X[0].length;
        const XtX = matMul(transpose(X), X);
        
        // Add lambda * I to diagonal
        for (let i = 0; i < n; i++) XtX[i][i] += lambda;
        
        const Xty = matVecMul(transpose(X), y);
        return solve(XtX, Xty);  // Solve (X'X + λI)β = X'y
    }
    
    // Walk-forward validation (PIT - point in time):
    // Train on seasons 1..k, predict season k+1
    // Report MAE per fold
    function walkForwardValidate(
        data: SeasonData[],  // 2019-2023
        lambda: number
    ): { mae: number; foldResults: FoldResult[] } {
        const folds: FoldResult[] = [];
        for (let testYear = 2021; testYear <= 2023; testYear++) {
            const trainData = data.filter(d => d.season < testYear);
            const testData = data.filter(d => d.season === testYear);
            const model = ridgeRegression(
                trainData.map(d => d.features),
                trainData.map(d => d.pointDiff),
                lambda
            );
            const predictions = testData.map(d => dotProduct(model, d.features));
            const mae = mean(testData.map((d, i) => Math.abs(predictions[i] - d.pointDiff)));
            folds.push({ testYear, mae, n: testData.length });
        }
        return { mae: mean(folds.map(f => f.mae)), foldResults: folds };
    }

**Lambda tuning:** Start with λ=1000 (same as NCAAMB). Grid search [100, 500, 1000, 2000, 5000] using walk-forward MAE.

**Integration into pick-engine.ts:**

    // In the NFL section of generateDailyPicks, replace the napkin math:
    // BEFORE:
    //   const modelSpread = (avgMargin_home - avgMargin_away) / 2 + 2.5;
    // AFTER:
    //   const modelSpread = predictNFLSpread(homeFeatures, awayFeatures, ridgeCoefficients);
    
    function predictNFLSpread(
        home: NFLRidgeFeatures,
        away: NFLRidgeFeatures,
        coeffs: number[]
    ): number {
        const diffFeatures = [
            home.offEPA - away.offEPA,
            home.defEPA - away.defEPA,
            home.pace - away.pace,
            home.redZoneTD - away.redZoneTD,
            home.turnoverDiff - away.turnoverDiff,
            home.thirdDownRate - away.thirdDownRate,
            home.sackRate - away.sackRate,
            home.explosivePlayRate - away.explosivePlayRate,
        ];
        return dotProduct(coeffs, diffFeatures) + HCA_NFL;
    }

**Validation target:** Walk-forward MAE < 10.0 points (current napkin math is ~12-14). ATS accuracy on 2023 holdout > 52%.

**Tests:** Add `tests/nfl-ridge.test.ts` — test coefficient stability, feature normalization, edge cases (bye weeks, missing EPA data).

---

## Task 2: NBA Ridge Regression Model

**Why:** NBA model uses simple net rating comparison. The Four Factors (eFG%, TOV%, ORB%, FTR) are the most validated predictive features in basketball analytics. Adding rest/travel context should give us a real edge, especially for B2B games.

**Where:** Create `src/lib/nba-ridge.ts`, integrate into `pick-engine.ts` where NBA `modelEdge` is computed. The engine already has `src/lib/nba-stats.ts` for Four Factors data.

**Features:**

    interface NBARidgeFeatures {
        // Four Factors (offense)
        offEFG: number;        // Effective FG% (rolling 10-game)
        offTOV: number;        // Turnover rate
        offORB: number;        // Offensive rebound rate
        offFTR: number;        // Free throw rate
        // Four Factors (defense)
        defEFG: number;        // Opponent eFG%
        defTOV: number;        // Opponent TOV rate (forced)
        defORB: number;        // Defensive rebound rate
        defFTR: number;        // Opponent FTR allowed
        // Context
        pace: number;          // Possessions per game
        netRating: number;     // Offensive - defensive rating
        restDays: number;      // Days since last game (0=B2B, 1=normal, 2+=extra rest)
        isB2B: boolean;        // Back-to-back flag
        travelMiles: number;   // Distance traveled since last game
    }

**Rest/travel encoding:** B2B is worth ~2-3 points in NBA. Encode as:

    // Rest advantage = home_rest - away_rest
    // Cap at +/- 3 to avoid outliers (All-Star break)
    const restAdvantage = Math.max(-3, Math.min(3,
        home.restDays - away.restDays
    ));

**Training data:** NBA.com API (free, no key needed for basic stats). `nba_api` Python package has 5+ seasons of game logs. Alternatively, Basketball Reference CSV exports.

**Implementation follows same pattern as Task 1** — Ridge regression with walk-forward validation. Lambda grid search. Target: MAE < 8.0 points, ATS > 52% on holdout.

**NBA-specific wrinkle:** Season-long stats are noisy early (first 15 games). Use expanding window: start with preseason projections (prior year stats regressed to mean), blend with current-season data as games accumulate.

    // Blend factor: weight toward current season as sample grows
    const blendWeight = Math.min(1.0, gamesPlayed / 30);
    const blendedEFG = blendWeight * currentEFG + (1 - blendWeight) * priorEFG;

**Tests:** `tests/nba-ridge.test.ts` — test rest day encoding, B2B detection, early-season blending.

---

## Task 3: NCAAF Ridge Regression Model

**Why:** NCAAF uses SP+ ratings from CFBD API, but the spread model is still basic. College football has unique challenges: roster turnover, small sample sizes (12-13 games), and conference strength gaps.

**Where:** Create `src/lib/ncaaf-ridge.ts`. The engine already has `src/lib/cfbd.ts` for SP+ data.

**Features:**

    interface NCAAFRidgeFeatures {
        spPlusOff: number;        // SP+ offensive rating
        spPlusDef: number;        // SP+ defensive rating
        spPlusST: number;         // SP+ special teams
        returningProduction: number; // % of production returning (PFF/CFBD)
        recruitingRanking: number;   // 247Sports composite rank (log-scaled)
        strengthOfSchedule: number;  // Opponent-adjusted SOS
        recentForm: number;         // Last 3 games point differential
        homeFieldAdv: number;       // Venue-specific HCA (SEC > MAC)
    }

**Key challenge — seasonal regression:** College teams change dramatically year to year. Use only current-season data (no multi-year rolling windows for team stats). However, recruit rankings and returning production serve as preseason priors.

    // Early season (weeks 1-4): lean on priors
    // Mid season (weeks 5-8): blend
    // Late season (weeks 9+): lean on current performance
    const seasonProgress = Math.min(1.0, (currentWeek - 1) / 8);
    const priorWeight = 1.0 - seasonProgress;

**Training data:** CFBD API (free with API key — https://collegefootballdata.com). 5 seasons (2019-2023). ~800 FBS games per season.

**Recruiting rank encoding:** Log-scale to compress the tail:

    const recruitFeature = -Math.log(recruitingRanking + 1);
    // #1 → -0.69, #25 → -3.26, #130 → -4.87

**Lambda:** Start higher (λ=2000) due to smaller sample sizes. Grid search [500, 1000, 2000, 5000].

**Tests:** `tests/ncaaf-ridge.test.ts` — test seasonal progression blending, recruiting rank encoding, FCS opponent handling.

---

## Task 4: Dynamic HCA Recalibration

**Why:** The overnight analysis found home court advantage trending from 6.4→8.6 points in NCAAMB, but the model uses flat constants (2.5 conference, 1.5 non-conf). This systematic miscalibration costs 1-2% accuracy across every game.

**Where:** Create `src/lib/hca-tracker.ts`, integrate into `pick-engine.ts` HCA logic.

**Current HCA in pick-engine.ts (approximate):**

    // Flat values used today:
    const HCA = {
        NCAAMB: { conference: 2.5, nonConference: 1.5, neutral: 0 },
        NFL: { divisional: 2.5, nonDivisional: 2.5, neutral: 0 },
        NBA: { regular: 2.5, neutral: 0 },
        NCAAF: { conference: 3.0, nonConference: 2.0, neutral: 0 },
    };

**Replace with dynamic system:**

    // src/lib/hca-tracker.ts
    
    interface HCAConfig {
        sport: string;
        conference?: string;    // Track per-conference (SEC HCA ≠ Ivy League)
        venueType: 'home' | 'neutral' | 'away';
        gameType: 'regular' | 'conference_tourney' | 'ncaa_tourney' | 'rivalry';
    }
    
    // Compute rolling HCA from completed games
    function computeRollingHCA(
        completedGames: CompletedGame[],
        config: HCAConfig,
        windowDays: number = 90
    ): number {
        const cutoff = new Date(Date.now() - windowDays * 86400000);
        const relevant = completedGames.filter(g =>
            g.sport === config.sport &&
            g.gameDate > cutoff &&
            (!config.conference || g.homeConference === config.conference) &&
            g.venueType === config.venueType
        );
        
        if (relevant.length < 30) {
            // Not enough data — fall back to sport-level HCA
            return computeSportLevelHCA(completedGames, config.sport, windowDays);
        }
        
        // HCA = mean(homeScore - awayScore)
        const margins = relevant.map(g => g.homeScore - g.awayScore);
        return mean(margins);
    }
    
    // Monthly recalibration job
    async function recalibrateHCA(): Promise<HCAMap> {
        const games = await fetchCompletedGames(/* last 2 seasons */);
        const sports = ['NCAAMB', 'NFL', 'NBA', 'NCAAF'];
        const hcaMap: HCAMap = {};
        
        for (const sport of sports) {
            hcaMap[sport] = {
                overall: computeRollingHCA(games, { sport, venueType: 'home' }),
                byConference: {},
            };
            
            const conferences = getConferences(sport);
            for (const conf of conferences) {
                hcaMap[sport].byConference[conf] = computeRollingHCA(
                    games,
                    { sport, conference: conf, venueType: 'home' }
                );
            }
        }
        
        return hcaMap;
    }

**KenPom FanMatch integration:** When available, use KenPom's game-level HCA from FanMatch data (already fetched in `src/lib/kenpom.ts`). FanMatch includes venue-adjusted predictions — extract the implied HCA:

    // If FanMatch predicts Home 72 - Away 68 on neutral,
    // but actual game is at home venue, FanMatch adjusts.
    // Implied HCA = FanMatch_home_predicted - FanMatch_neutral_predicted
    
    const fanMatchHCA = fanMatch
        ? fanMatch.predictedHomeScore - fanMatch.neutralHomeScore
        : null;
    
    // Use FanMatch HCA when available, fall back to rolling HCA
    const gameHCA = fanMatchHCA ?? rollingHCA[sport].byConference[homeConf] ?? rollingHCA[sport].overall;

**Tournament-specific HCA:**

    // Conference tournament: most are at neutral sites, but "home" team
    // may have travel advantage. Use reduced HCA (0.5-1.0).
    // NCAA tournament: true neutral. HCA = 0 (but seed-based crowd advantage exists).
    
    if (game.isConferenceTournament) {
        hca = rollingHCA[sport].overall * 0.3;  // 30% of normal
    } else if (game.isNCAASTournament) {
        hca = 0;  // True neutral
    }

**Rivalry game adjustment:** Rivalry games historically show reduced HCA (visitors play harder). Apply 0.7x multiplier for detected rival matchups.

**Tests:** `tests/hca-tracker.test.ts` — test rolling window computation, conference-level granularity, tournament overrides, minimum sample fallback.

---

## Task 5: CLV (Closing Line Value) Tracking System

**Why:** CLV is the single most validated measure of betting edge. Without it, we can't distinguish real edge from variance. Academic research (Kaunitz et al. 2017) conclusively shows CLV-positive bettors are profitable long-term. This is P0 — everything else depends on knowing if our picks actually beat the market.

**Where:** Schema changes in `prisma/schema.prisma`, closing line capture in new `src/lib/clv-tracker.ts`, integration with pick generation and grading pipelines.

**Schema changes:**

    // Add to DailyPick model in prisma/schema.prisma:
    model DailyPick {
        // ... existing fields ...
        
        openingLine     Float?      // Line when pick was generated
        closingLine     Float?      // Line at game start
        closingTotal    Float?      // Total at game start (for O/U picks)
        clvSpread       Float?      // CLV = pickLine - closingLine (positive = we got a better number)
        clvTotal        Float?      // CLV for O/U picks
        lineCaptureTm   DateTime?   // When closing line was captured
    }

**Closing line capture pipeline:**

    // src/lib/clv-tracker.ts
    
    // Run 5 minutes before each game's scheduled start
    async function captureClosingLines(): Promise<void> {
        const upcoming = await prisma.dailyPick.findMany({
            where: {
                closingLine: null,
                result: null,  // Not yet graded
                game: {
                    gameDate: {
                        gte: new Date(),
                        lte: new Date(Date.now() + 10 * 60 * 1000), // Next 10 mins
                    },
                },
            },
        });
        
        for (const pick of upcoming) {
            const currentOdds = await fetchCurrentOdds(pick.gameId);
            if (!currentOdds) continue;
            
            await prisma.dailyPick.update({
                where: { id: pick.id },
                data: {
                    closingLine: currentOdds.spread,
                    closingTotal: currentOdds.total,
                    lineCaptureTm: new Date(),
                },
            });
        }
    }
    
    // Compute CLV after game completes
    async function computeCLV(pickId: string): Promise<void> {
        const pick = await prisma.dailyPick.findUnique({ where: { id: pickId } });
        if (!pick?.closingLine || !pick?.line) return;
        
        // For spreads: positive CLV = we got a better line than closing
        // If we picked home -3 and it closed at home -5, CLV = +2 (we got a better number)
        const clvSpread = pick.pickType === 'SPREAD'
            ? pick.closingLine - pick.line  // More negative closing = market agreed with us
            : null;
        
        // For totals: depends on direction
        // If we picked OVER at 145 and it closed at 148, CLV = +3 (market moved our way)
        const clvTotal = pick.pickType === 'TOTAL'
            ? (pick.direction === 'OVER'
                ? pick.closingTotal! - pick.line   // Over: closing went up = market agrees
                : pick.line - pick.closingTotal!)  // Under: closing went down = market agrees
            : null;
        
        await prisma.dailyPick.update({
            where: { id: pickId },
            data: { clvSpread, clvTotal },
        });
    }

**CLV dashboard metrics (add to existing dashboard or API):**

    // Average CLV by sport
    // Average CLV by confidence tier (5★ should beat by more)
    // CLV trend over time (rolling 30-day)
    // Alert: if 7-day rolling CLV < -0.5, something is wrong
    
    async function getCLVSummary(): Promise<CLVSummary> {
        const picks = await prisma.dailyPick.findMany({
            where: { clvSpread: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });
        
        return {
            overallCLV: mean(picks.map(p => p.clvSpread!)),
            bySport: groupBy(picks, 'sport', p => mean(p.map(x => x.clvSpread!))),
            byTier: groupBy(picks, 'confidence', p => mean(p.map(x => x.clvSpread!))),
            last7Days: mean(picks.filter(p => isWithin7Days(p)).map(p => p.clvSpread!)),
        };
    }

**Cron schedule:** Add to existing cron or create new job:

    // Run every 5 minutes during game windows
    // NFL: Sunday 12pm-12am ET, Monday/Thursday 7-11pm ET
    // NBA: Daily 6pm-12am ET
    // NCAAMB: Daily 11am-12am ET
    // NCAAF: Saturday 11am-12am ET

**Also store opening line at pick generation time.** In `generateDailyPicks`, when creating a DailyPick record, set `openingLine = line` (the line at pick time is our opening line).

**Tests:** `tests/clv-tracker.test.ts` — test CLV calculation for spread/total, direction handling, edge cases (no closing line captured).

---

## Task 6: ATS Pick Refinement

**Why:** NCAAMB ATS hits 57.8% at edge ≥5, but NFL and NBA ATS signals are weaker (~52%). Refining ATS signals with sport-specific context should push all sports above 54%.

**Where:** Modifications to `pick-engine.ts` signal generation sections.

### 6a: NCAAMB ATS Improvements

**Conference strength adjustment:**

    // Adjust ATS confidence based on conference quality gap
    // Big 12 vs Big 12 = tight lines, reduce confidence
    // Power conf vs mid-major = potentially exploitable
    
    function conferenceStrengthAdjustment(
        homeConf: string,
        awayConf: string,
        kenpomRankings: KenpomData[]
    ): number {
        const homeConfAvgRank = getConferenceAvgRank(homeConf, kenpomRankings);
        const awayConfAvgRank = getConferenceAvgRank(awayConf, kenpomRankings);
        const confGap = Math.abs(homeConfAvgRank - awayConfAvgRank);
        
        // Larger conference gap = more exploitable (market misprices cross-conf)
        if (confGap > 50) return 1.15;   // 15% confidence boost
        if (confGap > 25) return 1.05;   // 5% boost
        if (confGap < 10) return 0.95;   // Tight conference = reduce confidence
        return 1.0;
    }

**Rival game detection:**

    // Rivalry games have tighter, more efficient lines
    // Define rival pairs and apply 0.9x confidence multiplier
    const NCAAMB_RIVALS: [string, string][] = [
        ['Duke', 'North Carolina'],
        ['Kentucky', 'Louisville'],
        ['Kansas', 'Kansas State'],
        ['Indiana', 'Purdue'],
        ['Michigan', 'Michigan State'],
        // ... extend with conference data
    ];
    
    function isRivalry(home: string, away: string): boolean {
        return NCAAMB_RIVALS.some(([a, b]) =>
            (home === a && away === b) || (home === b && away === a)
        );
    }

### 6b: NFL ATS Improvements

**Divisional game adjustment:** Divisional games are closer (market knows this), but division rivals in mismatch years still offer value:

    // Divisional games: reduce ATS edge by 20% (lines are sharper)
    // UNLESS win differential > 5 games (mismatch year)
    function divisionalAdjustment(
        homeWins: number, awayWins: number, isDivisional: boolean
    ): number {
        if (!isDivisional) return 1.0;
        const winGap = Math.abs(homeWins - awayWins);
        return winGap > 5 ? 1.1 : 0.8;
    }

**Prime time public bias:** Public overvalues primetime favorites. Fade accordingly:

    // Sunday/Monday Night, Thursday Night — public hammers favorites
    // If the model likes the dog, boost confidence
    function primetimeBias(
        isPrimetime: boolean,
        modelPicksUnderdog: boolean
    ): number {
        if (!isPrimetime) return 1.0;
        return modelPicksUnderdog ? 1.15 : 0.9;
    }

**Weather impact on spreads (NFL):**

    // Wind >20mph: reduce total, slight dog advantage (passing game disrupted)
    // Rain/snow: reduce total significantly, run-heavy = closer games
    // Already have weather.ts — integrate into spread signal
    
    function weatherSpreadAdjustment(weather: WeatherData): number {
        if (!weather) return 1.0;
        const windPenalty = weather.windSpeed > 20 ? 0.9 : 1.0;
        const precipPenalty = weather.precipitation > 0.1 ? 0.85 : 1.0;
        return windPenalty * precipPenalty;  // Multiply with edge confidence
    }

### 6c: NBA ATS — Rest Advantage

    // NBA rest edge is well-documented:
    // Team on 2+ rest days vs B2B opponent: +2.5 ATS edge
    // Both on B2B: neutral
    // Both rested: neutral
    
    function restAdvantageATS(homeRest: number, awayRest: number): number {
        const advantage = homeRest - awayRest;
        if (advantage >= 2) return 1.2;      // Home well-rested vs tired away
        if (advantage <= -2) return 1.2;     // Big rest gap either way = exploitable
        if (advantage === 0) return 1.0;     // Even rest
        return 1.05;                         // Slight advantage
    }

**Tests:** `tests/ats-refinement.test.ts` — test each adjustment in isolation, verify multipliers stack correctly, edge cases.

---

## Task 7: New Edge Signals Implementation

**Why:** The edge research (see `audit-reports/edge-research.md`) found 18 new profitable signals. We implement the top 6 that are highest impact and lowest complexity.

**Where:** New signal functions in `pick-engine.ts`, added to the `spreadSignals` and `ouSignals` arrays.

### 7a: Pace Mismatch Exploitation (NCAAMB)

    // Slow team (tempo < 64) vs fast team (tempo > 72):
    // Slow team controls pace → UNDER hits at elevated rate
    // Also affects spread: fast team underperforms when slowed down
    
    function signalPaceMismatch(
        homeTempo: number,
        awayTempo: number,
        homeRank: number,
        awayRank: number
    ): Signal | null {
        const tempoGap = Math.abs(homeTempo - awayTempo);
        if (tempoGap < 6) return null;  // Not enough mismatch
        
        const slowTeam = homeTempo < awayTempo ? 'home' : 'away';
        const slowTeamBetter = slowTeam === 'home'
            ? homeRank < awayRank  // Lower rank = better
            : awayRank < homeRank;
        
        // If the better team is also the slow team, strong UNDER + cover signal
        const edge = slowTeamBetter ? tempoGap * 0.3 : tempoGap * 0.15;
        
        return {
            category: 'paceMismatch',
            direction: 'under',  // Pace mismatches lean under
            edge,
            label: `Pace mismatch: ${tempoGap.toFixed(1)} tempo gap`,
        };
    }

### 7b: KenPom Efficiency Margin Thresholds (NCAAMB)

    // When KenPom efficiency margin (AdjOE - AdjDE) gap between teams > 15:
    // The better team covers at ~58% historically
    // This is a "blowout detector" — market underestimates dominance
    
    function signalKenpomMarginThreshold(
        homeEffMargin: number,
        awayEffMargin: number
    ): Signal | null {
        const gap = Math.abs(homeEffMargin - awayEffMargin);
        if (gap < 12) return null;  // Not significant enough
        
        const favoredSide = homeEffMargin > awayEffMargin ? 'home' : 'away';
        const edge = (gap - 12) * 0.5;  // Scale linearly above threshold
        
        return {
            category: 'kenpomMargin',
            direction: favoredSide,
            edge: Math.min(edge, 6),  // Cap at 6
            label: `KenPom efficiency gap: ${gap.toFixed(1)}`,
        };
    }

### 7c: EPA Differential Thresholds (NFL)

    // When EPA differential (off EPA - def EPA) between teams > 0.15:
    // Strong cover signal. EPA is the best single predictor in NFL.
    
    function signalEPAThreshold(
        homeOffEPA: number, homeDefEPA: number,
        awayOffEPA: number, awayDefEPA: number
    ): Signal | null {
        const homeNetEPA = homeOffEPA - homeDefEPA;  // Higher = better
        const awayNetEPA = awayOffEPA - awayDefEPA;
        const epaDiff = homeNetEPA - awayNetEPA;
        
        if (Math.abs(epaDiff) < 0.1) return null;
        
        return {
            category: 'epaThreshold',
            direction: epaDiff > 0 ? 'home' : 'away',
            edge: Math.abs(epaDiff) * 15,  // Scale to points
            label: `EPA differential: ${epaDiff.toFixed(3)}`,
        };
    }

### 7d: Weather + Total Interaction (NFL)

    // Combine weather data with total prediction
    // Wind > 15mph + total > 45 = strong UNDER signal
    // Rain/snow + total > 42 = strong UNDER signal
    
    function signalWeatherTotal(
        weather: WeatherData | null,
        projectedTotal: number
    ): Signal | null {
        if (!weather) return null;
        
        let underEdge = 0;
        if (weather.windSpeed > 15 && projectedTotal > 45) {
            underEdge += (weather.windSpeed - 15) * 0.3;
        }
        if (weather.precipitation > 0.1 && projectedTotal > 42) {
            underEdge += 2.0;
        }
        if (weather.temperature < 25 && projectedTotal > 40) {
            underEdge += 1.5;  // Cold games go under
        }
        
        if (underEdge < 1.0) return null;
        
        return {
            category: 'weatherTotal',
            direction: 'under',
            edge: Math.min(underEdge, 5),
            label: `Weather UNDER: wind=${weather.windSpeed}mph, precip=${weather.precipitation}`,
        };
    }

### 7e: Late-Season Motivation Detection (Cross-Sport)

    // Teams with nothing to play for (eliminated, locked seed) underperform ATS
    // Teams fighting for playoff spots / seeding overperform ATS
    
    function signalMotivation(
        team: TeamStanding,
        opponent: TeamStanding,
        weeksRemaining: number
    ): Signal | null {
        if (weeksRemaining > 4) return null;  // Only matters late season
        
        const teamMotivation = computeMotivation(team, weeksRemaining);
        const oppMotivation = computeMotivation(opponent, weeksRemaining);
        const motivationGap = teamMotivation - oppMotivation;
        
        if (Math.abs(motivationGap) < 2) return null;
        
        return {
            category: 'motivation',
            direction: motivationGap > 0 ? 'team' : 'opponent',
            edge: Math.abs(motivationGap) * 0.8,
            label: `Motivation edge: ${motivationGap.toFixed(1)}`,
        };
    }
    
    function computeMotivation(team: TeamStanding, weeksLeft: number): number {
        let score = 5;  // Baseline
        if (team.eliminated) score -= 4;
        if (team.clinched && team.seedLocked) score -= 3;
        if (team.gamesBackOfPlayoff <= 2) score += 3;
        if (team.gamesBackOfBye <= 1) score += 2;
        if (team.divisionLeadGames <= 1) score += 2;
        return score;
    }

### 7f: Travel Fatigue Quantification (Cross-Sport)

    // Teams traveling 1500+ miles for a game show measurable underperformance
    // Especially when combined with time zone changes (West→East early games)
    
    function signalTravelFatigue(
        travelMiles: number,
        timeZoneChange: number,  // Positive = traveling east
        isEarlyGame: boolean     // Before 1pm local time
    ): Signal | null {
        let fatigueScore = 0;
        
        if (travelMiles > 1500) fatigueScore += (travelMiles - 1500) / 500;
        if (timeZoneChange >= 2 && isEarlyGame) fatigueScore += 2;  // West coast team playing early East coast game
        if (timeZoneChange <= -2 && !isEarlyGame) fatigueScore += 1; // Less impactful going west
        
        if (fatigueScore < 1) return null;
        
        return {
            category: 'travelFatigue',
            direction: 'against_traveler',
            edge: Math.min(fatigueScore, 4),
            label: `Travel fatigue: ${travelMiles}mi, ${timeZoneChange}tz shift`,
        };
    }

**Weight integration:** Add new signal categories to the weight maps in `pick-engine.ts`. Start with small weights (0.03-0.05) and adjust based on CLV data from Task 5:

    // New weight additions (subtract from existing signals proportionally)
    // Example for NCAAMB SPREAD:
    paceMismatch: 0.03,
    kenpomMargin: 0.04,
    motivation: 0.02,
    travelFatigue: 0.02,
    // Total: 0.11 — redistribute from lower-value signals

**Tests:** `tests/edge-signals.test.ts` — test each signal independently with known inputs.

---

## Task 8: Tournament Model Validation System

**Why:** Conference tournaments (~March 3) are the dress rehearsal for March Madness. We need a live validation pipeline to measure accuracy in real-time and adjust before Selection Sunday (March 15).

**Where:** Create `src/lib/tournament-validator.ts`, add dashboard endpoint.

**Validation pipeline:**

    // src/lib/tournament-validator.ts
    
    interface ValidationResult {
        sport: string;
        tournament: string;
        totalPicks: number;
        correct: number;
        accuracy: number;
        byTier: Record<number, { n: number; correct: number; accuracy: number }>;
        bySide: {
            favorite: { n: number; accuracy: number };
            underdog: { n: number; accuracy: number };
        };
        byType: {
            spread: { n: number; accuracy: number };
            total: { n: number; accuracy: number };
        };
        clvAvg: number;
        underRate: number;       // % of O/U picks that were UNDER
        underAccuracy: number;   // UNDER pick accuracy (should be elevated in tournaments)
    }
    
    async function validateTournamentPicks(
        tournament: string,     // e.g., "Big 12 Tournament"
        startDate: Date,
        endDate: Date
    ): Promise<ValidationResult> {
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport: 'NCAAMB',
                createdAt: { gte: startDate, lte: endDate },
                result: { not: null },
                // Filter to tournament games (need tournament flag on UpcomingGame)
            },
            include: { game: true },
        });
        
        const correct = picks.filter(p => p.result === 'WON').length;
        
        // Break down by confidence tier
        const byTier: Record<number, any> = {};
        for (let tier = 1; tier <= 5; tier++) {
            const tierPicks = picks.filter(p => p.confidence === tier);
            byTier[tier] = {
                n: tierPicks.length,
                correct: tierPicks.filter(p => p.result === 'WON').length,
                accuracy: tierPicks.length > 0
                    ? tierPicks.filter(p => p.result === 'WON').length / tierPicks.length
                    : 0,
            };
        }
        
        // UNDER rate and accuracy (tournament-specific edge)
        const ouPicks = picks.filter(p => p.pickType === 'TOTAL');
        const underPicks = ouPicks.filter(p => p.direction === 'UNDER');
        
        return {
            sport: 'NCAAMB',
            tournament,
            totalPicks: picks.length,
            correct,
            accuracy: picks.length > 0 ? correct / picks.length : 0,
            byTier,
            bySide: computeSideBreakdown(picks),
            byType: computeTypeBreakdown(picks),
            clvAvg: mean(picks.filter(p => p.clvSpread).map(p => p.clvSpread!)),
            underRate: ouPicks.length > 0 ? underPicks.length / ouPicks.length : 0,
            underAccuracy: underPicks.length > 0
                ? underPicks.filter(p => p.result === 'WON').length / underPicks.length
                : 0,
        };
    }

**Live tracking dashboard endpoint:**

    // Add API route: /api/tournament-validation
    // Returns real-time accuracy during tournament play
    // Auto-refreshes every 30 minutes
    
    // Key metrics to display:
    // 1. Overall accuracy (target: >55%)
    // 2. 5★ pick accuracy (target: >60%)
    // 3. UNDER accuracy (target: >58%)
    // 4. Average CLV (target: >0.5)
    // 5. Upset detection rate (did we pick any upsets correctly?)

**Model adjustment triggers:**

    // If after 20+ tournament picks:
    // - Overall accuracy < 48%: alert, review signals
    // - 5★ accuracy < 50%: reduce 5★ gate threshold
    // - UNDER accuracy < 45%: reduce tournament UNDER boost
    // - CLV < -1.0: something fundamentally wrong
    
    function shouldAdjustModel(results: ValidationResult): Adjustment[] {
        const adjustments: Adjustment[] = [];
        
        if (results.totalPicks >= 20 && results.accuracy < 0.48) {
            adjustments.push({
                type: 'ALERT',
                message: 'Tournament accuracy below 48% — review signal weights',
            });
        }
        
        if (results.byTier[5]?.n >= 5 && results.byTier[5].accuracy < 0.5) {
            adjustments.push({
                type: 'REDUCE_GATE',
                signal: '5_star_threshold',
                suggestion: 'Raise 5★ edge gate by +2',
            });
        }
        
        if (results.underAccuracy < 0.45 && results.underRate > 0.3) {
            adjustments.push({
                type: 'REDUCE_BOOST',
                signal: 'tournament_under_boost',
                suggestion: 'Reduce UNDER 1.3x → 1.15x',
            });
        }
        
        return adjustments;
    }

**Tests:** `tests/tournament-validator.test.ts` — test accuracy computation, tier breakdown, adjustment triggers.

---

## Task 9: Signal Weight Optimization & Performance Attribution

**Why:** Signal weights are currently hand-tuned. Once CLV data accumulates (Task 5), we can empirically optimize weights. Signals that consistently beat the closing line deserve higher weights. This task also builds the attribution system to understand what's working and what isn't.

**Where:** Create `src/lib/signal-optimizer.ts` and `src/lib/performance-attribution.ts`.

### 9a: Signal Weight Optimization

    // src/lib/signal-optimizer.ts
    
    // Track CLV contribution by signal
    // Each pick has multiple signals — attribute CLV proportionally
    
    interface SignalContribution {
        signalCategory: string;
        avgCLV: number;           // Average CLV when this signal fired
        hitRate: number;          // % of time this signal's direction was correct
        avgEdge: number;          // Average edge magnitude
        n: number;               // Number of picks where this signal fired
    }
    
    async function computeSignalContributions(
        sport: string,
        pickType: 'SPREAD' | 'TOTAL',
        windowDays: number = 90
    ): Promise<SignalContribution[]> {
        // This requires storing signal breakdowns per pick
        // Add signalBreakdown JSON field to DailyPick:
        //   signalBreakdown: { signals: Signal[], convergenceScore: number }
        
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport,
                pickType,
                clvSpread: { not: null },
                createdAt: { gte: daysAgo(windowDays) },
            },
        });
        
        // Group by signal category
        const byCat: Record<string, { clvs: number[]; hits: number; total: number; edges: number[] }> = {};
        
        for (const pick of picks) {
            const breakdown = pick.signalBreakdown as any;
            if (!breakdown?.signals) continue;
            
            for (const signal of breakdown.signals) {
                if (!byCat[signal.category]) {
                    byCat[signal.category] = { clvs: [], hits: 0, total: 0, edges: [] };
                }
                byCat[signal.category].clvs.push(pick.clvSpread!);
                byCat[signal.category].edges.push(signal.edge);
                byCat[signal.category].total++;
                if (pick.result === 'WON') byCat[signal.category].hits++;
            }
        }
        
        return Object.entries(byCat).map(([cat, data]) => ({
            signalCategory: cat,
            avgCLV: mean(data.clvs),
            hitRate: data.hits / data.total,
            avgEdge: mean(data.edges),
            n: data.total,
        }));
    }
    
    // Optimize weights using gradient-free approach (grid search + constraints)
    function optimizeWeights(
        contributions: SignalContribution[],
        currentWeights: Record<string, number>
    ): Record<string, number> {
        // Score each signal by CLV contribution
        const scores = contributions
            .filter(c => c.n >= 20)  // Minimum sample
            .map(c => ({
                category: c.signalCategory,
                score: c.avgCLV * Math.sqrt(c.n),  // CLV weighted by sample size
            }));
        
        // Normalize scores to weights that sum to 1.0
        const totalScore = scores.reduce((s, x) => s + Math.max(0.01, x.score), 0);
        const optimized: Record<string, number> = {};
        
        for (const s of scores) {
            // Blend: 70% data-driven, 30% current weights (stability)
            const dataWeight = Math.max(0.01, s.score) / totalScore;
            const currentWeight = currentWeights[s.category] || 0.05;
            optimized[s.category] = 0.7 * dataWeight + 0.3 * currentWeight;
        }
        
        // Normalize to sum to 1.0
        const total = Object.values(optimized).reduce((a, b) => a + b, 0);
        for (const key of Object.keys(optimized)) {
            optimized[key] = Number((optimized[key] / total).toFixed(4));
        }
        
        return optimized;
    }

**Schema addition:**

    // Add to DailyPick in prisma/schema.prisma:
    signalBreakdown  Json?    // Store the signals array for attribution

**Store signal breakdown at pick generation time** — in `generateDailyPicks`, when creating each DailyPick, serialize the signals array:

    await prisma.dailyPick.create({
        data: {
            // ... existing fields ...
            signalBreakdown: {
                signals: spreadSignals.map(s => ({
                    category: s.category,
                    direction: s.direction,
                    edge: s.edge,
                    label: s.label,
                })),
                convergenceScore,
                weightedEdge,
            },
        },
    });

### 9b: Performance Attribution

    // src/lib/performance-attribution.ts
    
    interface AttributionReport {
        sport: string;
        period: string;
        bySignal: Record<string, {
            picks: number;
            wins: number;
            accuracy: number;
            avgCLV: number;
            roi: number;
        }>;
        byTier: Record<number, {
            picks: number;
            wins: number;
            accuracy: number;
            avgCLV: number;
        }>;
        byContext: {
            primetime: { picks: number; accuracy: number };
            rivalry: { picks: number; accuracy: number };
            tournament: { picks: number; accuracy: number };
            regular: { picks: number; accuracy: number };
        };
        signalDecay: Record<string, {
            month1Accuracy: number;
            month2Accuracy: number;
            month3Accuracy: number;
            trend: 'improving' | 'stable' | 'decaying';
        }>;
    }
    
    async function generateAttributionReport(
        sport: string,
        startDate: Date,
        endDate: Date
    ): Promise<AttributionReport> {
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport,
                createdAt: { gte: startDate, lte: endDate },
                result: { not: null },
            },
            include: { game: true },
        });
        
        // ... compute all breakdowns (similar pattern to tournament validator)
        
        // Signal decay detection: compare accuracy in 30-day windows
        // If a signal's accuracy is dropping month-over-month, flag it
        const decay = detectSignalDecay(picks);
        
        return { sport, period: `${startDate} - ${endDate}`, bySignal, byTier, byContext, signalDecay: decay };
    }
    
    function detectSignalDecay(picks: DailyPick[]): Record<string, any> {
        // Sort by date, split into monthly buckets
        // For each signal, compute accuracy per month
        // Flag if 3-month trend is negative
        // This catches signals that worked historically but have been "found" by the market
    }

**Tests:** `tests/signal-optimizer.test.ts` — test weight normalization, minimum sample enforcement, CLV scoring. `tests/attribution.test.ts` — test decay detection, context breakdown.

---

## Task Order & Dependencies

    Task 1 (NFL Ridge)     ─── independent ───┐
    Task 2 (NBA Ridge)     ─── independent ───┤
    Task 3 (NCAAF Ridge)   ─── independent ───┤
    Task 4 (Dynamic HCA)   ─── independent ───┼──► All feed into Task 8
    Task 5 (CLV Tracking)  ─── independent ───┤       (Tournament Validation)
    Task 6 (ATS Refinement)─── independent ───┤
    Task 7 (Edge Signals)  ─── independent ───┘
    Task 8 (Tournament Validation) ── depends on Tasks 1-7 being integrated
    Task 9 (Weight Optimization)   ── depends on Task 5 (CLV data)

**Recommended execution order:**
1. **Task 5 (CLV)** — Start first. Needs time to accumulate data before Task 9.
2. **Tasks 1-3 (Ridge models)** — Can be done in parallel. Biggest accuracy gains.
3. **Task 4 (HCA)** — Quick win, applies to all sports.
4. **Tasks 6-7 (ATS + Signals)** — Build on Ridge model improvements.
5. **Task 8 (Tournament Validation)** — Must be ready by March 1.
6. **Task 9 (Weight Optimization)** — Ongoing, uses CLV data as it accumulates.

---

## Validation Criteria

Before considering Phase 3 complete:

    ✅ NFL Ridge MAE < 10.0 on walk-forward holdout
    ✅ NBA Ridge MAE < 8.0 on walk-forward holdout  
    ✅ NCAAF Ridge MAE < 12.0 on walk-forward holdout
    ✅ CLV tracking captures closing lines for >90% of picks
    ✅ Average CLV across all picks is positive (>0.0)
    ✅ Tournament validation pipeline tested with mock data
    ✅ All new signals have unit tests
    ✅ Signal weights still sum to 1.0 per sport per pick type
    ✅ HCA values recalibrated with current season data
    ✅ No regression in existing NCAAMB ATS performance (>55% at edge ≥5)
