/**
 * NLP Query Parse API Route
 *
 * POST /api/trends/parse — Parses a natural language query into a
 * structured TrendQuery object that can be executed.
 *
 * Body: { query: string }
 * Returns: { success, data: { trendQuery, playerTrendQuery?, queryType, interpretation, confidence, suggestions? } }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseNaturalLanguageQuery } from "@/lib/nlp-query-parser";

export async function POST(request: NextRequest) {
  const start = performance.now();

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json(
      { success: false, error: "Query string is required" },
      { status: 400 },
    );
  }

  if (query.length > 500) {
    return NextResponse.json(
      { success: false, error: "Query too long (max 500 characters)" },
      { status: 400 },
    );
  }

  try {
    const result = await parseNaturalLanguageQuery(query);
    const durationMs = Math.round(performance.now() - start);

    return NextResponse.json({
      success: true,
      data: {
        trendQuery: result.trendQuery,
        playerTrendQuery: result.playerTrendQuery,
        queryType: result.queryType,
        interpretation: result.interpretation,
        confidence: result.confidence,
        suggestions: result.suggestions,
      },
      meta: { durationMs },
    });
  } catch (err) {
    console.error("[POST /api/trends/parse] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Parse failed",
      },
      { status: 500 },
    );
  }
}
