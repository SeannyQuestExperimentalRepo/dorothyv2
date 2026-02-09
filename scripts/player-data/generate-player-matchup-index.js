/**
 * Generate Player Matchup Index
 *
 * Reads nfl-player-games.json and creates a pre-computed index of
 * head-to-head matchup data for every player against every opponent.
 * Only includes opponents faced 2+ times.
 *
 * Output: data/player-matchup-index.json
 *
 * Structure:
 * {
 *   [playerId]: {
 *     playerName: string,
 *     position: string,
 *     opponents: {
 *       [opponentTeam]: {
 *         games: number,
 *         wins: number,
 *         losses: number,
 *         avgPassYds: number | null,
 *         avgRushYds: number | null,
 *         avgRecYds: number | null,
 *         avgFantasyPts: number | null,
 *         seasons: number[]   // which seasons these games span
 *       }
 *     }
 *   }
 * }
 *
 * Usage: node scripts/player-data/generate-player-matchup-index.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../../data");
const PLAYER_FILE = path.join(DATA_DIR, "nfl-player-games.json");
const OUTPUT_FILE = path.join(DATA_DIR, "player-matchup-index.json");

const MIN_GAMES = 2; // minimum games vs an opponent to include

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely compute average of a numeric field from an array of games.
 * Returns null if no valid values, otherwise rounded to 2 decimal places.
 */
function avgField(games, field) {
  let sum = 0;
  let count = 0;
  for (const g of games) {
    const val = g[field];
    if (val != null && typeof val === "number") {
      sum += val;
      count++;
    }
  }
  if (count === 0) return null;
  return Math.round((sum / count) * 100) / 100;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log("Generate Player Matchup Index");
  console.log("=============================\n");

  // Load data
  console.log("Loading player game data...");
  const playerGames = JSON.parse(fs.readFileSync(PLAYER_FILE, "utf-8"));
  console.log(`  ${playerGames.length.toLocaleString()} player-game records loaded\n`);

  // ─── Group by player_id -> opponent_team -> [games] ──────────────────────
  // Also track player metadata (name, position) from most recent game

  const playerMap = new Map();
  // player_id -> { name, position, opponents: Map(opponent_team -> [games]) }

  for (const g of playerGames) {
    const pid = g.player_id;
    const opp = g.opponent_team;
    if (!pid || !opp) continue;

    if (!playerMap.has(pid)) {
      playerMap.set(pid, {
        name: g.player_display_name || g.player_name || "",
        position: g.position_group || g.position || "",
        latestSeason: g.season || 0,
        opponents: new Map(),
      });
    }

    const player = playerMap.get(pid);

    // Update name/position from most recent record
    if (g.season > player.latestSeason) {
      player.name = g.player_display_name || g.player_name || player.name;
      player.position = g.position_group || g.position || player.position;
      player.latestSeason = g.season;
    }

    if (!player.opponents.has(opp)) {
      player.opponents.set(opp, []);
    }
    player.opponents.get(opp).push(g);
  }

  console.log(`  ${playerMap.size.toLocaleString()} unique players found\n`);

  // ─── Build the index ─────────────────────────────────────────────────────

  const index = {};

  const stats = {
    playersInIndex: 0,
    totalMatchups: 0,
    matchupsFiltered: 0, // opponent matchups with < MIN_GAMES
    maxGamesVsOpponent: 0,
    maxGamesPlayer: "",
    maxGamesOpponent: "",
  };

  for (const [pid, playerData] of playerMap) {
    const opponents = {};
    let hasAnyMatchup = false;

    for (const [oppTeam, games] of playerData.opponents) {
      if (games.length < MIN_GAMES) {
        stats.matchupsFiltered++;
        continue;
      }

      // Count W/L
      let wins = 0;
      let losses = 0;
      const seasons = new Set();

      for (const g of games) {
        if (g.gameResult === "W") wins++;
        else if (g.gameResult === "L") losses++;
        if (g.season) seasons.add(g.season);
      }

      opponents[oppTeam] = {
        games: games.length,
        wins,
        losses,
        avgPassYds: avgField(games, "passing_yards"),
        avgRushYds: avgField(games, "rushing_yards"),
        avgRecYds: avgField(games, "receiving_yards"),
        avgFantasyPts: avgField(games, "fantasy_points_ppr"),
        seasons: [...seasons].sort(),
      };

      hasAnyMatchup = true;
      stats.totalMatchups++;

      // Track max
      if (games.length > stats.maxGamesVsOpponent) {
        stats.maxGamesVsOpponent = games.length;
        stats.maxGamesPlayer = playerData.name;
        stats.maxGamesOpponent = oppTeam;
      }
    }

    if (hasAnyMatchup) {
      index[pid] = {
        playerName: playerData.name,
        position: playerData.position,
        opponents,
      };
      stats.playersInIndex++;
    }
  }

  // ─── Write output ────────────────────────────────────────────────────────
  console.log("Writing matchup index...");
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2) + "\n", "utf-8");

  const fileSizeMB = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(1);
  console.log(`  Saved to ${path.basename(OUTPUT_FILE)} (${fileSizeMB} MB)\n`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("  Player Matchup Index Summary");
  console.log("=".repeat(60));
  console.log(`  Total player-game records:   ${playerGames.length.toLocaleString()}`);
  console.log(`  Unique players in source:    ${playerMap.size.toLocaleString()}`);
  console.log(`  Players in index:            ${stats.playersInIndex.toLocaleString()}`);
  console.log(`  Total matchup entries:       ${stats.totalMatchups.toLocaleString()}`);
  console.log(`  Matchups filtered (<${MIN_GAMES}g):   ${stats.matchupsFiltered.toLocaleString()}`);
  console.log(`  Min games threshold:         ${MIN_GAMES}`);
  console.log();
  console.log("  Most matchup games:");
  console.log(
    `    ${stats.maxGamesPlayer} vs ${stats.maxGamesOpponent}: ${stats.maxGamesVsOpponent} games`
  );

  // ─── Sample lookups ──────────────────────────────────────────────────────
  // Find Patrick Mahomes
  const mahomesId = Object.keys(index).find(
    (pid) => index[pid].playerName === "Patrick Mahomes"
  );
  if (mahomesId && index[mahomesId]) {
    const mahomes = index[mahomesId];
    const oppEntries = Object.entries(mahomes.opponents);
    console.log();
    console.log(`  Sample: ${mahomes.playerName} (${mahomes.position})`);
    console.log(`    Opponents with 2+ games: ${oppEntries.length}`);

    // Show top 3 most-faced opponents
    const sorted = oppEntries.sort((a, b) => b[1].games - a[1].games).slice(0, 3);
    for (const [opp, data] of sorted) {
      console.log(
        `    vs ${opp}: ${data.games}g, ${data.wins}W-${data.losses}L, ` +
          `${data.avgPassYds || 0} avg pass yds, ${data.avgFantasyPts || 0} avg PPR`
      );
    }
  }

  // Find a top RB
  const topRBId = Object.keys(index).find(
    (pid) => index[pid].playerName === "Derrick Henry" && index[pid].position === "RB"
  );
  if (topRBId && index[topRBId]) {
    const rb = index[topRBId];
    const oppEntries = Object.entries(rb.opponents);
    console.log();
    console.log(`  Sample: ${rb.playerName} (${rb.position})`);
    console.log(`    Opponents with 2+ games: ${oppEntries.length}`);

    const sorted = oppEntries.sort((a, b) => b[1].games - a[1].games).slice(0, 3);
    for (const [opp, data] of sorted) {
      console.log(
        `    vs ${opp}: ${data.games}g, ${data.wins}W-${data.losses}L, ` +
          `${data.avgRushYds || 0} avg rush yds, ${data.avgFantasyPts || 0} avg PPR`
      );
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done! Player matchup index generated.");
  console.log("=".repeat(60) + "\n");
}

main();
