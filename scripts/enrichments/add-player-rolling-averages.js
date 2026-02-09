/**
 * Add Player Rolling Averages Enrichment
 *
 * Enriches each player-game record in nfl-player-games.json with
 * rolling 3-game averages for key stats ENTERING that game.
 * The window is the player's last 3 games within the same season.
 *
 * Added fields (position-specific):
 *   QBs:     rolling3_passing_yards, rolling3_passing_tds, rolling3_passing_epa
 *   RBs:     rolling3_rushing_yards, rolling3_rushing_tds
 *   WRs/TEs: rolling3_receiving_yards, rolling3_receiving_tds, rolling3_targets
 *   All:     rolling3_fantasy_points_ppr
 *
 * Usage: node scripts/enrichments/add-player-rolling-averages.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "../../data");
const PLAYER_FILE = path.join(DATA_DIR, "nfl-player-games.json");

const WINDOW = 3;

// ─── Position-specific stat configs ──────────────────────────────────────────

const ROLLING_FIELDS = {
  QB: [
    { source: "passing_yards", target: "rolling3_passing_yards" },
    { source: "passing_tds", target: "rolling3_passing_tds" },
    { source: "passing_epa", target: "rolling3_passing_epa" },
  ],
  RB: [
    { source: "rushing_yards", target: "rolling3_rushing_yards" },
    { source: "rushing_tds", target: "rolling3_rushing_tds" },
  ],
  WR: [
    { source: "receiving_yards", target: "rolling3_receiving_yards" },
    { source: "receiving_tds", target: "rolling3_receiving_tds" },
    { source: "targets", target: "rolling3_targets" },
  ],
  TE: [
    { source: "receiving_yards", target: "rolling3_receiving_yards" },
    { source: "receiving_tds", target: "rolling3_receiving_tds" },
    { source: "targets", target: "rolling3_targets" },
  ],
};

// Fantasy PPR applies to all positions
const UNIVERSAL_FIELDS = [
  { source: "fantasy_points_ppr", target: "rolling3_fantasy_points_ppr" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gameOrder(a, b) {
  if (a.season !== b.season) return a.season - b.season;
  return a.week - b.week;
}

/**
 * Compute the average of a stat field across a window of games.
 * Skips null/undefined values. Returns null if no valid values.
 */
function windowAvg(games, field) {
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
  console.log("Add Player Rolling Averages Enrichment");
  console.log("======================================\n");

  // Load data
  console.log("Loading player game data...");
  const playerGames = JSON.parse(fs.readFileSync(PLAYER_FILE, "utf-8"));
  console.log(`  ${playerGames.length.toLocaleString()} player-game records loaded\n`);

  // ─── Group by player_id -> season -> sorted indices ──────────────────────
  const playerSeasonMap = new Map();

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

  console.log(`  ${playerSeasonMap.size.toLocaleString()} unique players\n`);

  // ─── Process ─────────────────────────────────────────────────────────────

  const stats = {
    totalRecords: playerGames.length,
    recordsEnriched: 0,
    recordsWithRolling: 0, // games that have >= 1 prior game for rolling
    playersProcessed: 0,
    fieldCounts: {}, // how many times each rolling field was set non-null
  };

  // All possible target fields for tracking
  const allTargetFields = new Set();
  for (const fields of Object.values(ROLLING_FIELDS)) {
    for (const f of fields) allTargetFields.add(f.target);
  }
  for (const f of UNIVERSAL_FIELDS) allTargetFields.add(f.target);
  for (const f of allTargetFields) stats.fieldCounts[f] = 0;

  for (const [pid, seasonMap] of playerSeasonMap) {
    stats.playersProcessed++;

    for (const [season, indices] of seasonMap) {
      // Sort by season + week
      indices.sort((a, b) => gameOrder(playerGames[a], playerGames[b]));

      // Determine position group from first game
      const posGroup = playerGames[indices[0]].position_group || "";

      // Get the position-specific fields to compute
      const posFields = ROLLING_FIELDS[posGroup] || [];
      const allFields = [...posFields, ...UNIVERSAL_FIELDS];

      // Process each game in chronological order
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        const g = playerGames[idx];

        // The window is the previous WINDOW games (not including current)
        const windowStart = Math.max(0, j - WINDOW);
        const windowEnd = j; // exclusive — games before current
        const windowGames = [];
        for (let k = windowStart; k < windowEnd; k++) {
          windowGames.push(playerGames[indices[k]]);
        }

        // Write rolling averages
        for (const { source, target } of allFields) {
          if (windowGames.length === 0) {
            g[target] = null;
          } else {
            const avg = windowAvg(windowGames, source);
            g[target] = avg;
            if (avg !== null) {
              stats.fieldCounts[target] = (stats.fieldCounts[target] || 0) + 1;
            }
          }
        }

        stats.recordsEnriched++;
        if (windowGames.length > 0) stats.recordsWithRolling++;
      }
    }
  }

  // ─── Write back ──────────────────────────────────────────────────────────
  console.log("Writing enriched data...");
  fs.writeFileSync(PLAYER_FILE, JSON.stringify(playerGames, null, 2) + "\n", "utf-8");
  console.log(`  Saved to ${path.basename(PLAYER_FILE)}\n`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("  Player Rolling Averages Enrichment Summary");
  console.log("=".repeat(60));
  console.log(`  Total records:               ${stats.totalRecords.toLocaleString()}`);
  console.log(`  Records enriched:            ${stats.recordsEnriched.toLocaleString()}`);
  console.log(`  Records with rolling data:   ${stats.recordsWithRolling.toLocaleString()}`);
  console.log(`    (first game of each season has null rolling averages)`);
  console.log(`  Unique players processed:    ${stats.playersProcessed.toLocaleString()}`);
  console.log();
  console.log("  Non-null rolling field counts:");
  for (const [field, count] of Object.entries(stats.fieldCounts).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      console.log(`    ${field.padEnd(35)} ${count.toLocaleString()}`);
    }
  }

  // ─── Sample verification ─────────────────────────────────────────────────
  // Find a QB with rolling data in a recent season
  const sampleQB = playerGames.find(
    (g) =>
      g.position_group === "QB" &&
      g.rolling3_passing_yards != null &&
      g.season >= 2023 &&
      g.passing_yards >= 250
  );
  if (sampleQB) {
    console.log();
    console.log("  Sample QB with rolling averages:");
    console.log(
      `    ${sampleQB.player_display_name} | ${sampleQB.season} Wk ${sampleQB.week} vs ${sampleQB.opponent_team}`
    );
    console.log(
      `    Actual:  ${sampleQB.passing_yards} pass yds, ${sampleQB.passing_tds} TDs, ${sampleQB.fantasy_points_ppr} PPR`
    );
    console.log(
      `    Rolling: ${sampleQB.rolling3_passing_yards} avg pass yds, ` +
        `${sampleQB.rolling3_passing_tds} avg TDs, ` +
        `${sampleQB.rolling3_fantasy_points_ppr} avg PPR`
    );
  }

  const sampleRB = playerGames.find(
    (g) =>
      g.position_group === "RB" &&
      g.rolling3_rushing_yards != null &&
      g.season >= 2023 &&
      g.rushing_yards >= 80
  );
  if (sampleRB) {
    console.log("  Sample RB with rolling averages:");
    console.log(
      `    ${sampleRB.player_display_name} | ${sampleRB.season} Wk ${sampleRB.week} vs ${sampleRB.opponent_team}`
    );
    console.log(
      `    Actual:  ${sampleRB.rushing_yards} rush yds, ${sampleRB.rushing_tds} TDs`
    );
    console.log(
      `    Rolling: ${sampleRB.rolling3_rushing_yards} avg rush yds, ` +
        `${sampleRB.rolling3_rushing_tds} avg TDs`
    );
  }

  const sampleWR = playerGames.find(
    (g) =>
      g.position_group === "WR" &&
      g.rolling3_receiving_yards != null &&
      g.season >= 2023 &&
      g.receiving_yards >= 80
  );
  if (sampleWR) {
    console.log("  Sample WR with rolling averages:");
    console.log(
      `    ${sampleWR.player_display_name} | ${sampleWR.season} Wk ${sampleWR.week} vs ${sampleWR.opponent_team}`
    );
    console.log(
      `    Actual:  ${sampleWR.receiving_yards} rec yds, ${sampleWR.targets} targets`
    );
    console.log(
      `    Rolling: ${sampleWR.rolling3_receiving_yards} avg rec yds, ` +
        `${sampleWR.rolling3_targets} avg targets`
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  Done! Player rolling averages enriched.");
  console.log("=".repeat(60) + "\n");
}

main();
