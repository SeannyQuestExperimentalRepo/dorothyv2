/**
 * GET /api/odds?sport=NFL
 *
 * Returns live odds from multiple sportsbooks via The Odds API.
 * Caches snapshots in DB and serves from cache within 5-minute window.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOddsSnapshots, type GameOddsSnapshot } from "@/lib/odds-api";
import { publicLimiter, applyRateLimit } from "@/lib/rate-limit";
import { features } from "@/lib/config";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, publicLimiter);
  if (limited) return limited;

  if (!features.LIVE_ODDS) {
    return NextResponse.json(
      { success: false, error: "Live odds are currently disabled" },
      { status: 503 },
    );
  }

  const sport = req.nextUrl.searchParams.get("sport")?.toUpperCase();
  if (!sport || !VALID_SPORTS.includes(sport)) {
    return NextResponse.json(
      { success: false, error: "sport is required (NFL, NCAAF, NCAAMB)" },
      { status: 400 },
    );
  }

  try {
    const now = new Date();

    // Check for recent cached snapshot
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const cached = await prisma.oddsSnapshot.findMany({
      where: {
        sport: sport as Sport,
        fetchedAt: { gte: cutoff },
        gameDate: { gt: now }, // Only games that haven't started
      },
      orderBy: { fetchedAt: "desc" },
    });

    if (cached.length > 0) {
      // Deduplicate by externalId (keep most recent)
      const seen = new Set<string>();
      const games = cached.filter((s) => {
        if (seen.has(s.externalId)) return false;
        seen.add(s.externalId);
        return true;
      });

      return NextResponse.json({
        success: true,
        sport,
        games: games.map((g) => ({
          gameId: g.externalId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          commenceTime: g.gameDate.toISOString(),
          books: g.bookmakers,
          bestSpread: g.bestSpread != null ? { value: g.bestSpread, book: "—", odds: -110 } : null,
          bestTotal: g.bestTotal != null ? { value: g.bestTotal, book: "—" } : null,
        })),
        cached: true,
        count: games.length,
      });
    }

    // Fetch fresh odds from The Odds API
    const snapshots = await getOddsSnapshots(sport);

    // Persist snapshots to DB
    if (snapshots.length > 0) {
      await prisma.oddsSnapshot.createMany({
        data: snapshots.map((s) => ({
          sport: sport as Sport,
          gameDate: new Date(s.commenceTime),
          homeTeam: s.homeTeam,
          awayTeam: s.awayTeam,
          externalId: s.gameId,
          bookmakers: s.books as unknown as import("@prisma/client").Prisma.InputJsonValue,
          bestSpread: s.bestSpread?.value ?? null,
          bestTotal: s.bestTotal?.value ?? null,
        })),
        skipDuplicates: true,
      });
    }

    // Filter out games that have already started
    const upcoming = snapshots.filter(
      (s) => new Date(s.commenceTime) > now,
    );

    return NextResponse.json({
      success: true,
      sport,
      games: upcoming.map((s: GameOddsSnapshot) => ({
        gameId: s.gameId,
        homeTeam: s.homeTeam,
        awayTeam: s.awayTeam,
        commenceTime: s.commenceTime,
        books: s.books,
        bestSpread: s.bestSpread,
        bestTotal: s.bestTotal,
      })),
      cached: false,
      count: upcoming.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /api/odds]", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
