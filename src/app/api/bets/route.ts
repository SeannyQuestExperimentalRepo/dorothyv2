/**
 * GET  /api/bets?sport=NFL&result=WIN&from=2024-01-01&to=2024-12-31&betType=SPREAD&limit=50&offset=0
 * POST /api/bets — Create a new bet
 *
 * All routes require authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/../../auth";
import { prisma } from "@/lib/db";
import type { Sport, BetType, BetResult } from "@prisma/client";
import { authLimiter, applyRateLimit } from "@/lib/rate-limit";
import { hasAccess } from "@/lib/subscription";
import { features } from "@/lib/config";

export const dynamic = "force-dynamic";

const VALID_SPORTS: Sport[] = ["NFL", "NCAAF", "NCAAMB", "NBA"];
const VALID_BET_TYPES: BetType[] = [
  "SPREAD",
  "OVER_UNDER",
  "MONEYLINE",
  "PLAYER_PROP",
  "PARLAY",
  "TEASER",
];
const VALID_RESULTS: BetResult[] = ["WIN", "LOSS", "PUSH", "PENDING"];

/** Convert American odds to decimal payout multiplier (e.g., -110 → 0.909, +150 → 1.5) */
function oddsToPayoutMultiplier(odds: number): number {
  if (odds >= 100) return odds / 100;
  if (odds <= -100) return 100 / Math.abs(odds);
  return 0; // invalid odds
}

/** Calculate profit from a graded bet */
function calculateProfit(
  stake: number,
  odds: number,
  result: BetResult,
): number | null {
  if (result === "PENDING") return null;
  if (result === "PUSH") return 0;
  if (result === "WIN") return stake * oddsToPayoutMultiplier(odds);
  return -stake; // LOSS
}

// ─── GET: List user's bets ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    const { searchParams } = req.nextUrl;
    const sport = searchParams.get("sport")?.toUpperCase() as Sport | undefined;
    const betType = searchParams.get("betType")?.toUpperCase() as
      | BetType
      | undefined;
    const result = searchParams.get("result")?.toUpperCase() as
      | BetResult
      | undefined;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where clause
    const where: Record<string, unknown> = { userId: session.user.id };
    if (sport && VALID_SPORTS.includes(sport)) where.sport = sport;
    if (betType && VALID_BET_TYPES.includes(betType)) where.betType = betType;
    if (result && VALID_RESULTS.includes(result)) where.result = result;
    if (from || to) {
      where.gameDate = {};
      if (from) (where.gameDate as Record<string, unknown>).gte = new Date(from);
      if (to) (where.gameDate as Record<string, unknown>).lte = new Date(to);
    }

    const [bets, total] = await Promise.all([
      prisma.bet.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.bet.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      bets,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (error) {
    console.error("[GET /api/bets]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch bets" },
      { status: 500 },
    );
  }
}

// ─── POST: Create a new bet ───────────────────────────────────────────────

interface CreateBetBody {
  sport: Sport;
  betType: BetType;
  gameDate: string; // ISO date
  homeTeam: string;
  awayTeam: string;
  pickSide: string;
  line?: number;
  oddsValue?: number;
  stake: number;
  sportsbook?: string;
  playerName?: string;
  propStat?: string;
  propLine?: number;
  notes?: string;
  parlayLegs?: Array<{
    homeTeam: string;
    awayTeam: string;
    pickSide: string;
    line?: number;
  }>;
  teaserPoints?: number;
  dailyPickId?: number;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    if (features.SUBSCRIPTIONS_ACTIVE && !hasAccess(session.user.role, "betTracking")) {
      return NextResponse.json(
        { success: false, error: "Bet tracking requires a Premium subscription" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as CreateBetBody;

    // Validate required fields
    if (!body.sport || !VALID_SPORTS.includes(body.sport)) {
      return NextResponse.json(
        { success: false, error: "Valid sport required (NFL, NCAAF, NCAAMB)" },
        { status: 400 },
      );
    }
    if (!body.betType || !VALID_BET_TYPES.includes(body.betType)) {
      return NextResponse.json(
        { success: false, error: "Valid betType required" },
        { status: 400 },
      );
    }
    if (!body.gameDate || !body.homeTeam || !body.awayTeam || !body.pickSide) {
      return NextResponse.json(
        {
          success: false,
          error: "gameDate, homeTeam, awayTeam, and pickSide are required",
        },
        { status: 400 },
      );
    }
    if (!body.stake || body.stake <= 0) {
      return NextResponse.json(
        { success: false, error: "stake must be a positive number" },
        { status: 400 },
      );
    }

    const odds = body.oddsValue ?? -110;
    if (odds > -100 && odds < 100) {
      return NextResponse.json(
        { success: false, error: "Invalid odds: must be >= 100 or <= -100" },
        { status: 400 },
      );
    }
    const toWin = body.stake * oddsToPayoutMultiplier(odds);

    const bet = await prisma.bet.create({
      data: {
        userId: session.user.id,
        sport: body.sport,
        betType: body.betType,
        gameDate: new Date(body.gameDate),
        homeTeam: body.homeTeam.trim(),
        awayTeam: body.awayTeam.trim(),
        pickSide: body.pickSide.trim(),
        line: body.line ?? null,
        oddsValue: odds,
        stake: body.stake,
        toWin: Math.round(toWin * 100) / 100,
        sportsbook: body.sportsbook?.trim() || null,
        playerName: body.playerName?.trim() || null,
        propStat: body.propStat || null,
        propLine: body.propLine ?? null,
        notes: body.notes?.trim() || null,
        parlayLegs: body.parlayLegs || undefined,
        teaserPoints: body.teaserPoints ?? null,
        dailyPickId: body.dailyPickId ?? null,
      },
    });

    return NextResponse.json({ success: true, bet }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/bets]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create bet" },
      { status: 500 },
    );
  }
}

// ─── PATCH: Batch update bets (e.g., grade multiple) ──────────────────────

interface PatchBetBody {
  id: string;
  result?: BetResult;
  notes?: string;
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    const body = (await req.json()) as PatchBetBody;

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: "Bet id is required" },
        { status: 400 },
      );
    }

    // Verify ownership
    const existing = await prisma.bet.findFirst({
      where: { id: body.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Bet not found" },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.result && VALID_RESULTS.includes(body.result)) {
      updateData.result = body.result;
      updateData.profit = calculateProfit(
        existing.stake,
        existing.oddsValue,
        body.result,
      );
      updateData.gradedAt = body.result !== "PENDING" ? new Date() : null;
    }
    if (body.notes !== undefined) {
      updateData.notes = body.notes;
    }

    const updated = await prisma.bet.update({
      where: { id: body.id },
      data: updateData,
    });

    return NextResponse.json({ success: true, bet: updated });
  } catch (error) {
    console.error("[PATCH /api/bets]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update bet" },
      { status: 500 },
    );
  }
}
