import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Phase 0: Bettable Game Coverage ===\n");

  for (const season of [2025, 2026]) {
    const bettable = await prisma.nCAAMBGame.count({
      where: { season, homeScore: { not: null }, spread: { not: null }, overUnder: { not: null } },
    });
    const bettableWithKenpom = await prisma.nCAAMBGame.count({
      where: {
        season,
        homeScore: { not: null },
        spread: { not: null },
        overUnder: { not: null },
        homeAdjEM: { not: null },
      },
    });
    const bettableWithFM = await prisma.nCAAMBGame.count({
      where: {
        season,
        homeScore: { not: null },
        spread: { not: null },
        overUnder: { not: null },
        fmHomePred: { not: null },
      },
    });

    console.log(`--- Season ${season} (bettable = has spread + O/U + score) ---`);
    console.log(`Bettable games:     ${bettable}`);
    console.log(`+ KenPom:           ${bettableWithKenpom} (${((bettableWithKenpom / bettable) * 100).toFixed(1)}%)`);
    console.log(`+ FanMatch:         ${bettableWithFM} (${((bettableWithFM / bettable) * 100).toFixed(1)}%)`);
    console.log();
  }

  // Date range for 2026 games with spread data
  const earliest2026 = await prisma.nCAAMBGame.findFirst({
    where: { season: 2026, spread: { not: null } },
    orderBy: { gameDate: "asc" },
    select: { gameDate: true },
  });
  const latest2026 = await prisma.nCAAMBGame.findFirst({
    where: { season: 2026, spread: { not: null } },
    orderBy: { gameDate: "desc" },
    select: { gameDate: true },
  });
  console.log(`2026 bettable date range: ${earliest2026?.gameDate.toISOString().slice(0, 10)} to ${latest2026?.gameDate.toISOString().slice(0, 10)}`);

  // Monthly breakdown of 2026 bettable games
  const monthly2026 = await prisma.$queryRaw<
    { month: number; cnt: bigint; withKenpom: bigint }[]
  >`
    SELECT
      EXTRACT(MONTH FROM "gameDate")::int as month,
      COUNT(*) as cnt,
      COUNT(*) FILTER (WHERE "homeAdjEM" IS NOT NULL) as "withKenpom"
    FROM "NCAAMBGame"
    WHERE season = 2026
      AND "homeScore" IS NOT NULL
      AND "spread" IS NOT NULL
    GROUP BY EXTRACT(MONTH FROM "gameDate")
    ORDER BY month
  `;
  console.log(`\n--- 2026 Bettable Games by Month ---`);
  for (const m of monthly2026) {
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    console.log(
      `  ${monthNames[m.month]}: ${m.cnt} games, ${m.withKenpom} with KenPom (${((Number(m.withKenpom) / Number(m.cnt)) * 100).toFixed(1)}%)`,
    );
  }

  // 2025 monthly breakdown
  const monthly2025 = await prisma.$queryRaw<
    { month: number; cnt: bigint; withKenpom: bigint }[]
  >`
    SELECT
      EXTRACT(MONTH FROM "gameDate")::int as month,
      COUNT(*) as cnt,
      COUNT(*) FILTER (WHERE "homeAdjEM" IS NOT NULL) as "withKenpom"
    FROM "NCAAMBGame"
    WHERE season = 2025
      AND "homeScore" IS NOT NULL
      AND "spread" IS NOT NULL
    GROUP BY EXTRACT(MONTH FROM "gameDate")
    ORDER BY month
  `;
  console.log(`\n--- 2025 Bettable Games by Month ---`);
  for (const m of monthly2025) {
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    console.log(
      `  ${monthNames[m.month]}: ${m.cnt} games, ${m.withKenpom} with KenPom (${((Number(m.withKenpom) / Number(m.cnt)) * 100).toFixed(1)}%)`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
