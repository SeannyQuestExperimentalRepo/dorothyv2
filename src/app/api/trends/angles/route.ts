/**
 * Reverse Lookup / Auto-Surface Angles API Route
 *
 * GET  /api/trends/angles — Discover interesting betting angles
 * POST /api/trends/angles — Full query with JSON body
 *
 * Automatically scans predefined filter combinations and returns
 * the most statistically significant trends.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  executeReverseLookup,
  executeTeamReverseLookup,
  type ReverseLookupOptions,
} from "@/lib/reverse-lookup-engine";

// --- Zod Schemas ---

const AngleCategorySchema = z.enum([
  "weather", "schedule", "spread", "ranking", "primetime",
  "conference", "playoff", "rest", "tempo", "month", "combined",
]);

const TrendStrengthSchema = z.enum(["strong", "moderate", "weak", "noise"]);

const ReverseLookupQuerySchema = z.object({
  sport: z.enum(["NFL", "NCAAF", "NCAAMB"]).optional(),
  team: z.string().optional(),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  minStrength: TrendStrengthSchema.optional(),
  categories: z.array(AngleCategorySchema).optional(),
});

// --- Helpers ---

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details ? { details } : {}) },
    { status },
  );
}

// --- POST /api/trends/angles ---

export async function POST(request: NextRequest) {
  const start = performance.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON in request body", 400);
  }

  const parsed = ReverseLookupQuerySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid query parameters", 400, parsed.error.format());
  }

  try {
    const options = parsed.data as ReverseLookupOptions;
    const result = await executeReverseLookup(options);
    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: {
        angles: result.angles.map((a) => ({
          id: a.template.id,
          label: a.template.label,
          category: a.template.category,
          sport: a.sport,
          headline: a.headline,
          record: a.record,
          atsSignificance: a.atsSignificance,
          ouSignificance: a.ouSignificance,
          winSignificance: a.winSignificance,
          interestScore: a.interestScore,
          seasonRange: a.seasonRange,
        })),
        templatesScanned: result.templatesScanned,
        significantCount: result.significantCount,
        computedAt: result.computedAt,
      },
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[POST /api/trends/angles] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}

// --- GET /api/trends/angles ---

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const sport = searchParams.get("sport") as "NFL" | "NCAAF" | "NCAAMB" | null;
  const team = searchParams.get("team") || undefined;
  const maxResultsStr = searchParams.get("maxResults");
  const minStrength = searchParams.get("minStrength") as "strong" | "moderate" | "weak" | "noise" | null;

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

  let maxResults: number | undefined;
  if (maxResultsStr) {
    maxResults = parseInt(maxResultsStr, 10);
    if (isNaN(maxResults) || maxResults <= 0) {
      return errorResponse("maxResults must be a positive integer", 400);
    }
  }

  const categoriesStr = searchParams.get("categories");
  let categories: ReverseLookupOptions["categories"];
  if (categoriesStr) {
    categories = categoriesStr.split(",") as ReverseLookupOptions["categories"];
  }

  try {
    // If team is specified, use team-specific lookup
    if (team && sport) {
      const result = await executeTeamReverseLookup(
        sport,
        team,
        seasonRange || [2015, 2025],
        maxResults || 15,
      );
      const durationMs = Math.round(performance.now() - start);
      return NextResponse.json({
        success: true,
        data: {
          angles: result.angles.map((a) => ({
            id: a.template.id,
            label: a.template.label,
            category: a.template.category,
            sport: a.sport,
            headline: a.headline,
            record: a.record,
            atsSignificance: a.atsSignificance,
            ouSignificance: a.ouSignificance,
            winSignificance: a.winSignificance,
            interestScore: a.interestScore,
            seasonRange: a.seasonRange,
          })),
          templatesScanned: result.templatesScanned,
          significantCount: result.significantCount,
          computedAt: result.computedAt,
        },
        meta: { durationMs },
      });
    }

    const options: ReverseLookupOptions = {
      sport: sport || undefined,
      team,
      seasonRange,
      maxResults,
      minStrength: minStrength || undefined,
      categories,
    };

    const result = await executeReverseLookup(options);
    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: {
        angles: result.angles.map((a) => ({
          id: a.template.id,
          label: a.template.label,
          category: a.template.category,
          sport: a.sport,
          headline: a.headline,
          record: a.record,
          atsSignificance: a.atsSignificance,
          ouSignificance: a.ouSignificance,
          winSignificance: a.winSignificance,
          interestScore: a.interestScore,
          seasonRange: a.seasonRange,
        })),
        templatesScanned: result.templatesScanned,
        significantCount: result.significantCount,
        computedAt: result.computedAt,
      },
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[GET /api/trends/angles] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}
