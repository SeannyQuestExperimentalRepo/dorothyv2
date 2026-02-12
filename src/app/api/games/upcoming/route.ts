/**
 * GET /api/games/upcoming?sport=NFL
 * GET /api/games/upcoming           (all sports)
 *
 * Returns upcoming games with odds from the UpcomingGame table.
 * ISR-cached for 5 minutes (revalidate = 300).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicLimiter, applyRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];

export async function GET(request: NextRequest) {
  const limited = applyRateLimit(request, publicLimiter);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const sportParam = searchParams.get("sport")?.toUpperCase();

  // Validate sport if provided
  if (sportParam && !VALID_SPORTS.includes(sportParam)) {
    return NextResponse.json(
      { success: false, error: "sport must be NFL, NCAAF, or NCAAMB" },
      { status: 400 },
    );
  }

  try {
    // Use start of today in Eastern Time so games align with the US sports calendar.
    // Without this, yesterday's 7 PM+ ET games bleed into "today" because they cross
    // UTC midnight (e.g. 7 PM ET = 00:00 UTC next day).
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const todayStart = new Date(todayStr + "T05:00:00Z"); // ET midnight ≈ 05:00 UTC (EST)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      gameDate: { gte: todayStart },
    };
    if (sportParam) {
      where.sport = sportParam;
    }

    const games = await prisma.upcomingGame.findMany({
      where,
      orderBy: { gameDate: "asc" },
      take: 30,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        games: games.map((g) => ({
          id: g.id,
          sport: g.sport,
          gameDate: g.gameDate.toISOString(),
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeRank: g.homeRank,
          awayRank: g.awayRank,
          spread: g.spread,
          overUnder: g.overUnder,
          moneylineHome: g.moneylineHome,
          moneylineAway: g.moneylineAway,
        })),
        count: games.length,
        lastUpdated: games[0]?.lastUpdated?.toISOString() ?? null,
      },
    });
    response.headers.set(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (err) {
    console.error("[GET /api/games/upcoming] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch upcoming games" },
      { status: 500 },
    );
  }
}
