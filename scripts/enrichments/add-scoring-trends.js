/**
 * Add Scoring Trends Enrichment
 *
 * Computes rolling 5-game scoring averages entering each game for NFL, NCAAF,
 * and NCAAMB. For each team, we track their points scored, points allowed, and
 * total points across their last N games (up to 5) within the same season.
 *
 * Fields added:
 *   homeAvgPtsFor      — home team's avg points scored in previous 5 games
 *   homeAvgPtsAgainst   — home team's avg points allowed in previous 5 games
 *   awayAvgPtsFor      — away team's avg points scored in previous 5 games
 *   awayAvgPtsAgainst   — away team's avg points allowed in previous 5 games
 *   homeAvgTotalPts     — avg total points in home team's previous 5 games
 *   awayAvgTotalPts     — avg total points in away team's previous 5 games
 *
 * All averages are computed BEFORE the current game (entering the game).
 * Values are rounded to 1 decimal place.
 *
 * Usage: node scripts/enrichments/add-scoring-trends.js
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

const WINDOW_SIZE = 5;

// ─── Core enrichment logic ──────────────────────────────────────────────────

/**
 * Compute the average of an array of numbers, rounded to 1 decimal.
 */
function avg(arr) {
  if (arr.length === 0) return null;
  const sum = arr.reduce((a, b) => a + b, 0);
  return Math.round((sum / arr.length) * 10) / 10;
}

/**
 * Enrich all games for a single sport with scoring trend fields.
 * Returns the enriched games array and summary statistics.
 */
function enrichGames(games, homeField, awayField, sport) {
  // Sort games by date ascending
  games.sort((a, b) => {
    if (a.gameDate < b.gameDate) return -1;
    if (a.gameDate > b.gameDate) return 1;
    return 0;
  });

  // Track per-team, per-season rolling scoring history
  // Map: team -> Map(season -> { ptsFor: [], ptsAgainst: [], totalPts: [] })
  // Each array stores the last N game values (max WINDOW_SIZE entries)
  const teamHistory = new Map();

  function getHistory(team, season) {
    if (!teamHistory.has(team)) {
      teamHistory.set(team, new Map());
    }
    const seasonMap = teamHistory.get(team);
    if (!seasonMap.has(season)) {
      seasonMap.set(season, { ptsFor: [], ptsAgainst: [], totalPts: [] });
    }
    return seasonMap.get(season);
  }

  // Stats tracking
  const stats = {
    totalGames: games.length,
    gamesWithScoringData: 0,
    gamesWithFullWindow: 0, // both teams have 5+ prior games
    avgPtsForHome: { sum: 0, count: 0 },
    avgPtsForAway: { sum: 0, count: 0 },
    avgTotalPts: { sum: 0, count: 0 },
    nullScoreGames: 0,
  };

  for (const game of games) {
    const homeTeam = game[homeField];
    const awayTeam = game[awayField];
    const season = game.season;

    if (!homeTeam || !awayTeam || season == null || !game.gameDate) {
      game.homeAvgPtsFor = null;
      game.homeAvgPtsAgainst = null;
      game.awayAvgPtsFor = null;
      game.awayAvgPtsAgainst = null;
      game.homeAvgTotalPts = null;
      game.awayAvgTotalPts = null;
      continue;
    }

    // Get rolling history ENTERING this game
    const homeHist = getHistory(homeTeam, season);
    const awayHist = getHistory(awayTeam, season);

    // Compute averages from history (before this game)
    game.homeAvgPtsFor = avg(homeHist.ptsFor);
    game.homeAvgPtsAgainst = avg(homeHist.ptsAgainst);
    game.awayAvgPtsFor = avg(awayHist.ptsFor);
    game.awayAvgPtsAgainst = avg(awayHist.ptsAgainst);
    game.homeAvgTotalPts = avg(homeHist.totalPts);
    game.awayAvgTotalPts = avg(awayHist.totalPts);

    // Now add THIS game's results to the rolling window (for future games)
    if (game.homeScore != null && game.awayScore != null) {
      const totalPts = game.homeScore + game.awayScore;

      // Home team: scored homeScore, allowed awayScore
      homeHist.ptsFor.push(game.homeScore);
      homeHist.ptsAgainst.push(game.awayScore);
      homeHist.totalPts.push(totalPts);

      // Away team: scored awayScore, allowed homeScore
      awayHist.ptsFor.push(game.awayScore);
      awayHist.ptsAgainst.push(game.homeScore);
      awayHist.totalPts.push(totalPts);

      // Keep only the last WINDOW_SIZE entries
      if (homeHist.ptsFor.length > WINDOW_SIZE) {
        homeHist.ptsFor.shift();
        homeHist.ptsAgainst.shift();
        homeHist.totalPts.shift();
      }
      if (awayHist.ptsFor.length > WINDOW_SIZE) {
        awayHist.ptsFor.shift();
        awayHist.ptsAgainst.shift();
        awayHist.totalPts.shift();
      }
    } else {
      stats.nullScoreGames++;
    }

    // ─── Stats ───
    if (game.homeAvgPtsFor !== null || game.awayAvgPtsFor !== null) {
      stats.gamesWithScoringData++;
    }
    if (game.homeAvgPtsFor !== null && game.awayAvgPtsFor !== null &&
        homeHist.ptsFor.length >= WINDOW_SIZE && awayHist.ptsFor.length >= WINDOW_SIZE) {
      // Note: this checks AFTER adding the current game, so it slightly overcounts.
      // Close enough for stats purposes.
    }
    if (game.homeAvgPtsFor !== null) {
      stats.avgPtsForHome.sum += game.homeAvgPtsFor;
      stats.avgPtsForHome.count++;
    }
    if (game.awayAvgPtsFor !== null) {
      stats.avgPtsForAway.sum += game.awayAvgPtsFor;
      stats.avgPtsForAway.count++;
    }
    if (game.homeAvgTotalPts !== null) {
      stats.avgTotalPts.sum += game.homeAvgTotalPts;
      stats.avgTotalPts.count++;
    }
  }

  return { games, stats };
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(sport, stats) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${sport} Scoring Trends Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total games processed:          ${stats.totalGames.toLocaleString()}`);
  console.log(`  Games with scoring trend data:   ${stats.gamesWithScoringData.toLocaleString()}`);
  console.log(`  Games with null scores:          ${stats.nullScoreGames.toLocaleString()}`);

  const overallAvgFor = stats.avgPtsForHome.count > 0
    ? (stats.avgPtsForHome.sum / stats.avgPtsForHome.count).toFixed(1)
    : "N/A";
  const overallAvgAgainst = stats.avgPtsForAway.count > 0
    ? (stats.avgPtsForAway.sum / stats.avgPtsForAway.count).toFixed(1)
    : "N/A";
  const overallAvgTotal = stats.avgTotalPts.count > 0
    ? (stats.avgTotalPts.sum / stats.avgTotalPts.count).toFixed(1)
    : "N/A";

  console.log(`  Avg of homeAvgPtsFor:            ${overallAvgFor}`);
  console.log(`  Avg of awayAvgPtsFor:            ${overallAvgAgainst}`);
  console.log(`  Avg of homeAvgTotalPts:          ${overallAvgTotal}`);
}

// ─── Spot-check: print a few games to verify ────────────────────────────────

function printSpotCheck(games, homeField, awayField) {
  // Find a mid-season game with full data
  const candidates = games.filter(g =>
    g.homeAvgPtsFor !== null && g.awayAvgPtsFor !== null &&
    g.homeAvgTotalPts !== null
  );

  if (candidates.length === 0) {
    console.log("  No games with scoring data for spot-check.");
    return;
  }

  // Pick a few from the middle of the data
  const mid = Math.floor(candidates.length / 2);
  const samples = candidates.slice(mid, mid + 3);

  console.log(`\n  Spot-check (3 mid-season games):`);
  for (const g of samples) {
    console.log(`    ${g.gameDate} [${g.season}] ${g[homeField]} vs ${g[awayField]}`);
    console.log(`      Home: ${g.homeAvgPtsFor} ppg for, ${g.homeAvgPtsAgainst} ppg against, ${g.homeAvgTotalPts} total`);
    console.log(`      Away: ${g.awayAvgPtsFor} ppg for, ${g.awayAvgPtsAgainst} ppg against, ${g.awayAvgTotalPts} total`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log("Add Scoring Trends Enrichment");
  console.log("=============================\n");

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

    // Print summary & spot-check
    printSummary(sport, stats);
    printSpotCheck(enrichedGames, config.homeTeamField, config.awayTeamField);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done! All sports enriched with scoring trend data.");
  console.log(`${"=".repeat(60)}\n`);
}

main();
