/**
 * GET /api/games/injuries?sport=NFL&home=Kansas+City+Chiefs&away=Buffalo+Bills
 *
 * Returns current injury reports for both teams from ESPN.
 * No database storage — fetched live with CDN caching (15 min).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchInjuries,
  getInjuriesForTeam,
  type Injury,
} from "@/lib/espn-injuries";
import type { Sport } from "@/lib/espn-api";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB"];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const sport = searchParams.get("sport")?.toUpperCase();
  const homeTeam = searchParams.get("home");
  const awayTeam = searchParams.get("away");

  if (!sport || !homeTeam || !awayTeam) {
    return errorResponse("sport, home, and away params are required", 400);
  }

  if (!VALID_SPORTS.includes(sport)) {
    return errorResponse("sport must be NFL, NCAAF, or NCAAMB", 400);
  }

  try {
    const allInjuries = await fetchInjuries(sport as Sport);

    const homeInjuries: Injury[] = getInjuriesForTeam(allInjuries, homeTeam);
    const awayInjuries: Injury[] = getInjuriesForTeam(allInjuries, awayTeam);

    const durationMs = Math.round(performance.now() - start);

    const response = NextResponse.json({
      success: true,
      data: {
        home: homeInjuries,
        away: awayInjuries,
      },
      meta: {
        sport,
        homeTeam,
        awayTeam,
        lastUpdated: new Date().toISOString(),
        durationMs,
      },
    });

    // Cache at CDN for 15 min, serve stale for 30 min while revalidating
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=900, stale-while-revalidate=1800",
    );

    return response;
  } catch (err) {
    console.error("[GET /api/games/injuries] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
