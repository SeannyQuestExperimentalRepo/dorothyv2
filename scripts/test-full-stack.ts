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
  loadAllGames,
  loadGamesBySport,
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
// 1. Game Engine Tests
// ---------------------------------------------------------------------------

section("1. GAME ENGINE");

console.log("\nLoading game data...");
const t0 = Date.now();
const allGames = loadAllGames();
const loadTime = Date.now() - t0;
console.log(`  Loaded ${allGames.length} games in ${loadTime}ms`);

const nflGames = loadGamesBySport("NFL");
const ncaafGames = loadGamesBySport("NCAAF");
const ncaambGames = loadGamesBySport("NCAAMB");

assert(allGames.length > 50000, `Total games > 50K (${allGames.length})`);
assert(nflGames.length > 14000, `NFL games > 14K (${nflGames.length})`);
assert(ncaafGames.length > 14000, `NCAAF games > 14K (${ncaafGames.length})`);
assert(ncaambGames.length > 20000, `NCAAMB games > 20K (${ncaambGames.length})`);

// NFL home win rate should be ~55-58%
const nflHomeWins = nflGames.filter((g) => g.scoreDifference > 0).length;
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
const chiefsResult = executeTrendQuery(chiefsQuery);
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
const coldResult = executeTrendQuery(coldQuery);
assert(coldResult.summary.totalGames > 0, `NCAAF cold games found (${coldResult.summary.totalGames})`);
assert(
  coldResult.summary.winPct > 55,
  `NCAAF cold home win% > 55% (${coldResult.summary.winPct}%)`,
);

// Test QB enrichment data
const gamesWithQB = nflGames.filter((g) => g._raw && g._raw["homeQB"]);
assert(gamesWithQB.length > 2000, `NFL games with QB data > 2K (${gamesWithQB.length})`);

// Test rest days enrichment
const gamesWithRest = nflGames.filter((g) => g._raw && g._raw["homeRestDays"] != null);
assert(gamesWithRest.length > 10000, `NFL games with rest data > 10K (${gamesWithRest.length})`);

// Test ATS data
const gamesWithSpread = nflGames.filter((g) => g.spread != null);
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

const uniquePlayers = new Set(playerGames.map((g) => g.player_id)).size;
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
  (g) => `${g.gameDate}-${g.homeTeam}-${g.awayTeam}`,
);
const nflUniqueKeys = new Set(nflGameKeys);
assert(
  nflUniqueKeys.size === nflGameKeys.length,
  `No duplicate NFL games (${nflGameKeys.length} total, ${nflUniqueKeys.size} unique)`,
  `${nflGameKeys.length - nflUniqueKeys.size} duplicates found`,
);

// Check score consistency
const badScoreGames = nflGames.filter(
  (g) =>
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
const playerWithContext = playerGames.filter((g) => g.gameDate != null).length;
const contextPct = (playerWithContext / playerGames.length) * 100;
assert(
  contextPct > 95,
  `Player game context match rate > 95% (${contextPct.toFixed(1)}%)`,
);

// Check season ranges make sense
const nflSeasons = new Set(nflGames.map((g) => g.season));
const playerSeasons = new Set(playerGames.map((g) => g.season));
assert(
  Array.from(nflSeasons).some((s) => s >= 2020),
  `NFL data includes recent seasons`,
);
assert(
  Array.from(playerSeasons).some((s) => s >= 2024),
  `Player data includes 2024 season`,
);

// Check that spread data is present for recent games
const recentNFL = nflGames.filter((g) => g.season >= 2015);
const withSpread = recentNFL.filter((g) => g.spread != null);
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
const emptyR = executeTrendQuery(emptyQ);
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
const extremeR = executeTrendQuery(extremeQ);
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
const futureR = executeTrendQuery(futureQ);
assert(futureR.summary.totalGames === 0, `No games for future seasons`);

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
