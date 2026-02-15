# Phase 1.5: NCAAMB Tournament Readiness

> **⚠️ Context Budget Guide**
> This prompt is ~22KB (~5.5k tokens). The main files Claude needs to read:
> - `src/lib/pick-engine.ts` — 100KB (~25k tokens) ← THE big file
> - `src/lib/kenpom.ts` — 11KB (~3k tokens)
> - `src/lib/elo.ts` — 15KB (~4k tokens)
> - `prisma/schema.prisma` — 35KB (~9k tokens)
>
> **Total estimated context: ~47k tokens (~24% of 200k)**
>
> If you're on Claude with project/repo context already loaded, you have plenty of room.
> If pasting into a fresh chat, add these files to context first:
> 1. `src/lib/pick-engine.ts` (required — nearly every task touches this)
> 2. `prisma/schema.prisma` (needed for Task 12: closingLine fields)
> 3. `src/lib/kenpom.ts` (needed for Tasks 9-10: FanMatch)
> 4. `src/lib/elo.ts` (needed for Task 3: eloOU signal)

This is tournament-readiness work for the trendline pick engine. Selection Sunday is **March 15, 2026** — we have ~4 weeks. This phase slots between Phase 1 (bug fixes, already merged) and Phase 2 (tests/architecture). Every change here targets the March Madness pipeline: weight rebalancing, tournament-specific logic, FanMatch cross-checks, stale odds protection, and closing line tracking.

The codebase is `pick-engine.ts` (~3,095 lines) unless otherwise noted. All weight changes must sum to 1.0 for their respective signal group. Do each task in order — later tasks depend on earlier weight changes.

---

## Task 1: Drop Elo ATS Weight to 0 for NCAAMB Spread

**Why:** Elo ATS has shown no predictive value for college basketball spreads. The 0.05 weight is dead weight — redistribute to modelEdge which is our strongest signal.

**Where:** `pick-engine.ts` around line 133, the `SPREAD_WEIGHTS` object for NCAAMB.

**Current code:**

    NCAAMB: {
        modelEdge: 0.23,
        seasonATS: 0.14,
        trendAngles: 0.2,
        recentForm: 0.1,
        h2h: 0.05,
        situational: 0.0,
        restDays: 0.05,
        marketEdge: 0.08,
        eloEdge: 0.05,
        barttorvik: 0.05,
        sizeExp: 0.05,
    }

**Replace with:**

    NCAAMB: {
        modelEdge: 0.28,
        seasonATS: 0.14,
        trendAngles: 0.2,
        recentForm: 0.1,
        h2h: 0.05,
        situational: 0.0,
        restDays: 0.05,
        marketEdge: 0.08,
        eloEdge: 0.0,
        barttorvik: 0.05,
        sizeExp: 0.05,
    }

Verify the weights still sum to 1.0: 0.28 + 0.14 + 0.2 + 0.1 + 0.05 + 0.0 + 0.05 + 0.08 + 0.0 + 0.05 + 0.05 = 1.0 ✓

---

## Task 2: Reduce Barttorvik Weight for Both Spread and O/U

**Why:** Barttorvik data at 0.05 is marginally useful but the weight is better allocated to modelEdge. Drop to 0.02 and give the freed 0.03 to modelEdge in both spread and O/U.

**Where:** Same `SPREAD_WEIGHTS.NCAAMB` (already modified in Task 1) and `OU_WEIGHTS.NCAAMB` around line 185.

**Spread — update the Task 1 result to:**

    NCAAMB: {
        modelEdge: 0.31,
        seasonATS: 0.14,
        trendAngles: 0.2,
        recentForm: 0.1,
        h2h: 0.05,
        situational: 0.0,
        restDays: 0.05,
        marketEdge: 0.08,
        eloEdge: 0.0,
        barttorvik: 0.02,
        sizeExp: 0.05,
    }

Sum: 0.31 + 0.14 + 0.2 + 0.1 + 0.05 + 0.0 + 0.05 + 0.08 + 0.0 + 0.02 + 0.05 = 1.0 ✓

**O/U — current code (~line 185):**

    NCAAMB: {
        modelEdge: 0.28,
        seasonOU: 0.1,
        trendAngles: 0.18,
        recentForm: 0.07,
        h2hWeather: 0.12,
        tempoDiff: 0.15,
        barttorvik: 0.05,
        pointDist: 0.05,
    }

**Replace with:**

    NCAAMB: {
        modelEdge: 0.31,
        seasonOU: 0.1,
        trendAngles: 0.18,
        recentForm: 0.07,
        h2hWeather: 0.12,
        tempoDiff: 0.15,
        barttorvik: 0.02,
        pointDist: 0.05,
    }

Sum: 0.31 + 0.1 + 0.18 + 0.07 + 0.12 + 0.15 + 0.02 + 0.05 = 1.0 ✓

---

## Task 3: Reframe Elo as O/U Signal (eloOU)

**Why:** Elo is useless for ATS but has signal for O/U: when both teams have high Elo (>1600), they tend to play tighter, more disciplined games that go UNDER. This is a new signal for NCAAMB O/U only.

**Where:** Add a new signal function and wire it into the O/U weights.

### Step 3a: Add eloOU to O/U weights

Take 0.03 from seasonOU (0.10 → 0.07) and add eloOU at 0.03.

**Update the O/U weights (from Task 2) to:**

    NCAAMB: {
        modelEdge: 0.31,
        seasonOU: 0.07,
        trendAngles: 0.18,
        recentForm: 0.07,
        h2hWeather: 0.12,
        tempoDiff: 0.15,
        barttorvik: 0.02,
        pointDist: 0.05,
        eloOU: 0.03,
    }

Sum: 0.31 + 0.07 + 0.18 + 0.07 + 0.12 + 0.15 + 0.02 + 0.05 + 0.03 = 1.0 ✓

### Step 3b: Add the signalEloOU function

Place this near the other signal functions. It checks if both teams have Elo above 1600 and returns an UNDER lean.

    function signalEloOU(
      homeElo: number | null,
      awayElo: number | null
    ): SignalResult {
      if (!homeElo || !awayElo) return { direction: "neutral", confidence: 0, note: "N/A" };

      const bothElite = homeElo > 1600 && awayElo > 1600;
      if (bothElite) {
        const avgElo = (homeElo + awayElo) / 2;
        // Higher combined Elo = stronger UNDER lean
        const confidence = Math.min(0.7, (avgElo - 1600) / 200);
        return {
          direction: "under",
          confidence,
          note: `Both teams elite Elo (${homeElo.toFixed(0)} vs ${awayElo.toFixed(0)}) → UNDER lean`,
        };
      }

      return { direction: "neutral", confidence: 0, note: "Elo not both elite" };
    }

### Step 3c: Wire it into the O/U signal aggregation

In the O/U signal collection section for NCAAMB, add the eloOU signal call alongside the others. Look for where other O/U signals are gathered into the weighted array and add:

    if (sport === "NCAAMB") {
      const eloOUResult = signalEloOU(homeElo, awayElo);
      ouSignals.push({ weight: ouWeights.eloOU, ...eloOUResult });
    }

---

## Task 4: Tournament UNDER Boost

**Why:** March Madness neutral-site games historically go UNDER at a high rate. Pressure, unfamiliar venue, defensive intensity all ramp up. We want to be more aggressive on UNDER picks during the tournament.

**Where:** `pick-engine.ts` around line 2680, the NCAAMB O/U confidence tier logic.

**Current code:**

    if (sport === "NCAAMB" && ouMeta) {
        const { absEdge, avgTempo, ouDir } = ouMeta;
        if (ouDir === "under" && absEdge >= 12 && avgTempo <= 64) {
            confidence = 5;
        } else if (ouDir === "under" && absEdge >= 10) {
            confidence = 4;
        } else if (absEdge >= 9) {
            confidence = 3;
        } else {
            confidence = 0;
        }
    }

**Replace with:**

    if (sport === "NCAAMB" && ouMeta) {
        const { absEdge, avgTempo, ouDir } = ouMeta;
        const gameDate = new Date(game.gameDate);
        const isMarchNeutral = game.isNeutralSite === true && gameDate.getMonth() === 2; // March = month 2 (0-indexed)

        let effectiveEdge = absEdge;
        if (isMarchNeutral && ouDir === "under") {
            effectiveEdge = absEdge * 1.3; // Tournament UNDER boost
        }

        if (isMarchNeutral && ouDir === "under") {
            // Tournament-specific tiers (more aggressive on UNDERs)
            if (effectiveEdge >= 10) {
                confidence = 5;
            } else if (effectiveEdge >= 8) {
                confidence = 4;
            } else if (effectiveEdge >= 6) {
                confidence = 3;
            } else {
                confidence = 0;
            }
        } else {
            // Regular season tiers (unchanged)
            if (ouDir === "under" && absEdge >= 12 && avgTempo <= 64) {
                confidence = 5;
            } else if (ouDir === "under" && absEdge >= 10) {
                confidence = 4;
            } else if (absEdge >= 9) {
                confidence = 3;
            } else {
                confidence = 0;
            }
        }
    }

---

## Task 5: Neutral Site HCA Fix for Tournament

**Why:** Phase 1 should have fixed this, but verify: when `isNeutralSite` is true, the home court advantage in `signalModelEdgeNCAAMB` must be set to 0. If it's not already fixed, fix it now.

**Where:** The `signalModelEdgeNCAAMB` function (or `computeKenPomEdge` / `computePowerRatingEdge` for NCAAMB). Search for where HCA is applied.

**What to verify/fix:** Look for something like:

    const hca = 3.5; // or whatever the HCA value is

It should be:

    const hca = game.isNeutralSite ? 0 : 3.5;

If Phase 1 already fixed this, confirm it and move on. If not, apply the fix. Check every place HCA is added for NCAAMB — there may be multiple (Ridge regression input, power rating fallback, model edge computation).

---

## Task 6: Seed-Aware Upset Detection (ATS)

**Why:** Tournament upsets follow patterns. When a 12-seed has KenPom metrics close to or better than a 5-seed, the market overvalues seeding. We want to detect these mismatches.

**Where:** Add a new signal function `signalSeedMismatch` and wire it into NCAAMB spread weights.

### Step 6a: Update spread weights

Take 0.05 from trendAngles (0.20 → 0.15) and add seedMismatch at 0.05.

**Final NCAAMB spread weights (incorporating Tasks 1-2):**

    NCAAMB: {
        modelEdge: 0.31,
        seasonATS: 0.14,
        trendAngles: 0.15,
        recentForm: 0.1,
        h2h: 0.05,
        situational: 0.0,
        restDays: 0.05,
        marketEdge: 0.08,
        eloEdge: 0.0,
        barttorvik: 0.02,
        sizeExp: 0.05,
        seedMismatch: 0.05,
    }

Sum: 0.31 + 0.14 + 0.15 + 0.1 + 0.05 + 0.0 + 0.05 + 0.08 + 0.0 + 0.02 + 0.05 + 0.05 = 1.0 ✓

### Step 6b: Add the signalSeedMismatch function

    function signalSeedMismatch(
      homeStats: KenpomTeamStats | null,
      awayStats: KenpomTeamStats | null,
      game: any
    ): SignalResult {
      if (!homeStats || !awayStats) return { direction: "neutral", confidence: 0, note: "N/A" };

      const homeSeed = homeStats.seed;
      const awaySeed = awayStats.seed;
      if (!homeSeed || !awaySeed) return { direction: "neutral", confidence: 0, note: "No seed data" };

      const homeAdjEM = homeStats.adjEM ?? 0;
      const awayAdjEM = awayStats.adjEM ?? 0;
      const adjEMGap = Math.abs(homeAdjEM - awayAdjEM);

      // Identify higher seed (lower number = better seed) and lower seed
      const higherSeed = Math.min(homeSeed, awaySeed);
      const lowerSeed = Math.max(homeSeed, awaySeed);
      const lowerSeedIsHome = homeSeed > awaySeed;
      const lowerSeedStats = lowerSeedIsHome ? homeStats : awayStats;
      const lowerSeedRank = lowerSeedStats.rank ?? 999;

      // Too close to call
      if (adjEMGap < 5) {
        return {
          direction: "neutral",
          confidence: 0.3,
          note: `Seeds ${higherSeed}v${lowerSeed} but AdjEM gap only ${adjEMGap.toFixed(1)} — too close to call`,
        };
      }

      // 12v5 upset detection
      if (higherSeed === 5 && lowerSeed === 12 && lowerSeedRank <= 80) {
        const underdogDir = lowerSeedIsHome ? "home" : "away";
        return {
          direction: underdogDir,
          confidence: 0.55,
          note: `12v5 upset spot: 12-seed ranked #${lowerSeedRank} in KenPom`,
        };
      }

      // 11v6 upset detection
      if (higherSeed === 6 && lowerSeed === 11 && lowerSeedRank <= 60) {
        const underdogDir = lowerSeedIsHome ? "home" : "away";
        return {
          direction: underdogDir,
          confidence: 0.5,
          note: `11v6 upset spot: 11-seed ranked #${lowerSeedRank} in KenPom`,
        };
      }

      // Check if lower seed has BETTER AdjEM than higher seed (general mismatch)
      const lowerSeedAdjEM = lowerSeedIsHome ? homeAdjEM : awayAdjEM;
      const higherSeedAdjEM = lowerSeedIsHome ? awayAdjEM : homeAdjEM;
      if (lowerSeedAdjEM > higherSeedAdjEM) {
        const underdogDir = lowerSeedIsHome ? "home" : "away";
        return {
          direction: underdogDir,
          confidence: 0.4,
          note: `Seed mismatch: ${lowerSeed}-seed has better AdjEM (${lowerSeedAdjEM.toFixed(1)}) than ${higherSeed}-seed (${higherSeedAdjEM.toFixed(1)})`,
        };
      }

      return { direction: "neutral", confidence: 0, note: "No seed mismatch detected" };
    }

### Step 6c: Wire into spread signal aggregation

In the NCAAMB spread signal collection, add:

    if (sport === "NCAAMB") {
      const seedResult = signalSeedMismatch(homeKenpomStats, awayKenpomStats, game);
      spreadSignals.push({ weight: spreadWeights.seedMismatch, ...seedResult });
    }

---

## Task 7: Conference Tournament Fatigue

**Why:** Teams playing their 3rd game in 4 days during conference tournaments are fatigued. This is equivalent to back-to-back in the NBA.

**Where:** The `signalRestDays` function for NCAAMB.

**What to do:** Enhance the existing rest days logic. When computing rest for NCAAMB, look at the team's last 3 games. If 3 games were played within a 4-day window, flag as fatigued.

Find the section in `signalRestDays` that handles NCAAMB and add:

    // Conference tournament fatigue detection for NCAAMB
    // Look at last 3 games for the team — if all within 4 days, apply fatigue
    function detectConferenceTournamentFatigue(
      recentGames: Array<{ gameDate: Date }>,
      currentGameDate: Date
    ): boolean {
      if (recentGames.length < 3) return false;
      // Sort by date descending
      const sorted = recentGames
        .map(g => new Date(g.gameDate))
        .sort((a, b) => b.getTime() - a.getTime());

      // Check if 3 most recent games span <= 4 days
      const thirdMostRecent = sorted[2];
      const mostRecent = sorted[0];
      const spanDays = (mostRecent.getTime() - thirdMostRecent.getTime()) / (1000 * 60 * 60 * 24);
      return spanDays <= 4;
    }

In the rest days signal output, when fatigue is detected, return a result equivalent to B2B:

    if (sport === "NCAAMB" && detectConferenceTournamentFatigue(teamRecentGames, gameDate)) {
      // Apply same penalty as B2B for the fatigued team
      // If home team is fatigued, lean "away"; if away team is fatigued, lean "home"
      // If both fatigued, neutral with note
    }

You'll need to query recent games for each team. Use the existing game fetching pattern already in the codebase.

---

## Task 8: Tournament Round Awareness

**Why:** Lines get sharper in later rounds of the NCAA tournament. Sweet 16+ games have tighter spreads and less market inefficiency, so we need higher confidence thresholds.

**Where:** The NCAAMB spread confidence tier logic (separate from the O/U tiers in Task 4).

**What to do:** Detect tournament round. The simplest approach: if `isNeutralSite === true` and month is March/April, check the date ranges:

    function detectTournamentRound(gameDate: Date, isNeutralSite: boolean): string | null {
      if (!isNeutralSite) return null;
      const month = gameDate.getMonth(); // 0-indexed
      if (month !== 2 && month !== 3) return null; // March or April only

      const day = gameDate.getDate();
      if (month === 2) {
        // March dates (approximate — adjust yearly)
        if (day <= 19) return "first-four";
        if (day <= 21) return "round-of-64";
        if (day <= 23) return "round-of-32";
        if (day <= 28) return "sweet-16";
        if (day <= 30) return "elite-8";
      }
      if (month === 3) {
        // April dates
        if (day <= 5) return "final-four";
        if (day <= 7) return "championship";
      }
      return "tournament"; // Generic tournament game
    }

Alternatively, add a `tournamentRound` field to the game model if you want precision. For now the date-based approach works.

In the NCAAMB **spread** confidence tiers, when the round is "sweet-16" or later:

    const round = detectTournamentRound(new Date(game.gameDate), game.isNeutralSite);
    const isLateRound = round && ["sweet-16", "elite-8", "final-four", "championship"].includes(round);

    // For spread confidence tiers:
    if (isLateRound) {
      // Raise the 3-star gate for late-round games (sharper lines)
      // 3★ requires absEdge >= 11 instead of 9
      if (absEdge >= 13) {
        confidence = 5;
      } else if (absEdge >= 11) {
        confidence = 3;
      } else {
        confidence = 0;
      }
    }

---

## Task 9: FanMatch Total as O/U Cross-Check

**Why:** FanMatch predicts home and away scores. The sum (HomePred + VisitorPred) is an independent total estimate. When it agrees with our Ridge regression direction, we have convergence — boost confidence. When they disagree, reduce.

**Where:** The NCAAMB O/U confidence tier logic (same area as Task 4, around line 2680).

**What to do:** Before the confidence tier assignments, check FanMatch agreement:

    // FanMatch total cross-check
    let fmAdjustment = 1.0; // neutral by default
    if (fanMatchData) {
      const fmTotal = (fanMatchData.HomePred ?? 0) + (fanMatchData.VisitorPred ?? 0);
      const marketTotal = game.overUnder; // the posted O/U line
      if (fmTotal && marketTotal) {
        const fmDir = fmTotal > marketTotal ? "over" : "under";
        if (fmDir === ouDir) {
          fmAdjustment = 1.15; // Agreement — boost
        } else {
          fmAdjustment = 0.85; // Disagreement — reduce
        }
      }
    }

    // Apply FanMatch adjustment to effectiveEdge (after tournament boost from Task 4)
    effectiveEdge = effectiveEdge * fmAdjustment;

Insert this adjustment BEFORE the confidence tier if/else block so `effectiveEdge` reflects both the tournament boost (Task 4) and the FanMatch cross-check.

---

## Task 10: Use FanMatch PredTempo in Ridge Regression

**Why:** The Ridge regression currently uses `(homeAdjTempo + awayAdjTempo) / 2` as a tempo input — that's just season averages. FanMatch's `PredTempo` is a matchup-specific tempo prediction. It accounts for pace-of-play matchup dynamics.

**Where:** The Ridge regression input preparation for NCAAMB O/U. Search for where `adjTempo` values are averaged.

**Current pattern (approximate):**

    const avgTempo = (homeKenpomStats.adjTempo + awayKenpomStats.adjTempo) / 2;

**Replace with:**

    // Prefer FanMatch matchup-specific tempo if available
    const avgTempo = fanMatchData?.PredTempo
      ? fanMatchData.PredTempo
      : (homeKenpomStats.adjTempo + awayKenpomStats.adjTempo) / 2;

Find every place where the tempo average is computed for the Ridge regression input and apply this substitution. There may be multiple locations — check both the feature vector construction and any tempo used in confidence tier logic.

---

## Task 11: Stale Odds Protection

**Why:** When odds haven't been refreshed in >6 hours, the edge we're seeing may be a phantom — the line has already moved. We need to penalize stale odds to avoid false confidence.

**Where:** Early in the pick generation flow, before signal aggregation. The game's odds have a timestamp from when they were fetched.

**What to do:** Add a staleness check:

    // Stale odds detection
    function getOddsStaleness(game: any): { isStale: boolean; hoursOld: number } {
      const oddsTimestamp = game.oddsUpdatedAt ?? game.updatedAt;
      if (!oddsTimestamp) return { isStale: true, hoursOld: Infinity };
      const hoursOld = (Date.now() - new Date(oddsTimestamp).getTime()) / (1000 * 60 * 60);
      return { isStale: hoursOld > 6, hoursOld };
    }

Then, after computing `absEdge` but before confidence tier assignment:

    const staleness = getOddsStaleness(game);
    if (staleness.isStale) {
      absEdge = absEdge * 0.8; // Reduce phantom edges
      // Cap max confidence at 3★
      // Add reasoning note
      reasoning.push(`⚠️ Odds may be stale (${staleness.hoursOld.toFixed(1)}h old)`);
    }

And in the confidence tier logic, after computing confidence:

    if (staleness.isStale && confidence > 3) {
      confidence = 3;
    }

This applies to ALL markets (spread and O/U) for NCAAMB.

---

## Task 12: Closing Line Tracking (CLV)

**Why:** Closing Line Value is the gold standard for measuring if a model is beating the market. We need to capture closing lines to compute CLV later. This is infrastructure — it doesn't change picks.

### Step 12a: Add fields to Prisma schema

**Where:** `prisma/schema.prisma`, the `DailyPick` model.

Add these fields:

    model DailyPick {
      // ... existing fields ...
      closingSpread   Float?   // Final spread at game time
      closingTotal    Float?   // Final O/U total at game time
    }

Run `npx prisma migrate dev --name add-closing-lines` after adding these.

### Step 12b: Capture closing lines during grading

**Where:** The grading function that processes completed games. Search for where `DailyPick` records are updated with results (PENDING → WIN/LOSS).

When grading a pick, look up the final line from the completed game record:

    // During grading, capture closing lines
    const closingSpread = completedGame.spread; // The final spread from the game record
    const closingTotal = completedGame.overUnder; // The final O/U from the game record

    await prisma.dailyPick.update({
      where: { id: pick.id },
      data: {
        result: pickResult,
        closingSpread: closingSpread,
        closingTotal: closingTotal,
        // ... other grading fields
      },
    });

This captures whatever the spread/total was at game time (which is close to the closing line since ESPN updates to final odds).

---

## Verification Checklist

After implementing all 12 tasks, verify:

- [ ] **Weight sums:** NCAAMB spread weights sum to 1.0 (should be: 0.31 + 0.14 + 0.15 + 0.1 + 0.05 + 0.0 + 0.05 + 0.08 + 0.0 + 0.02 + 0.05 + 0.05 = 1.0)
- [ ] **Weight sums:** NCAAMB O/U weights sum to 1.0 (should be: 0.31 + 0.07 + 0.18 + 0.07 + 0.12 + 0.15 + 0.02 + 0.05 + 0.03 = 1.0)
- [ ] **No regression:** Regular season O/U tiers are unchanged (the else branch in Task 4)
- [ ] **HCA zero:** Neutral site games have HCA = 0 in all NCAAMB model edge calculations
- [ ] **New signals wired:** eloOU, seedMismatch both appear in signal aggregation
- [ ] **FanMatch tempo:** Ridge regression uses PredTempo when available, falls back to average
- [ ] **FanMatch total:** Cross-check modifies effectiveEdge before tier assignment
- [ ] **Stale odds:** Games with >6h old odds get 0.8x penalty and 3★ cap
- [ ] **Fatigue detection:** Teams with 3 games in 4 days get B2B-equivalent penalty
- [ ] **Late round gates:** Sweet 16+ spread picks require absEdge >= 11 for 3★
- [ ] **Prisma migration:** closingSpread and closingTotal fields added to DailyPick
- [ ] **Grading updated:** Closing lines captured during pick grading
- [ ] **TypeScript compiles:** `npx tsc --noEmit` passes
- [ ] **No console errors:** Run a dry pick generation for a test game
