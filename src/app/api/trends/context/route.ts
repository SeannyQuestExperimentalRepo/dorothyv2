/**
 * Daily Game Context API Route
 *
 * GET /api/trends/context?date=2024-10-06&sport=NFL
 *   — Get game context cards for all games on a date
 *
 * GET /api/trends/context?sport=NFL&home=Kansas City Chiefs&away=Buffalo Bills
 *   — Get context for a specific matchup
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getDailyGameContext,
  getMatchupContext,
} from "@/lib/game-context-engine";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const date = searchParams.get("date");
  const sport = searchParams.get("sport") as "NFL" | "NCAAF" | "NCAAMB" | null;
  const home = searchParams.get("home");
  const away = searchParams.get("away");
  const seasonStr = searchParams.get("season");

  try {
    // Matchup mode: specific home/away teams
    if (home && away && sport) {
      const season = seasonStr ? parseInt(seasonStr, 10) : undefined;
      const context = await getMatchupContext(sport, home, away, season);

      if (!context) {
        return NextResponse.json({
          success: true,
          data: { game: null, message: "No matching games found for this matchup" },
          meta: { durationMs: Math.round(performance.now() - start) },
        });
      }

      return NextResponse.json({
        success: true,
        data: { game: context },
        meta: { durationMs: Math.round(performance.now() - start) },
      });
    }

    // Daily mode: all games on a date
    if (!date) {
      return errorResponse("Either 'date' or 'home'+'away'+'sport' params are required", 400);
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse("Date must be in YYYY-MM-DD format", 400);
    }

    const result = await getDailyGameContext(date, sport || undefined);
    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: {
        date: result.date,
        games: result.games,
        gameCount: result.games.length,
        computedAt: result.computedAt,
      },
      meta: {
        durationMs,
        sport: sport || "ALL",
      },
    });
  } catch (err) {
    console.error("[GET /api/trends/context] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
