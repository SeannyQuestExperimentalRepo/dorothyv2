/**
 * Import NCAAMB spread & O/U data from CSV files.
 *
 * Works with data from:
 *   - SportsBookReviewsOnline (Excel → CSV)
 *   - BigDataBall ($25/season)
 *   - Any CSV with columns: date, home_team, away_team, spread, over_under
 *
 * Expected CSV format (header row required):
 *   date,home_team,away_team,home_score,away_score,spread,over_under
 *
 * Alternative columns are auto-detected:
 *   - "close" / "closing_spread" / "line" → spread
 *   - "total" / "ou" / "closing_total" → over_under
 *   - "home" / "Home Team" → home_team
 *   - "away" / "Away Team" / "visitor" → away_team
 *
 * Usage:
 *   npx tsx scripts/import-odds-csv.ts data/ncaamb-odds-2026.csv [--dry-run] [--season 2026]
 */

import * as fs from "fs";
import { prisma } from "../src/lib/db";
import {
  calculateSpreadResult,
  calculateOUResult,
} from "../src/lib/espn-sync";

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SEASON = (() => {
  const idx = args.indexOf("--season");
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 2026;
})();

if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-odds-csv.ts <file.csv> [--dry-run] [--season 2026]");
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

interface CSVRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  spread: number | null;
  overUnder: number | null;
}

/** Normalize team name for fuzzy matching */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.''()]/g, "")
    .replace(/\s+/g, " ")
    .replace(/ st$/, " state") // Expand abbreviations
    .trim();
}

/** Parse a CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Detect which column indices map to which fields */
function detectColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const h = header.map((c) => c.toLowerCase().replace(/[^a-z0-9_]/g, ""));

  for (let i = 0; i < h.length; i++) {
    const col = h[i];
    if (["date", "game_date", "gamedate"].includes(col)) map.date = i;
    if (["home", "home_team", "hometeam"].includes(col)) map.homeTeam = i;
    if (["away", "away_team", "awayteam", "visitor", "road"].includes(col)) map.awayTeam = i;
    if (["home_score", "homescore", "home_pts", "homepts"].includes(col)) map.homeScore = i;
    if (["away_score", "awayscore", "away_pts", "awaypts", "visitor_score"].includes(col)) map.awayScore = i;
    if (["spread", "close", "closing_spread", "closingspread", "line", "closing_line"].includes(col)) map.spread = i;
    if (["over_under", "overunder", "total", "ou", "closing_total", "closingtotal"].includes(col)) map.overUnder = i;
  }

  return map;
}

function parseDate(dateStr: string): string | null {
  // Try various date formats
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];

  // Try MM/DD/YYYY
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [m, day, y] = parts;
    const d2 = new Date(`${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`);
    if (!isNaN(d2.getTime())) return d2.toISOString().split("T")[0];
  }

  return null;
}

async function main() {
  console.log(`\n=== Import NCAAMB Odds from CSV ===`);
  console.log(`File: ${csvPath}`);
  console.log(`Season: ${SEASON}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // Read and parse CSV
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length < 2) {
    console.error("CSV file is empty or has no data rows");
    process.exit(1);
  }

  const header = parseCSVLine(lines[0]);
  const colMap = detectColumns(header);

  console.log("Detected columns:");
  for (const [field, idx] of Object.entries(colMap)) {
    console.log(`  ${field} → column ${idx} (${header[idx]})`);
  }

  if (colMap.date === undefined || colMap.homeTeam === undefined || colMap.awayTeam === undefined) {
    console.error("\nMissing required columns: date, home_team, away_team");
    console.error("Found columns:", header.join(", "));
    process.exit(1);
  }

  if (colMap.spread === undefined && colMap.overUnder === undefined) {
    console.error("\nNo spread or over_under column found");
    console.error("Found columns:", header.join(", "));
    process.exit(1);
  }

  // Parse rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const dateStr = parseDate(fields[colMap.date]);
    if (!dateStr) continue;

    rows.push({
      date: dateStr,
      homeTeam: fields[colMap.homeTeam] ?? "",
      awayTeam: fields[colMap.awayTeam] ?? "",
      homeScore: colMap.homeScore !== undefined ? parseFloat(fields[colMap.homeScore]) : undefined,
      awayScore: colMap.awayScore !== undefined ? parseFloat(fields[colMap.awayScore]) : undefined,
      spread: colMap.spread !== undefined ? parseFloat(fields[colMap.spread]) || null : null,
      overUnder: colMap.overUnder !== undefined ? parseFloat(fields[colMap.overUnder]) || null : null,
    });
  }

  console.log(`\nParsed ${rows.length} data rows`);

  // Load DB games needing odds
  const dbGames = await prisma.nCAAMBGame.findMany({
    where: {
      season: SEASON,
      spread: null,
      homeScore: { not: null },
    },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  console.log(`${dbGames.length} DB games need spread/O-U data\n`);

  // Build lookup: "YYYY-MM-DD:normalizedHome:normalizedAway" → dbGame
  const dbLookup = new Map<string, (typeof dbGames)[number]>();
  for (const g of dbGames) {
    if (!g.gameDate) continue;
    const dateKey = g.gameDate.toISOString().split("T")[0];
    const key = `${dateKey}:${normalize(g.homeTeam.name)}:${normalize(g.awayTeam.name)}`;
    dbLookup.set(key, g);
  }

  // Match CSV rows to DB games
  let matched = 0;
  let updated = 0;
  let noMatch = 0;

  for (const row of rows) {
    if (row.spread === null && row.overUnder === null) continue;

    // Try exact normalized match
    const key = `${row.date}:${normalize(row.homeTeam)}:${normalize(row.awayTeam)}`;
    let dbGame = dbLookup.get(key);

    // Try fuzzy match by date
    if (!dbGame) {
      for (const [k, g] of dbLookup) {
        const [dateStr, dbHome, dbAway] = k.split(":");
        if (dateStr !== row.date) continue;

        const csvHome = normalize(row.homeTeam);
        const csvAway = normalize(row.awayTeam);

        if (
          (dbHome.includes(csvHome) || csvHome.includes(dbHome)) &&
          (dbAway.includes(csvAway) || csvAway.includes(dbAway))
        ) {
          dbGame = g;
          break;
        }
      }
    }

    if (!dbGame) {
      noMatch++;
      continue;
    }

    matched++;

    // Calculate results
    const spreadResult = calculateSpreadResult(
      dbGame.homeScore!,
      dbGame.awayScore!,
      row.spread,
    );
    const ouResult = calculateOUResult(
      dbGame.homeScore!,
      dbGame.awayScore!,
      row.overUnder,
    );

    if (DRY_RUN) {
      console.log(
        `[DRY] ${row.awayTeam} @ ${row.homeTeam} (${row.date}): spread=${row.spread}, O/U=${row.overUnder} → ${spreadResult}/${ouResult}`,
      );
    } else {
      await prisma.nCAAMBGame.update({
        where: { id: dbGame.id },
        data: {
          spread: row.spread,
          overUnder: row.overUnder,
          spreadResult,
          ouResult,
        },
      });
    }
    updated++;

    // Remove from lookup so we don't match the same game twice
    const matchKey = `${dbGame.gameDate!.toISOString().split("T")[0]}:${normalize(dbGame.homeTeam.name)}:${normalize(dbGame.awayTeam.name)}`;
    dbLookup.delete(matchKey);
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`CSV rows with odds: ${rows.filter((r) => r.spread !== null || r.overUnder !== null).length}`);
  console.log(`Matched to DB games: ${matched}`);
  console.log(`Updated: ${updated}`);
  console.log(`No match found: ${noMatch}`);
  console.log(
    `DB games still needing odds: ${dbGames.length - updated}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
