/**
 * Player Trend Query API Route
 *
 * POST /api/trends/players — Full player query with JSON body
 * GET  /api/trends/players — Simple query via URL params
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  executePlayerTrendQueryFromDB,
  type PlayerTrendQuery,
  type PlayerTrendResult,
  type PlayerTrendGame,
} from "@/lib/player-trend-engine";
import { enrichPlayerSummary } from "@/lib/significance-enrichment";

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

const PlayerTrendQuerySchema = z.object({
  player: z.string().optional(),
  playerId: z.string().optional(),
  position: z.string().optional(),
  positionGroup: z.string().optional(),
  team: z.string().optional(),
  opponent: z.string().optional(),
  filters: z.array(TrendFilterSchema).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  limit: z.number().int().positive().optional(),
  orderBy: z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]),
  }).optional(),
});

// --- Helpers ---

const MAX_RESPONSE_GAMES = 100;

/** Strip heavy fields from game objects to reduce response size */
function trimGameForResponse(
  game: PlayerTrendGame,
): Record<string, unknown> {
  // Keep all fields except headshot_url and position-irrelevant stat nulls
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(game)) {
    if (key === "headshot_url") continue;
    const val = (game as Record<string, unknown>)[key];
    if (val !== null && val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

function formatResponse(result: PlayerTrendResult, durationMs: number) {
  const trimmedGames = result.games
    .slice(0, MAX_RESPONSE_GAMES)
    .map(trimGameForResponse);

  // Enrich with statistical significance
  const significance = enrichPlayerSummary(result.summary);

  return NextResponse.json({
    success: true,
    data: {
      query: result.query,
      summary: result.summary,
      significance,
      games: trimmedGames,
      gameCount: result.games.length,
      computedAt: result.computedAt,
    },
    meta: {
      durationMs,
      gamesSearched: result.summary.totalGames,
    },
  });
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details ? { details } : {}) },
    { status },
  );
}

// --- POST /api/trends/players ---

export async function POST(request: NextRequest) {
  const start = performance.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON in request body", 400);
  }

  const parsed = PlayerTrendQuerySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid query parameters", 400, parsed.error.format());
  }

  try {
    const query = parsed.data as PlayerTrendQuery;
    const result = await executePlayerTrendQueryFromDB(query);
    const durationMs = Math.round(performance.now() - start);
    return formatResponse(result, durationMs);
  } catch (err) {
    console.error("[POST /api/trends/players] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}

// --- GET /api/trends/players ---

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const player = searchParams.get("player") || undefined;
  const playerId = searchParams.get("playerId") || undefined;
  const position = searchParams.get("position") || undefined;
  const positionGroup = searchParams.get("positionGroup") || undefined;
  const team = searchParams.get("team") || undefined;
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

  const limitParam = searchParams.get("limit");
  let limit: number | undefined;
  if (limitParam) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit <= 0) {
      return errorResponse("limit must be a positive integer", 400);
    }
  }

  if (!player && !playerId && !position && !positionGroup && !team) {
    return errorResponse(
      "At least one of player, playerId, position, positionGroup, or team is required",
      400,
    );
  }

  try {
    const query: PlayerTrendQuery = {
      player,
      playerId,
      position,
      positionGroup,
      team,
      opponent,
      filters: [],
      seasonRange,
      limit,
    };

    const result = await executePlayerTrendQueryFromDB(query);
    const durationMs = Math.round(performance.now() - start);
    return formatResponse(result, durationMs);
  } catch (err) {
    console.error("[GET /api/trends/players] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
