/**
 * GET /api/bets/stats?from=2024-01-01&to=2024-12-31&sport=NFL
 *
 * Returns aggregated betting statistics for the authenticated user:
 * - Total bets, W/L/P counts, overall ROI
 * - Breakdown by sport, betType, month
 * - Current streak
 * - Cumulative P&L timeline for charting
 */

import { NextRequest, NextResponse } from "next/server";
import { authLimiter, applyRateLimit } from "@/lib/rate-limit";
import { auth } from "@/../../auth";
import { prisma } from "@/lib/db";
import { parseDateParam, validateDateRange } from "@/lib/utils";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

interface BetStats {
  totalBets: number;
  gradedBets: number;
  pendingBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number; // W / (W+L) as decimal
  totalStaked: number;
  totalProfit: number;
  roi: number; // profit / staked as decimal
  currentStreak: { type: "W" | "L" | "P" | "none"; count: number };
  bestDay: { date: string; profit: number } | null;
  worstDay: { date: string; profit: number } | null;
  bySport: Record<string, { w: number; l: number; p: number; profit: number; staked: number }>;
  byBetType: Record<string, { w: number; l: number; p: number; profit: number; staked: number }>;
  byMonth: Array<{ month: string; w: number; l: number; profit: number; staked: number }>;
  cumulativePL: Array<{ date: string; profit: number; cumulative: number }>;
}

function computeStreak(
  bets: Array<{ result: string; createdAt: Date }>,
): BetStats["currentStreak"] {
  if (bets.length === 0) return { type: "none", count: 0 };

  // Sort by createdAt descending (most recent first)
  const sorted = [...bets]
    .filter((b) => b.result !== "PENDING")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (sorted.length === 0) return { type: "none", count: 0 };

  const streakType = sorted[0].result as "WIN" | "LOSS" | "PUSH";
  let count = 0;
  for (const bet of sorted) {
    if (bet.result === streakType) count++;
    else break;
  }

  const typeMap = { WIN: "W" as const, LOSS: "L" as const, PUSH: "P" as const };
  return { type: typeMap[streakType] ?? "none", count };
}

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
    const sport = searchParams.get("sport")?.toUpperCase() as
      | Sport
      | undefined;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Validate date params
    const dateError = validateDateRange(from, to);
    if (dateError) {
      return NextResponse.json({ success: false, error: dateError }, { status: 400 });
    }

    const where: Record<string, unknown> = { userId: session.user.id };
    if (sport) where.sport = sport;
    if (from || to) {
      where.gameDate = {};
      if (from) (where.gameDate as Record<string, unknown>).gte = parseDateParam(from)!;
      if (to) (where.gameDate as Record<string, unknown>).lte = parseDateParam(to)!;
    }

    const bets = await prisma.bet.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        result: true,
        profit: true,
        stake: true,
        sport: true,
        betType: true,
        gameDate: true,
        createdAt: true,
      },
    });

    // Compute stats
    const graded = bets.filter((b) => b.result !== "PENDING");
    const wins = graded.filter((b) => b.result === "WIN");
    const losses = graded.filter((b) => b.result === "LOSS");
    const pushes = graded.filter((b) => b.result === "PUSH");
    const totalStaked = graded.reduce((sum, b) => sum + b.stake, 0);
    const totalProfit = graded.reduce(
      (sum, b) => sum + (b.profit ?? 0),
      0,
    );

    // By sport
    const bySport: BetStats["bySport"] = {};
    for (const bet of graded) {
      const key = bet.sport;
      if (!bySport[key]) bySport[key] = { w: 0, l: 0, p: 0, profit: 0, staked: 0 };
      bySport[key].staked += bet.stake;
      bySport[key].profit += bet.profit ?? 0;
      if (bet.result === "WIN") bySport[key].w++;
      else if (bet.result === "LOSS") bySport[key].l++;
      else bySport[key].p++;
    }

    // By bet type
    const byBetType: BetStats["byBetType"] = {};
    for (const bet of graded) {
      const key = bet.betType;
      if (!byBetType[key]) byBetType[key] = { w: 0, l: 0, p: 0, profit: 0, staked: 0 };
      byBetType[key].staked += bet.stake;
      byBetType[key].profit += bet.profit ?? 0;
      if (bet.result === "WIN") byBetType[key].w++;
      else if (bet.result === "LOSS") byBetType[key].l++;
      else byBetType[key].p++;
    }

    // By month
    const monthMap = new Map<
      string,
      { w: number; l: number; profit: number; staked: number }
    >();
    for (const bet of graded) {
      const month = bet.gameDate.toISOString().slice(0, 7); // YYYY-MM
      if (!monthMap.has(month))
        monthMap.set(month, { w: 0, l: 0, profit: 0, staked: 0 });
      const m = monthMap.get(month)!;
      m.staked += bet.stake;
      m.profit += bet.profit ?? 0;
      if (bet.result === "WIN") m.w++;
      else if (bet.result === "LOSS") m.l++;
    }
    const byMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    // Cumulative P&L
    let cumulative = 0;
    const cumulativePL = graded.map((bet) => {
      cumulative += bet.profit ?? 0;
      return {
        date: bet.gameDate.toISOString().slice(0, 10),
        profit: bet.profit ?? 0,
        cumulative: Math.round(cumulative * 100) / 100,
      };
    });

    // Best/worst day
    const dayProfits = new Map<string, number>();
    for (const bet of graded) {
      const day = bet.gameDate.toISOString().slice(0, 10);
      dayProfits.set(day, (dayProfits.get(day) ?? 0) + (bet.profit ?? 0));
    }
    let bestDay: BetStats["bestDay"] = null;
    let worstDay: BetStats["worstDay"] = null;
    Array.from(dayProfits.entries()).forEach(([date, profit]) => {
      if (!bestDay || profit > bestDay.profit)
        bestDay = { date, profit: Math.round(profit * 100) / 100 };
      if (!worstDay || profit < worstDay.profit)
        worstDay = { date, profit: Math.round(profit * 100) / 100 };
    });

    const wlCount = wins.length + losses.length;
    const stats: BetStats = {
      totalBets: bets.length,
      gradedBets: graded.length,
      pendingBets: bets.length - graded.length,
      wins: wins.length,
      losses: losses.length,
      pushes: pushes.length,
      winRate: wlCount > 0 ? wins.length / wlCount : 0,
      totalStaked: Math.round(totalStaked * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      roi: totalStaked > 0 ? totalProfit / totalStaked : 0,
      currentStreak: computeStreak(bets),
      bestDay,
      worstDay,
      bySport,
      byBetType,
      byMonth,
      cumulativePL,
    };

    return NextResponse.json(
      { success: true, stats },
      { headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("[GET /api/bets/stats]", error);
    return NextResponse.json(
      { success: false, error: "Failed to compute stats" },
      { status: 500 },
    );
  }
}
