/**
 * Add Conference Records Enrichment
 *
 * For NCAAF and NCAAMB only, computes each team's conference record entering
 * each game. Only games where isConferenceGame is true count toward the tally.
 *
 * Fields added:
 *   homeConfWins   / homeConfLosses
 *   awayConfWins   / awayConfLosses
 *
 * These represent the team's conference W-L record BEFORE the current game.
 *
 * Usage: node scripts/enrichments/add-conference-records.js
 */

const fs = require("fs");
const path = require("path");

// ─── File paths ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "../../data");

const SPORT_CONFIGS = {
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
 * Enrich all games for a single sport with conference record fields.
 * Returns the enriched games array and summary statistics.
 */
function enrichGames(games, homeField, awayField, sport) {
  // Sort games by date ascending
  games.sort((a, b) => {
    if (a.gameDate < b.gameDate) return -1;
    if (a.gameDate > b.gameDate) return 1;
    return 0;
  });

  // Track per-team, per-season conference records
  // Map: team -> Map(season -> { wins, losses })
  const teamConfRecords = new Map();

  function getRecord(team, season) {
    if (!teamConfRecords.has(team)) {
      teamConfRecords.set(team, new Map());
    }
    const seasonMap = teamConfRecords.get(team);
    if (!seasonMap.has(season)) {
      seasonMap.set(season, { wins: 0, losses: 0 });
    }
    return seasonMap.get(season);
  }

  // Stats tracking
  const stats = {
    totalGames: games.length,
    conferenceGames: 0,
    gamesWithPriorConfRecord: 0,
    maxConfWins: 0,
    maxConfLosses: 0,
    sampleRecords: [],
  };

  for (const game of games) {
    const homeTeam = game[homeField];
    const awayTeam = game[awayField];
    const season = game.season;

    if (!homeTeam || !awayTeam || season == null || !game.gameDate) {
      game.homeConfWins = null;
      game.homeConfLosses = null;
      game.awayConfWins = null;
      game.awayConfLosses = null;
      continue;
    }

    // Get conference records ENTERING this game
    const homeRec = getRecord(homeTeam, season);
    const awayRec = getRecord(awayTeam, season);

    game.homeConfWins = homeRec.wins;
    game.homeConfLosses = homeRec.losses;
    game.awayConfWins = awayRec.wins;
    game.awayConfLosses = awayRec.losses;

    // Now update records if this IS a conference game with valid scores
    if (game.isConferenceGame && game.homeScore != null && game.awayScore != null) {
      stats.conferenceGames++;

      if (game.homeScore > game.awayScore) {
        homeRec.wins++;
        awayRec.losses++;
      } else if (game.awayScore > game.homeScore) {
        awayRec.wins++;
        homeRec.losses++;
      }
      // Ties: no update (extremely rare in these sports)
    }

    // ─── Stats ───
    if (game.homeConfWins > 0 || game.homeConfLosses > 0 ||
        game.awayConfWins > 0 || game.awayConfLosses > 0) {
      stats.gamesWithPriorConfRecord++;
    }
    for (const w of [game.homeConfWins, game.awayConfWins]) {
      if (w > stats.maxConfWins) stats.maxConfWins = w;
    }
    for (const l of [game.homeConfLosses, game.awayConfLosses]) {
      if (l > stats.maxConfLosses) stats.maxConfLosses = l;
    }

    // Capture a few sample records for verification
    if (stats.sampleRecords.length < 5 && game.isConferenceGame &&
        (game.homeConfWins > 0 || game.homeConfLosses > 0)) {
      stats.sampleRecords.push({
        date: game.gameDate,
        season: game.season,
        home: homeTeam,
        away: awayTeam,
        homeConfRecord: `${game.homeConfWins}-${game.homeConfLosses}`,
        awayConfRecord: `${game.awayConfWins}-${game.awayConfLosses}`,
      });
    }
  }

  return { games, stats };
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(sport, stats) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${sport} Conference Records Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total games processed:            ${stats.totalGames.toLocaleString()}`);
  console.log(`  Conference games found:            ${stats.conferenceGames.toLocaleString()}`);
  console.log(`  Games with prior conf record:      ${stats.gamesWithPriorConfRecord.toLocaleString()}`);
  console.log(`  Max conf wins entering a game:     ${stats.maxConfWins}`);
  console.log(`  Max conf losses entering a game:   ${stats.maxConfLosses}`);

  if (stats.sampleRecords.length > 0) {
    console.log(`\n  Sample conference records (entering game):`);
    for (const s of stats.sampleRecords) {
      console.log(`    ${s.date} [${s.season}] ${s.home} (${s.homeConfRecord}) vs ${s.away} (${s.awayConfRecord})`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log("Add Conference Records Enrichment");
  console.log("=================================\n");

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
  console.log("  Done! NCAAF & NCAAMB enriched with conference records.");
  console.log(`${"=".repeat(60)}\n`);
}

main();
