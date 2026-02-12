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
 *   0 21 * * *  (21:00 UTC = 4 PM ET) — afternoon odds capture before evening games
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
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

  // Sentry Cron Monitor: signal check-in at start
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "daily-sync",
    status: "in_progress",
  }, {
    schedule: { type: "crontab", value: "0 11,17,21 * * *" },
    checkinMargin: 5,
    maxRuntime: 10,
    timezone: "Etc/UTC",
  });

  try {
    // 1. FIRST: Refresh upcoming games with odds
    // This captures today's spreads/totals BEFORE games start, so when they
    // complete later, syncCompletedGames can look up the pre-game odds.
    for (const sport of SPORTS) {
      try {
        const refreshResult = await Sentry.startSpan(
          { name: `cron.refresh.${sport}`, op: "cron.step" },
          () => refreshUpcomingGames(sport),
        );
        results[`refresh_${sport}`] = refreshResult;
      } catch (err) {
        Sentry.captureException(err, { tags: { cronStep: "refresh", sport } });
        console.error(`[Cron] Refresh failed for ${sport}:`, err);
        results[`refresh_${sport}`] = {
          error: "Unknown error",
        };
      }
    }

    // 1.5. Supplement NCAAMB odds from The Odds API
    // Fills UpcomingGame gaps so syncCompletedGames finds odds for games ESPN missed.
    try {
      const supplementResult = await Sentry.startSpan(
        { name: "cron.supplement.NCAAMB", op: "cron.step" },
        async () => {
          const { supplementUpcomingGamesFromOddsApi } = await import("@/lib/odds-api-sync");
          return supplementUpcomingGamesFromOddsApi("NCAAMB");
        },
      );
      results.supplement_NCAAMB = supplementResult;
      console.log(
        `[Cron] OddsAPI supplement: fetched=${supplementResult.fetched}, supplemented=${supplementResult.supplemented}, enriched=${supplementResult.enriched}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "supplement", sport: "NCAAMB" } });
      console.error("[Cron] OddsAPI supplement failed:", err);
      results.supplement_NCAAMB = { error: "Unknown error" };
    }

    // 1.6. Capture FanMatch predictions for NCAAMB upcoming games
    // Stores game-level KenPom predictions so they persist when games complete.
    try {
      await Sentry.startSpan(
        { name: "cron.fanmatch.NCAAMB", op: "cron.step" },
        async () => {
          const { getKenpomFanMatch } = await import("@/lib/kenpom");
          const { prisma } = await import("@/lib/db");
          const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
          const fanMatch = await getKenpomFanMatch(todayStr);
          if (!fanMatch || fanMatch.length === 0) {
            results.fanmatch_NCAAMB = { skipped: true, reason: "no FanMatch data" };
            return;
          }

          let updated = 0;
          for (const fm of fanMatch) {
            try {
              const gameDate = new Date(fm.DateOfGame);
              const dateStr = gameDate.toISOString().split("T")[0];
              // Update matching UpcomingGame rows
              const result = await prisma.upcomingGame.updateMany({
                where: {
                  sport: "NCAAMB",
                  gameDate: {
                    gte: new Date(dateStr + "T00:00:00Z"),
                    lte: new Date(dateStr + "T23:59:59Z"),
                  },
                  fmHomePred: null, // Only set if not already captured
                },
                data: {
                  fmHomePred: fm.HomePred,
                  fmAwayPred: fm.VisitorPred,
                  fmHomeWinProb: fm.HomeWP,
                },
              });
              updated += result.count;
            } catch {
              // Skip individual game failures
            }
          }

          results.fanmatch_NCAAMB = { captured: updated, available: fanMatch.length };
          console.log(`[Cron] FanMatch: captured ${updated} predictions from ${fanMatch.length} games`);
        },
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "fanmatch", sport: "NCAAMB" } });
      console.error("[Cron] FanMatch capture failed:", err);
      results.fanmatch_NCAAMB = { error: "Unknown error" };
    }

    // 2. THEN: Sync yesterday's completed games
    // lookupUpcomingGameOdds() searches for odds captured in step 1 (or
    // from a previous cron run) using a ±1 day date window.
    for (const sport of SPORTS) {
      try {
        const syncResult = await Sentry.startSpan(
          { name: `cron.sync.${sport}`, op: "cron.step" },
          () => syncCompletedGames(sport),
        );
        results[`sync_${sport}`] = syncResult;
      } catch (err) {
        Sentry.captureException(err, { tags: { cronStep: "sync", sport } });
        console.error(`[Cron] Sync failed for ${sport}:`, err);
        results[`sync_${sport}`] = {
          error: "Unknown error",
        };
      }
    }

    // 2.5. Backfill yesterday's NCAAMB games that still lack spreads (morning run only)
    try {
      const backfillResult = await Sentry.startSpan(
        { name: "cron.backfill.NCAAMB", op: "cron.step" },
        async () => {
          const { backfillYesterdayOdds } = await import("@/lib/odds-api-sync");
          return backfillYesterdayOdds();
        },
      );
      results.backfill_NCAAMB = backfillResult;
      console.log(
        `[Cron] OddsAPI backfill: updated=${backfillResult.updated}, notMatched=${backfillResult.notMatched}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "backfill", sport: "NCAAMB" } });
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
      const gradeResult = await Sentry.startSpan(
        { name: "cron.grade_picks", op: "cron.step" },
        async () => {
          const { gradeYesterdaysPicks } = await import("@/lib/pick-engine");
          return gradeYesterdaysPicks();
        },
      );
      results.grade_picks = gradeResult;
      console.log(`[Cron] Graded ${gradeResult.graded} picks (${gradeResult.errors} errors)`);
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "grade_picks" } });
      console.error("[Cron] Pick grading failed:", err);
      results.grade_picks = { error: "Unknown error" };
    }

    // 5. Auto-grade pending bets (linked to picks or matched to games)
    try {
      const betResult = await Sentry.startSpan(
        { name: "cron.grade_bets", op: "cron.step" },
        async () => {
          const { gradePendingBets } = await import("@/lib/pick-engine");
          return gradePendingBets();
        },
      );
      results.grade_bets = betResult;
      console.log(`[Cron] Graded ${betResult.graded} bets (${betResult.errors} errors)`);
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "grade_bets" } });
      console.error("[Cron] Bet grading failed:", err);
      results.grade_bets = { error: "Unknown error" };
    }

    // 6. Evaluate saved trends against today's upcoming games
    try {
      const trendResult = await Sentry.startSpan(
        { name: "cron.trend_eval", op: "cron.step" },
        async () => {
          const { evaluateSavedTrends } = await import("@/lib/trend-evaluator");
          return evaluateSavedTrends();
        },
      );
      results.trend_eval = trendResult;
      console.log(`[Cron] Evaluated ${trendResult.evaluated} saved trends, ${trendResult.triggered} triggered`);
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "trend_eval" } });
      console.error("[Cron] Trend evaluation failed:", err);
      results.trend_eval = { error: "Unknown error" };
    }

    // 7. Invalidate in-memory caches so new data is visible
    clearGameCache();
    clearAnglesCache();
    clearKenpomCache();
    console.log("[Cron] Game, angles, and KenPom caches cleared after sync");

    // 8. Track custom metrics for Sentry dashboards
    for (const sport of SPORTS) {
      const syncData = results[`sync_${sport}`] as { inserted?: number } | undefined;
      if (syncData?.inserted != null) {
        Sentry.metrics.gauge("cron.games_synced", syncData.inserted, { attributes: { sport } });
      }
      const picksData = results[`picks_${sport}`] as { generated?: number } | undefined;
      if (picksData?.generated != null) {
        Sentry.metrics.gauge("cron.picks_generated", picksData.generated, { attributes: { sport } });
      }
    }

    const durationMs = Math.round(performance.now() - start);
    Sentry.metrics.gauge("cron.duration_ms", durationMs, { unit: "millisecond" });

    // Sentry Cron Monitor: signal successful completion
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "daily-sync",
      status: "ok",
    });

    return NextResponse.json({
      success: true,
      data: results,
      meta: { durationMs },
    });
  } catch (err) {
    // Sentry Cron Monitor: signal failure
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "daily-sync",
      status: "error",
    });
    Sentry.captureException(err, { tags: { cronStep: "fatal" } });
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
