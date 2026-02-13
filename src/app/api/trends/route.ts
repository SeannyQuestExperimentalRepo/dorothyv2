/**
 * Trend Query API Route
 *
 * POST /api/trends — Full query with JSON body (TrendQuery)
 * GET  /api/trends — Simple query via URL params
 *
 * Returns trend results with summary statistics, ATS/O-U breakdowns,
 * and game-level data (capped at 100 games in response).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  executeTrendQueryCached,
  buildQuery,
  type TrendQuery,
  type TrendResult,
  type TrendGame,
} from "@/lib/trend-engine";
import { enrichGameSummary } from "@/lib/significance-enrichment";
import { queryLimiter, applyRateLimit } from "@/lib/rate-limit";
import { trackError, trackTiming, startTimer } from "@/lib/error-tracking";
import { TrendQuerySchema, SportSchema, PerspectiveSchema } from "@/lib/trend-query-schema";

// Vercel serverless config
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// --- Helpers ---

const MAX_RESPONSE_GAMES = 100;

function stripRawFromGames(
  games: TrendGame[],
): Omit<TrendGame, "_raw">[] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return games.map(({ _raw, ...rest }) => rest) as Omit<TrendGame, "_raw">[];
}

function formatResponse(result: TrendResult, durationMs: number, method: "GET" | "POST" = "GET") {
  const trimmedGames = stripRawFromGames(
    result.games.slice(0, MAX_RESPONSE_GAMES),
  );

  // Enrich with statistical significance
  const significance = enrichGameSummary(
    result.summary,
    result.query.perspective,
    result.query.sport,
  );

  const response = NextResponse.json({
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
      sport: result.query.sport,
      gamesSearched: result.summary.totalGames,
    },
  });
  // POST bodies aren't part of CDN cache keys, so use private cache for POST
  response.headers.set(
    "Cache-Control",
    method === "POST"
      ? "private, max-age=300"
      : "s-maxage=300, stale-while-revalidate=3600",
  );
  return response;
}

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

// --- POST /api/trends ---

export async function POST(request: NextRequest) {
  const limited = applyRateLimit(request, queryLimiter);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON in request body", 400);
  }

  const parsed = TrendQuerySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "Invalid query parameters",
      400,
      parsed.error.format(),
    );
  }

  try {
    const query = parsed.data as TrendQuery;
    const timer = startTimer();
    const result = await executeTrendQueryCached(query);
    const durationMs = timer();
    trackTiming({ route: "/api/trends", method: "POST", durationMs, sport: query.sport });
    return formatResponse(result, durationMs, "POST");
  } catch (err) {
    trackError(err, { route: "/api/trends", action: "POST" });
    return errorResponse(
      "Internal server error",
      500,
    );
  }
}

// --- GET /api/trends ---

export async function GET(request: NextRequest) {
  const limited = applyRateLimit(request, queryLimiter);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);

  const sportParam = searchParams.get("sport");
  if (!sportParam) {
    return errorResponse("Query parameter 'sport' is required", 400);
  }

  const sportParsed = SportSchema.safeParse(sportParam.toUpperCase());
  if (!sportParsed.success) {
    return errorResponse(
      `Invalid sport: '${sportParam}'. Must be one of: NFL, NCAAF, NCAAMB, ALL`,
      400,
    );
  }

  const perspectiveParam = searchParams.get("perspective");
  if (perspectiveParam) {
    const perspectiveParsed = PerspectiveSchema.safeParse(perspectiveParam);
    if (!perspectiveParsed.success) {
      return errorResponse(
        `Invalid perspective: '${perspectiveParam}'. Must be one of: home, away, favorite, underdog, team, opponent`,
        400,
      );
    }
  }

  const seasonStart = searchParams.get("seasonStart");
  const seasonEnd = searchParams.get("seasonEnd");
  let seasonRange: [number, number] | undefined;
  if (seasonStart && seasonEnd) {
    const s = parseInt(seasonStart, 10);
    const e = parseInt(seasonEnd, 10);
    if (isNaN(s) || isNaN(e)) {
      return errorResponse(
        "seasonStart and seasonEnd must be valid integers",
        400,
      );
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

  try {
    const query = buildQuery(sportParsed.data as TrendQuery["sport"], {
      team: searchParams.get("team") || undefined,
      perspective: (perspectiveParam as TrendQuery["perspective"]) || undefined,
      seasonRange,
      limit,
      filters: [],
    });

    const timer = startTimer();
    const result = await executeTrendQueryCached(query);
    const durationMs = timer();
    trackTiming({ route: "/api/trends", method: "GET", durationMs });
    return formatResponse(result, durationMs);
  } catch (err) {
    trackError(err, { route: "/api/trends", action: "GET" });
    return errorResponse(
      "Internal server error",
      500,
    );
  }
}
