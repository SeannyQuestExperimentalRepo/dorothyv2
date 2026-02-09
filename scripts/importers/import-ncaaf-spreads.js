/**
 * NCAAF Spread Data Importer
 *
 * Merges point spread and over/under data into the NCAAF staging JSON.
 * Supports two data sources:
 *
 * 1. CFBD API (College Football Data):
 *    - Requires API key from collegefootballdata.com
 *    - Free tier: 1,000 calls/month
 *    - Usage: node import-ncaaf-spreads.js --cfbd --key YOUR_API_KEY
 *
 * 2. CSV/JSON file:
 *    - Any file with: date, homeTeam, awayTeam, spread, overUnder
 *    - Usage: node import-ncaaf-spreads.js --file path/to/spreads.csv
 *
 * Output: Updates data/ncaaf-games-staging.json with spread/OU data
 */

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "../../data/ncaaf-games-final.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const CFBD_BASE = "https://api.collegefootballdata.com";
const RATE_LIMIT_MS = 1000; // 1 second between CFBD calls

// ─── Spread Result Calculation ──────────────────────────────────────────────

function calculateSpreadResult(homeScore, awayScore, spread) {
  if (spread === null || spread === undefined) return null;
  const margin = (homeScore - awayScore) + spread;
  if (margin > 0) return "COVERED";
  if (margin < 0) return "LOST";
  return "PUSH";
}

function calculateOUResult(homeScore, awayScore, overUnder) {
  if (overUnder === null || overUnder === undefined) return null;
  const total = homeScore + awayScore;
  if (total > overUnder) return "OVER";
  if (total < overUnder) return "UNDER";
  return "PUSH";
}

// ─── CFBD API Fetch ─────────────────────────────────────────────────────────

async function fetchCFBDLines(year, apiKey) {
  const url = `${CFBD_BASE}/lines?year=${year}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`CFBD API error: HTTP ${res.status} for year ${year}`);
  }

  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Match CFBD line to staging game ────────────────────────────────────────

// CFBD name -> our canonical name (direct map for FBS teams with different names)
const CFBD_TO_CANONICAL = {
  "App State": "Appalachian State",
  "BYU": "BYU Cougars",
  "LSU": "LSU Tigers",
  "Miami": "Miami (FL)",
  "Middle Tennessee": "Middle Tennessee State",
  "NC State": "NC State Wolfpack",
  "Ole Miss": "Ole Miss Rebels",
  "San José State": "San Jose State",
  "SMU": "SMU Mustangs",
  "Southern Miss": "Southern Mississippi",
  "TCU": "TCU Horned Frogs",
  "UAB": "UAB Blazers",
  "UCF": "UCF Knights",
  "UConn": "Connecticut",
  "UL Monroe": "Louisiana-Monroe",
  "UNLV": "UNLV Rebels",
  "USC": "USC Trojans",
  "UTEP": "UTEP Miners",
  "UTSA": "UTSA Roadrunners",
  "Hawai'i": "Hawaii",
  "UMass": "Massachusetts",
  "SE Louisiana": "Southeastern Louisiana",
  "Louisiana": "Louisiana Ragin' Cajuns",
};

function normalizeTeamName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/state$/, "st")
    .replace(/university$/, "");
}

/**
 * Build a multi-key game index: date + various normalized team name forms.
 * For each game, index by homeTeam, homeTeamCanonical, and homeSlug.
 */
function buildGameIndex(games) {
  const index = {};

  function addKey(key, idx) {
    if (!index[key]) index[key] = [];
    index[key].push(idx);
  }

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const date = g.gameDate;
    if (!date) continue;

    // Index by homeTeam (short name)
    if (g.homeTeam) {
      addKey(`${date}|${normalizeTeamName(g.homeTeam)}`, i);
    }
    // Index by homeTeamCanonical (full name)
    if (g.homeTeamCanonical) {
      addKey(`${date}|${normalizeTeamName(g.homeTeamCanonical)}`, i);
    }
    // Index by homeSlug (sports-reference URL slug)
    if (g.homeSlug) {
      addKey(`${date}|${normalizeTeamName(g.homeSlug)}`, i);
    }
  }
  return index;
}

/**
 * Try to find a game match for a CFBD record using multiple name forms.
 */
function findGameMatch(gameIndex, dateStr, cfbdTeamName) {
  // Try direct CFBD name
  let key = `${dateStr}|${normalizeTeamName(cfbdTeamName)}`;
  if (gameIndex[key]) return gameIndex[key];

  // Try canonical alias
  const canonical = CFBD_TO_CANONICAL[cfbdTeamName];
  if (canonical) {
    key = `${dateStr}|${normalizeTeamName(canonical)}`;
    if (gameIndex[key]) return gameIndex[key];
  }

  return null;
}

// ─── CFBD Mode ──────────────────────────────────────────────────────────────

async function importFromCFBD(apiKey) {
  const seasons = new Set(data.map((g) => g.season));
  const sortedSeasons = Array.from(seasons).sort();

  console.log(`Fetching CFBD lines for ${sortedSeasons.length} seasons...`);
  console.log(`Seasons: ${sortedSeasons[0]}-${sortedSeasons[sortedSeasons.length - 1]}\n`);

  const gameIndex = buildGameIndex(data);
  let matched = 0;
  let unmatched = 0;

  for (const year of sortedSeasons) {
    try {
      const lines = await fetchCFBDLines(year, apiKey);
      console.log(`  ${year}: ${lines.length} games with lines`);

      for (const game of lines) {
        // CFBD returns lines array per game, pick consensus or first provider
        if (!game.lines || game.lines.length === 0) continue;

        // Prefer "consensus" provider, fallback to first available
        const line =
          game.lines.find((l) => l.provider === "consensus") ||
          game.lines.find((l) => l.provider === "Bovada") ||
          game.lines[0];

        const spread = line.spread ? parseFloat(line.spread) : null;
        const overUnder = line.overUnder ? parseFloat(line.overUnder) : null;

        // Match to staging game
        const dateStr = game.startDate
          ? game.startDate.substring(0, 10)
          : null;
        if (!dateStr) continue;

        const candidates = findGameMatch(gameIndex, dateStr, game.homeTeam || "");

        if (candidates && candidates.length > 0) {
          const idx = candidates[0]; // Take first match
          data[idx].spread = spread;
          data[idx].overUnder = overUnder;
          data[idx].spreadResult = calculateSpreadResult(
            data[idx].homeScore,
            data[idx].awayScore,
            spread
          );
          data[idx].ouResult = calculateOUResult(
            data[idx].homeScore,
            data[idx].awayScore,
            overUnder
          );
          matched++;
        } else {
          unmatched++;
        }
      }

      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.error(`  ERROR ${year}: ${err.message}`);
    }
  }

  return { matched, unmatched };
}

// ─── CSV/JSON File Mode ─────────────────────────────────────────────────────

function importFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let records;

  if (ext === ".json") {
    records = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } else if (ext === ".csv") {
    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    records = lines.slice(1).map((line) => {
      const values = line.split(",");
      const obj = {};
      headers.forEach((h, i) => (obj[h] = values[i]?.trim()));
      return obj;
    });
  } else {
    throw new Error(`Unsupported file format: ${ext}`);
  }

  console.log(`Loaded ${records.length} spread records from ${filePath}\n`);

  const gameIndex = buildGameIndex(data);
  let matched = 0;
  let unmatched = 0;

  for (const rec of records) {
    const dateStr = rec.date || rec.gameDate || rec.game_date;
    const homeTeam = rec.homeTeam || rec.home_team || rec.home;
    const spread = rec.spread ? parseFloat(rec.spread) : null;
    const overUnder =
      rec.overUnder || rec.over_under || rec.total
        ? parseFloat(rec.overUnder || rec.over_under || rec.total)
        : null;

    if (!dateStr || !homeTeam) continue;

    const key = `${dateStr}|${normalizeTeamName(homeTeam)}`;
    const candidates = gameIndex[key];

    if (candidates && candidates.length > 0) {
      const idx = candidates[0];
      data[idx].spread = spread;
      data[idx].overUnder = overUnder;
      data[idx].spreadResult = calculateSpreadResult(
        data[idx].homeScore,
        data[idx].awayScore,
        spread
      );
      data[idx].ouResult = calculateOUResult(
        data[idx].homeScore,
        data[idx].awayScore,
        overUnder
      );
      matched++;
    } else {
      unmatched++;
    }
  }

  return { matched, unmatched };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cfbd")) {
    const keyIdx = args.indexOf("--key");
    const apiKey = keyIdx >= 0 ? args[keyIdx + 1] : process.env.CFBD_API_KEY;

    if (!apiKey) {
      console.error("Error: CFBD API key required.");
      console.error("Usage: node import-ncaaf-spreads.js --cfbd --key YOUR_API_KEY");
      console.error("   or: CFBD_API_KEY=key node import-ncaaf-spreads.js --cfbd");
      process.exit(1);
    }

    const { matched, unmatched } = await importFromCFBD(apiKey);
    console.log(`\nCFBD import: ${matched} matched, ${unmatched} unmatched`);
  } else if (args.includes("--file")) {
    const fileIdx = args.indexOf("--file");
    const filePath = args[fileIdx + 1];

    if (!filePath) {
      console.error("Error: file path required.");
      console.error("Usage: node import-ncaaf-spreads.js --file path/to/spreads.csv");
      process.exit(1);
    }

    const { matched, unmatched } = importFromFile(filePath);
    console.log(`\nFile import: ${matched} matched, ${unmatched} unmatched`);
  } else {
    console.log("NCAAF Spread Data Importer");
    console.log("─────────────────────────");
    console.log("");
    console.log("Usage:");
    console.log("  From CFBD API:  node import-ncaaf-spreads.js --cfbd --key YOUR_API_KEY");
    console.log("  From file:      node import-ncaaf-spreads.js --file path/to/spreads.csv");
    console.log("");
    console.log("Get a free CFBD API key at: https://collegefootballdata.com/key");
    console.log("");

    // Show current spread coverage
    const withSpread = data.filter((g) => g.spread !== null);
    const withOU = data.filter((g) => g.overUnder !== null);
    console.log(`Current staging data: ${data.length} games`);
    console.log(`  With spread: ${withSpread.length}`);
    console.log(`  With O/U:    ${withOU.length}`);
    console.log(`  Missing:     ${data.length - withSpread.length}`);
    return;
  }

  // Save updated data
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`\nUpdated: ${dataPath}`);

  // Stats
  const withSpread = data.filter((g) => g.spread !== null);
  const withOU = data.filter((g) => g.overUnder !== null);
  console.log(`\nFinal spread coverage: ${withSpread.length}/${data.length} games`);
  console.log(`Final O/U coverage:    ${withOU.length}/${data.length} games`);
}

main().catch(console.error);
