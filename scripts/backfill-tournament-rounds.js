#!/usr/bin/env node

/**
 * Backfill tournamentRound for NCAA Tournament games.
 *
 * Uses date-based ordering within each season's tournament window to assign rounds.
 * Pattern: First Four → R64 → R32 → Sweet 16 → Elite 8 → Final Four → Championship
 *
 * Only processes games with isTournament=true AND isConferenceTourney=false
 * (excludes conference tournament games that share the isTournament flag).
 *
 * Usage:
 *   node scripts/backfill-tournament-rounds.js
 *   node scripts/backfill-tournament-rounds.js --dry-run
 */

require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Backfilling tournament rounds${dryRun ? " (DRY RUN)" : ""}\n`);

  // Get all NCAA tournament games (excluding conference tournament games)
  const seasons = await prisma.$queryRaw`
    SELECT DISTINCT season FROM "NCAAMBGame"
    WHERE "isTournament" = true AND "isConferenceTourney" = false
    ORDER BY season ASC
  `;

  let totalUpdated = 0;

  for (const { season } of seasons) {
    const games = await prisma.nCAAMBGame.findMany({
      where: {
        season,
        isTournament: true,
        isConferenceTourney: false,
      },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
      orderBy: { gameDate: "asc" },
    });

    if (games.length === 0) continue;

    // Group by date
    const byDate = new Map();
    for (const g of games) {
      const dk = g.gameDate.toISOString().split("T")[0];
      if (!byDate.has(dk)) byDate.set(dk, []);
      byDate.get(dk).push(g);
    }

    const dates = [...byDate.keys()].sort();

    // Assign rounds based on game count and position in the tournament
    // Expected pattern: FF(4), R64(32), R32(16), S16(8), E8(4), FF(2), Champ(1)
    // Running count through ordered dates
    let running = 0;
    const roundAssignments = new Map(); // gameId → round

    for (const date of dates) {
      const dateGames = byDate.get(date);
      const count = dateGames.length;

      let round;
      if (running === 0 && count <= 4 && games.length >= 67) {
        // First Four: first 2-4 games (only when total suggests First Four exists)
        round = "First Four";
      } else if (running + count <= 36) {
        // After First Four (or from start if no FF), games up to ~36 are R64
        round = running < 4 && games.length < 67 ? "Round of 64" : "Round of 64";
        if (running < 4 && count <= 4 && games.length >= 67) {
          round = "First Four";
        }
      } else {
        // Determine by running count
        round = "Round of 64"; // default
      }

      running += count;
      for (const g of dateGames) {
        roundAssignments.set(g.id, round);
      }
    }

    // Bottom-up approach: assign from the end of the tournament backwards.
    // Later rounds have fixed sizes, early rounds absorb any variation.
    roundAssignments.clear();
    const totalGames = games.length;

    // Assign from the end: Championship(1) + FF(2) + E8(4) + S16(8) + R32(16) + R64(32) = 63
    // Remaining games at the start are First Four
    const mainBracket = 63; // 32+16+8+4+2+1
    const ffCount = Math.max(0, totalGames - mainBracket);

    let cumulative = 0;
    for (const date of dates) {
      const dateGames = byDate.get(date);

      for (const g of dateGames) {
        let round;
        if (cumulative < ffCount) {
          round = "First Four";
        } else {
          const pos = cumulative - ffCount;
          if (pos < 32) round = "Round of 64";
          else if (pos < 48) round = "Round of 32";
          else if (pos < 56) round = "Sweet 16";
          else if (pos < 60) round = "Elite Eight";
          else if (pos < 62) round = "Final Four";
          else round = "Championship";
        }
        roundAssignments.set(g.id, round);
        cumulative++;
      }
    }

    // Count by round
    const roundCounts = {};
    for (const [, round] of roundAssignments) {
      roundCounts[round] = (roundCounts[round] || 0) + 1;
    }

    console.log(`${season}: ${totalGames} games → ${JSON.stringify(roundCounts)}`);

    // Apply updates
    if (!dryRun) {
      const roundGroups = new Map();
      for (const [id, round] of roundAssignments) {
        if (!roundGroups.has(round)) roundGroups.set(round, []);
        roundGroups.get(round).push(id);
      }

      for (const [round, ids] of roundGroups) {
        await prisma.nCAAMBGame.updateMany({
          where: { id: { in: ids } },
          data: { tournamentRound: round },
        });
      }
      totalUpdated += totalGames;
    }
  }

  console.log(`\nDone! Updated ${totalUpdated} games across ${seasons.length} seasons`);

  if (!dryRun) {
    // Validation
    const roundDist = await prisma.$queryRaw`
      SELECT "tournamentRound", COUNT(*)::int as games
      FROM "NCAAMBGame"
      WHERE "isTournament" = true AND "isConferenceTourney" = false
      AND "tournamentRound" IS NOT NULL
      GROUP BY "tournamentRound"
      ORDER BY games DESC
    `;
    console.log("\nRound distribution:");
    for (const r of roundDist) {
      console.log(`  ${r.tournamentRound}: ${r.games}`);
    }

    const nullRounds = await prisma.nCAAMBGame.count({
      where: {
        isTournament: true,
        isConferenceTourney: false,
        tournamentRound: null,
      },
    });
    console.log(`\nNULL rounds remaining: ${nullRounds} (should be 0)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
