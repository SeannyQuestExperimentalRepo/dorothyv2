/**
 * GET /api/picks/record?sport=NFL&days=30
 *
 * Returns aggregated track record of graded picks.
 * Breaks down by overall, pickType (SPREAD/OU/PROP), and confidence tier.
 */

import { NextRequest, NextResponse } from "next/server";
import { publicLimiter, applyRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];

interface RecordBucket {
  wins: number;
  losses: number;
  pushes: number;
  total: number;
  winPct: number;
}

function buildBucket(picks: { result: string }[]): RecordBucket {
  const wins = picks.filter((p) => p.result === "WIN").length;
  const losses = picks.filter((p) => p.result === "LOSS").length;
  const pushes = picks.filter((p) => p.result === "PUSH").length;
  const total = wins + losses; // pushes excluded from %
  return {
    wins,
    losses,
    pushes,
    total: wins + losses + pushes,
    winPct: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
  };
}

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, publicLimiter);
  if (limited) return limited;

  try {
    const { searchParams } = req.nextUrl;
    const sport = searchParams.get("sport")?.toUpperCase();
    const days = parseInt(searchParams.get("days") || "30", 10);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const where: Record<string, unknown> = {
      result: { not: "PENDING" },
      gradedAt: { gte: cutoff },
    };

    if (sport && VALID_SPORTS.includes(sport)) {
      where.sport = sport as Sport;
    }

    const gradedPicks = await prisma.dailyPick.findMany({
      where,
      select: {
        result: true,
        pickType: true,
        confidence: true,
        sport: true,
      },
    });

    const overall = buildBucket(gradedPicks);

    // By pick type
    const byType: Record<string, RecordBucket> = {};
    for (const type of ["SPREAD", "OVER_UNDER", "PLAYER_PROP"]) {
      const filtered = gradedPicks.filter((p) => p.pickType === type);
      if (filtered.length > 0) {
        byType[type] = buildBucket(filtered);
      }
    }

    // By confidence tier
    const byConfidence: Record<string, RecordBucket> = {};
    for (const tier of [5, 4, 3]) {
      const filtered = gradedPicks.filter((p) => p.confidence === tier);
      if (filtered.length > 0) {
        byConfidence[`${tier}_star`] = buildBucket(filtered);
      }
    }

    return NextResponse.json(
      {
        success: true,
        days,
        sport: sport || "ALL",
        overall,
        byType,
        byConfidence,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800",
        },
      },
    );
  } catch (err) {
    console.error("[picks/record] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch record" },
      { status: 500 },
    );
  }
}
