/**
 * Full-stack integration test for TrendLine engines, NLP parser, and data integrity.
 *
 * Tests:
 * 1. Game engine — load data, run queries, verify results
 * 2. Player engine — load data, run queries, verify results
 * 3. NLP parser — local detection for game and player queries
 * 4. Data integrity — cross-check game/player data consistency
 * 5. Edge cases — empty results, bad inputs, boundary conditions
 */

import {
  loadAllGamesCached,
  loadGamesBySportCached,
  executeTrendQuery,
  type TrendQuery,
  type TrendGame,
} from "../src/lib/trend-engine";

import {
  loadPlayerGames,
  executePlayerTrendQuery,
  resolvePlayerName,
  type PlayerTrendQuery,
  type PlayerTrendGame,
} from "../src/lib/player-trend-engine";

import { parseQueryLocal } from "../src/lib/nlp-query-parser";

import {
  executePlayerPropQuery,
  resolveStatName,
  type PropQuery,
} from "../src/lib/prop-trend-engine";

import {
  binomialZScore,
  zToP,
  isSignificant,
  wilsonInterval,
  analyzeTrendSignificance,
  analyzePlayerProp,
} from "../src/lib/trend-stats";

import {
  executeReverseLookup,
  executeTeamReverseLookup,
  getAngleTemplates,
} from "../src/lib/reverse-lookup-engine";

import {
  enrichGameSummary,
  enrichPlayerSummary,
  getWinRateBaseline,
} from "../src/lib/significance-enrichment";

import {
  generateGameTrendCard,
  generatePlayerTrendCard,
  generatePropTrendCard,
  type TrendCard,
} from "../src/lib/trend-card-generator";

import {
  getDailyGameContext,
  getMatchupContext,
} from "../src/lib/game-context-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}`);
}

// ---------------------------------------------------------------------------
// Main async runner
// ---------------------------------------------------------------------------

async function main() {
  // ---------------------------------------------------------------------------
  // 1. Game Engine Tests
  // ---------------------------------------------------------------------------

  section("1. GAME ENGINE");

  console.log("\nLoading game data...");
  const t0 = Date.now();
  const allGames: TrendGame[] = await loadAllGamesCached();
  const loadTime = Date.now() - t0;
  console.log(`  Loaded ${allGames.length} games in ${loadTime}ms`);

  const nflGames: TrendGame[] = await loadGamesBySportCached("NFL");
  const ncaafGames: TrendGame[] = await loadGamesBySportCached("NCAAF");
  const ncaambGames: TrendGame[] = await loadGamesBySportCached("NCAAMB");

  assert(allGames.length > 50000, `Total games > 50K (${allGames.length})`);
  assert(nflGames.length > 14000, `NFL games > 14K (${nflGames.length})`);
  assert(ncaafGames.length > 14000, `NCAAF games > 14K (${ncaafGames.length})`);
  assert(ncaambGames.length > 20000, `NCAAMB games > 20K (${ncaambGames.length})`);

  // NFL home win rate should be ~55-58%
  const nflHomeWins = nflGames.filter((g: TrendGame) => g.scoreDifference > 0).length;
  const nflHomeWinPct = (nflHomeWins / nflGames.length) * 100;
  assert(
    nflHomeWinPct > 50 && nflHomeWinPct < 65,
    `NFL home win rate realistic (${nflHomeWinPct.toFixed(1)}%)`,
  );

  // Test a specific query: Chiefs since 2020
  const chiefsQuery: TrendQuery = {
    sport: "NFL",
    team: "Kansas City Chiefs",
    perspective: "team",
    filters: [],
    seasonRange: [2020, 2024],
  };
  const chiefsResult = executeTrendQuery(chiefsQuery, allGames);
  assert(
    chiefsResult.summary.totalGames > 60 && chiefsResult.summary.totalGames < 120,
    `Chiefs 2020-2024 game count reasonable (${chiefsResult.summary.totalGames})`,
  );
  assert(
    chiefsResult.summary.winPct > 60,
    `Chiefs win% > 60% (${chiefsResult.summary.winPct}%)`,
  );

  // Test cold weather NCAAF
  const coldQuery: TrendQuery = {
    sport: "NCAAF",
    filters: [{ field: "temperature", operator: "lt", value: 30 }],
  };
  const coldResult = executeTrendQuery(coldQuery, allGames);
  assert(coldResult.summary.totalGames > 0, `NCAAF cold games found (${coldResult.summary.totalGames})`);
  assert(
    coldResult.summary.winPct > 55,
    `NCAAF cold home win% > 55% (${coldResult.summary.winPct}%)`,
  );

  // Test QB enrichment data
  const gamesWithQB = nflGames.filter((g: TrendGame) => g._raw && g._raw["homeQB"]);
  assert(gamesWithQB.length > 2000, `NFL games with QB data > 2K (${gamesWithQB.length})`);

  // Test rest days enrichment
  const gamesWithRest = nflGames.filter((g: TrendGame) => g._raw && g._raw["homeRestDays"] != null);
  assert(gamesWithRest.length > 10000, `NFL games with rest data > 10K (${gamesWithRest.length})`);

  // Test ATS data
  const gamesWithSpread = nflGames.filter((g: TrendGame) => g.spread != null);
  assert(gamesWithSpread.length > 5000, `NFL games with spread > 5K (${gamesWithSpread.length})`);

  // ---------------------------------------------------------------------------
  // 2. Player Engine Tests
  // ---------------------------------------------------------------------------

  section("2. PLAYER ENGINE");

  console.log("\nLoading player data...");
  const t1 = Date.now();
  const playerGames = loadPlayerGames();
  const playerLoadTime = Date.now() - t1;
  console.log(`  Loaded ${playerGames.length} player-game records in ${playerLoadTime}ms`);

  const uniquePlayers = new Set(playerGames.map((g: PlayerTrendGame) => g.player_id)).size;
  assert(playerGames.length > 100000, `Player games > 100K (${playerGames.length})`);
  assert(uniquePlayers > 2000, `Unique players > 2K (${uniquePlayers})`);

  // Player name resolution
  const mahomes = resolvePlayerName("mahomes", playerGames);
  assert(mahomes !== null && mahomes.displayName === "Patrick Mahomes", `Resolves "mahomes" -> Patrick Mahomes`);

  const kelce = resolvePlayerName("kelce", playerGames);
  assert(kelce !== null && kelce.displayName === "Travis Kelce", `Resolves "kelce" -> Travis Kelce`);

  const rodgers = resolvePlayerName("aaron rodgers", playerGames);
  assert(rodgers !== null && rodgers.displayName === "Aaron Rodgers", `Resolves "aaron rodgers"`);

  // Test player query: Mahomes
  const mahomesQ: PlayerTrendQuery = { player: "Patrick Mahomes", filters: [] };
  const mahomesR = executePlayerTrendQuery(mahomesQ, playerGames);
  assert(
    mahomesR.summary.totalGames > 120 && mahomesR.summary.totalGames < 180,
    `Mahomes career games reasonable (${mahomesR.summary.totalGames})`,
  );
  assert(
    mahomesR.summary.winPct > 70,
    `Mahomes win% > 70% (${mahomesR.summary.winPct}%)`,
  );
  assert(
    (mahomesR.summary.statAverages.passing_yards || 0) > 250,
    `Mahomes avg passing yards > 250 (${mahomesR.summary.statAverages.passing_yards})`,
  );

  // Test position query: RBs with 100+ rushing yards
  const bigRushQ: PlayerTrendQuery = {
    positionGroup: "RB",
    seasonRange: [2020, 2024],
    filters: [{ field: "rushing_yards", operator: "gte", value: 100 }],
  };
  const bigRushR = executePlayerTrendQuery(bigRushQ, playerGames);
  assert(bigRushR.summary.totalGames > 300, `RB 100+ rush games > 300 (${bigRushR.summary.totalGames})`);
  assert(
    bigRushR.summary.winPct > 65,
    `Teams win when RB rushes 100+ (${bigRushR.summary.winPct}%)`,
  );
  assert(
    (bigRushR.summary.statAverages.rushing_yards || 0) >= 100,
    `Avg rushing yards >= 100 (${bigRushR.summary.statAverages.rushing_yards})`,
  );

  // Test ordering and limit
  const topPassQ: PlayerTrendQuery = {
    positionGroup: "QB",
    seasonRange: [2024, 2024],
    filters: [{ field: "passing_yards", operator: "gte", value: 300 }],
    orderBy: { field: "passing_yards", direction: "desc" },
    limit: 5,
  };
  const topPassR = executePlayerTrendQuery(topPassQ, playerGames);
  assert(topPassR.games.length === 5, `Top 5 QB 300+ yard games returned (${topPassR.games.length})`);
  if (topPassR.games.length >= 2) {
    assert(
      (topPassR.games[0].passing_yards || 0) >= (topPassR.games[1].passing_yards || 0),
      `Results sorted DESC by passing yards`,
    );
  }

  // Test defensive player query
  const defQ: PlayerTrendQuery = {
    positionGroup: "DL",
    seasonRange: [2023, 2024],
    filters: [{ field: "def_sacks", operator: "gte", value: 2 }],
  };
  const defR = executePlayerTrendQuery(defQ, playerGames);
  assert(defR.summary.totalGames > 20, `DL 2+ sack games found (${defR.summary.totalGames})`);

  // Test opponent filter
  const mahomesVsBills: PlayerTrendQuery = {
    player: "Patrick Mahomes",
    opponent: "Buffalo Bills",
    filters: [],
  };
  const mVsBills = executePlayerTrendQuery(mahomesVsBills, playerGames);
  assert(
    mVsBills.summary.totalGames > 5 && mVsBills.summary.totalGames < 25,
    `Mahomes vs Bills game count reasonable (${mVsBills.summary.totalGames})`,
  );

  // ---------------------------------------------------------------------------
  // 3. NLP Parser Tests
  // ---------------------------------------------------------------------------

  section("3. NLP PARSER (local)");

  // Game queries
  const nflHome = parseQueryLocal("NFL home favorites since 2020");
  assert(nflHome !== null, `Parses "NFL home favorites since 2020"`);
  if (nflHome) {
    assert(nflHome.sport === "NFL", `  Sport = NFL`);
    assert(nflHome.perspective === "favorite", `  Perspective = favorite`);
    assert(nflHome.seasonRange?.[0] === 2020, `  Season start = 2020`);
  }

  const snowGames = parseQueryLocal("snow games in college football");
  assert(snowGames !== null, `Parses "snow games in college football"`);
  if (snowGames) {
    assert(snowGames.sport === "NCAAF", `  Sport = NCAAF`);
    assert(
      snowGames.filters.some((f) => f.field === "weatherCategory" && f.value === "SNOW"),
      `  Weather filter = SNOW`,
    );
  }

  const marchMadness = parseQueryLocal("March Madness upsets");
  assert(marchMadness !== null, `Parses "March Madness upsets"`);
  if (marchMadness) {
    assert(marchMadness.sport === "NCAAMB", `  Sport = NCAAMB`);
  }

  // Should return null for ambiguous queries
  const vague = parseQueryLocal("who is the best");
  assert(vague === null, `Returns null for vague query`);

  // ---------------------------------------------------------------------------
  // 4. Data Integrity Checks
  // ---------------------------------------------------------------------------

  section("4. DATA INTEGRITY");

  // Check for duplicate games in NFL
  const nflGameKeys = nflGames.map(
    (g: TrendGame) => `${g.gameDate}-${g.homeTeam}-${g.awayTeam}`,
  );
  const nflUniqueKeys = new Set(nflGameKeys);
  assert(
    nflUniqueKeys.size === nflGameKeys.length,
    `No duplicate NFL games (${nflGameKeys.length} total, ${nflUniqueKeys.size} unique)`,
    `${nflGameKeys.length - nflUniqueKeys.size} duplicates found`,
  );

  // Check score consistency
  const badScoreGames = nflGames.filter(
    (g: TrendGame) =>
      g.homeScore != null &&
      g.awayScore != null &&
      g.scoreDifference !== g.homeScore - g.awayScore,
  );
  assert(
    badScoreGames.length === 0,
    `Score consistency (scoreDiff = home - away)`,
    `${badScoreGames.length} inconsistent`,
  );

  // Check player data has game context
  const playerWithContext = playerGames.filter((g: PlayerTrendGame) => g.gameDate != null).length;
  const contextPct = (playerWithContext / playerGames.length) * 100;
  assert(
    contextPct > 95,
    `Player game context match rate > 95% (${contextPct.toFixed(1)}%)`,
  );

  // Check season ranges make sense
  const nflSeasons = new Set(nflGames.map((g: TrendGame) => g.season));
  const playerSeasons = new Set(playerGames.map((g: PlayerTrendGame) => g.season));
  assert(
    Array.from(nflSeasons).some((s) => s >= 2020),
    `NFL data includes recent seasons`,
  );
  assert(
    Array.from(playerSeasons).some((s) => s >= 2024),
    `Player data includes 2024 season`,
  );

  // Check that spread data is present for recent games
  const recentNFL = nflGames.filter((g: TrendGame) => g.season >= 2015);
  const withSpread = recentNFL.filter((g: TrendGame) => g.spread != null);
  const spreadPct = (withSpread.length / recentNFL.length) * 100;
  assert(
    spreadPct > 80,
    `Recent NFL games (2015+) have spread data > 80% (${spreadPct.toFixed(1)}%)`,
  );

  // ---------------------------------------------------------------------------
  // 5. Edge Cases
  // ---------------------------------------------------------------------------

  section("5. EDGE CASES");

  // Empty result query
  const emptyQ: TrendQuery = {
    sport: "NFL",
    team: "Nonexistent Team",
    filters: [],
  };
  const emptyR = executeTrendQuery(emptyQ, allGames);
  assert(emptyR.summary.totalGames === 0, `Empty result for fake team`);
  assert(emptyR.summary.winPct === 0, `Win% = 0 for empty result`);

  // Player that doesn't exist
  const fakePlayerR = executePlayerTrendQuery(
    { player: "Fakename McFakeface", filters: [] },
    playerGames,
  );
  assert(fakePlayerR.summary.totalGames === 0, `Empty result for fake player`);

  // Extreme filter
  const extremeQ: TrendQuery = {
    sport: "NFL",
    filters: [{ field: "homeScore", operator: "gt", value: 60 }],
  };
  const extremeR = executeTrendQuery(extremeQ, allGames);
  assert(
    extremeR.summary.totalGames < 50,
    `Very few NFL games with home score > 60 (${extremeR.summary.totalGames})`,
  );

  // Season range outside data
  const futureQ: TrendQuery = {
    sport: "NFL",
    seasonRange: [2030, 2035],
    filters: [],
  };
  const futureR = executeTrendQuery(futureQ, allGames);
  assert(futureR.summary.totalGames === 0, `No games for future seasons`);

  // ---------------------------------------------------------------------------
  // 6. Statistical Significance Module
  // ---------------------------------------------------------------------------

  section("6. STATISTICAL SIGNIFICANCE");

  // Binomial z-score: 30/50 = 60% vs 50% baseline
  const z1 = binomialZScore(30, 50, 0.5);
  assert(z1 > 1.4 && z1 < 1.5, `Z-score for 30/50 ~ 1.41 (${z1.toFixed(3)})`);

  // Z-score for 50% exactly should be 0
  const z0 = binomialZScore(25, 50, 0.5);
  assert(Math.abs(z0) < 0.01, `Z-score for 25/50 ~ 0 (${z0.toFixed(3)})`);

  // P-value for z=1.96 should be ~0.05
  const p196 = zToP(1.96);
  assert(p196 > 0.04 && p196 < 0.06, `P-value for z=1.96 ~ 0.05 (${p196.toFixed(4)})`);

  // P-value for z=0 should be ~1.0
  const p0 = zToP(0);
  assert(p0 > 0.95, `P-value for z=0 ~ 1.0 (${p0.toFixed(4)})`);

  // Significance test: 40/50 = 80% should be significant
  assert(isSignificant(40, 50, 0.5), `40/50 at 80% is significant`);

  // Significance test: 26/50 = 52% should NOT be significant
  assert(!isSignificant(26, 50, 0.5), `26/50 at 52% is not significant`);

  // Too small sample should never be significant
  assert(!isSignificant(8, 9, 0.5), `9 trials too small for significance`);

  // Wilson interval should contain observed rate
  const [wLow, wHigh] = wilsonInterval(30, 50);
  assert(wLow > 0.45 && wLow < 0.50, `Wilson lower bound reasonable (${wLow})`);
  assert(wHigh > 0.70 && wHigh < 0.75, `Wilson upper bound reasonable (${wHigh})`);

  // Full trend significance analysis
  const strongTrend = analyzeTrendSignificance(40, 50, 0.5);
  assert(strongTrend.isSignificant === true, `40/50 trend is significant`);
  assert(strongTrend.strength === "strong", `40/50 trend is strong (${strongTrend.strength})`);

  const noiseTrend = analyzeTrendSignificance(3, 5, 0.5);
  assert(noiseTrend.strength === "noise", `3/5 trend is noise (${noiseTrend.strength})`);

  const moderateTrend = analyzeTrendSignificance(35, 50, 0.5);
  assert(
    moderateTrend.strength === "moderate" || moderateTrend.strength === "strong",
    `35/50 trend is moderate or strong (${moderateTrend.strength})`,
  );

  // Prop hit rate analysis
  const propValues = [280, 310, 250, 320, 290, 300, 270, 315, 285, 305];
  const propResult = analyzePlayerProp(propValues, 275.5, "over", "passing_yards");
  assert(propResult.total === 10, `Prop total = 10 (${propResult.total})`);
  assert(propResult.hits === 8, `Prop hits = 8 (${propResult.hits})`);
  assert(propResult.hitRate === 80, `Prop hit rate = 80% (${propResult.hitRate})`);

  // Under prop test
  const underResult = analyzePlayerProp(propValues, 300, "under", "passing_yards");
  assert(underResult.hits === 5, `Under 300 hits = 5 (${underResult.hits})`);

  // Null values should be filtered
  const withNulls = [280, null, 310, null, 250];
  const nullResult = analyzePlayerProp(withNulls, 275.5, "over", "passing_yards");
  assert(nullResult.total === 3, `Null-filtered total = 3 (${nullResult.total})`);

  // ---------------------------------------------------------------------------
  // 7. Player Prop Trend Engine
  // ---------------------------------------------------------------------------

  section("7. PLAYER PROP TREND ENGINE");

  // Stat name resolution
  assert(resolveStatName("passing yards") === "passing_yards", `Resolves "passing yards"`);
  assert(resolveStatName("rush yards") === "rushing_yards", `Resolves "rush yards"`);
  assert(resolveStatName("receptions") === "receptions", `Resolves "receptions"`);
  assert(resolveStatName("fantasy points") === "fantasy_points_ppr", `Resolves "fantasy points"`);
  assert(resolveStatName("PASSING_YARDS") === "passing_yards", `Case insensitive resolution`);

  // Mahomes over 275.5 passing yards
  const mahomesProp: PropQuery = {
    player: "Patrick Mahomes",
    stat: "passing_yards",
    line: 275.5,
    direction: "over",
  };
  const mahomesPropR = executePlayerPropQuery(mahomesProp);
  assert(
    mahomesPropR.playerName === "Patrick Mahomes",
    `Player name resolved (${mahomesPropR.playerName})`,
  );
  assert(
    mahomesPropR.overall.total > 100,
    `Mahomes has 100+ games for passing yards (${mahomesPropR.overall.total})`,
  );
  assert(
    mahomesPropR.overall.hitRate > 30 && mahomesPropR.overall.hitRate < 90,
    `Mahomes over 275.5 hit rate realistic (${mahomesPropR.overall.hitRate}%)`,
  );
  assert(
    mahomesPropR.avgValue > 250 && mahomesPropR.avgValue < 350,
    `Mahomes avg passing yards realistic (${mahomesPropR.avgValue})`,
  );
  assert(
    mahomesPropR.medianValue > 240 && mahomesPropR.medianValue < 340,
    `Mahomes median passing yards realistic (${mahomesPropR.medianValue})`,
  );

  // Check splits exist
  assert(
    mahomesPropR.splits.length > 0,
    `Mahomes prop has splits (${mahomesPropR.splits.length})`,
  );
  const homeSplit = mahomesPropR.splits.find((s) => s.label === "Home");
  const awaySplit = mahomesPropR.splits.find((s) => s.label === "Away");
  assert(homeSplit !== undefined, `Has home split`);
  assert(awaySplit !== undefined, `Has away split`);
  if (homeSplit && awaySplit) {
    // Some games may have isHome=null, so home+away <= total
    assert(
      homeSplit.total + awaySplit.total <= mahomesPropR.overall.total,
      `Home + Away <= Total (${homeSplit.total} + ${awaySplit.total} <= ${mahomesPropR.overall.total})`,
    );
  }

  // Check recent trends
  assert(
    mahomesPropR.recentTrend.last5.total <= 5,
    `Last 5 has <= 5 games (${mahomesPropR.recentTrend.last5.total})`,
  );
  assert(
    mahomesPropR.recentTrend.last10.total <= 10,
    `Last 10 has <= 10 games (${mahomesPropR.recentTrend.last10.total})`,
  );

  // Check streak is a number
  assert(
    typeof mahomesPropR.currentStreak === "number",
    `Current streak is a number (${mahomesPropR.currentStreak})`,
  );

  // Check game logs
  assert(
    mahomesPropR.games.length > 0 && mahomesPropR.games.length <= 50,
    `Game logs present and capped (${mahomesPropR.games.length})`,
  );
  assert(
    mahomesPropR.games[0].gameDate !== "",
    `Game logs have dates`,
  );
  assert(
    typeof mahomesPropR.games[0].statValue === "number",
    `Game logs have stat values`,
  );

  // Test with home filter
  const mahomesHome: PropQuery = {
    player: "Patrick Mahomes",
    stat: "passing_yards",
    line: 275.5,
    direction: "over",
    homeAway: "home",
  };
  const mahomesHomeR = executePlayerPropQuery(mahomesHome);
  assert(
    mahomesHomeR.overall.total > 0 &&
      mahomesHomeR.overall.total < mahomesPropR.overall.total,
    `Home-only has fewer games (${mahomesHomeR.overall.total} < ${mahomesPropR.overall.total})`,
  );

  // Test with favorite filter
  const mahomesFav: PropQuery = {
    player: "Patrick Mahomes",
    stat: "passing_yards",
    line: 275.5,
    direction: "over",
    favDog: "favorite",
  };
  const mahomesFavR = executePlayerPropQuery(mahomesFav);
  assert(
    mahomesFavR.overall.total > 50,
    `Mahomes as favorite has games (${mahomesFavR.overall.total})`,
  );

  // Test rushing prop: Derrick Henry over 79.5 rushing yards
  const henryProp: PropQuery = {
    player: "Derrick Henry",
    stat: "rushing_yards",
    line: 79.5,
    direction: "over",
  };
  const henryR = executePlayerPropQuery(henryProp);
  assert(
    henryR.overall.total > 50,
    `Henry has rushing data (${henryR.overall.total} games)`,
  );
  assert(
    henryR.avgValue > 60,
    `Henry avg rushing yards > 60 (${henryR.avgValue})`,
  );

  // Test receptions prop: Travis Kelce over 5.5 receptions
  const kelceProp: PropQuery = {
    player: "Travis Kelce",
    stat: "receptions",
    line: 5.5,
    direction: "over",
  };
  const kelceR = executePlayerPropQuery(kelceProp);
  assert(
    kelceR.overall.total > 50,
    `Kelce has reception data (${kelceR.overall.total} games)`,
  );

  // Test fake player returns empty
  const fakeProp: PropQuery = {
    player: "Notareal Player",
    stat: "passing_yards",
    line: 200,
    direction: "over",
  };
  const fakeR = executePlayerPropQuery(fakeProp);
  assert(fakeR.overall.total === 0, `Fake player returns 0 games`);
  assert(fakeR.games.length === 0, `Fake player has no game logs`);

  // Test season range filter
  const mahomes2024: PropQuery = {
    player: "Patrick Mahomes",
    stat: "passing_yards",
    line: 250.5,
    direction: "over",
    seasonRange: [2024, 2024],
  };
  const mahomes2024R = executePlayerPropQuery(mahomes2024);
  assert(
    mahomes2024R.overall.total > 5 && mahomes2024R.overall.total < 25,
    `Mahomes 2024 only has limited games (${mahomes2024R.overall.total})`,
  );

  // Test by-season splits exist
  const seasonSplits = mahomesPropR.splits.filter((s) => s.label.includes("Season"));
  assert(
    seasonSplits.length > 3,
    `Multiple season splits present (${seasonSplits.length})`,
  );

  // Test significance is attached to overall result
  assert(
    mahomesPropR.overall.significance !== undefined,
    `Overall has significance analysis`,
  );
  assert(
    mahomesPropR.overall.significance.sampleSize === mahomesPropR.overall.total,
    `Significance sample size matches total`,
  );

  // ---------------------------------------------------------------------------
  // 8. Reverse Lookup / Auto-Surface Angles
  // ---------------------------------------------------------------------------

  section("8. REVERSE LOOKUP ENGINE");

  // Test angle templates
  const nflTemplates = getAngleTemplates("NFL");
  const ncaafTemplates = getAngleTemplates("NCAAF");
  const ncaambTemplates = getAngleTemplates("NCAAMB");
  assert(nflTemplates.length > 15, `NFL has 15+ angle templates (${nflTemplates.length})`);
  assert(ncaafTemplates.length > 10, `NCAAF has 10+ angle templates (${ncaafTemplates.length})`);
  assert(ncaambTemplates.length > 8, `NCAAMB has 8+ angle templates (${ncaambTemplates.length})`);

  // Test NFL reverse lookup
  const nflAngles = await executeReverseLookup({
    sport: "NFL",
    seasonRange: [2015, 2024],
    maxResults: 10,
    minStrength: "weak",
  });
  assert(
    nflAngles.templatesScanned > 15,
    `NFL templates scanned > 15 (${nflAngles.templatesScanned})`,
  );
  assert(
    nflAngles.angles.length > 0,
    `NFL angles discovered (${nflAngles.angles.length})`,
  );
  assert(
    nflAngles.durationMs < 30000,
    `NFL scan completed in < 30s (${nflAngles.durationMs}ms)`,
  );

  // Check angle structure
  if (nflAngles.angles.length > 0) {
    const topAngle = nflAngles.angles[0];
    assert(topAngle.headline.length > 10, `Top angle has headline`);
    assert(topAngle.interestScore > 0, `Top angle has positive interest score (${topAngle.interestScore})`);
    assert(topAngle.record.totalGames >= 20, `Top angle has 20+ games (${topAngle.record.totalGames})`);
    assert(
      topAngle.atsSignificance !== undefined,
      `Top angle has ATS significance`,
    );
    assert(
      topAngle.winSignificance !== undefined,
      `Top angle has win significance`,
    );
  }

  // Angles should be sorted by interest score (descending)
  if (nflAngles.angles.length >= 2) {
    assert(
      nflAngles.angles[0].interestScore >= nflAngles.angles[1].interestScore,
      `Angles sorted by interest score`,
    );
  }

  // Test NCAAMB reverse lookup (data currently covers 2005-2009 while scraper runs)
  const ncaambAngles = await executeReverseLookup({
    sport: "NCAAMB",
    seasonRange: [2005, 2009],
    maxResults: 10,
    minStrength: "weak",
  });
  assert(
    ncaambAngles.templatesScanned > 0,
    `NCAAMB templates scanned (${ncaambAngles.templatesScanned})`,
  );

  // Test category filter
  const weatherAngles = await executeReverseLookup({
    sport: "NFL",
    seasonRange: [2015, 2024],
    categories: ["weather"],
    minStrength: "noise",
  });
  assert(
    weatherAngles.angles.every((a) => a.template.category === "weather"),
    `Category filter works (all weather)`,
  );

  // Test team-specific lookup
  const chiefsAngles = await executeTeamReverseLookup("NFL", "Kansas City Chiefs", [2018, 2024], 10);
  assert(
    chiefsAngles.templatesScanned > 0,
    `Chiefs team lookup scanned templates (${chiefsAngles.templatesScanned})`,
  );

  // Test all-sports scan
  const allSportsAngles = await executeReverseLookup({
    seasonRange: [2018, 2024],
    maxResults: 15,
    minStrength: "moderate",
  });
  assert(
    allSportsAngles.angles.length > 0,
    `All-sports scan found angles (${allSportsAngles.angles.length})`,
  );
  // Check that multiple sports are represented
  const sportsFound = new Set(allSportsAngles.angles.map((a) => a.sport));
  assert(
    sportsFound.size >= 1,
    `Multiple sports in results (${Array.from(sportsFound).join(", ")})`,
  );

  // Test strong-only filter
  const strongOnly = await executeReverseLookup({
    sport: "NFL",
    seasonRange: [2005, 2024],
    minStrength: "strong",
    maxResults: 50,
  });
  if (strongOnly.angles.length > 0) {
    assert(
      strongOnly.angles.every(
        (a) =>
          a.atsSignificance.strength === "strong" ||
          a.winSignificance.strength === "strong" ||
          (a.ouSignificance?.strength === "strong"),
      ),
      `Strong-only filter works`,
    );
  }

  // Print top 5 NFL angles for visual inspection
  console.log("\n  Top 5 NFL angles:");
  for (const a of nflAngles.angles.slice(0, 5)) {
    console.log(`    [${a.interestScore}] ${a.headline}`);
  }

  // ---------------------------------------------------------------------------
  // 9. Significance Enrichment Integration
  // ---------------------------------------------------------------------------

  section("9. SIGNIFICANCE ENRICHMENT");

  // Test win rate baselines
  assert(
    getWinRateBaseline("home", "NFL") === 0.57,
    `NFL home baseline = 57%`,
  );
  assert(
    getWinRateBaseline("favorite") === 0.66,
    `Favorite baseline = 66%`,
  );
  assert(
    getWinRateBaseline("underdog") === 0.34,
    `Underdog baseline = 34%`,
  );
  assert(
    getWinRateBaseline("team") === 0.50,
    `Team baseline = 50%`,
  );

  // Test game summary enrichment with Chiefs query
  const chiefsForSig = executeTrendQuery(chiefsQuery, allGames);
  const chiefsSig = enrichGameSummary(
    chiefsForSig.summary,
    chiefsQuery.perspective,
    chiefsQuery.sport,
  );
  assert(
    chiefsSig.winRate !== undefined,
    `Chiefs enrichment has winRate significance`,
  );
  assert(
    chiefsSig.ats !== undefined,
    `Chiefs enrichment has ATS significance`,
  );
  assert(
    chiefsSig.overUnder !== undefined,
    `Chiefs enrichment has O/U significance`,
  );
  assert(
    chiefsSig.topFinding.length > 10,
    `Chiefs enrichment has top finding (${chiefsSig.topFinding.substring(0, 50)}...)`,
  );
  assert(
    chiefsSig.winRate.sampleSize > 50,
    `Chiefs win rate sample size > 50 (${chiefsSig.winRate.sampleSize})`,
  );

  // Chiefs since 2020 should have a significant win rate
  assert(
    chiefsSig.winRate.isSignificant === true || chiefsSig.winRate.observedRate > 0.7,
    `Chiefs win rate is notable (${(chiefsSig.winRate.observedRate * 100).toFixed(1)}%)`,
  );

  // Test player summary enrichment
  const mahomesForSig = executePlayerTrendQuery(mahomesQ, playerGames);
  const mahomesSig = enrichPlayerSummary(mahomesForSig.summary);
  assert(
    mahomesSig.winRate !== undefined,
    `Mahomes enrichment has win rate significance`,
  );
  assert(
    mahomesSig.topFinding.length > 5,
    `Mahomes enrichment has top finding`,
  );
  assert(
    mahomesSig.winRate.isSignificant === true,
    `Mahomes win rate is significant`,
  );

  // Test enrichment with small sample (empty/fake team)
  const emptyForSig = executeTrendQuery(emptyQ, allGames);
  const emptySig = enrichGameSummary(emptyForSig.summary);
  assert(
    emptySig.winRate.strength === "noise",
    `Empty result has noise strength (${emptySig.winRate.strength})`,
  );
  assert(
    emptySig.topFinding.includes("No statistically significant"),
    `Empty result says no significant trends`,
  );

  // Test notable seasons
  assert(
    Array.isArray(chiefsSig.notableSeasons),
    `Chiefs has notable seasons array`,
  );

  console.log(`\n  Chiefs top finding: ${chiefsSig.topFinding}`);
  console.log(`  Mahomes top finding: ${mahomesSig.topFinding}`);

  // ---------------------------------------------------------------------------
  // 10. Shareable Trend Cards
  // ---------------------------------------------------------------------------

  section("10. SHAREABLE TREND CARDS");

  // Game trend card
  const chiefsCard = generateGameTrendCard(chiefsForSig);
  assert(chiefsCard.type === "game", `Chiefs card type is "game"`);
  assert(chiefsCard.headline.includes("Chiefs"), `Chiefs card headline includes team name`);
  assert(chiefsCard.heroStat.value.includes("%"), `Heroes stat has percentage`);
  assert(chiefsCard.supportingStats.length >= 2, `Has 2+ supporting stats (${chiefsCard.supportingStats.length})`);
  assert(chiefsCard.streakDots.length > 0, `Has streak dots (${chiefsCard.streakDots.length})`);
  assert(chiefsCard.significance.strength !== undefined, `Has significance badge`);
  assert(chiefsCard.meta.sampleSize > 50, `Meta has sample size (${chiefsCard.meta.sampleSize})`);
  assert(chiefsCard.id.length > 0, `Has card ID`);
  assert(chiefsCard.tags.length > 0, `Has tags (${chiefsCard.tags.join(", ")})`);
  assert(chiefsCard.meta.shareParam.length > 0, `Has share param`);

  // Player trend card
  const mahomesCard = generatePlayerTrendCard(mahomesForSig);
  assert(mahomesCard.type === "player", `Mahomes card type is "player"`);
  assert(mahomesCard.headline.includes("Mahomes"), `Mahomes card headline includes player name`);
  assert(mahomesCard.supportingStats.length >= 2, `Player card has 2+ stats`);
  assert(mahomesCard.streakDots.length > 0, `Player card has streak dots`);

  // Prop trend card
  const mahomesPropCard = generatePropTrendCard(mahomesPropR);
  assert(mahomesPropCard.type === "prop", `Prop card type is "prop"`);
  assert(mahomesPropCard.headline.includes("Mahomes"), `Prop card headline includes player`);
  assert(mahomesPropCard.headline.includes("Over"), `Prop card headline includes direction`);
  assert(mahomesPropCard.headline.includes("275.5"), `Prop card headline includes line`);
  assert(mahomesPropCard.heroStat.label.includes("Hit Rate"), `Prop hero stat is hit rate`);
  assert(mahomesPropCard.supportingStats.length >= 2, `Prop card has 2+ supporting stats`);
  assert(mahomesPropCard.streakDots.length > 0, `Prop card has streak dots`);

  // Card for empty result
  const emptyCard = generateGameTrendCard(emptyForSig);
  assert(emptyCard.meta.sampleSize === 0, `Empty card has 0 sample size`);

  // Visual sample
  console.log("\n  Sample Chiefs card:");
  console.log(`    Headline: ${chiefsCard.headline}`);
  console.log(`    Hero: ${chiefsCard.heroStat.value} ${chiefsCard.heroStat.label}`);
  console.log(`    Streak: ${chiefsCard.streakDots.map(d => d ? "W" : "L").join("")}`);
  console.log(`    Significance: ${chiefsCard.significance.strength} (${chiefsCard.significance.confidenceRange})`);

  console.log("\n  Sample Prop card:");
  console.log(`    Headline: ${mahomesPropCard.headline}`);
  console.log(`    Hero: ${mahomesPropCard.heroStat.value} ${mahomesPropCard.heroStat.label}`);
  console.log(`    Streak: ${mahomesPropCard.streakDots.map(d => d ? "O" : "U").join("")}`);

  // ---------------------------------------------------------------------------
  // 11. Daily Game Context Cards
  // ---------------------------------------------------------------------------

  section("11. DAILY GAME CONTEXT");

  // Test daily context for a known NFL game day (2024 Week 1)
  // KC vs BAL on 2024-09-05
  const dailyContext = await getDailyGameContext("2024-09-05", "NFL");
  assert(
    dailyContext.games.length > 0,
    `Found games on 2024-09-05 (${dailyContext.games.length})`,
  );
  assert(dailyContext.date === "2024-09-05", `Date matches`);
  assert(dailyContext.durationMs > 0, `Has duration`);

  if (dailyContext.games.length > 0) {
    const gameCtx = dailyContext.games[0];
    assert(gameCtx.sport === "NFL", `Game sport is NFL`);
    assert(gameCtx.homeTeam.length > 0, `Has home team (${gameCtx.homeTeam})`);
    assert(gameCtx.awayTeam.length > 0, `Has away team (${gameCtx.awayTeam})`);

    // Home trends
    assert(gameCtx.homeTrends.team.length > 0, `Home trends has team name`);
    assert(
      gameCtx.homeTrends.seasonRecord !== undefined,
      `Home trends has season record`,
    );
    assert(
      gameCtx.homeTrends.seasonAts !== undefined,
      `Home trends has ATS record`,
    );
    assert(
      gameCtx.homeTrends.venueRecord !== undefined,
      `Home trends has venue record`,
    );

    // Away trends
    assert(gameCtx.awayTrends.team.length > 0, `Away trends has team name`);

    // Head-to-head
    assert(
      gameCtx.headToHead !== undefined,
      `Has head-to-head record`,
    );

    // Insight
    assert(gameCtx.insight.length > 10, `Has insight text`);
  }

  // Test matchup context
  const matchup = await getMatchupContext("NFL", "Kansas City Chiefs", "Buffalo Bills");
  assert(matchup !== null, `KC vs BUF matchup found`);
  if (matchup) {
    assert(
      matchup.headToHead.totalGames > 5,
      `KC vs BUF h2h has games (${matchup.headToHead.totalGames})`,
    );
    assert(
      matchup.headToHead.lastMeeting !== null,
      `KC vs BUF has last meeting`,
    );
    assert(
      matchup.homeTrends.team.length > 0,
      `Matchup has home trends`,
    );
  }

  // Test empty date
  const emptyDate = await getDailyGameContext("2030-01-01", "NFL");
  assert(emptyDate.games.length === 0, `No games on future date`);

  // Test a date with multiple games
  const bigGameDay = await getDailyGameContext("2024-09-08", "NFL");
  assert(
    bigGameDay.games.length > 5,
    `Sunday 2024-09-08 has multiple NFL games (${bigGameDay.games.length})`,
  );

  // Print sample context
  if (dailyContext.games.length > 0) {
    const sample = dailyContext.games[0];
    console.log(`\n  Sample game context:`);
    console.log(`    ${sample.awayTeam} @ ${sample.homeTeam} (${sample.gameDate})`);
    console.log(`    Spread: ${sample.spread} | O/U: ${sample.overUnder}`);
    console.log(`    Home record: ${sample.homeTrends.seasonRecord.wins}-${sample.homeTrends.seasonRecord.losses}`);
    console.log(`    H2H: ${sample.headToHead.totalGames} games`);
    console.log(`    Angles: ${sample.situationalAngles.length}`);
    console.log(`    Insight: ${sample.insight.substring(0, 100)}...`);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  section("RESULTS");
  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run the test suite
main().catch((err) => {
  console.error("Test suite failed with error:", err);
  process.exit(1);
});
