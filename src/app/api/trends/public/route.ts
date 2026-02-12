/**
 * GET /api/trends/public
 *
 * Returns public (shared) trends for the community leaderboard.
 * Sorted by most recently triggered, filterable by sport.
 * No authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicLimiter, applyRateLimit, getClientIp } from "@/lib/rate-limit";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS: Sport[] = ["NFL", "NCAAF", "NCAAMB", "NBA"];

export async function GET(req: NextRequest) {
  try {
    const limited = applyRateLimit(req, publicLimiter, getClientIp(req));
    if (limited) return limited;

    const { searchParams } = req.nextUrl;
    const sport = searchParams.get("sport")?.toUpperCase() as Sport | undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    const where: Record<string, unknown> = { isPublic: true };
    if (sport && VALID_SPORTS.includes(sport)) {
      where.sport = sport;
    }

    const trends = await prisma.savedTrend.findMany({
      where,
      orderBy: { lastTriggered: { sort: "desc", nulls: "last" } },
      take: limit,
      select: {
        id: true,
        name: true,
        sport: true,
        description: true,
        lastTriggered: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            image: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      trends: trends.map((t) => ({
        id: t.id,
        name: t.name,
        sport: t.sport,
        description: t.description,
        lastTriggered: t.lastTriggered,
        createdAt: t.createdAt,
        authorName: t.user.name ?? "Anonymous",
        authorImage: t.user.image,
      })),
    });
  } catch (error) {
    console.error("[GET /api/trends/public]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch public trends" },
      { status: 500 },
    );
  }
}
