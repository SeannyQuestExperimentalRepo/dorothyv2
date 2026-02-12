/**
 * GET /api/odds/snapshots?sport=NCAAMB&home=Duke&away=North+Carolina
 *
 * Returns OddsSnapshot history for a specific game over the past 7 days.
 * Used by the line movement chart to show spread/total movement over time.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authLimiter, applyRateLimit } from "@/lib/rate-limit";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB"];

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, authLimiter);
  if (limited) return limited;

  const sport = req.nextUrl.searchParams.get("sport")?.toUpperCase();
  const home = req.nextUrl.searchParams.get("home");
  const away = req.nextUrl.searchParams.get("away");

  if (!sport || !VALID_SPORTS.includes(sport)) {
    return NextResponse.json(
      { success: false, error: "sport is required (NFL, NCAAF, NCAAMB)" },
      { status: 400 },
    );
  }

  if (!home || !away) {
    return NextResponse.json(
      { success: false, error: "home and away team names are required" },
      { status: 400 },
    );
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.oddsSnapshot.findMany({
      where: {
        sport: sport as Sport,
        homeTeam: home,
        awayTeam: away,
        fetchedAt: { gte: sevenDaysAgo },
      },
      orderBy: { fetchedAt: "asc" },
      select: {
        fetchedAt: true,
        bestSpread: true,
        bestTotal: true,
        bookmakers: true,
      },
    });

    return NextResponse.json({
      success: true,
      sport,
      home,
      away,
      snapshots: snapshots.map((s) => ({
        fetchedAt: s.fetchedAt.toISOString(),
        bestSpread: s.bestSpread,
        bestTotal: s.bestTotal,
        bookmakers: s.bookmakers,
      })),
      count: snapshots.length,
    });
  } catch (err) {
    console.error("[GET /api/odds/snapshots]", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch odds snapshots" },
      { status: 500 },
    );
  }
}
