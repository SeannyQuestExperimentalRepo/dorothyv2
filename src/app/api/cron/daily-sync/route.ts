/**
 * POST /api/cron/daily-sync
 *
 * Daily cron job that:
 * 1. Refreshes upcoming games with current odds from ESPN
 * 1.5. Supplements NCAAMB odds from The Odds API (fills ESPN gaps)
 * 2. Syncs yesterday's completed games into the historical DB
 * 2.5. Backfills yesterday's NCAAMB games still missing spreads (morning only)
 * 3. Generates daily picks
 * 4-7. Grades picks, grades bets, evaluates trends, clears caches
 *
 * IMPORTANT: Step 1/1.5 must run BEFORE step 2 so that today's odds are
 * captured in the UpcomingGame table before any games are marked as completed.
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
export const maxDuration = 300;

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
          error: "Unknown error",
        };
      }
    }

    // 1.5. Supplement NCAAMB odds from The Odds API
    // Fills UpcomingGame gaps so syncCompletedGames finds odds for games ESPN missed.
    try {
      const { supplementUpcomingGamesFromOddsApi } = await import("@/lib/odds-api-sync");
      const supplementResult = await supplementUpcomingGamesFromOddsApi("NCAAMB");
      results.supplement_NCAAMB = supplementResult;
      console.log(
        `[Cron] OddsAPI supplement: fetched=${supplementResult.fetched}, supplemented=${supplementResult.supplemented}, enriched=${supplementResult.enriched}`,
      );
    } catch (err) {
      console.error("[Cron] OddsAPI supplement failed:", err);
      results.supplement_NCAAMB = { error: "Unknown error" };
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
          error: "Unknown error",
        };
      }
    }

    // 2.5. Backfill yesterday's NCAAMB games that still lack spreads (morning run only)
    try {
      const { backfillYesterdayOdds } = await import("@/lib/odds-api-sync");
      const backfillResult = await backfillYesterdayOdds();
      results.backfill_NCAAMB = backfillResult;
      console.log(
        `[Cron] OddsAPI backfill: updated=${backfillResult.updated}, notMatched=${backfillResult.notMatched}`,
      );
    } catch (err) {
      console.error("[Cron] OddsAPI backfill failed:", err);
      results.backfill_NCAAMB = { error: "Unknown error" };
    }

    // 3. Pre-generate today's daily picks for all sports
    // Done here (after odds refresh) so picks are ready before users check
    {
      const { generateDailyPicks } = await import("@/lib/pick-engine");
      const { prisma } = await import("@/lib/db");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const todayKey = new Date(todayStr + "T00:00:00Z");

      for (const sport of SPORTS) {
        try {
          // Skip if picks already exist for today
          const existing = await prisma.dailyPick.count({
            where: { date: todayKey, sport },
          });
          if (existing > 0) {
            results[`picks_${sport}`] = { skipped: true, existing };
            continue;
          }

          const picks = await generateDailyPicks(todayStr, sport);
          if (picks.length > 0) {
            await prisma.dailyPick.createMany({
              data: picks.map((p) => ({
                date: todayKey,
                sport: p.sport,
                pickType: p.pickType,
                homeTeam: p.homeTeam,
                awayTeam: p.awayTeam,
                gameDate: p.gameDate,
                pickSide: p.pickSide,
                line: p.line,
                pickLabel: p.pickLabel,
                playerName: p.playerName,
                propStat: p.propStat,
                propLine: p.propLine,
                trendScore: p.trendScore,
                confidence: p.confidence,
                headline: p.headline,
                reasoning: p.reasoning as unknown as import("@prisma/client").Prisma.InputJsonValue,
              })),
              skipDuplicates: true,
            });
          }
          results[`picks_${sport}`] = { generated: picks.length };
          console.log(`[Cron] Generated ${picks.length} picks for ${sport}`);
        } catch (err) {
          console.error(`[Cron] Pick generation failed for ${sport}:`, err);
          results[`picks_${sport}`] = { error: "Unknown error" };
        }
      }
    }

    // 4. Grade yesterday's daily picks
    try {
      const { gradeYesterdaysPicks } = await import("@/lib/pick-engine");
      const gradeResult = await gradeYesterdaysPicks();
      results.grade_picks = gradeResult;
      console.log(`[Cron] Graded ${gradeResult.graded} picks (${gradeResult.errors} errors)`);
    } catch (err) {
      console.error("[Cron] Pick grading failed:", err);
      results.grade_picks = { error: "Unknown error" };
    }

    // 5. Auto-grade pending bets (linked to picks or matched to games)
    try {
      const { gradePendingBets } = await import("@/lib/pick-engine");
      const betResult = await gradePendingBets();
      results.grade_bets = betResult;
      console.log(`[Cron] Graded ${betResult.graded} bets (${betResult.errors} errors)`);
    } catch (err) {
      console.error("[Cron] Bet grading failed:", err);
      results.grade_bets = { error: "Unknown error" };
    }

    // 6. Evaluate saved trends against today's upcoming games
    try {
      const { evaluateSavedTrends } = await import("@/lib/trend-evaluator");
      const trendResult = await evaluateSavedTrends();
      results.trend_eval = trendResult;
      console.log(`[Cron] Evaluated ${trendResult.evaluated} saved trends, ${trendResult.triggered} triggered`);
    } catch (err) {
      console.error("[Cron] Trend evaluation failed:", err);
      results.trend_eval = { error: "Unknown error" };
    }

    // 7. Invalidate in-memory caches so new data is visible
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
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

// Also support GET for Vercel Cron (which sends GET requests)
export async function GET(request: NextRequest) {
  return POST(request);
}
