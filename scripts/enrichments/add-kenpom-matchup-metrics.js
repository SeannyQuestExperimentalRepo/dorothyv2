/**
 * Add KenPom Matchup Metrics — NCAAMB Enrichment
 *
 * Computes advanced game-level matchup analytics derived from per-team KenPom
 * ratings already present in the staging data. These metrics capture pace/tempo
 * matchups, efficiency edges, predicted totals & margins, upset potential, and
 * game-style classifications that sharp bettors and analytics sites rely on.
 *
 * Input:  data/ncaamb-games-staging.json  (must already have KenPom fields)
 * Output: data/ncaamb-games-staging.json  (same file, enriched in-place)
 *
 * Usage:  node scripts/enrichments/add-kenpom-matchup-metrics.js
 */

const fs = require("fs");
const path = require("path");

// ─── Constants ──────────────────────────────────────────────────────────────

const HOME_COURT_ADVANTAGE = 3.5; // Points added for home court in CBB
const D1_AVG_OE = 100; // D1 average adjusted offensive efficiency
const D1_AVG_DE = 100; // D1 average adjusted defensive efficiency
const D1_AVG_TEMPO = 67.5; // D1 average possessions per 40 minutes

// Tempo thresholds for game style classification
const FAST_PACE_THRESHOLD = 70;
const SLOW_PACE_THRESHOLD = 64;

// Defensive battle threshold (both teams must be below this AdjDE)
const ELITE_DEFENSE_THRESHOLD = 97;

// Pace advantage "even" tolerance
const PACE_EVEN_TOLERANCE = 1.0;

// Baseline total for rough predicted-total fallback
const BASELINE_TOTAL = 140;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Round a number to 1 decimal place, or return null if input is null/NaN */
function round1(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  return Math.round(val * 10) / 10;
}

/** Check whether a game has enough KenPom data to compute matchup metrics */
function hasKenpomData(game) {
  return (
    game.homeAdjOE !== null &&
    game.awayAdjOE !== null &&
    game.homeAdjDE !== null &&
    game.awayAdjDE !== null &&
    game.homeAdjTempo !== null &&
    game.awayAdjTempo !== null
  );
}

/**
 * Compute the AdjEM (efficiency margin) for a team.
 * If the game already has it populated, use that; otherwise derive from OE - DE.
 */
function getAdjEM(game, side) {
  const em = side === "home" ? game.homeAdjEM : game.awayAdjEM;
  if (em !== null && em !== undefined) return em;
  const oe = side === "home" ? game.homeAdjOE : game.awayAdjOE;
  const de = side === "home" ? game.homeAdjDE : game.awayAdjDE;
  if (oe !== null && de !== null) return oe - de;
  return null;
}

// ─── Null-filled defaults for games without KenPom data ─────────────────────

function nullMetrics() {
  return {
    // Pace / Tempo
    expectedPace: null,
    paceMismatch: null,
    paceAdvantage: null,
    // Efficiency
    efficiencyGap: null,
    homeOffVsAwayDef: null,
    awayOffVsHomeDef: null,
    biggestMismatch: null,
    // Predicted total & margin
    kenpomPredTotal: null,
    kenpomPredMargin: null,
    // Upset potential
    isKenpomUpset: false,
    kenpomRankDiff: null,
    upsetMagnitude: null,
    // Game style
    gameStyle: null,
    offensiveFirepower: null,
    defensiveBattle: false,
  };
}

// ─── Core computation ───────────────────────────────────────────────────────

function computeMatchupMetrics(game) {
  if (!hasKenpomData(game)) return nullMetrics();

  const homeEM = getAdjEM(game, "home");
  const awayEM = getAdjEM(game, "away");

  // ── 1. Pace / Tempo Matchup ─────────────────────────────────────────────

  const expectedPace = round1((game.homeAdjTempo + game.awayAdjTempo) / 2);

  const paceMismatch = round1(
    Math.abs(game.homeAdjTempo - game.awayAdjTempo)
  );

  const tempoDiff = game.homeAdjTempo - game.awayAdjTempo;
  let paceAdvantage;
  if (Math.abs(tempoDiff) <= PACE_EVEN_TOLERANCE) {
    paceAdvantage = "EVEN";
  } else {
    paceAdvantage = tempoDiff > 0 ? "HOME" : "AWAY";
  }

  // ── 2. Efficiency Matchup ──────────────────────────────────────────────

  // Positive efficiencyGap means home team is better by KenPom
  const efficiencyGap =
    homeEM !== null && awayEM !== null ? round1(homeEM - awayEM) : null;

  // Home offense vs away defense — positive = mismatch favoring home offense
  const homeOffVsAwayDef = round1(game.homeAdjOE - game.awayAdjDE);

  // Away offense vs home defense — positive = mismatch favoring away offense
  const awayOffVsHomeDef = round1(game.awayAdjOE - game.homeAdjDE);

  let biggestMismatch;
  if (homeOffVsAwayDef === null || awayOffVsHomeDef === null) {
    biggestMismatch = null;
  } else if (Math.abs(homeOffVsAwayDef - awayOffVsHomeDef) < 1.0) {
    biggestMismatch = "EVEN";
  } else {
    biggestMismatch =
      homeOffVsAwayDef > awayOffVsHomeDef ? "HOME_OFFENSE" : "AWAY_OFFENSE";
  }

  // ── 3. Predicted Total & Margin ────────────────────────────────────────

  let kenpomPredTotal;
  if (game.fmHomePred !== null && game.fmAwayPred !== null) {
    // Best source: FanMatch predicted scores
    kenpomPredTotal = round1(game.fmHomePred + game.fmAwayPred);
  } else if (homeOffVsAwayDef !== null && awayOffVsHomeDef !== null) {
    // Fallback: rough estimate from efficiency edges and pace
    kenpomPredTotal = round1(
      ((homeOffVsAwayDef + awayOffVsHomeDef) * expectedPace) / 200 +
        BASELINE_TOTAL
    );
  } else {
    kenpomPredTotal = null;
  }

  // Predicted margin from KenPom efficiencies + home court advantage
  let kenpomPredMargin = null;
  if (homeEM !== null && awayEM !== null) {
    const hca = game.isNeutralSite ? 0 : HOME_COURT_ADVANTAGE;
    kenpomPredMargin = round1(homeEM - awayEM + hca);
  }

  // ── 4. Upset Potential ─────────────────────────────────────────────────

  // Determine which team KenPom favored (by AdjEM)
  let isKenpomUpset = false;
  let upsetMagnitude = null;

  if (homeEM !== null && awayEM !== null) {
    const kenpomFavoredHome = homeEM > awayEM;
    const homeWon = game.homeScore > game.awayScore;

    // Upset = the KenPom-favored team lost
    if (kenpomFavoredHome && !homeWon) {
      isKenpomUpset = true;
      upsetMagnitude = round1(Math.abs(homeEM - awayEM));
    } else if (!kenpomFavoredHome && homeWon) {
      isKenpomUpset = true;
      upsetMagnitude = round1(Math.abs(homeEM - awayEM));
    }
    // If AdjEM is equal and either team wins, not counted as upset
  }

  // Rank difference: negative means home is higher-ranked (better)
  const kenpomRankDiff =
    game.homeKenpomRank !== null && game.awayKenpomRank !== null
      ? game.homeKenpomRank - game.awayKenpomRank
      : null;

  // ── 5. Game Style Classification ───────────────────────────────────────

  let gameStyle;
  if (expectedPace > FAST_PACE_THRESHOLD) {
    gameStyle = "FAST_PACED";
  } else if (expectedPace < SLOW_PACE_THRESHOLD) {
    gameStyle = "SLOW_GRIND";
  } else {
    gameStyle = "MODERATE";
  }

  const offensiveFirepower = round1((game.homeAdjOE + game.awayAdjOE) / 2);

  const defensiveBattle =
    game.homeAdjDE < ELITE_DEFENSE_THRESHOLD &&
    game.awayAdjDE < ELITE_DEFENSE_THRESHOLD;

  return {
    expectedPace,
    paceMismatch,
    paceAdvantage,
    efficiencyGap,
    homeOffVsAwayDef,
    awayOffVsHomeDef,
    biggestMismatch,
    kenpomPredTotal,
    kenpomPredMargin,
    isKenpomUpset,
    kenpomRankDiff,
    upsetMagnitude,
    gameStyle,
    offensiveFirepower,
    defensiveBattle,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const dataPath = path.join(
    __dirname,
    "../../data/ncaamb-games-staging.json"
  );

  if (!fs.existsSync(dataPath)) {
    console.error(
      "ERROR: No staging data found at",
      dataPath,
      "\nRun normalize-ncaamb.js first."
    );
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${data.length.toLocaleString()} NCAAMB games\n`);

  // ── Enrich each game ────────────────────────────────────────────────────

  let enrichedCount = 0;
  let skippedCount = 0;

  for (const game of data) {
    const metrics = computeMatchupMetrics(game);
    Object.assign(game, metrics);

    if (hasKenpomData(game)) {
      enrichedCount++;
    } else {
      skippedCount++;
    }
  }

  // ── Save back to file ──────────────────────────────────────────────────

  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`Saved enriched data back to ${dataPath}\n`);

  // ── Summary Statistics ─────────────────────────────────────────────────

  console.log("=== KENPOM MATCHUP METRICS SUMMARY ===\n");
  console.log(
    `Games with KenPom matchup metrics: ${enrichedCount.toLocaleString()}`
  );
  console.log(
    `Games skipped (no KenPom data):    ${skippedCount.toLocaleString()}`
  );

  // Only compute stats on enriched games
  const enriched = data.filter((g) => hasKenpomData(g));

  if (enriched.length === 0) {
    console.log("\nNo enriched games to summarize.");
    return;
  }

  // Average expected pace
  const paces = enriched.map((g) => g.expectedPace).filter((v) => v !== null);
  const avgPace = paces.reduce((a, b) => a + b, 0) / paces.length;
  console.log(`\nAverage expected pace:    ${avgPace.toFixed(1)}`);

  // Average efficiency gap (absolute value for magnitude)
  const gaps = enriched
    .map((g) => g.efficiencyGap)
    .filter((v) => v !== null);
  const avgGap =
    gaps.reduce((a, b) => a + Math.abs(b), 0) / gaps.length;
  console.log(`Average efficiency gap:  ${avgGap.toFixed(1)} (absolute)`);

  // ── Game Style Distribution ────────────────────────────────────────────

  const fastPaced = enriched.filter(
    (g) => g.gameStyle === "FAST_PACED"
  ).length;
  const slowGrind = enriched.filter(
    (g) => g.gameStyle === "SLOW_GRIND"
  ).length;
  const moderate = enriched.filter(
    (g) => g.gameStyle === "MODERATE"
  ).length;

  console.log("\n--- Game Style Distribution ---");
  console.log(
    `  FAST_PACED (pace > ${FAST_PACE_THRESHOLD}): ${fastPaced.toLocaleString()} (${((fastPaced / enriched.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  MODERATE:                  ${moderate.toLocaleString()} (${((moderate / enriched.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `  SLOW_GRIND (pace < ${SLOW_PACE_THRESHOLD}): ${slowGrind.toLocaleString()} (${((slowGrind / enriched.length) * 100).toFixed(1)}%)`
  );

  // ── KenPom Upsets ──────────────────────────────────────────────────────

  const upsets = enriched.filter((g) => g.isKenpomUpset);
  const upsetMagnitudes = upsets
    .map((g) => g.upsetMagnitude)
    .filter((v) => v !== null);
  const avgUpsetMag =
    upsetMagnitudes.length > 0
      ? upsetMagnitudes.reduce((a, b) => a + b, 0) / upsetMagnitudes.length
      : 0;

  console.log("\n--- Upset Potential ---");
  console.log(
    `  KenPom upsets:           ${upsets.length.toLocaleString()} (${((upsets.length / enriched.length) * 100).toFixed(1)}%)`
  );
  console.log(`  Average upset magnitude: ${avgUpsetMag.toFixed(1)}`);

  // ── Defensive Battles ─────────────────────────────────────────────────

  const defBattles = enriched.filter((g) => g.defensiveBattle).length;
  console.log(
    `\nDefensive battles (both AdjDE < ${ELITE_DEFENSE_THRESHOLD}): ${defBattles.toLocaleString()} (${((defBattles / enriched.length) * 100).toFixed(1)}%)`
  );

  // ── Efficiency Gap Distribution ───────────────────────────────────────

  const buckets = { "0-5": 0, "5-10": 0, "10-15": 0, "15-20": 0, "20+": 0 };
  for (const g of enriched) {
    if (g.efficiencyGap === null) continue;
    const absGap = Math.abs(g.efficiencyGap);
    if (absGap < 5) buckets["0-5"]++;
    else if (absGap < 10) buckets["5-10"]++;
    else if (absGap < 15) buckets["10-15"]++;
    else if (absGap < 20) buckets["15-20"]++;
    else buckets["20+"]++;
  }

  console.log("\n--- Efficiency Gap Distribution ---");
  for (const [bucket, count] of Object.entries(buckets)) {
    const pct = ((count / gaps.length) * 100).toFixed(1);
    const bar = "#".repeat(Math.round(count / gaps.length * 50));
    console.log(`  ${bucket.padEnd(6)}: ${count.toLocaleString().padStart(7)} (${pct}%) ${bar}`);
  }

  console.log("\n=== ENRICHMENT COMPLETE ===");
}

main();
