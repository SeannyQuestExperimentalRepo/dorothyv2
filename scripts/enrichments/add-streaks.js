/**
 * Add Streaks Enrichment
 *
 * Computes win/loss streak and ATS (against the spread) streak entering each game
 * for NFL, NCAAF, and NCAAMB. Streaks are per-team, per-season, and represent
 * the streak ENTERING the game (before it is played).
 *
 * Fields added:
 *   homeWinStreak  / awayWinStreak  — consecutive SU wins (negative = loss streak)
 *   homeATSStreak  / awayATSStreak  — consecutive ATS covers (negative = consecutive non-covers)
 *
 * Usage: node scripts/enrichments/add-streaks.js
 */

const fs = require("fs");
const path = require("path");

// ─── File paths ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "../../data");

const SPORT_CONFIGS = {
  NFL: {
    filePath: path.join(DATA_DIR, "nfl-games-staging.json"),
    homeTeamField: "homeTeamCanonical",
    awayTeamField: "awayTeamCanonical",
  },
  NCAAF: {
    filePath: path.join(DATA_DIR, "ncaaf-games-final.json"),
    homeTeamField: "homeTeamCanonical",
    awayTeamField: "awayTeamCanonical",
  },
  NCAAMB: {
    filePath: path.join(DATA_DIR, "ncaamb-games-staging.json"),
    homeTeamField: "homeTeam",
    awayTeamField: "awayTeam",
  },
};

// ─── Core enrichment logic ──────────────────────────────────────────────────

/**
 * Determine the straight-up (SU) result for a team in a game.
 * Returns "W", "L", or null if scores are missing/tied.
 */
function getSUResult(game, team, homeField, awayField) {
  if (game.homeScore == null || game.awayScore == null) return null;
  if (game.homeScore === game.awayScore) return null; // tie — breaks the streak

  const isHome = game[homeField] === team;
  if (isHome) {
    return game.homeScore > game.awayScore ? "W" : "L";
  } else {
    return game.awayScore > game.homeScore ? "W" : "L";
  }
}

/**
 * Determine the ATS result for a team in a game.
 * spreadResult is from the HOME team's perspective:
 *   COVERED = home covered, LOST = home failed to cover, PUSH = push
 * Returns "C" (covered), "L" (lost), or null.
 */
function getATSResult(game, team, homeField) {
  if (!game.spreadResult || game.spreadResult === "PUSH") return null;

  const isHome = game[homeField] === team;
  if (isHome) {
    return game.spreadResult === "COVERED" ? "C" : "L";
  } else {
    // Away team: flip the result
    return game.spreadResult === "COVERED" ? "L" : "C";
  }
}

/**
 * Update a running streak value.
 * Positive = winning/covering streak, negative = losing/non-covering streak.
 * A null result (push, tie, missing data) resets the streak to 0.
 */
function updateStreak(currentStreak, result, winChar) {
  if (result === null) return 0;

  if (result === winChar) {
    // Continuing or starting a positive streak
    return currentStreak > 0 ? currentStreak + 1 : 1;
  } else {
    // Continuing or starting a negative streak
    return currentStreak < 0 ? currentStreak - 1 : -1;
  }
}

/**
 * Enrich all games for a single sport with streak fields.
 * Returns the enriched games array and summary statistics.
 */
function enrichGames(games, homeField, awayField, sport) {
  // Sort games by date ascending, then by season as a tiebreaker
  games.sort((a, b) => {
    if (a.gameDate < b.gameDate) return -1;
    if (a.gameDate > b.gameDate) return 1;
    return 0;
  });

  // Track per-team, per-season streaks
  // Map: team -> Map(season -> { winStreak, atsStreak })
  const teamStreaks = new Map();

  function getStreaks(team, season) {
    if (!teamStreaks.has(team)) {
      teamStreaks.set(team, new Map());
    }
    const seasonMap = teamStreaks.get(team);
    if (!seasonMap.has(season)) {
      seasonMap.set(season, { winStreak: 0, atsStreak: 0 });
    }
    return seasonMap.get(season);
  }

  // Stats tracking
  const stats = {
    totalGames: games.length,
    gamesWithWinStreaks: 0,
    gamesWithATSStreaks: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    maxATSWinStreak: 0,
    maxATSLossStreak: 0,
    winStreakDistribution: {},
    atsStreakDistribution: {},
  };

  for (const game of games) {
    const homeTeam = game[homeField];
    const awayTeam = game[awayField];
    const season = game.season;

    if (!homeTeam || !awayTeam || season == null || !game.gameDate) {
      game.homeWinStreak = null;
      game.awayWinStreak = null;
      game.homeATSStreak = null;
      game.awayATSStreak = null;
      continue;
    }

    // Get current streaks ENTERING this game
    const homeStreakState = getStreaks(homeTeam, season);
    const awayStreakState = getStreaks(awayTeam, season);

    // Record the entering-game streaks
    game.homeWinStreak = homeStreakState.winStreak;
    game.awayWinStreak = awayStreakState.winStreak;
    game.homeATSStreak = homeStreakState.atsStreak;
    game.awayATSStreak = awayStreakState.atsStreak;

    // Now compute results of THIS game and update the running streaks
    const homeSU = getSUResult(game, homeTeam, homeField, awayField);
    const awaySU = getSUResult(game, awayTeam, homeField, awayField);
    const homeATS = getATSResult(game, homeTeam, homeField);
    const awayATS = getATSResult(game, awayTeam, homeField);

    homeStreakState.winStreak = updateStreak(homeStreakState.winStreak, homeSU, "W");
    awayStreakState.winStreak = updateStreak(awayStreakState.winStreak, awaySU, "W");
    homeStreakState.atsStreak = updateStreak(homeStreakState.atsStreak, homeATS, "C");
    awayStreakState.atsStreak = updateStreak(awayStreakState.atsStreak, awayATS, "C");

    // ─── Stats ───
    if (game.homeWinStreak !== 0 || game.awayWinStreak !== 0) {
      stats.gamesWithWinStreaks++;
    }
    if (game.homeATSStreak !== 0 || game.awayATSStreak !== 0) {
      stats.gamesWithATSStreaks++;
    }

    for (const s of [game.homeWinStreak, game.awayWinStreak]) {
      if (s > stats.maxWinStreak) stats.maxWinStreak = s;
      if (s < stats.maxLossStreak) stats.maxLossStreak = s;
      const bucket = clampBucket(s, 5);
      stats.winStreakDistribution[bucket] = (stats.winStreakDistribution[bucket] || 0) + 1;
    }

    for (const s of [game.homeATSStreak, game.awayATSStreak]) {
      if (s > stats.maxATSWinStreak) stats.maxATSWinStreak = s;
      if (s < stats.maxATSLossStreak) stats.maxATSLossStreak = s;
      const bucket = clampBucket(s, 5);
      stats.atsStreakDistribution[bucket] = (stats.atsStreakDistribution[bucket] || 0) + 1;
    }
  }

  return { games, stats };
}

/**
 * Clamp a streak value into a display bucket string for distribution stats.
 * e.g., clampBucket(7, 5) => "5+" ; clampBucket(-8, 5) => "-5-"
 */
function clampBucket(val, max) {
  if (val == null) return "null";
  if (val >= max) return `${max}+`;
  if (val <= -max) return `${-max}-`;
  return String(val);
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(sport, stats) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${sport} Streaks Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total games processed:         ${stats.totalGames.toLocaleString()}`);
  console.log(`  Games with non-zero win streak: ${stats.gamesWithWinStreaks.toLocaleString()}`);
  console.log(`  Games with non-zero ATS streak: ${stats.gamesWithATSStreaks.toLocaleString()}`);
  console.log(`  Max win streak seen:            ${stats.maxWinStreak}`);
  console.log(`  Max loss streak seen:           ${stats.maxLossStreak}`);
  console.log(`  Max ATS cover streak seen:      ${stats.maxATSWinStreak}`);
  console.log(`  Max ATS loss streak seen:       ${stats.maxATSLossStreak}`);

  console.log(`\n  Win Streak Distribution (entering game, home + away):`);
  const sortedBuckets = Object.keys(stats.winStreakDistribution).sort((a, b) => {
    return parseBucket(a) - parseBucket(b);
  });
  for (const bucket of sortedBuckets) {
    const count = stats.winStreakDistribution[bucket];
    const bar = "#".repeat(Math.min(Math.round(count / 200), 50));
    console.log(`    ${bucket.padStart(4)}: ${count.toLocaleString().padStart(8)}  ${bar}`);
  }

  if (stats.maxATSWinStreak > 0 || stats.maxATSLossStreak < 0) {
    console.log(`\n  ATS Streak Distribution (entering game, home + away):`);
    const atsBuckets = Object.keys(stats.atsStreakDistribution).sort((a, b) => {
      return parseBucket(a) - parseBucket(b);
    });
    for (const bucket of atsBuckets) {
      const count = stats.atsStreakDistribution[bucket];
      const bar = "#".repeat(Math.min(Math.round(count / 200), 50));
      console.log(`    ${bucket.padStart(4)}: ${count.toLocaleString().padStart(8)}  ${bar}`);
    }
  }
}

/**
 * Parse a bucket string back to a number for sorting.
 */
function parseBucket(b) {
  if (b === "null") return -999;
  if (b.endsWith("+")) return parseInt(b) + 0.5;
  if (b.endsWith("-")) return parseInt(b) - 0.5;
  return parseInt(b);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log("Add Streaks Enrichment");
  console.log("======================\n");

  for (const [sport, config] of Object.entries(SPORT_CONFIGS)) {
    console.log(`Processing ${sport}...`);

    // Load data
    const rawData = fs.readFileSync(config.filePath, "utf8");
    const games = JSON.parse(rawData);
    console.log(`  Loaded ${games.length.toLocaleString()} games from ${path.basename(config.filePath)}`);

    // Enrich
    const { games: enrichedGames, stats } = enrichGames(
      games,
      config.homeTeamField,
      config.awayTeamField,
      sport
    );

    // Write back
    fs.writeFileSync(config.filePath, JSON.stringify(enrichedGames, null, 2) + "\n", "utf8");
    console.log(`  Wrote enriched data back to ${path.basename(config.filePath)}`);

    // Print summary
    printSummary(sport, stats);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done! All sports enriched with streak data.");
  console.log(`${"=".repeat(60)}\n`);
}

main();
