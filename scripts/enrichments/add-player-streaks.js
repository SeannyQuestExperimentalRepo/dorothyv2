/**
 * Add Player Streaks Enrichment
 *
 * Enriches each player-game record in nfl-player-games.json with the
 * player's streaks ENTERING that game. All streak values represent
 * the streak state before the game was played, not after.
 *
 * Added fields:
 *   playerWinStreak       — consecutive team wins in this player's games (negative = losing streak)
 *   playerFantasyStreak   — consecutive games with fantasy_points_ppr >= season average (within-season)
 *   playerPassYdStreak    — (QBs) consecutive games with 200+ passing yards
 *   playerRushYdStreak    — (RBs) consecutive games with 50+ rushing yards
 *   playerRecYdStreak     — (WRs/TEs) consecutive games with 50+ receiving yards
 *
 * Processing: chronological per player per season.
 *
 * Usage: node scripts/enrichments/add-player-streaks.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../../data");
const PLAYER_FILE = path.join(DATA_DIR, "nfl-player-games.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sort key for chronological ordering: season, then week.
 */
function gameOrder(a, b) {
  if (a.season !== b.season) return a.season - b.season;
  return a.week - b.week;
}

/**
 * Compute the season average of fantasy_points_ppr for a player in a given season.
 * Only counts games where the value is a non-null number.
 */
function computeSeasonFantasyAvg(games) {
  let sum = 0;
  let count = 0;
  for (const g of games) {
    if (g.fantasy_points_ppr != null && typeof g.fantasy_points_ppr === "number") {
      sum += g.fantasy_points_ppr;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log("Add Player Streaks Enrichment");
  console.log("=============================\n");

  // Load data
  console.log("Loading player game data...");
  const playerGames = JSON.parse(fs.readFileSync(PLAYER_FILE, "utf-8"));
  console.log(`  ${playerGames.length.toLocaleString()} player-game records loaded\n`);

  // ─── Group by player_id -> season -> sorted games ────────────────────────
  // We need to build per-player-per-season groups, sort them chronologically,
  // then compute streaks entering each game.

  const playerSeasonMap = new Map(); // player_id -> Map(season -> [indices])

  for (let i = 0; i < playerGames.length; i++) {
    const g = playerGames[i];
    const pid = g.player_id;
    const season = g.season;
    if (!pid || season == null) continue;

    if (!playerSeasonMap.has(pid)) {
      playerSeasonMap.set(pid, new Map());
    }
    const seasonMap = playerSeasonMap.get(pid);
    if (!seasonMap.has(season)) {
      seasonMap.set(season, []);
    }
    seasonMap.get(season).push(i);
  }

  console.log(`  ${playerSeasonMap.size.toLocaleString()} unique players`);

  // ─── Process each player-season chronologically ──────────────────────────

  const stats = {
    totalRecords: playerGames.length,
    recordsEnriched: 0,
    playersProcessed: 0,
    winStreakSet: 0,
    fantasyStreakSet: 0,
    passYdStreakSet: 0,
    rushYdStreakSet: 0,
    recYdStreakSet: 0,
    maxWinStreak: 0,
    maxLoseStreak: 0,
    maxFantasyStreak: 0,
    maxPassYdStreak: 0,
    maxRushYdStreak: 0,
    maxRecYdStreak: 0,
  };

  for (const [pid, seasonMap] of playerSeasonMap) {
    stats.playersProcessed++;

    for (const [season, indices] of seasonMap) {
      // Sort indices by season + week of the corresponding games
      indices.sort((a, b) => gameOrder(playerGames[a], playerGames[b]));

      // Get the position group from the first game for this player-season
      const posGroup = playerGames[indices[0]].position_group || "";

      // Pre-compute season fantasy average for the fantasy streak threshold
      const seasonGames = indices.map((i) => playerGames[i]);
      const seasonFantasyAvg = computeSeasonFantasyAvg(seasonGames);

      // Running streak state (these track the streak AS OF the end of the previous game)
      let winStreak = 0; // positive = wins, negative = losses
      let fantasyStreak = 0; // consecutive games >= season avg
      let passYdStreak = 0;
      let rushYdStreak = 0;
      let recYdStreak = 0;

      for (const idx of indices) {
        const g = playerGames[idx];

        // ── Write streaks ENTERING this game ──
        g.playerWinStreak = winStreak;
        g.playerFantasyStreak = fantasyStreak;

        if (posGroup === "QB") {
          g.playerPassYdStreak = passYdStreak;
        }
        if (posGroup === "RB") {
          g.playerRushYdStreak = rushYdStreak;
        }
        if (posGroup === "WR" || posGroup === "TE") {
          g.playerRecYdStreak = recYdStreak;
        }

        stats.recordsEnriched++;

        // Track stat extremes
        if (winStreak > 0) stats.maxWinStreak = Math.max(stats.maxWinStreak, winStreak);
        if (winStreak < 0) stats.maxLoseStreak = Math.max(stats.maxLoseStreak, Math.abs(winStreak));
        stats.maxFantasyStreak = Math.max(stats.maxFantasyStreak, fantasyStreak);
        if (posGroup === "QB") stats.maxPassYdStreak = Math.max(stats.maxPassYdStreak, passYdStreak);
        if (posGroup === "RB") stats.maxRushYdStreak = Math.max(stats.maxRushYdStreak, rushYdStreak);
        if (posGroup === "WR" || posGroup === "TE") stats.maxRecYdStreak = Math.max(stats.maxRecYdStreak, recYdStreak);

        // Count non-zero streaks for stats
        if (winStreak !== 0) stats.winStreakSet++;
        if (fantasyStreak !== 0) stats.fantasyStreakSet++;
        if (passYdStreak !== 0) stats.passYdStreakSet++;
        if (rushYdStreak !== 0) stats.rushYdStreakSet++;
        if (recYdStreak !== 0) stats.recYdStreakSet++;

        // ── Update streak state AFTER this game ──

        // Win streak: positive for consecutive wins, negative for consecutive losses
        if (g.gameResult === "W") {
          winStreak = winStreak > 0 ? winStreak + 1 : 1;
        } else if (g.gameResult === "L") {
          winStreak = winStreak < 0 ? winStreak - 1 : -1;
        } else {
          // Tie or null: reset
          winStreak = 0;
        }

        // Fantasy streak: consecutive games >= season average PPR
        const fpts = g.fantasy_points_ppr;
        if (fpts != null && typeof fpts === "number" && seasonFantasyAvg > 0) {
          fantasyStreak = fpts >= seasonFantasyAvg ? fantasyStreak + 1 : 0;
        } else {
          fantasyStreak = 0;
        }

        // Position-specific yardage streaks
        if (posGroup === "QB") {
          const passYds = g.passing_yards;
          if (passYds != null && typeof passYds === "number") {
            passYdStreak = passYds >= 200 ? passYdStreak + 1 : 0;
          } else {
            passYdStreak = 0;
          }
        }

        if (posGroup === "RB") {
          const rushYds = g.rushing_yards;
          if (rushYds != null && typeof rushYds === "number") {
            rushYdStreak = rushYds >= 50 ? rushYdStreak + 1 : 0;
          } else {
            rushYdStreak = 0;
          }
        }

        if (posGroup === "WR" || posGroup === "TE") {
          const recYds = g.receiving_yards;
          if (recYds != null && typeof recYds === "number") {
            recYdStreak = recYds >= 50 ? recYdStreak + 1 : 0;
          } else {
            recYdStreak = 0;
          }
        }
      }
    }
  }

  // ─── Write back ──────────────────────────────────────────────────────────
  console.log("Writing enriched data...");
  fs.writeFileSync(PLAYER_FILE, JSON.stringify(playerGames, null, 2) + "\n", "utf-8");
  console.log(`  Saved to ${path.basename(PLAYER_FILE)}\n`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("  Player Streaks Enrichment Summary");
  console.log("=".repeat(60));
  console.log(`  Total records:               ${stats.totalRecords.toLocaleString()}`);
  console.log(`  Records enriched:            ${stats.recordsEnriched.toLocaleString()}`);
  console.log(`  Unique players processed:    ${stats.playersProcessed.toLocaleString()}`);
  console.log();
  console.log("  Non-zero streak counts:");
  console.log(`    playerWinStreak:           ${stats.winStreakSet.toLocaleString()}`);
  console.log(`    playerFantasyStreak:       ${stats.fantasyStreakSet.toLocaleString()}`);
  console.log(`    playerPassYdStreak (QB):   ${stats.passYdStreakSet.toLocaleString()}`);
  console.log(`    playerRushYdStreak (RB):   ${stats.rushYdStreakSet.toLocaleString()}`);
  console.log(`    playerRecYdStreak (WR/TE): ${stats.recYdStreakSet.toLocaleString()}`);
  console.log();
  console.log("  Max streaks observed:");
  console.log(`    Longest win streak:        ${stats.maxWinStreak}`);
  console.log(`    Longest losing streak:     ${stats.maxLoseStreak}`);
  console.log(`    Longest fantasy streak:    ${stats.maxFantasyStreak}`);
  console.log(`    Longest pass yd streak:    ${stats.maxPassYdStreak}`);
  console.log(`    Longest rush yd streak:    ${stats.maxRushYdStreak}`);
  console.log(`    Longest rec yd streak:     ${stats.maxRecYdStreak}`);

  // ─── Sample verification ─────────────────────────────────────────────────
  // Find a QB with a notable pass yard streak
  const sampleQB = playerGames.find(
    (g) => g.position_group === "QB" && g.playerPassYdStreak >= 3 && g.season >= 2020
  );
  if (sampleQB) {
    console.log();
    console.log("  Sample QB with pass yd streak:");
    console.log(
      `    ${sampleQB.player_display_name} | ${sampleQB.season} Wk ${sampleQB.week} | ` +
        `Win streak: ${sampleQB.playerWinStreak} | Pass yd streak: ${sampleQB.playerPassYdStreak} | ` +
        `Fantasy streak: ${sampleQB.playerFantasyStreak}`
    );
  }

  const sampleRB = playerGames.find(
    (g) => g.position_group === "RB" && g.playerRushYdStreak >= 3 && g.season >= 2020
  );
  if (sampleRB) {
    console.log("  Sample RB with rush yd streak:");
    console.log(
      `    ${sampleRB.player_display_name} | ${sampleRB.season} Wk ${sampleRB.week} | ` +
        `Win streak: ${sampleRB.playerWinStreak} | Rush yd streak: ${sampleRB.playerRushYdStreak}`
    );
  }

  const sampleWR = playerGames.find(
    (g) => g.position_group === "WR" && g.playerRecYdStreak >= 3 && g.season >= 2020
  );
  if (sampleWR) {
    console.log("  Sample WR with rec yd streak:");
    console.log(
      `    ${sampleWR.player_display_name} | ${sampleWR.season} Wk ${sampleWR.week} | ` +
        `Win streak: ${sampleWR.playerWinStreak} | Rec yd streak: ${sampleWR.playerRecYdStreak}`
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done! Player streak data enriched.");
  console.log("=".repeat(60) + "\n");
}

main();
