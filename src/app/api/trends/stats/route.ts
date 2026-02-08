/**
 * Dataset Statistics API Route
 *
 * GET /api/trends/stats — Returns game counts, season ranges, and
 * feature flags for each sport in the TrendLine dataset.
 */

import { NextResponse } from "next/server";
import { loadGamesBySportCached, type TrendGame } from "@/lib/trend-engine";

// --- Helpers (outside handler to avoid strict-mode block issues) ---

function getSeasonRange(games: TrendGame[]): [number, number] | null {
  if (games.length === 0) return null;
  const seasons = games.map((g) => g.season).filter(Boolean);
  return seasons.length > 0
    ? [Math.min(...seasons), Math.max(...seasons)]
    : null;
}

function hasField(games: TrendGame[], field: string): boolean {
  return games.some(
    (g) =>
      (g as unknown as Record<string, unknown>)[field] !== undefined &&
      (g as unknown as Record<string, unknown>)[field] !== null,
  );
}

// --- GET /api/trends/stats ---

export async function GET() {
  try {
    const start = performance.now();

    const nflGames = loadGamesBySportCached("NFL");
    const ncaafGames = loadGamesBySportCached("NCAAF");
    const ncaambGames = loadGamesBySportCached("NCAAMB");

    const nflSeasons = getSeasonRange(nflGames);
    const ncaafSeasons = getSeasonRange(ncaafGames);
    const ncaambSeasons = getSeasonRange(ncaambGames);

    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: {
        nfl: {
          totalGames: nflGames.length,
          seasons: nflSeasons,
          hasSpread: hasField(nflGames, "spread"),
        },
        ncaaf: {
          totalGames: ncaafGames.length,
          seasons: ncaafSeasons,
          hasWeather: hasField(ncaafGames, "weather"),
        },
        ncaamb: {
          totalGames: ncaambGames.length,
          seasons: ncaambSeasons,
          hasKenpom: hasField(ncaambGames, "kenpomRank"),
        },
        total: nflGames.length + ncaafGames.length + ncaambGames.length,
      },
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[GET /api/trends/stats] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
