/**
 * KenPom FanMatch Historical Data Importer
 *
 * Pulls all FanMatch game predictions for every day of every season.
 * FanMatch provides KenPom's projected scores and win probabilities
 * for every D-I game — this is gold for comparing predictions vs spreads.
 *
 * Fields per game: Season, GameID, DateOfGame, Visitor, Home,
 *   HomeRank, VisitorRank, HomePred, VisitorPred, HomeWP, PredTempo, ThrillScore
 *
 * Strategy: iterate through each day of the CBB season (~150 days × 12 seasons)
 * Available from 2014 onward.
 *
 * Usage:
 *   node scripts/scrapers/kenpom-fanmatch.js [--start YYYY] [--end YYYY]
 *   Default: 2014-2025
 */

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.KENPOM_API_KEY || "";
const BASE_URL = "https://kenpom.com/api.php";
const RATE_LIMIT_MS = 300; // 300ms between requests (gentle)

if (!API_KEY) {
  console.error("Error: KENPOM_API_KEY required.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchFanMatch(dateStr) {
  const url = `${BASE_URL}?endpoint=fanmatch&d=${dateStr}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (res.status === 404) return []; // No games that day
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${dateStr}`);
  }

  const text = await res.text();
  if (!text.startsWith("[")) return [];
  return JSON.parse(text);
}

/**
 * Generate all dates in a CBB season.
 * Season YYYY runs from November (YYYY-1) to April YYYY.
 * E.g., season 2024 = Nov 2023 to Apr 2024.
 */
function getSeasonDates(season) {
  const dates = [];
  // Start: November 1 of previous year
  const start = new Date(season - 1, 10, 1); // Nov 1
  // End: April 30 of the season year
  const end = new Date(season, 3, 30); // Apr 30

  let d = new Date(start);
  while (d <= end) {
    dates.push(formatDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function main() {
  const args = process.argv.slice(2);
  const startIdx = args.indexOf("--start");
  const endIdx = args.indexOf("--end");

  const startYear = startIdx >= 0 ? parseInt(args[startIdx + 1]) : 2014;
  const endYear = endIdx >= 0 ? parseInt(args[endIdx + 1]) : 2025;

  console.log(`KenPom FanMatch Import: ${startYear}-${endYear}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);

  const outputDir = path.join(__dirname, "../../data/raw/kenpom");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const allGames = [];
  let totalDays = 0;
  let daysWithGames = 0;
  let apiErrors = 0;

  for (let season = startYear; season <= endYear; season++) {
    const dates = getSeasonDates(season);
    let seasonGames = 0;

    console.log(`\n─── Season ${season} (${dates.length} days) ───`);

    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];
      totalDays++;

      try {
        const games = await fetchFanMatch(dateStr);
        if (games.length > 0) {
          allGames.push(...games);
          seasonGames += games.length;
          daysWithGames++;
        }
      } catch (err) {
        apiErrors++;
        if (apiErrors <= 5) {
          console.error(`  ERROR ${dateStr}: ${err.message}`);
        }
      }

      // Progress every 30 days
      if ((i + 1) % 30 === 0) {
        console.log(
          `  ${dates[i]}: ${seasonGames} games so far (${i + 1}/${dates.length} days)`
        );
      }

      await sleep(RATE_LIMIT_MS);
    }

    console.log(`  Season ${season}: ${seasonGames} games total`);

    // Checkpoint after each season
    const checkpointPath = path.join(outputDir, "kenpom-fanmatch.json");
    fs.writeFileSync(checkpointPath, JSON.stringify(allGames, null, 2));
    console.log(`  [Checkpoint: ${allGames.length} total games saved]`);
  }

  // Final save
  const outputPath = path.join(outputDir, "kenpom-fanmatch.json");
  fs.writeFileSync(outputPath, JSON.stringify(allGames, null, 2));

  console.log("\n═══ FANMATCH IMPORT COMPLETE ═══");
  console.log(`Seasons: ${startYear}-${endYear}`);
  console.log(`Total days checked: ${totalDays}`);
  console.log(`Days with games: ${daysWithGames}`);
  console.log(`Total games: ${allGames.length}`);
  console.log(`API errors: ${apiErrors}`);
  console.log(`\nSaved: ${outputPath}`);

  // Per-season breakdown
  const bySeason = {};
  for (const g of allGames) {
    bySeason[g.Season] = (bySeason[g.Season] || 0) + 1;
  }
  console.log("\nGames per season:");
  Object.entries(bySeason)
    .sort(([a], [b]) => a - b)
    .forEach(([s, c]) => console.log(`  ${s}: ${c}`));
}

main().catch(console.error);
