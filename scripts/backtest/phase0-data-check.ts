import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Phase 0: Data Coverage & Quality Check ===");
  console.log(`Date: ${new Date().toISOString()}\n`);

  // 1. Game counts by season
  for (const season of [2025, 2026]) {
    const total = await prisma.nCAAMBGame.count({ where: { season } });
    const completed = await prisma.nCAAMBGame.count({
      where: { season, homeScore: { not: null } },
    });
    const withSpread = await prisma.nCAAMBGame.count({
      where: { season, spread: { not: null } },
    });
    const withOU = await prisma.nCAAMBGame.count({
      where: { season, overUnder: { not: null } },
    });
    const withKenpom = await prisma.nCAAMBGame.count({
      where: { season, homeAdjEM: { not: null } },
    });
    const completedWithKenpom = await prisma.nCAAMBGame.count({
      where: { season, homeScore: { not: null }, homeAdjEM: { not: null } },
    });
    const withFM = await prisma.nCAAMBGame.count({
      where: { season, fmHomePred: { not: null } },
    });
    const withML = await prisma.nCAAMBGame.count({
      where: { season, moneylineHome: { not: null } },
    });

    console.log(`--- Season ${season} ---`);
    console.log(`Total games:        ${total}`);
    console.log(`Completed (scored): ${completed}`);
    console.log(`With spread:        ${withSpread} (${((withSpread / completed) * 100).toFixed(1)}% of completed)`);
    console.log(`With O/U line:      ${withOU} (${((withOU / completed) * 100).toFixed(1)}% of completed)`);
    console.log(`With KenPom:        ${withKenpom} (${((withKenpom / completed) * 100).toFixed(1)}% of completed)`);
    console.log(`Completed+KenPom:   ${completedWithKenpom} (${((completedWithKenpom / completed) * 100).toFixed(1)}% of completed)`);
    console.log(`With FanMatch:      ${withFM} (${((withFM / completed) * 100).toFixed(1)}% of completed)`);
    console.log(`With moneyline:     ${withML} (${((withML / completed) * 100).toFixed(1)}% of completed)`);
    console.log();
  }

  // 2. Check for duplicate games
  const dupes = await prisma.$queryRaw<
    { gameDate: Date; homeTeamId: number; awayTeamId: number; cnt: bigint }[]
  >`
    SELECT "gameDate", "homeTeamId", "awayTeamId", COUNT(*) as cnt
    FROM "NCAAMBGame"
    GROUP BY "gameDate", "homeTeamId", "awayTeamId"
    HAVING COUNT(*) > 1
  `;
  console.log(`--- Duplicate Check ---`);
  console.log(`Duplicate game entries: ${dupes.length}`);
  if (dupes.length > 0) {
    console.log("First 5 duplicates:", dupes.slice(0, 5));
  }

  // 3. Missing results check
  const missingResults = await prisma.nCAAMBGame.count({
    where: {
      homeScore: { not: null },
      spreadResult: null,
      spread: { not: null },
    },
  });
  console.log(`\n--- Missing Results ---`);
  console.log(`Games with score + spread but no spreadResult: ${missingResults}`);

  const missingOUResult = await prisma.nCAAMBGame.count({
    where: {
      homeScore: { not: null },
      ouResult: null,
      overUnder: { not: null },
    },
  });
  console.log(`Games with score + O/U but no ouResult: ${missingOUResult}`);

  // 4. Consistency check: O/U result vs actual
  const ouInconsistent = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) as cnt FROM "NCAAMBGame"
    WHERE "homeScore" IS NOT NULL
      AND "overUnder" IS NOT NULL
      AND "ouResult" IS NOT NULL
      AND (
        ("ouResult" = 'OVER' AND ("homeScore" + "awayScore") < "overUnder")
        OR ("ouResult" = 'UNDER' AND ("homeScore" + "awayScore") > "overUnder")
      )
  `;
  console.log(`\n--- O/U Consistency ---`);
  console.log(`Inconsistent O/U results: ${ouInconsistent[0].cnt}`);

  // 5. Outlier scores
  const outlierHigh = await prisma.nCAAMBGame.count({
    where: {
      OR: [{ homeScore: { gt: 120 } }, { awayScore: { gt: 120 } }],
    },
  });
  const outlierLow = await prisma.nCAAMBGame.count({
    where: {
      homeScore: { not: null },
      OR: [{ homeScore: { lt: 30 } }, { awayScore: { lt: 30 } }],
    },
  });
  console.log(`\n--- Outlier Scores ---`);
  console.log(`Games with any team > 120: ${outlierHigh}`);
  console.log(`Games with any team < 30: ${outlierLow}`);

  // 6. Sample a few 2026 games without KenPom to see team names
  const sample2026 = await prisma.nCAAMBGame.findMany({
    where: { season: 2026, homeAdjEM: null, homeScore: { not: null } },
    include: { homeTeam: true, awayTeam: true },
    take: 10,
    orderBy: { gameDate: "desc" },
  });
  console.log(`\n--- Sample 2026 games WITHOUT KenPom ---`);
  for (const g of sample2026) {
    console.log(
      `  ${g.gameDate.toISOString().slice(0, 10)} | ${g.homeTeam.name} vs ${g.awayTeam.name} | ${g.homeScore}-${g.awayScore}`,
    );
  }

  // 7. Sample a few 2026 games WITH KenPom
  const sample2026K = await prisma.nCAAMBGame.findMany({
    where: { season: 2026, homeAdjEM: { not: null } },
    include: { homeTeam: true, awayTeam: true },
    take: 5,
    orderBy: { gameDate: "desc" },
  });
  console.log(`\n--- Sample 2026 games WITH KenPom ---`);
  for (const g of sample2026K) {
    console.log(
      `  ${g.gameDate.toISOString().slice(0, 10)} | ${g.homeTeam.name} vs ${g.awayTeam.name} | AdjEM: ${g.homeAdjEM}/${g.awayAdjEM}`,
    );
  }

  // 8. O/U baselines
  for (const season of [2025, 2026]) {
    const ou = await prisma.$queryRaw<
      { result: string; cnt: bigint }[]
    >`
      SELECT "ouResult" as result, COUNT(*) as cnt
      FROM "NCAAMBGame"
      WHERE season = ${season}
        AND "ouResult" IS NOT NULL
        AND "overUnder" IS NOT NULL
      GROUP BY "ouResult"
    `;
    console.log(`\n--- O/U Baselines (Season ${season}) ---`);
    const total = ou.reduce((s, r) => s + Number(r.cnt), 0);
    for (const r of ou) {
      console.log(`  ${r.result}: ${r.cnt} (${((Number(r.cnt) / total) * 100).toFixed(1)}%)`);
    }
  }

  // 9. Spread baselines
  for (const season of [2025, 2026]) {
    const sp = await prisma.$queryRaw<
      { result: string; cnt: bigint }[]
    >`
      SELECT "spreadResult" as result, COUNT(*) as cnt
      FROM "NCAAMBGame"
      WHERE season = ${season}
        AND "spreadResult" IS NOT NULL
        AND "spread" IS NOT NULL
      GROUP BY "spreadResult"
    `;
    console.log(`\n--- Spread Baselines (Season ${season}) ---`);
    const total = sp.reduce((s, r) => s + Number(r.cnt), 0);
    for (const r of sp) {
      console.log(`  ${r.result}: ${r.cnt} (${((Number(r.cnt) / total) * 100).toFixed(1)}%)`);
    }
  }

  // 10. Vegas line accuracy (total within 3 of O/U line)
  for (const season of [2025, 2026]) {
    const vegas = await prisma.$queryRaw<{ within3: bigint; total: bigint }[]>`
      SELECT
        COUNT(*) FILTER (WHERE ABS(("homeScore" + "awayScore") - "overUnder") <= 3) as "within3",
        COUNT(*) as total
      FROM "NCAAMBGame"
      WHERE season = ${season}
        AND "homeScore" IS NOT NULL
        AND "overUnder" IS NOT NULL
    `;
    const w = Number(vegas[0].within3);
    const t = Number(vegas[0].total);
    console.log(
      `\n--- Vegas Line Accuracy (Season ${season}) ---`,
    );
    console.log(`  Total within 3 of O/U line: ${w}/${t} (${((w / t) * 100).toFixed(1)}%)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
