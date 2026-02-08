/**
 * Add Rest Days Enrichment
 *
 * Computes rest/schedule situation fields for NFL, NCAAF, and NCAAMB games.
 * For each game, calculates how many calendar days each team had since their
 * previous game in the same season. This is a critical betting angle — teams
 * on short rest, back-to-backs (basketball), bye weeks (football), etc.
 *
 * Usage: node scripts/enrichments/add-rest-days.js
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

// ─── Date utilities (string-only, no Date object timezone issues) ───────────

/**
 * Parse a "YYYY-MM-DD" string into { year, month, day } integers.
 */
function parseDate(dateStr) {
  const parts = dateStr.split("-");
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10),
  };
}

/**
 * Convert a { year, month, day } object to a Julian Day Number.
 * This avoids all timezone issues by working purely with integers.
 * Formula from the US Naval Observatory.
 */
function toJulianDay(year, month, day) {
  // Adjust for Jan/Feb being months 13/14 of the previous year
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/**
 * Compute the number of calendar days between two "YYYY-MM-DD" date strings.
 * Returns dateB - dateA (positive if B is after A).
 */
function daysBetween(dateStrA, dateStrB) {
  const a = parseDate(dateStrA);
  const b = parseDate(dateStrB);
  return toJulianDay(b.year, b.month, b.day) - toJulianDay(a.year, a.month, a.day);
}

// ─── Core enrichment logic ──────────────────────────────────────────────────

/**
 * Build a map of team -> season -> sorted list of game dates.
 * A team can appear as home OR away in any game, so we check both sides.
 */
function buildTeamGameDates(games, homeField, awayField) {
  // Map: teamName -> Map(season -> [gameDates sorted ascending])
  const teamSeasonDates = new Map();

  for (const game of games) {
    const homeTeam = game[homeField];
    const awayTeam = game[awayField];
    const season = game.season;
    const date = game.gameDate;

    if (!homeTeam || !awayTeam || !date || season == null) continue;

    for (const team of [homeTeam, awayTeam]) {
      if (!teamSeasonDates.has(team)) {
        teamSeasonDates.set(team, new Map());
      }
      const seasonMap = teamSeasonDates.get(team);
      if (!seasonMap.has(season)) {
        seasonMap.set(season, []);
      }
      seasonMap.get(season).push(date);
    }
  }

  // Sort each team's dates within each season and deduplicate
  for (const [, seasonMap] of teamSeasonDates) {
    for (const [season, dates] of seasonMap) {
      const sorted = [...new Set(dates)].sort();
      seasonMap.set(season, sorted);
    }
  }

  return teamSeasonDates;
}

/**
 * Find the previous game date for a team in a given season before the given date.
 * Returns null if this is the team's first game of the season.
 */
function findPreviousGameDate(teamSeasonDates, team, season, currentDate) {
  const seasonMap = teamSeasonDates.get(team);
  if (!seasonMap) return null;

  const dates = seasonMap.get(season);
  if (!dates) return null;

  // Binary search for the current date, then look one step back
  // Dates are sorted ascending
  let prevDate = null;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= currentDate) break;
    prevDate = dates[i];
  }

  return prevDate;
}

/**
 * Enrich all games for a single sport with rest day fields.
 * Returns the enriched games array and summary statistics.
 */
function enrichGames(games, homeField, awayField, sport) {
  // Sort games by date ascending (stable sort preserves order for same-date games)
  games.sort((a, b) => (a.gameDate < b.gameDate ? -1 : a.gameDate > b.gameDate ? 1 : 0));

  // Build the team -> season -> dates lookup
  const teamSeasonDates = buildTeamGameDates(games, homeField, awayField);

  // Stats tracking
  const stats = {
    totalGames: games.length,
    gamesWithBothRestData: 0,
    homeRestTotal: 0,
    homeRestCount: 0,
    awayRestTotal: 0,
    awayRestCount: 0,
    restDistribution: {},
    // Sport-specific
    byeWeekGames: 0,
    shortWeekGames: 0,
    backToBackGames: 0,
  };

  for (const game of games) {
    const homeTeam = game[homeField];
    const awayTeam = game[awayField];
    const season = game.season;
    const currentDate = game.gameDate;

    // Compute rest days for home team
    const homePrevDate = findPreviousGameDate(teamSeasonDates, homeTeam, season, currentDate);
    const homeRestDays = homePrevDate !== null ? daysBetween(homePrevDate, currentDate) : null;

    // Compute rest days for away team
    const awayPrevDate = findPreviousGameDate(teamSeasonDates, awayTeam, season, currentDate);
    const awayRestDays = awayPrevDate !== null ? daysBetween(awayPrevDate, currentDate) : null;

    // Compute rest advantage
    const restAdvantage =
      homeRestDays !== null && awayRestDays !== null ? homeRestDays - awayRestDays : null;

    // Add core fields to every sport
    game.homeRestDays = homeRestDays;
    game.awayRestDays = awayRestDays;
    game.restAdvantage = restAdvantage;

    // Sport-specific fields
    if (sport === "NFL") {
      game.homeIsByeWeek = homeRestDays !== null && homeRestDays >= 12;
      game.awayIsByeWeek = awayRestDays !== null && awayRestDays >= 12;
      game.isShortWeek =
        (homeRestDays !== null && homeRestDays < 6) ||
        (awayRestDays !== null && awayRestDays < 6);

      if (game.homeIsByeWeek || game.awayIsByeWeek) stats.byeWeekGames++;
      if (game.isShortWeek) stats.shortWeekGames++;
    }

    if (sport === "NCAAF") {
      game.homeIsByeWeek = homeRestDays !== null && homeRestDays >= 12;
      game.awayIsByeWeek = awayRestDays !== null && awayRestDays >= 12;
      game.isShortWeek =
        (homeRestDays !== null && homeRestDays < 6) ||
        (awayRestDays !== null && awayRestDays < 6);

      if (game.homeIsByeWeek || game.awayIsByeWeek) stats.byeWeekGames++;
      if (game.isShortWeek) stats.shortWeekGames++;
    }

    if (sport === "NCAAMB") {
      game.homeIsBackToBack = homeRestDays !== null && homeRestDays === 1;
      game.awayIsBackToBack = awayRestDays !== null && awayRestDays === 1;

      if (game.homeIsBackToBack || game.awayIsBackToBack) stats.backToBackGames++;
    }

    // Accumulate stats
    if (homeRestDays !== null && awayRestDays !== null) {
      stats.gamesWithBothRestData++;
    }
    if (homeRestDays !== null) {
      stats.homeRestTotal += homeRestDays;
      stats.homeRestCount++;
      const bucket = homeRestDays >= 8 ? "8+" : String(homeRestDays);
      stats.restDistribution[bucket] = (stats.restDistribution[bucket] || 0) + 1;
    }
    if (awayRestDays !== null) {
      stats.awayRestTotal += awayRestDays;
      stats.awayRestCount++;
      const bucket = awayRestDays >= 8 ? "8+" : String(awayRestDays);
      stats.restDistribution[bucket] = (stats.restDistribution[bucket] || 0) + 1;
    }
  }

  return { games, stats };
}

// ─── Print summary ──────────────────────────────────────────────────────────

function printSummary(sport, stats) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${sport} Rest Days Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total games processed:        ${stats.totalGames.toLocaleString()}`);
  console.log(
    `  Games with both teams' rest:   ${stats.gamesWithBothRestData.toLocaleString()}`
  );

  const avgHome =
    stats.homeRestCount > 0 ? (stats.homeRestTotal / stats.homeRestCount).toFixed(2) : "N/A";
  const avgAway =
    stats.awayRestCount > 0 ? (stats.awayRestTotal / stats.awayRestCount).toFixed(2) : "N/A";
  console.log(`  Avg home rest days:           ${avgHome}`);
  console.log(`  Avg away rest days:           ${avgAway}`);

  if (sport === "NFL" || sport === "NCAAF") {
    console.log(`  Bye-week games:               ${stats.byeWeekGames.toLocaleString()}`);
    console.log(`  Short-week games:             ${stats.shortWeekGames.toLocaleString()}`);
  }

  if (sport === "NCAAMB") {
    console.log(`  Back-to-back games:           ${stats.backToBackGames.toLocaleString()}`);
  }

  // Rest day distribution (sorted by bucket)
  console.log(`\n  Rest Day Distribution (home + away combined):`);
  const buckets = ["1", "2", "3", "4", "5", "6", "7", "8+"];
  for (const bucket of buckets) {
    const count = stats.restDistribution[bucket] || 0;
    if (count > 0) {
      const bar = "#".repeat(Math.min(Math.round(count / 100), 60));
      console.log(`    ${bucket.padStart(3)} days: ${count.toLocaleString().padStart(8)}  ${bar}`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log("Add Rest Days Enrichment");
  console.log("========================\n");

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
  console.log("  Done! All sports enriched with rest day data.");
  console.log(`${"=".repeat(60)}\n`);
}

main();
