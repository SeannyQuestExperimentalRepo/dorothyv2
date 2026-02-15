# Phase NFL Foundation: From Napkin Math to Real Model

> **Context Management:** When context reaches 70%, compact the conversation and continue.

The NFL pipeline currently has a C- grade. The "model" is `(avgMargin_home - avgMargin_away)/2 + 2.5` — literal napkin math. Defensive EPA is NULL in the database. Rest/bye weeks aren't modeled. Injuries are fetched but thrown away. This phase fixes the foundation.

This is a big lift — 7 tasks, roughly in priority order. Each task stands alone, so you can commit after each one. The goal: get NFL to a functional B-grade model before the 2026 season.

Reference: The NFL edge exploration report identified defensive EPA, regression model, and bye weeks as the top 3 priorities with the highest ROI.

---

## Task 1: Fix Defensive EPA (Critical — Half the Signal is Missing)

**Why:** The `NFLTeamEPA` table has a `defEpaPerPlay` column that is always NULL. The nflverse module only computes offensive EPA from player_stats. Without defensive EPA, the EPA signal is using `offEPA - 0` — meaningless for team comparisons.

**Where:** The nflverse sync module (search for where `NFLTeamEPA` records are upserted — likely in a file like `nflverse.ts` or `nfl-data.ts`).

**What to do:** Download the nflverse play-by-play CSV and aggregate defensive EPA from it.

### Step 1a: Add PBP download function

    async function downloadNflPbp(season: number): Promise<Array<any>> {
      const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv`;
      // Download and parse CSV
      // Filter to real plays: play_type in ("pass", "run") and not nullified by penalty
      // Each row has: defteam, epa, week, season
      // Return parsed rows
    }

### Step 1b: Aggregate defensive EPA by team and week

    function aggregateDefensiveEpa(
      plays: Array<{ defteam: string; epa: number; week: number }>
    ): Map<string, Map<number, { defEpaPerPlay: number; defPassEpa: number; defRushEpa: number }>> {
      // Group by defteam + week
      // For each group: compute mean EPA (this IS the defensive EPA — EPA allowed per play)
      // Also split by play_type for pass/rush defensive EPA
      // Lower (more negative) = better defense
      const result = new Map();

      for (const play of plays) {
        const teamMap = result.get(play.defteam) || new Map();
        const weekData = teamMap.get(play.week) || { totalEpa: 0, plays: 0 };
        weekData.totalEpa += play.epa;
        weekData.plays += 1;
        teamMap.set(play.week, weekData);
        result.set(play.defteam, teamMap);
      }

      // Convert to per-play averages
      for (const [team, weekMap] of result) {
        for (const [week, data] of weekMap) {
          weekMap.set(week, {
            ...data,
            defEpaPerPlay: data.totalEpa / data.plays,
          });
        }
      }
      return result;
    }

### Step 1c: Update the NFL EPA sync to include defensive EPA

In the existing sync function that upserts `NFLTeamEPA` records, merge in the defensive EPA data:

    // After computing offensive EPA from player_stats (existing code)
    // Look up defensive EPA from PBP aggregation
    const defData = defensiveEpaMap.get(teamAbbr)?.get(week);

    await prisma.nFLTeamEPA.upsert({
      where: { teamId_week_season: { teamId, week, season } },
      update: {
        // ... existing offensive fields ...
        defEpaPerPlay: defData?.defEpaPerPlay ?? null,
        defPassEpa: defData?.defPassEpa ?? null,
        defRushEpa: defData?.defRushEpa ?? null,
      },
      create: {
        // ... all fields including defensive ...
      },
    });

### Step 1d: Update the EPA signal to use defensive EPA

Find the `signalNflEpa` function (or equivalent). Currently it likely does something like:

    const homeRating = homeEpa.offEpaPerPlay * EPA_TO_POINTS;
    const awayRating = awayEpa.offEpaPerPlay * EPA_TO_POINTS;

Change to use the composite (offensive EPA minus defensive EPA allowed):

    // Composite EPA: offensive efficiency minus defensive efficiency allowed
    // offEPA is positive = good offense, defEPA is positive = bad defense (allows more EPA)
    const homeComposite = (homeEpa.offEpaPerPlay ?? 0) - (homeEpa.defEpaPerPlay ?? 0);
    const awayComposite = (awayEpa.offEpaPerPlay ?? 0) - (awayEpa.defEpaPerPlay ?? 0);

    const homeRating = homeComposite * EPA_TO_POINTS;
    const awayRating = awayComposite * EPA_TO_POINTS;

**Note on the PBP CSV:** It's ~200MB per season. Consider downloading once and caching, or processing during the weekly nflverse sync cron. The CSV columns you need are: `defteam`, `epa`, `week`, `season`, `play_type`, `penalty` (filter out penalty plays).

---

## Task 2: NFL Ridge Regression Model

**Why:** NCAAMB has a Ridge regression model with 62.8% walk-forward validated accuracy. NFL uses `(avgMargin_home - avgMargin_away)/2 + 2.5`. The single biggest accuracy upgrade is replacing this with a proper trained model.

**Where:** Create a new function `trainNflRidgeModel` and replace `computePowerRatingEdge` for NFL.

### Step 2a: Define feature vector

For each NFL game, build a feature vector from data available BEFORE the game:

    interface NflFeatureVector {
      // EPA features (season-to-date weighted averages)
      homeOffEpa: number;        // Home team offensive EPA/play
      homeDefEpa: number;        // Home team defensive EPA/play (from Task 1)
      awayOffEpa: number;
      awayDefEpa: number;
      homePassEpa: number;       // Pass-specific EPA
      homeRushEpa: number;       // Rush-specific EPA
      awayPassEpa: number;
      awayRushEpa: number;
      // Situational
      homeRestDays: number;      // Days since last game
      awayRestDays: number;
      isHomeDome: boolean;       // Playing in a dome
      homeElo: number;
      awayElo: number;
      // Weather (outdoor games only)
      windSpeed: number;         // 0 for dome games
      temperature: number;       // 72 for dome games (normalized)
      precipitation: number;
    }

### Step 2b: Build training dataset

    async function buildNflTrainingData(seasons: number[]): Promise<Array<{
      features: number[];
      spreadResult: number;  // actual margin minus spread (positive = home covered)
      totalResult: number;   // actual total minus line
    }>> {
      // For each completed NFLGame in the given seasons:
      // 1. Look up NFLTeamEPA for both teams (season-to-date averages UP TO that week)
      // 2. Look up EloRating for both teams at game time
      // 3. Look up GameWeather if outdoor
      // 4. Compute rest days from previous game
      // 5. Build feature vector
      // 6. Compute target: (homeScore - awayScore) for spread model,
      //    (homeScore + awayScore) for total model
      // Use seasons 2020-2024 for training (5 seasons, ~1,340 games)
    }

### Step 2c: Implement Ridge regression

Use the same Ridge regression approach as NCAAMB. If the codebase uses a library (like `ml-regression`), use the same one. If it's hand-rolled, follow the same pattern.

    function trainRidgeRegression(
      X: number[][],   // feature matrix
      y: number[],     // targets
      lambda: number   // regularization (start with 1.0, tune later)
    ): number[] {
      // Standard Ridge: w = (X'X + λI)^(-1) X'y
      // Return coefficient vector
    }

    // Train two models: one for spread prediction, one for total prediction
    const spreadModel = trainRidgeRegression(features, spreadTargets, 1.0);
    const totalModel = trainRidgeRegression(features, totalTargets, 1.0);

### Step 2d: Walk-forward validation

Follow the NCAAMB pattern: train on seasons 2020-2023, validate on 2024. Report:
- Spread prediction MAE
- Total prediction MAE
- ATS accuracy (predicted side vs actual cover)
- O/U accuracy

### Step 2e: Wire into pick engine

Replace the NFL `computePowerRatingEdge` call with the Ridge model prediction:

    // Old:
    const edge = computePowerRatingEdge(homeMargin, awayMargin, hca);

    // New:
    const predictedMargin = predictNflSpread(homeFeatures, spreadCoefficients);
    const edge = predictedMargin - game.spread;

Store the trained coefficients as a JSON file or in the database. Retrain weekly or monthly.

---

## Task 3: Bye Week / Rest Signal for NFL

**Why:** `signalRestDays` explicitly returns "N/A" for NFL. Post-bye teams cover at ~53-55% ATS. Short-week road teams (Thursday after Sunday) cover at ~46%. This is free edge.

**Where:** The `signalRestDays` function. Search for the early return that skips NFL:

    if (sport !== "NCAAMB" && sport !== "NBA") {
      return { direction: "neutral", confidence: 0, note: "N/A" };
    }

**What to do:** Remove the NFL exclusion and add NFL-specific rest logic.

    // NFL rest categories:
    // - Bye week: rest > 10 days → lean toward the rested team
    // - Short week (TNF after Sunday): rest = 3-4 days → lean against short-rest team
    // - Monday to Sunday: rest = 6 days (slight advantage)
    // - Normal: rest = 6-7 days → neutral

    if (sport === "NFL") {
      // Query last game for each team
      const homeLastGame = await prisma.nFLGame.findFirst({
        where: {
          OR: [{ homeTeamId: homeTeamId }, { awayTeamId: homeTeamId }],
          gameDate: { lt: game.gameDate },
          status: "completed",
        },
        orderBy: { gameDate: "desc" },
      });
      const awayLastGame = await prisma.nFLGame.findFirst({
        where: {
          OR: [{ homeTeamId: awayTeamId }, { awayTeamId: awayTeamId }],
          gameDate: { lt: game.gameDate },
          status: "completed",
        },
        orderBy: { gameDate: "desc" },
      });

      const homeRest = homeLastGame
        ? Math.floor((game.gameDate.getTime() - homeLastGame.gameDate.getTime()) / (1000 * 60 * 60 * 24))
        : 7;
      const awayRest = awayLastGame
        ? Math.floor((game.gameDate.getTime() - awayLastGame.gameDate.getTime()) / (1000 * 60 * 60 * 24))
        : 7;

      const restDiff = homeRest - awayRest;

      // Bye week advantage (one team rested, other not)
      if (homeRest > 10 && awayRest <= 7) {
        return {
          direction: "home",
          confidence: 0.55,
          note: `Home off bye (${homeRest}d rest) vs away normal (${awayRest}d)`,
        };
      }
      if (awayRest > 10 && homeRest <= 7) {
        return {
          direction: "away",
          confidence: 0.55,
          note: `Away off bye (${awayRest}d rest) vs home normal (${homeRest}d)`,
        };
      }

      // Short week disadvantage
      if (homeRest <= 4 && awayRest >= 6) {
        return {
          direction: "away",
          confidence: 0.45,
          note: `Home on short rest (${homeRest}d) — Thursday game?`,
        };
      }
      if (awayRest <= 4 && homeRest >= 6) {
        return {
          direction: "home",
          confidence: 0.45,
          note: `Away on short rest (${awayRest}d) — Thursday game?`,
        };
      }

      // Marginal rest advantage
      if (Math.abs(restDiff) >= 3) {
        const dir = restDiff > 0 ? "home" : "away";
        return {
          direction: dir,
          confidence: 0.3,
          note: `Rest edge: home ${homeRest}d vs away ${awayRest}d`,
        };
      }

      return { direction: "neutral", confidence: 0, note: `Rest similar: home ${homeRest}d vs away ${awayRest}d` };
    }

---

## Task 4: Weather Signal — Verify No Double-Count

**Why:** Phase 1 identified that NFL O/U double-counts weather (weather is both a standalone signal at 10% weight AND baked into h2hWeather at 20%). Verify the Phase 1 fix was applied. If not, fix it.

**Where:** Look at `OU_WEIGHTS.NFL` and the `signalH2hWeather` function for NFL.

**Current NFL O/U weights:**

    NFL: {
      modelEdge: 0.10,
      seasonOU: 0.15,
      trendAngles: 0.20,
      recentForm: 0.15,
      h2hWeather: 0.20,
      nflEpa: 0.10,
      weather: 0.10,
    }

**What to verify:**
1. Does `signalH2hWeather` include weather adjustments for NFL? If yes, weather is double-counted.
2. If double-counted: either remove the standalone `weather` signal for NFL and redistribute its 0.10 weight, OR strip weather logic out of `signalH2hWeather` for NFL.

**Recommended fix (if still double-counted):**

Rename/split the function so `h2hWeather` is ONLY H2H for NFL, and `weather` is the standalone weather signal. Then rebalance:

    NFL: {
      modelEdge: 0.10,
      seasonOU: 0.15,
      trendAngles: 0.20,
      recentForm: 0.15,
      h2h: 0.10,        // Pure H2H, no weather
      nflEpa: 0.10,
      weather: 0.20,     // Standalone weather (absorbed h2hWeather's portion)
    }

After fixing, add a calibrated weather impact table based on research:

    // NFL weather impact on totals (calibrated to historical data)
    function getWeatherTotalImpact(weather: GameWeather): number {
      let impact = 0; // negative = points suppressed (lean UNDER)
      if (weather.windSpeed > 20) impact -= 4;      // High wind: 3-5 pts under
      else if (weather.windSpeed > 15) impact -= 2;
      if (weather.temperature < 20) impact -= 3;     // Extreme cold
      else if (weather.temperature < 32) impact -= 1;
      if (weather.snowfall > 0) impact -= 5;          // Snow: 5-7 pts under
      if (weather.precipitation > 0.2) impact -= 2;   // Heavy rain
      else if (weather.precipitation > 0) impact -= 1;
      return impact;
    }

---

## Task 5: NFL-Specific Confidence Tiers

**Why:** NFL currently uses generic convergence score thresholds (85 for high confidence, 70 for medium). NCAAMB has calibrated 5★/4★/3★ tiers. NFL needs the same.

**Where:** The confidence tier assignment for NFL. Search for where NFL picks get their confidence rating.

**What to do:** Replace generic thresholds with NFL-specific tiers, modeled after NCAAMB's approach.

### NFL Spread Confidence Tiers:

    if (sport === "NFL") {
      const absEdge = Math.abs(predictedEdge);
      const restAdvantage = restSignal.confidence > 0.4; // Strong rest edge
      const weatherFactor = isOutdoor && weatherImpact !== 0;

      if (absEdge >= 7 && restAdvantage) {
        confidence = 5; // Large edge + rest advantage = highest confidence
      } else if (absEdge >= 5 && (restAdvantage || weatherFactor)) {
        confidence = 4; // Solid edge with supporting signal
      } else if (absEdge >= 3) {
        confidence = 3; // Standard play
      } else {
        confidence = 0; // No play
      }
    }

### NFL O/U Confidence Tiers:

    if (sport === "NFL" && ouMeta) {
      const { absEdge, ouDir } = ouMeta;

      // Weather-affected outdoor games: more confident on unders
      const weatherUnderBoost = isOutdoor && weatherImpact < -3 && ouDir === "under";

      if (weatherUnderBoost && absEdge >= 5) {
        confidence = 5; // Weather-driven under in bad conditions
      } else if (absEdge >= 6) {
        confidence = 4;
      } else if (absEdge >= 4) {
        confidence = 3;
      } else {
        confidence = 0;
      }
    }

These thresholds are starting points — they should be backtested and calibrated once the Ridge model (Task 2) is producing predictions. The key insight: NFL edges are smaller than NCAAMB (more efficient market), so the gates should be lower in absolute terms but the confidence should require convergence of multiple signals.

---

## Task 6: Injury Impact Scoring

**Why:** Injuries are fetched from ESPN and displayed in the UI but never used in the pick engine. QB injuries alone can swing a line 3-7 points. This is leaving edge on the table.

**Where:** Create a new function `computeInjuryImpact` and wire it into the NFL pick generation.

### Step 6a: Define positional value weights

    const NFL_POSITIONAL_VALUE: Record<string, number> = {
      QB: 1.0,
      EDGE: 0.25,
      CB: 0.20,
      WR: 0.18,
      OT: 0.15,  // Offensive tackle
      LB: 0.12,
      S: 0.10,
      RB: 0.10,
      TE: 0.08,
      DT: 0.08,
      G: 0.06,   // Guard
      C: 0.05,   // Center
      K: 0.04,
      P: 0.02,
    };

    const INJURY_STATUS_MULTIPLIER: Record<string, number> = {
      Out: 1.0,
      "Injured Reserve": 1.0,
      Doubtful: 0.8,
      Questionable: 0.3,
      Probable: 0.05,
    };

### Step 6b: Compute team injury impact score

    interface InjuryReport {
      playerName: string;
      position: string;
      status: string; // "Out", "Questionable", etc.
    }

    function computeTeamInjuryImpact(injuries: InjuryReport[]): number {
      let totalImpact = 0;
      for (const inj of injuries) {
        const posValue = NFL_POSITIONAL_VALUE[inj.position] ?? 0.05;
        const statusMult = INJURY_STATUS_MULTIPLIER[inj.status] ?? 0;
        totalImpact += posValue * statusMult;
      }
      return totalImpact;
    }

### Step 6c: Convert to spread adjustment

    function injurySpreadAdjustment(
      homeInjuries: InjuryReport[],
      awayInjuries: InjuryReport[]
    ): { adjustment: number; note: string } {
      const homeImpact = computeTeamInjuryImpact(homeInjuries);
      const awayImpact = computeTeamInjuryImpact(awayInjuries);

      // Scale: QB out ≈ 1.0 impact ≈ 5 point adjustment
      // Role player out ≈ 0.1 impact ≈ 0.5 point adjustment
      const IMPACT_TO_POINTS = 5.0;
      const adjustment = (awayImpact - homeImpact) * IMPACT_TO_POINTS;
      // Positive = favors home (away more injured)

      const note = `Injury impact: home ${homeImpact.toFixed(2)} / away ${awayImpact.toFixed(2)} → ${adjustment > 0 ? "home" : "away"} +${Math.abs(adjustment).toFixed(1)}pts`;

      return { adjustment, note };
    }

### Step 6d: Wire into NFL pick engine

In the NFL spread model edge computation, add the injury adjustment:

    // After computing model edge from Ridge regression
    const injAdj = injurySpreadAdjustment(homeInjuries, awayInjuries);
    const adjustedEdge = modelEdge + injAdj.adjustment;
    reasoning.push(injAdj.note);

**Important:** The ESPN injuries API returns live data. You need to fetch injuries at pick generation time (already happening for display). Just pass them into the model.

---

## Task 7: NFL Weight Rebalancing

**Why:** Current NFL weights were set before defensive EPA, rest signals, or injury scoring existed. Now that we're adding real signals, rebalance.

**Where:** `SPREAD_WEIGHTS.NFL` and `OU_WEIGHTS.NFL` in pick-engine.ts.

### NFL Spread Weights (after Tasks 1-6):

    NFL: {
      modelEdge: 0.25,     // Up from 0.15 — Ridge model is now the core
      seasonATS: 0.08,     // Down from 0.10 — less useful with proper model
      trendAngles: 0.12,   // Down from 0.20 — trend mining less reliable in NFL
      recentForm: 0.12,    // Down from 0.20 — captured better by EPA
      h2h: 0.05,           // Down from 0.10 — NFL rosters change too much
      situational: 0.05,   // Down from 0.10
      eloEdge: 0.05,       // Same
      nflEpa: 0.10,        // Same — but now includes defensive EPA
      restDays: 0.08,      // NEW — bye week / short week signal
      injuries: 0.10,      // NEW — injury impact scoring
    }

Sum: 0.25 + 0.08 + 0.12 + 0.12 + 0.05 + 0.05 + 0.05 + 0.10 + 0.08 + 0.10 = 1.0 ✓

### NFL O/U Weights (after Tasks 1-6):

    NFL: {
      modelEdge: 0.20,     // Up from 0.10 — Ridge total model
      seasonOU: 0.10,      // Down from 0.15
      trendAngles: 0.10,   // Down from 0.20
      recentForm: 0.10,    // Down from 0.15
      h2h: 0.05,           // Split from h2hWeather
      nflEpa: 0.15,        // Up from 0.10 — defensive EPA makes this real
      weather: 0.20,       // Up from 0.10 — calibrated weather impact
      restDays: 0.05,      // NEW — short week = sloppy play = under
      injuries: 0.05,      // NEW — missing players = fewer points
    }

Sum: 0.20 + 0.10 + 0.10 + 0.10 + 0.05 + 0.15 + 0.20 + 0.05 + 0.05 = 1.0 ✓

---

## Verification Checklist

After implementing all 7 tasks:

- [ ] **Defensive EPA populated:** Run the PBP sync for 2024 season and verify `defEpaPerPlay` is no longer NULL in NFLTeamEPA
- [ ] **EPA signal uses composite:** `signalNflEpa` uses `offEPA - defEPA` not just `offEPA`
- [ ] **Ridge model trained:** Coefficients stored, walk-forward validation results logged
- [ ] **Ridge model wired:** NFL `modelEdge` signal uses Ridge predictions, not `computePowerRatingEdge`
- [ ] **Rest signal works:** `signalRestDays` no longer returns "N/A" for NFL; test with a known bye-week game
- [ ] **Weather not double-counted:** Only ONE path for weather impact in NFL O/U
- [ ] **Weather calibrated:** Wind >20mph, snow, extreme cold produce meaningful under leans
- [ ] **Confidence tiers NFL-specific:** NFL spread and O/U have their own tier logic (not generic convergence)
- [ ] **Injury scoring:** QB out produces ~5pt adjustment; role player produces ~0.5pt
- [ ] **Injuries wired:** Injury adjustment appears in NFL pick reasoning
- [ ] **Weight sums:** Both NFL spread and O/U weights sum to 1.0
- [ ] **TypeScript compiles:** `npx tsc --noEmit` passes
- [ ] **No regressions:** NCAAMB picks unchanged by NFL-only modifications
- [ ] **PBP CSV handled:** Download is cached/efficient, not re-downloaded every cron run
