/**
 * Shareable Trend Cards API Route
 *
 * POST /api/trends/cards — Generate a trend card from a query
 *
 * Accepts the same query format as /api/trends, /api/trends/players,
 * or /api/trends/props and returns a structured TrendCard object
 * ready for rendering as a shareable social media card.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  executeTrendQueryCached,
  type TrendQuery,
} from "@/lib/trend-engine";
import {
  executePlayerTrendQueryCached,
  type PlayerTrendQuery,
} from "@/lib/player-trend-engine";
import {
  executePlayerPropQuery,
  type PropQuery,
} from "@/lib/prop-trend-engine";
import {
  generateGameTrendCard,
  generatePlayerTrendCard,
  generatePropTrendCard,
} from "@/lib/trend-card-generator";

// --- Zod Schemas ---

const FilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "between"]),
  value: z.any(),
});

const GameCardQuerySchema = z.object({
  type: z.literal("game"),
  sport: z.enum(["NFL", "NCAAF", "NCAAMB", "ALL"]),
  team: z.string().optional(),
  perspective: z.enum(["home", "away", "favorite", "underdog", "team", "opponent"]).optional(),
  filters: z.array(FilterSchema).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
});

const PlayerCardQuerySchema = z.object({
  type: z.literal("player"),
  player: z.string().optional(),
  position: z.string().optional(),
  positionGroup: z.string().optional(),
  team: z.string().optional(),
  opponent: z.string().optional(),
  filters: z.array(FilterSchema).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
});

const PropCardQuerySchema = z.object({
  type: z.literal("prop"),
  player: z.string().min(1),
  stat: z.string().min(1),
  line: z.number(),
  direction: z.enum(["over", "under"]),
  filters: z.array(FilterSchema).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  homeAway: z.enum(["home", "away"]).optional(),
  favDog: z.enum(["favorite", "underdog"]).optional(),
  opponent: z.string().optional(),
});

const CardQuerySchema = z.discriminatedUnion("type", [
  GameCardQuerySchema,
  PlayerCardQuerySchema,
  PropCardQuerySchema,
]);

// --- Helpers ---

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details ? { details } : {}) },
    { status },
  );
}

// --- POST /api/trends/cards ---

export async function POST(request: NextRequest) {
  const start = performance.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON in request body", 400);
  }

  const parsed = CardQuerySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid card query", 400, parsed.error.format());
  }

  try {
    const query = parsed.data;
    let card;

    if (query.type === "game") {
      const trendQuery: TrendQuery = {
        sport: query.sport as TrendQuery["sport"],
        team: query.team,
        perspective: query.perspective as TrendQuery["perspective"],
        filters: query.filters,
        seasonRange: query.seasonRange,
      };
      const result = await executeTrendQueryCached(trendQuery);
      card = generateGameTrendCard(result);
    } else if (query.type === "player") {
      const playerQuery: PlayerTrendQuery = {
        player: query.player,
        position: query.position,
        positionGroup: query.positionGroup,
        team: query.team,
        opponent: query.opponent,
        filters: query.filters,
        seasonRange: query.seasonRange,
      };
      const result = executePlayerTrendQueryCached(playerQuery);
      card = generatePlayerTrendCard(result);
    } else if (query.type === "prop") {
      const propQuery: PropQuery = {
        player: query.player,
        stat: query.stat,
        line: query.line,
        direction: query.direction,
        filters: query.filters,
        seasonRange: query.seasonRange,
        homeAway: query.homeAway,
        favDog: query.favDog,
        opponent: query.opponent,
      };
      const result = executePlayerPropQuery(propQuery);
      card = generatePropTrendCard(result);
    }

    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: { card },
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[POST /api/trends/cards] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
