/**
 * POST /api/cron/daily-sync
 *
 * Daily cron job that:
 * 1. Refreshes upcoming games with current odds (capture BEFORE games start)
 * 2. Syncs yesterday's completed games into the historical DB
 *    (looks up pre-game odds from UpcomingGame table)
 *
 * IMPORTANT: Step 1 must run BEFORE step 2 so that today's odds are captured
 * in the UpcomingGame table before any games are marked as completed. The
 * UpcomingGame cleanup uses a 3-day window to ensure odds persist long enough
 * for the completed-game sync to find them.
 *
 * Protected by CRON_SECRET header (Vercel Cron sends this automatically).
 *
 * Schedules (vercel.json):
 *   0 11 * * *  (11:00 UTC = 6 AM ET) — morning sync + odds capture
 *   0 17 * * *  (17:00 UTC = 12 PM ET) — midday odds capture for afternoon games
 */

import { NextRequest, NextResponse } from "next/server";
import { syncCompletedGames, refreshUpcomingGames } from "@/lib/espn-sync";
import { clearGameCache } from "@/lib/trend-engine";
import { clearAnglesCache } from "@/lib/reverse-lookup-engine";
import { clearKenpomCache } from "@/lib/kenpom";
import type { Sport } from "@/lib/espn-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SPORTS: Sport[] = ["NFL", "NCAAF", "NCAAMB"];

export async function POST(request: NextRequest) {
  // Verify cron secret (fail-closed: reject if not configured)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const start = performance.now();
  const results: Record<string, unknown> = {};

  try {
    // 1. FIRST: Refresh upcoming games with odds
    // This captures today's spreads/totals BEFORE games start, so when they
    // complete later, syncCompletedGames can look up the pre-game odds.
    for (const sport of SPORTS) {
      try {
        const refreshResult = await refreshUpcomingGames(sport);
        results[`refresh_${sport}`] = refreshResult;
      } catch (err) {
        console.error(`[Cron] Refresh failed for ${sport}:`, err);
        results[`refresh_${sport}`] = {
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    // 2. THEN: Sync yesterday's completed games
    // lookupUpcomingGameOdds() searches for odds captured in step 1 (or
    // from a previous cron run) using a ±1 day date window.
    for (const sport of SPORTS) {
      try {
        const syncResult = await syncCompletedGames(sport);
        results[`sync_${sport}`] = syncResult;
      } catch (err) {
        console.error(`[Cron] Sync failed for ${sport}:`, err);
        results[`sync_${sport}`] = {
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }

    // 3. Grade yesterday's daily picks
    try {
      const { gradeYesterdaysPicks } = await import("@/lib/pick-engine");
      const gradeResult = await gradeYesterdaysPicks();
      results.grade_picks = gradeResult;
      console.log(`[Cron] Graded ${gradeResult.graded} picks (${gradeResult.errors} errors)`);
    } catch (err) {
      console.error("[Cron] Pick grading failed:", err);
      results.grade_picks = { error: err instanceof Error ? err.message : "Unknown error" };
    }

    // 4. Invalidate in-memory caches so new data is visible
    clearGameCache();
    clearAnglesCache();
    clearKenpomCache();
    console.log("[Cron] Game, angles, and KenPom caches cleared after sync");

    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: results,
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[Cron] Fatal error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

// Also support GET for Vercel Cron (which sends GET requests)
export async function GET(request: NextRequest) {
  return POST(request);
}
