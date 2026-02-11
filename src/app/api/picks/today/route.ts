/**
 * GET /api/picks/today?sport=NFL&date=2026-02-10
 *
 * Returns today's betting picks. Checks DB first (cached path),
 * generates fresh picks if none exist, then persists and returns.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDailyPicks } from "@/lib/pick-engine";
import type { Sport } from "@prisma/client";
import { publicLimiter, applyRateLimit } from "@/lib/rate-limit";
import { auth } from "@/../../auth";
import { getTierConfig } from "@/lib/subscription";
import { features } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB"];

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, publicLimiter);
  if (limited) return limited;

  try {
    // Get user tier for pick filtering (optional auth — anonymous = FREE)
    let userRole: string | null = null;
    try {
      const session = await auth();
      userRole = session?.user?.role ?? null;
    } catch {
      // Auth failure is OK — treat as FREE tier
    }
    const tier = getTierConfig(userRole);
    const maxStars = features.SUBSCRIPTIONS_ACTIVE ? tier.maxPickStars : 5;

    const { searchParams } = req.nextUrl;
    const sport = searchParams.get("sport")?.toUpperCase();
    const date = searchParams.get("date") || todayET();

    if (!sport || !VALID_SPORTS.includes(sport)) {
      return NextResponse.json(
        { success: false, error: "sport is required (NFL, NCAAF, NCAAMB)" },
        { status: 400 },
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { success: false, error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const dateKey = new Date(date + "T00:00:00Z");
    const now = new Date();

    // Check if picks already exist in DB for this date (all games, not just upcoming)
    const allPicks = await prisma.dailyPick.findMany({
      where: {
        date: dateKey,
        sport: sport as Sport,
      },
      orderBy: [{ confidence: "desc" }, { trendScore: "desc" }],
    });

    let cached = true;

    if (allPicks.length === 0) {
      // No picks yet — generate for ALL games on this date
      cached = false;
      const generatedPicks = await generateDailyPicks(date, sport as Sport);

      if (generatedPicks.length > 0) {
        const pickData = generatedPicks.map((p) => ({
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
        }));

        await prisma.dailyPick.createMany({
          data: pickData,
          skipDuplicates: true,
        });

        // Fetch back from DB to get IDs and consistent format
        const savedPicks = await prisma.dailyPick.findMany({
          where: { date: dateKey, sport: sport as Sport },
          orderBy: [{ confidence: "desc" }, { trendScore: "desc" }],
        });
        allPicks.push(...savedPicks);
      }
    }

    // Filter for display: hide picks for games that have already started,
    // but they remain in DB for grading
    const displayPicks = allPicks
      .filter((p) => p.gameDate >= now)
      .filter((p) => p.confidence <= maxStars);

    return NextResponse.json(
      { success: true, date, sport, picks: displayPicks, cached, tier: tier.label },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (err) {
    console.error("[picks/today] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to generate picks" },
      { status: 500 },
    );
  }
}
