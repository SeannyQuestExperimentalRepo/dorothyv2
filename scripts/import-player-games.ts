/**
 * Import NFL player game logs from JSON into PostgreSQL.
 *
 * Reads data/nfl-player-games.json (268MB, ~105K records) and batch-inserts
 * into the PlayerGameLog table. Indexed columns are extracted for SQL filtering;
 * all other fields go into the JSONB `stats` column.
 *
 * Usage: npx tsx scripts/import-player-games.ts
 */

import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
const LOG_INTERVAL = 10_000;

// Fields that are stored as indexed columns (not in stats JSONB)
const INDEXED_FIELDS = new Set([
  "player_id",
  "player_display_name",
  "position",
  "position_group",
  "season",
  "week",
  "season_type",
  "team",
  "opponent_team",
  "gameDate",
  "isHome",
  "teamScore",
  "opponentScore",
  "gameResult",
  "spread",
  "overUnder",
  "spreadResult",
  "ouResult",
  "isPlayoff",
  "isPrimetime",
]);

async function main() {
  const filePath = path.resolve(process.cwd(), "data/nfl-player-games.json");

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  // Check if table already has data
  const existingCount = await prisma.playerGameLog.count();
  if (existingCount > 0) {
    console.log(`PlayerGameLog already has ${existingCount} records.`);
    console.log("Delete existing records first if you want to re-import.");
    console.log("Run: npx prisma db execute --stdin <<< 'TRUNCATE \"PlayerGameLog\" RESTART IDENTITY;'");
    process.exit(0);
  }

  console.log("Reading JSON file...");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>[];
  console.log(`Loaded ${raw.length} records from JSON`);

  let inserted = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const batch = raw.slice(i, i + BATCH_SIZE);

    const records = batch.map((row) => {
      // Build stats JSONB from non-indexed fields
      const stats: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(row)) {
        if (!INDEXED_FIELDS.has(key) && val !== null && val !== undefined) {
          stats[key] = val;
        }
      }

      return {
        playerId: String(row.player_id || ""),
        playerName: String(row.player_display_name || row.player_name || ""),
        position: String(row.position || ""),
        positionGroup: String(row.position_group || ""),
        season: Number(row.season) || 0,
        week: Number(row.week) || 0,
        seasonType: String(row.season_type || "REG"),
        team: String(row.team || ""),
        opponentTeam: String(row.opponent_team || ""),
        gameDate: row.gameDate ? new Date(row.gameDate as string) : null,
        isHome: typeof row.isHome === "boolean" ? row.isHome : null,
        teamScore: typeof row.teamScore === "number" ? row.teamScore : null,
        opponentScore: typeof row.opponentScore === "number" ? row.opponentScore : null,
        gameResult: typeof row.gameResult === "string" ? row.gameResult : null,
        spread: typeof row.spread === "number" ? row.spread : null,
        overUnder: typeof row.overUnder === "number" ? row.overUnder : null,
        spreadResult: typeof row.spreadResult === "string" ? row.spreadResult : null,
        ouResult: typeof row.ouResult === "string" ? row.ouResult : null,
        isPlayoff: row.isPlayoff === true,
        isPrimetime: typeof row.isPrimetime === "boolean" ? row.isPrimetime : null,
        stats,
      };
    });

    // Filter out records with missing required fields
    const validRecords = records.filter((r) => r.playerId && r.season > 0);
    skipped += records.length - validRecords.length;

    if (validRecords.length > 0) {
      await prisma.playerGameLog.createMany({
        data: validRecords,
        skipDuplicates: true,
      });
      inserted += validRecords.length;
    }

    if ((i + BATCH_SIZE) % LOG_INTERVAL < BATCH_SIZE || i + BATCH_SIZE >= raw.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.min(100, Math.round(((i + BATCH_SIZE) / raw.length) * 100));
      console.log(
        `  ${pct}% — ${inserted} inserted, ${skipped} skipped (${elapsed}s)`
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalCount = await prisma.playerGameLog.count();
  console.log(`\nDone! ${finalCount} records in PlayerGameLog (${totalTime}s)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Import failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
