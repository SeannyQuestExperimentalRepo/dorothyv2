#!/usr/bin/env node

/**
 * Backfill KenPom supplemental data (pointdist, height).
 *
 * Usage:
 *   node scripts/backfill-kenpom-all.js                    # all endpoints, all seasons
 *   node scripts/backfill-kenpom-all.js --endpoint=pointdist
 *   node scripts/backfill-kenpom-all.js --endpoint=height --since=2020
 *
 * Rate limiting: 2s between API calls, 30s on 429.
 * Uses createMany + skipDuplicates for idempotent runs.
 */

require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

const KENPOM_BASE = "https://kenpom.com/api.php";
const DELAY_MS = 2000;
const FIRST_SEASON = 2002; // KenPom data starts around 2002

async function fetchKenpom(endpoint, params, apiKey) {
  const url = new URL(KENPOM_BASE);
  url.searchParams.set("endpoint", endpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 429) throw new Error("429 rate limited");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KenPom ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Endpoint handlers ──────────────────────────────────────────────────────

async function backfillPointDist(prisma, apiKey, sinceSeason) {
  console.log("\n=== Point Distribution ===\n");

  // Check existing seasons
  const existing = await prisma.kenpomPointDist.groupBy({
    by: ["season"],
    _count: true,
  });
  const existingSeasons = new Set(existing.map((e) => e.season));

  for (let y = sinceSeason; y <= 2026; y++) {
    if (existingSeasons.has(y)) {
      console.log(`  ${y}: already have data, skipping`);
      continue;
    }

    try {
      const raw = await fetchKenpom("pointdist", { y: String(y) }, apiKey);
      if (!Array.isArray(raw) || raw.length === 0) {
        console.log(`  ${y}: empty response`);
        await sleep(DELAY_MS);
        continue;
      }

      const records = raw.map((r) => ({
        season: r.Season,
        teamName: r.TeamName,
        confShort: r.ConfShort,
        offFt: r.OffFt,
        offFg2: r.OffFg2,
        offFg3: r.OffFg3,
        rankOffFt: r.RankOffFt,
        rankOffFg2: r.RankOffFg2,
        rankOffFg3: r.RankOffFg3,
        defFt: r.DefFt,
        defFg2: r.DefFg2,
        defFg3: r.DefFg3,
        rankDefFt: r.RankDefFt,
        rankDefFg2: r.RankDefFg2,
        rankDefFg3: r.RankDefFg3,
      }));

      const result = await prisma.kenpomPointDist.createMany({
        data: records,
        skipDuplicates: true,
      });

      console.log(`  ${y}: ${result.count} teams`);
    } catch (err) {
      console.error(`  ${y}: ERROR — ${err.message}`);
      if (err.message.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
        y--; // retry
        continue;
      }
    }

    await sleep(DELAY_MS);
  }

  const total = await prisma.kenpomPointDist.count();
  console.log(`\nTotal point dist records: ${total}`);
}

async function backfillHeight(prisma, apiKey, sinceSeason) {
  console.log("\n=== Height / Experience ===\n");

  const existing = await prisma.kenpomHeight.groupBy({
    by: ["season"],
    _count: true,
  });
  const existingSeasons = new Set(existing.map((e) => e.season));

  for (let y = sinceSeason; y <= 2026; y++) {
    if (existingSeasons.has(y)) {
      console.log(`  ${y}: already have data, skipping`);
      continue;
    }

    try {
      const raw = await fetchKenpom("height", { y: String(y) }, apiKey);
      if (!Array.isArray(raw) || raw.length === 0) {
        console.log(`  ${y}: empty response`);
        await sleep(DELAY_MS);
        continue;
      }

      const records = raw.map((r) => ({
        season: r.Season,
        teamName: r.TeamName,
        confShort: r.ConfShort,
        avgHgt: r.AvgHgt,
        avgHgtRank: r.AvgHgtRank,
        hgtEff: r.HgtEff,
        hgtEffRank: r.HgtEffRank,
        hgt5: r.Hgt5,
        hgt5Rank: r.Hgt5Rank,
        hgt4: r.Hgt4,
        hgt4Rank: r.Hgt4Rank,
        hgt3: r.Hgt3,
        hgt3Rank: r.Hgt3Rank,
        hgt2: r.Hgt2,
        hgt2Rank: r.Hgt2Rank,
        hgt1: r.Hgt1,
        hgt1Rank: r.Hgt1Rank,
        exp: r.Exp,
        expRank: r.ExpRank,
        bench: r.Bench,
        benchRank: r.BenchRank,
        continuity: r.Continuity,
        continuityRank: r.RankContinuity,
      }));

      const result = await prisma.kenpomHeight.createMany({
        data: records,
        skipDuplicates: true,
      });

      console.log(`  ${y}: ${result.count} teams`);
    } catch (err) {
      console.error(`  ${y}: ERROR — ${err.message}`);
      if (err.message.includes("429")) {
        console.log("  Rate limited, waiting 30s...");
        await sleep(30000);
        y--; // retry
        continue;
      }
    }

    await sleep(DELAY_MS);
  }

  const total = await prisma.kenpomHeight.count();
  console.log(`\nTotal height records: ${total}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  const apiKey = process.env.KENPOM_API_KEY;
  if (!apiKey) throw new Error("KENPOM_API_KEY not set");

  const epArg = process.argv.find((a) => a.startsWith("--endpoint="));
  const endpoint = epArg ? epArg.split("=")[1] : "all";

  const sinceArg = process.argv.find((a) => a.startsWith("--since="));
  const sinceSeason = sinceArg ? parseInt(sinceArg.split("=")[1]) : FIRST_SEASON;

  console.log(`Backfilling KenPom data: endpoint=${endpoint}, since=${sinceSeason}`);

  try {
    if (endpoint === "all" || endpoint === "pointdist") {
      await backfillPointDist(prisma, apiKey, sinceSeason);
    }
    if (endpoint === "all" || endpoint === "height") {
      await backfillHeight(prisma, apiKey, sinceSeason);
    }

    console.log("\nDone!");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
