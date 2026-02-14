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
import { verifyCronSecret } from "@/lib/auth-helpers";
import type { Sport } from "@/lib/espn-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SPORTS: Sport[] = ["NFL", "NCAAF", "NCAAMB"];

export async function POST(request: NextRequest) {
  // Verify cron secret (timing-safe, fail-closed)
  if (!verifyCronSecret(request.headers.get("authorization"))) {
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

    // 2.6. Enrich NCAAMB games with KenPom season ratings
    // KenPom AdjEM/AdjOE/AdjDE/AdjTempo are not captured at game creation time.
    // This step backfills any NCAAMBGame rows missing KenPom data.
    try {
      const enrichResult = await Sentry.startSpan(
        { name: "cron.kenpom_enrich.NCAAMB", op: "cron.step" },
        async () => {
          const { enrichNCAAMBGamesWithKenpom } = await import("@/lib/espn-sync");
          return enrichNCAAMBGamesWithKenpom();
        },
      );
      results.kenpom_enrich_NCAAMB = enrichResult;
      console.log(
        `[Cron] KenPom enrich: enriched=${enrichResult.enriched}, notMatched=${enrichResult.notMatched}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "kenpom_enrich", sport: "NCAAMB" } });
      console.error("[Cron] KenPom enrichment failed:", err);
      results.kenpom_enrich_NCAAMB = { error: "Unknown error" };
    }

    // 2.65. Capture daily KenPom snapshot for PIT backtest dataset
    // Stores today's ratings in KenpomSnapshot for future model retraining.
    try {
      const snapshotResult = await Sentry.startSpan(
        { name: "cron.kenpom_snapshot.NCAAMB", op: "cron.step" },
        async () => {
          const { getKenpomArchiveRatings } = await import("@/lib/kenpom");
          const { prisma } = await import("@/lib/db");
          const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
          const snapshotDate = new Date(todayStr + "T00:00:00Z");

          // Skip if we already captured today
          const existing = await prisma.kenpomSnapshot.count({ where: { snapshotDate } });
          if (existing > 0) return { skipped: true, existing };

          const ratings = await getKenpomArchiveRatings(todayStr);
          if (!ratings || ratings.length === 0) return { skipped: true, reason: "no data" };

          const result = await prisma.kenpomSnapshot.createMany({
            data: ratings.map((r) => ({
              snapshotDate,
              season: r.Season,
              teamName: r.TeamName,
              adjEM: r.AdjEM,
              adjOE: r.AdjOE,
              adjDE: r.AdjDE,
              adjTempo: r.AdjTempo,
              rankAdjEM: r.RankAdjEM,
              confShort: r.ConfShort,
            })),
            skipDuplicates: true,
          });
          return { captured: result.count };
        },
      );
      results.kenpom_snapshot = snapshotResult;
      console.log(`[Cron] KenPom snapshot:`, snapshotResult);
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "kenpom_snapshot", sport: "NCAAMB" } });
      console.error("[Cron] KenPom snapshot capture failed:", err);
      results.kenpom_snapshot = { error: "Unknown error" };
    }

    // 2.7. Enrich NCAAF games with SP+ ratings from CollegeFootballData.com
    // SP+ (overall/offense/defense) are the NCAAF equivalent of KenPom metrics.
    try {
      const enrichResult = await Sentry.startSpan(
        { name: "cron.sp_enrich.NCAAF", op: "cron.step" },
        async () => {
          const { enrichNCAAFGamesWithSP } = await import("@/lib/espn-sync");
          return enrichNCAAFGamesWithSP();
        },
      );
      results.sp_enrich_NCAAF = enrichResult;
      console.log(
        `[Cron] SP+ enrich: enriched=${enrichResult.enriched}, notMatched=${enrichResult.notMatched}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cronStep: "sp_enrich", sport: "NCAAF" } });
      console.error("[Cron] SP+ enrichment failed:", err);
      results.sp_enrich_NCAAF = { error: "Unknown error" };
    }

    // 3. Pre-generate today's daily picks for all sports
    // Done here (after odds refresh) so picks are ready before users check
    // Afternoon/evening runs (UTC 17+) use force mode to regenerate with fresh odds
    {
      const { generateDailyPicks } = await import("@/lib/pick-engine");
      const { prisma } = await import("@/lib/db");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const todayKey = new Date(todayStr + "T00:00:00Z");
      const currentHourUTC = new Date().getUTCHours();
      const forceRegenerate = currentHourUTC >= 17; // Afternoon+ runs refresh picks

      for (const sport of SPORTS) {
        try {
          // Check if picks already exist for today
          const existing = await prisma.dailyPick.count({
            where: { date: todayKey, sport },
          });

          if (existing > 0 && !forceRegenerate) {
            results[`picks_${sport}`] = { skipped: true, existing };
            continue;
          }

          // Force mode: delete pending picks before regenerating with fresh odds
          if (existing > 0 && forceRegenerate) {
            const deleted = await prisma.dailyPick.deleteMany({
              where: { date: todayKey, sport, result: "PENDING" },
            });
            console.log(`[Cron] Force-regenerating ${sport} picks (deleted ${deleted.count} pending picks)`);
          }

          const { picks, context: pickContext } = await generateDailyPicks(todayStr, sport);

          if (pickContext.gamesErrored > 0) {
            Sentry.addBreadcrumb({
              category: "pick-engine",
              message: `${sport}: ${pickContext.gamesErrored} games errored during processing`,
              level: "warning",
              data: pickContext,
            });
          }

          if (picks.length > 0) {
            const createResult = await prisma.dailyPick.createMany({
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
                homeRank: p.homeRank,
                awayRank: p.awayRank,
              })),
              skipDuplicates: true,
            });

            // Detect duplicates (race condition from concurrent cron runs)
            if (createResult.count < picks.length) {
              const dupes = picks.length - createResult.count;
              console.warn(`[Cron] ${sport}: ${dupes} duplicate picks skipped (concurrent cron?)`);
              Sentry.addBreadcrumb({
                category: "cron",
                message: `${sport}: ${dupes} duplicate picks detected`,
                level: "warning",
              });
            }
          }
          results[`picks_${sport}`] = { generated: picks.length, context: pickContext };
          console.log(`[Cron] Generated ${picks.length} picks for ${sport}`);
        } catch (err) {
          Sentry.captureException(err, { tags: { cronStep: "generate_picks", sport } });
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
      results.trend_eval = {
        evaluated: trendResult.evaluated,
        triggered: trendResult.triggered,
        errors: trendResult.errors,
      };
      console.log(`[Cron] Evaluated ${trendResult.evaluated} saved trends, ${trendResult.triggered} triggered`);

      // 6.5. Send email notifications for triggered trends with notifyEmail enabled
      if (trendResult.triggeredTrends.length > 0) {
        try {
          const { sendTrendAlertEmail, isEmailConfigured } = await import("@/lib/email");
          if (isEmailConfigured()) {
            const toNotify = trendResult.triggeredTrends.filter((t) => t.notifyEmail);
            let emailsSent = 0;
            for (const trend of toNotify) {
              const sent = await sendTrendAlertEmail(
                trend.userEmail,
                trend.trendName,
                trend.description,
                trend.matchedGames,
              );
              if (sent) emailsSent++;
            }
            results.trend_emails = { eligible: toNotify.length, sent: emailsSent };
            console.log(`[Cron] Sent ${emailsSent}/${toNotify.length} trend alert emails`);
          } else {
            results.trend_emails = { skipped: true, reason: "email not configured" };
          }
        } catch (emailErr) {
          console.error("[Cron] Trend email notifications failed:", emailErr);
          results.trend_emails = { error: "Email send failed" };
        }
      }
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

    // Compute health: check if critical steps errored or 0 picks generated
    const hasStepError = Object.values(results).some(
      (r) => r && typeof r === "object" && "error" in (r as Record<string, unknown>),
    );
    const totalPicks = SPORTS.reduce((sum, s) => {
      const d = results[`picks_${s}`] as { generated?: number; skipped?: boolean } | undefined;
      if (d?.skipped) return sum; // skipped is fine (already exist)
      return sum + (d?.generated ?? 0);
    }, 0);
    const allSkipped = SPORTS.every((s) => {
      const d = results[`picks_${s}`] as { skipped?: boolean } | undefined;
      return d?.skipped;
    });
    const cronHealthy = !hasStepError && (totalPicks > 0 || allSkipped);

    // Sentry Cron Monitor: signal actual health
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "daily-sync",
      status: cronHealthy ? "ok" : "error",
    });

    if (!cronHealthy) {
      Sentry.captureMessage("Daily cron completed with issues", {
        level: "warning",
        extra: { results, totalPicks, hasStepError },
      });
    }

    return NextResponse.json({
      success: cronHealthy,
      data: results,
      meta: { durationMs, healthy: cronHealthy },
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
