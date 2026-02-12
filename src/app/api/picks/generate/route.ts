/**
 * POST /api/picks/generate?sport=NCAAMB
 *
 * Manually trigger pick generation for a sport + today's date.
 * Skips if picks already exist. Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDailyPicks } from "@/lib/pick-engine";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function POST(req: NextRequest) {
  // Require CRON_SECRET (fail-closed: reject if not configured)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const sport = req.nextUrl.searchParams.get("sport")?.toUpperCase();
  if (!sport || !VALID_SPORTS.includes(sport)) {
    return NextResponse.json(
      { success: false, error: "sport is required (NFL, NCAAF, NCAAMB)" },
      { status: 400 },
    );
  }

  const dateStr = todayET();
  const dateKey = new Date(dateStr + "T00:00:00Z");

  // Skip if picks already exist
  const existing = await prisma.dailyPick.count({
    where: { date: dateKey, sport: sport as Sport },
  });
  if (existing > 0) {
    return NextResponse.json({
      success: true,
      message: `${existing} picks already exist for ${sport} on ${dateStr}`,
      generated: 0,
    });
  }

  try {
    const picks = await generateDailyPicks(dateStr, sport as Sport);

    if (picks.length > 0) {
      await prisma.dailyPick.createMany({
        data: picks.map((p) => ({
          date: dateKey,
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

    return NextResponse.json({
      success: true,
      sport,
      date: dateStr,
      generated: picks.length,
    });
  } catch (err) {
    console.error(`[POST /api/picks/generate] Error generating ${sport} picks:`, err);
    return NextResponse.json(
      { success: false, error: "Failed to generate picks" },
      { status: 500 },
    );
  }
}
