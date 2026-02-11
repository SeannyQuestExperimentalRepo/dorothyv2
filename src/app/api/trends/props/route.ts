/**
 * Player Prop Trend API Route
 *
 * POST /api/trends/props — Full prop query with JSON body
 * GET  /api/trends/props — Simple prop query via URL params
 *
 * Analyzes player prop hit rates with situational filtering.
 * Example: "Mahomes over 275.5 passing yards at home as a favorite"
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  executePlayerPropQueryFromDB,
  resolveStatName,
  type PropQuery,
  type PropResult,
} from "@/lib/prop-trend-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// --- Zod Schemas ---

const FilterOperatorSchema = z.enum([
  "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "between",
]);

const TrendFilterSchema = z.object({
  field: z.string().min(1),
  operator: FilterOperatorSchema,
  value: z.any(),
});

const PropQuerySchema = z.object({
  player: z.string().min(1, "Player name is required"),
  stat: z.string().min(1, "Stat name is required"),
  line: z.number({ error: "Line is required" }),
  direction: z.enum(["over", "under"]),
  filters: z.array(TrendFilterSchema).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  homeAway: z.enum(["home", "away"]).optional(),
  favDog: z.enum(["favorite", "underdog"]).optional(),
  opponent: z.string().optional(),
});

// --- Helpers ---

const MAX_RESPONSE_GAMES = 50;

function formatResponse(result: PropResult, durationMs: number) {
  return NextResponse.json({
    success: true,
    data: {
      playerName: result.playerName,
      query: {
        stat: result.query.stat,
        line: result.query.line,
        direction: result.query.direction,
        homeAway: result.query.homeAway,
        favDog: result.query.favDog,
        opponent: result.query.opponent,
      },
      overall: result.overall,
      splits: result.splits,
      recentTrend: result.recentTrend,
      currentStreak: result.currentStreak,
      avgValue: result.avgValue,
      medianValue: result.medianValue,
      games: result.games.slice(0, MAX_RESPONSE_GAMES),
      gameCount: result.games.length,
      computedAt: result.computedAt,
    },
    meta: {
      durationMs,
      resolvedStat: resolveStatName(result.query.stat),
    },
  });
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details ? { details } : {}) },
    { status },
  );
}

// --- POST /api/trends/props ---

export async function POST(request: NextRequest) {
  const start = performance.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON in request body", 400);
  }

  const parsed = PropQuerySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid query parameters", 400, parsed.error.format());
  }

  try {
    const query = parsed.data as PropQuery;
    const result = await executePlayerPropQueryFromDB(query);
    const durationMs = Math.round(performance.now() - start);

    if (result.games.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          playerName: result.playerName,
          query: {
            stat: result.query.stat,
            line: result.query.line,
            direction: result.query.direction,
          },
          overall: result.overall,
          splits: [],
          recentTrend: result.recentTrend,
          currentStreak: 0,
          avgValue: 0,
          medianValue: 0,
          games: [],
          gameCount: 0,
          computedAt: result.computedAt,
          message: "No games found matching the query. Check player name and stat availability.",
        },
        meta: { durationMs, resolvedStat: resolveStatName(query.stat) },
      });
    }

    const response = formatResponse(result, durationMs);
    response.headers.set(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (err) {
    console.error("[POST /api/trends/props] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}

// --- GET /api/trends/props ---

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const player = searchParams.get("player");
  const stat = searchParams.get("stat");
  const lineStr = searchParams.get("line");
  const direction = searchParams.get("direction") as "over" | "under" | null;

  // Validate required params
  if (!player) return errorResponse("player is required", 400);
  if (!stat) return errorResponse("stat is required", 400);
  if (!lineStr) return errorResponse("line is required", 400);
  if (!direction || !["over", "under"].includes(direction)) {
    return errorResponse("direction must be 'over' or 'under'", 400);
  }

  const line = parseFloat(lineStr);
  if (isNaN(line)) return errorResponse("line must be a valid number", 400);

  // Optional params
  const homeAway = searchParams.get("homeAway") as "home" | "away" | null;
  const favDog = searchParams.get("favDog") as "favorite" | "underdog" | null;
  const opponent = searchParams.get("opponent") || undefined;

  const seasonStart = searchParams.get("seasonStart");
  const seasonEnd = searchParams.get("seasonEnd");
  let seasonRange: [number, number] | undefined;
  if (seasonStart && seasonEnd) {
    const s = parseInt(seasonStart, 10);
    const e = parseInt(seasonEnd, 10);
    if (isNaN(s) || isNaN(e)) {
      return errorResponse("seasonStart and seasonEnd must be valid integers", 400);
    }
    seasonRange = [s, e];
  }

  try {
    const query: PropQuery = {
      player,
      stat,
      line,
      direction,
      filters: [],
      seasonRange,
      homeAway: homeAway || undefined,
      favDog: favDog || undefined,
      opponent,
    };

    const result = await executePlayerPropQueryFromDB(query);
    const durationMs = Math.round(performance.now() - start);
    const response = formatResponse(result, durationMs);
    response.headers.set(
      "Cache-Control",
      "s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (err) {
    console.error("[GET /api/trends/props] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
