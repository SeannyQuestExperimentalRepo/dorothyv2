import { prisma } from "@/lib/db";
import { HomeContent } from "@/components/home/home-content";

async function getStats() {
  try {
    const [nflAgg, ncaafAgg, ncaambAgg] = await Promise.all([
      prisma.nFLGame.aggregate({
        _count: true,
        _min: { season: true },
        _max: { season: true },
      }),
      prisma.nCAAFGame.aggregate({
        _count: true,
        _min: { season: true },
        _max: { season: true },
      }),
      prisma.nCAAMBGame.aggregate({
        _count: true,
        _min: { season: true },
        _max: { season: true },
      }),
    ]);

    return {
      nfl: {
        totalGames: nflAgg._count,
        seasons:
          nflAgg._min.season != null && nflAgg._max.season != null
            ? ([nflAgg._min.season, nflAgg._max.season] as [number, number])
            : null,
      },
      ncaaf: {
        totalGames: ncaafAgg._count,
        seasons:
          ncaafAgg._min.season != null && ncaafAgg._max.season != null
            ? ([ncaafAgg._min.season, ncaafAgg._max.season] as [number, number])
            : null,
      },
      ncaamb: {
        totalGames: ncaambAgg._count,
        seasons:
          ncaambAgg._min.season != null && ncaambAgg._max.season != null
            ? ([ncaambAgg._min.season, ncaambAgg._max.season] as [number, number])
            : null,
      },
      total: nflAgg._count + ncaafAgg._count + ncaambAgg._count,
    };
  } catch {
    return null;
  }
}

export default async function Home() {
  const stats = await getStats();
  return <HomeContent stats={stats} />;
}
