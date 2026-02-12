/**
 * GET /api/odds/significant-moves?sport=NCAAMB
 *
 * Returns significant line movements detected from today's OddsSnapshot data.
 * Compares earliest vs latest snapshot for each game.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authLimiter, applyRateLimit } from "@/lib/rate-limit";
import { detectSignificantMoves } from "@/lib/line-movement";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB"];

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, authLimiter);
  if (limited) return limited;

  const sport = req.nextUrl.searchParams.get("sport")?.toUpperCase();

  if (!sport || !VALID_SPORTS.includes(sport)) {
    return NextResponse.json(
      { success: false, error: "sport is required (NFL, NCAAF, NCAAMB)" },
      { status: 400 },
    );
  }

  try {
    // Look at snapshots from the last 3 days (covers games with multiple captures)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const snapshots = await prisma.oddsSnapshot.findMany({
      where: {
        sport: sport as Sport,
        fetchedAt: { gte: threeDaysAgo },
      },
      select: {
        homeTeam: true,
        awayTeam: true,
        sport: true,
        bestSpread: true,
        bestTotal: true,
        fetchedAt: true,
      },
      orderBy: { fetchedAt: "asc" },
    });

    const moves = detectSignificantMoves(snapshots);

    return NextResponse.json({
      success: true,
      sport,
      moves,
      count: moves.length,
    });
  } catch (err) {
    console.error("[GET /api/odds/significant-moves]", err);
    return NextResponse.json(
      { success: false, error: "Failed to detect significant moves" },
      { status: 500 },
    );
  }
}
