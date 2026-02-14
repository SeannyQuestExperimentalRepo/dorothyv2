/**
 * Backfill KenPom daily snapshots from the archive API.
 *
 * Strategy: Get all unique game dates from NCAAMBGame, then fetch
 * archive ratings for the day BEFORE each game date (the ratings
 * that would have been available pre-game).
 *
 * The archive endpoint: GET /api.php?endpoint=archive&d=YYYY-MM-DD
 * Returns ~364 team ratings as of that date.
 *
 * Rate limiting: 2-second delay between API calls.
 */
const { PrismaClient } = require("@prisma/client");

const KENPOM_BASE = "https://kenpom.com/api.php";
const DELAY_MS = 2000; // 2 seconds between API calls

async function fetchArchive(date, apiKey) {
  const url = `${KENPOM_BASE}?endpoint=archive&d=${date}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KenPom archive ${res.status} for ${date}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

function subtractDays(d, days) {
  const result = new Date(d);
  result.setDate(result.getDate() - days);
  return result;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const prisma = new PrismaClient();
  const apiKey = process.env.KENPOM_API_KEY;
  if (!apiKey) throw new Error("KENPOM_API_KEY not set");

  // Parse --since flag (e.g., --since=2024)
  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const sinceSeason = sinceArg ? parseInt(sinceArg.split("=")[1]) : null;

  // Get all unique game dates with KenPom data
  const where = { homeScore: { not: null }, homeAdjEM: { not: null } };
  if (sinceSeason) where.season = { gte: sinceSeason };

  const games = await prisma.nCAAMBGame.findMany({
    where,
    select: { gameDate: true, season: true },
    orderBy: { gameDate: "asc" },
  });

  if (sinceSeason) console.log(`Filtering to seasons >= ${sinceSeason}`);

  // Unique dates we need snapshots for (day before each game date)
  const gameDates = [...new Set(games.map((g) => formatDate(g.gameDate)))];
  const snapshotDates = [...new Set(gameDates.map((d) => formatDate(subtractDays(new Date(d), 1))))];

  console.log(`Found ${gameDates.length} unique game dates → ${snapshotDates.length} snapshot dates needed`);

  // Check which dates we already have
  const existing = await prisma.kenpomSnapshot.findMany({
    select: { snapshotDate: true },
    distinct: ["snapshotDate"],
  });
  const existingDates = new Set(existing.map((e) => formatDate(e.snapshotDate)));
  const needed = snapshotDates.filter((d) => !existingDates.has(d));

  console.log(`Already have ${existingDates.size} dates, need ${needed.length} more\n`);

  if (needed.length === 0) {
    console.log("All snapshots already backfilled!");
    await prisma.$disconnect();
    return;
  }

  let fetched = 0;
  let errors = 0;

  for (const date of needed) {
    try {
      const ratings = await fetchArchive(date, apiKey);

      if (!Array.isArray(ratings) || ratings.length === 0) {
        console.log(`  ${date}: empty response, skipping`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      const season = ratings[0].Season;

      // Batch upsert
      const records = ratings.map((r) => ({
        snapshotDate: new Date(date + "T00:00:00Z"),
        season,
        teamName: r.TeamName,
        adjEM: r.AdjEM,
        adjOE: r.AdjOE,
        adjDE: r.AdjDE,
        adjTempo: r.AdjTempo,
        rankAdjEM: r.RankAdjEM,
        confShort: r.ConfShort,
      }));

      // Use createMany with skipDuplicates for speed
      const result = await prisma.kenpomSnapshot.createMany({
        data: records,
        skipDuplicates: true,
      });

      fetched++;
      console.log(`  ${date}: ${result.count} teams (season ${season}) [${fetched}/${needed.length}]`);
    } catch (err) {
      console.error(`  ${date}: ERROR — ${err.message}`);
      errors++;

      // If we get rate limited, wait longer
      if (err.message.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone! Fetched ${fetched} dates, ${errors} errors`);

  // Summary
  const total = await prisma.kenpomSnapshot.count();
  const distinctDates = await prisma.kenpomSnapshot.findMany({
    select: { snapshotDate: true },
    distinct: ["snapshotDate"],
  });
  console.log(`Total snapshots in DB: ${total} (${distinctDates.length} unique dates)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
