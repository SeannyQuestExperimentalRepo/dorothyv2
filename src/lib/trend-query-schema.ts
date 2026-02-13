/**
 * Shared Zod schemas for trend query validation.
 * Extracted from the trends API route so it can be imported
 * by both /api/trends and /api/trends/saved without violating
 * Next.js route export restrictions.
 */

import { z } from "zod";

const FilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "contains",
  "between",
]);

/** Whitelist of filter fields that map to TrendGame properties + computed fields. */
export const VALID_FILTER_FIELDS = [
  // Core
  "sport", "season", "gameDate", "homeTeam", "awayTeam",
  // Scores
  "homeScore", "awayScore", "scoreDifference", "totalPoints", "winner",
  // Rankings
  "homeRank", "awayRank", "homeKenpomRank", "awayKenpomRank",
  // Betting
  "spread", "overUnder", "spreadResult", "ouResult",
  // Context
  "isConferenceGame", "isPlayoff", "isNeutralSite",
  // Scheduling
  "week", "dayOfWeek", "isPrimetime", "primetimeSlot",
  // Weather
  "weatherCategory", "temperature", "windMph",
  // NCAAF
  "isBowlGame", "bowlName",
  // NCAAMB
  "isNCAAT", "isNIT", "isConfTourney", "overtimes", "homeSeed", "awaySeed",
  // KenPom
  "homeAdjEM", "awayAdjEM", "homeAdjOE", "awayAdjOE",
  "homeAdjDE", "awayAdjDE", "homeAdjTempo", "awayAdjTempo",
  // Predictions
  "fmHomePred", "fmAwayPred", "fmHomeWinProb", "fmThrillScore",
  // Rest / bye
  "homeRestDays", "awayRestDays", "restAdvantage",
  "homeIsByeWeek", "awayIsByeWeek", "isShortWeek",
  "homeIsBackToBack", "awayIsBackToBack",
  // Conferences
  "homeConference", "awayConference",
  // KenPom matchup
  "expectedPace", "paceMismatch", "efficiencyGap",
  "kenpomPredMargin", "isKenpomUpset", "gameStyle",
  // Computed
  "month", "year", "monthName",
  // Perspective-aware (used by NLP parser)
  "isHome", "isFavorite",
] as const;

const TrendFilterSchema = z.object({
  field: z.enum(VALID_FILTER_FIELDS),
  operator: FilterOperatorSchema,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number()])).max(50),
  ]),
});

export const SportSchema = z.enum(["NFL", "NCAAF", "NCAAMB", "ALL"]);

export const PerspectiveSchema = z.enum([
  "home",
  "away",
  "favorite",
  "underdog",
  "team",
  "opponent",
]);

export const TrendQuerySchema = z.object({
  sport: SportSchema,
  team: z.string().max(100).optional(),
  perspective: PerspectiveSchema.optional(),
  filters: z.array(TrendFilterSchema).max(10).default([]),
  seasonRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  orderBy: z
    .object({
      field: z.enum(VALID_FILTER_FIELDS),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
});
