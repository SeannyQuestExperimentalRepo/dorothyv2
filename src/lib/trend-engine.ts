/**
 * TrendLine Composable Trend Query Engine
 *
 * The core product feature of TrendLine. This engine normalizes game data
 * from NFL, NCAAF, and NCAAMB into a unified interface and provides a
 * composable filter system for building complex betting trend queries.
 *
 * Architecture:
 * 1. TrendGame — unified interface across all 3 sports
 * 2. TrendFilter — composable filter predicates
 * 3. Perspective — orients results from home/away/favorite/underdog/team POV
 * 4. TrendResult — query results with rich summary statistics
 *
 * Spread convention: negative = home favored (e.g., -7 means home is 7-point favorite).
 * The spreadResult in raw data is already computed from the home team's perspective.
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type Sport = "NFL" | "NCAAF" | "NCAAMB";
export type SportOrAll = Sport | "ALL";

export interface TrendGame {
  // Identity
  sport: Sport;
  season: number;
  gameDate: string; // YYYY-MM-DD

  // Teams (canonical names)
  homeTeam: string;
  awayTeam: string;

  // Scores
  homeScore: number;
  awayScore: number;
  scoreDifference: number; // home - away
  winner: string;

  // Rankings/Ratings
  homeRank: number | null; // AP rank
  awayRank: number | null;
  homeKenpomRank: number | null; // NCAAMB only
  awayKenpomRank: number | null;

  // Betting
  spread: number | null; // negative = home favored
  overUnder: number | null;
  spreadResult: "COVERED" | "LOST" | "PUSH" | null;
  ouResult: "OVER" | "UNDER" | "PUSH" | null;
  totalPoints: number; // homeScore + awayScore

  // Context
  isConferenceGame: boolean;
  isPlayoff: boolean; // NFL playoff, CFP, or NCAA Tournament
  isNeutralSite: boolean;

  // NFL/NCAAF specific
  week: string | null;
  dayOfWeek: string | null;
  isPrimetime: boolean;
  primetimeSlot: string | null;
  weatherCategory: string | null;
  temperature: number | null;
  windMph: number | null;

  // NCAAF specific
  isBowlGame: boolean;
  bowlName: string | null;

  // NCAAMB specific
  isNCAAT: boolean;
  isNIT: boolean;
  isConfTourney: boolean;
  overtimes: number;
  homeSeed: number | null;
  awaySeed: number | null;

  // KenPom (NCAAMB)
  homeAdjEM: number | null;
  awayAdjEM: number | null;
  homeAdjOE: number | null;
  awayAdjOE: number | null;
  homeAdjDE: number | null;
  awayAdjDE: number | null;
  homeAdjTempo: number | null;
  awayAdjTempo: number | null;
  fmHomePred: number | null;
  fmAwayPred: number | null;
  fmHomeWinProb: number | null;
  fmThrillScore: number | null;

  // Enrichments (added by enrichment scripts, may not exist yet)
  homeRestDays: number | null;
  awayRestDays: number | null;
  restAdvantage: number | null;

  // NFL/NCAAF bye-week and rest enrichments
  homeIsByeWeek: boolean;
  awayIsByeWeek: boolean;
  isShortWeek: boolean;

  // NCAAMB back-to-back enrichments
  homeIsBackToBack: boolean;
  awayIsBackToBack: boolean;

  // Conferences (NCAAF / NCAAMB)
  homeConference: string | null;
  awayConference: string | null;

  // KenPom matchup metrics (NCAAMB enrichments — future)
  expectedPace: number | null;
  paceMismatch: number | null;
  efficiencyGap: number | null;
  kenpomPredMargin: number | null;
  isKenpomUpset: boolean;
  gameStyle: string | null;

  // Raw object reference for sport-specific fields
  _raw: Record<string, unknown>;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "between";

export interface TrendFilter {
  /** Any field from TrendGame, or special computed fields like "month" */
  field: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * Perspective determines how results are oriented:
 * - "home" — stats from home team's POV
 * - "away" — stats from away team's POV
 * - "favorite" — stats from the favorite's POV (requires spread)
 * - "underdog" — stats from the underdog's POV (requires spread)
 * - "team" — stats from query.team's POV (requires query.team)
 * - "opponent" — stats from the opponent of query.team (requires query.team)
 */
export type Perspective =
  | "home"
  | "away"
  | "favorite"
  | "underdog"
  | "team"
  | "opponent";

export interface TrendQuery {
  sport: SportOrAll;
  /** Optional: filter to games involving this team */
  team?: string;
  /** How to orient the results. Defaults to "home". */
  perspective?: Perspective;
  /** Composable filters */
  filters: TrendFilter[];
  /** Optional: [startSeason, endSeason] inclusive */
  seasonRange?: [number, number];
  /** Max results returned */
  limit?: number;
  /** Sort order */
  orderBy?: { field: string; direction: "asc" | "desc" };
}

export interface TrendResult {
  query: TrendQuery;
  games: TrendGame[];
  summary: TrendSummary;
  computedAt: string;
}

export interface SeasonBreakdown {
  season: number;
  games: number;
  wins: number;
  losses: number;
  atsCovered: number;
  atsLost: number;
}

export interface TrendSummary {
  totalGames: number;

  // Win/Loss
  wins: number;
  losses: number;
  winPct: number; // 0-100

  // ATS (Against the Spread)
  atsCovered: number;
  atsLost: number;
  atsPush: number;
  atsPct: number; // 0-100 (excluding pushes)
  atsRecord: string; // "45-32-2"

  // Over/Under
  overs: number;
  unders: number;
  ouPush: number;
  overPct: number; // 0-100 (excluding pushes)
  ouRecord: string; // "40-38-1"

  // Scoring
  avgPointsFor: number; // From the perspective team's view
  avgPointsAgainst: number;
  avgTotalPoints: number;
  avgMargin: number;

  // Additional
  avgSpread: number | null;
  avgOverUnder: number | null;

  // Season breakdown
  bySeasonBreakdown: SeasonBreakdown[];
}

// ─── Oriented Game (internal) ──────────────────────────────────────────────────

/**
 * An oriented view of a game from a specific team's perspective.
 * Used internally for summary computation after perspective has been applied.
 */
interface OrientedGame {
  game: TrendGame;
  /** Points scored by the "perspective" team */
  pointsFor: number;
  /** Points scored by the opponent */
  pointsAgainst: number;
  /** Margin from the perspective team's view (positive = they won) */
  margin: number;
  /** Did the perspective team win? */
  isWin: boolean;
  /** ATS result from the perspective team's view */
  atsResult: "COVERED" | "LOST" | "PUSH" | null;
  /** Spread from the perspective team's view (negative = they were favored) */
  perspectiveSpread: number | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");

const NFL_FILE = "nfl-games-final.json";
const NCAAF_FILE = "ncaaf-games-final.json";
const NCAAMB_FILE = "ncaamb-games-final.json";

// ─── Data Loading & Normalization ───────────────────────────────────────────────

/**
 * Load and normalize all game data across NFL, NCAAF, and NCAAMB.
 * Data is read from JSON files in the /data directory.
 */
export function loadAllGames(): TrendGame[] {
  return [
    ...loadGamesBySport("NFL"),
    ...loadGamesBySport("NCAAF"),
    ...loadGamesBySport("NCAAMB"),
  ];
}

/**
 * Load and normalize game data for a single sport.
 */
export function loadGamesBySport(sport: Sport): TrendGame[] {
  const fileMap: Record<Sport, string> = {
    NFL: NFL_FILE,
    NCAAF: NCAAF_FILE,
    NCAAMB: NCAAMB_FILE,
  };
  const filePath = path.join(DATA_DIR, fileMap[sport]);

  if (!fs.existsSync(filePath)) {
    console.warn(`[trend-engine] Data file not found: ${filePath}`);
    return [];
  }

  const rawData = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >[];

  const normalizers: Record<
    Sport,
    (raw: Record<string, unknown>) => TrendGame
  > = {
    NFL: normalizeNFL,
    NCAAF: normalizeNCAAF,
    NCAAMB: normalizeNCAAMB,
  };

  return rawData.map(normalizers[sport]);
}

/** Safe accessor for unknown objects */
function get<T>(obj: Record<string, unknown>, key: string, fallback: T): T {
  const val = obj[key];
  if (val === undefined || val === null) return fallback;
  return val as T;
}

/**
 * Normalize an NFL raw game object into TrendGame.
 *
 * NFL data uses homeTeamCanonical/awayTeamCanonical for team names,
 * winnerCanonical for the winner, and does not have conference info.
 */
function normalizeNFL(raw: Record<string, unknown>): TrendGame {
  const homeScore = get<number>(raw, "homeScore", 0);
  const awayScore = get<number>(raw, "awayScore", 0);

  return {
    sport: "NFL",
    season: get<number>(raw, "season", 0),
    gameDate: get<string>(raw, "gameDate", ""),
    homeTeam: get<string>(raw, "homeTeamCanonical", ""),
    awayTeam: get<string>(raw, "awayTeamCanonical", ""),
    homeScore,
    awayScore,
    scoreDifference: get<number>(raw, "scoreDifference", homeScore - awayScore),
    winner: get<string>(raw, "winnerCanonical", ""),
    homeRank: null,
    awayRank: null,
    homeKenpomRank: null,
    awayKenpomRank: null,
    spread: get<number | null>(raw, "spread", null),
    overUnder: get<number | null>(raw, "overUnder", null),
    spreadResult: get<"COVERED" | "LOST" | "PUSH" | null>(
      raw,
      "spreadResult",
      null
    ),
    ouResult: get<"OVER" | "UNDER" | "PUSH" | null>(raw, "ouResult", null),
    totalPoints: homeScore + awayScore,
    isConferenceGame: false,
    isPlayoff: get<boolean>(raw, "isPlayoff", false),
    isNeutralSite: get<boolean>(raw, "isNeutralSite", false),
    week: get<string | null>(raw, "week", null),
    dayOfWeek: get<string | null>(raw, "dayOfWeek", null),
    isPrimetime: get<boolean>(raw, "isPrimetime", false),
    primetimeSlot: get<string | null>(raw, "primetimeSlot", null),
    weatherCategory: get<string | null>(raw, "weatherCategory", null),
    temperature: get<number | null>(raw, "temperature", null),
    windMph: get<number | null>(raw, "windMph", null),
    isBowlGame: false,
    bowlName: null,
    isNCAAT: false,
    isNIT: false,
    isConfTourney: false,
    overtimes: 0,
    homeSeed: null,
    awaySeed: null,
    homeAdjEM: null,
    awayAdjEM: null,
    homeAdjOE: null,
    awayAdjOE: null,
    homeAdjDE: null,
    awayAdjDE: null,
    homeAdjTempo: null,
    awayAdjTempo: null,
    fmHomePred: null,
    fmAwayPred: null,
    fmHomeWinProb: null,
    fmThrillScore: null,
    homeRestDays: get<number | null>(raw, "homeRestDays", null),
    awayRestDays: get<number | null>(raw, "awayRestDays", null),
    restAdvantage: get<number | null>(raw, "restAdvantage", null),
    homeIsByeWeek: get<boolean>(raw, "homeIsByeWeek", false),
    awayIsByeWeek: get<boolean>(raw, "awayIsByeWeek", false),
    isShortWeek: get<boolean>(raw, "isShortWeek", false),
    homeIsBackToBack: false,
    awayIsBackToBack: false,
    homeConference: null,
    awayConference: null,
    expectedPace: null,
    paceMismatch: null,
    efficiencyGap: null,
    kenpomPredMargin: null,
    isKenpomUpset: false,
    gameStyle: null,
    _raw: raw,
  };
}

/**
 * Normalize an NCAAF raw game object into TrendGame.
 *
 * NCAAF data uses homeTeamCanonical/awayTeamCanonical for full names,
 * has conference info, bowl game info, and AP ranks.
 */
function normalizeNCAAF(raw: Record<string, unknown>): TrendGame {
  const homeScore = get<number>(raw, "homeScore", 0);
  const awayScore = get<number>(raw, "awayScore", 0);

  return {
    sport: "NCAAF",
    season: get<number>(raw, "season", 0),
    gameDate: get<string>(raw, "gameDate", ""),
    homeTeam: get<string>(raw, "homeTeamCanonical", ""),
    awayTeam: get<string>(raw, "awayTeamCanonical", ""),
    homeScore,
    awayScore,
    scoreDifference: get<number>(raw, "scoreDifference", homeScore - awayScore),
    winner: get<string>(raw, "winnerCanonical", ""),
    homeRank: get<number | null>(raw, "homeRank", null),
    awayRank: get<number | null>(raw, "awayRank", null),
    homeKenpomRank: null,
    awayKenpomRank: null,
    spread: get<number | null>(raw, "spread", null),
    overUnder: get<number | null>(raw, "overUnder", null),
    spreadResult: get<"COVERED" | "LOST" | "PUSH" | null>(
      raw,
      "spreadResult",
      null
    ),
    ouResult: get<"OVER" | "UNDER" | "PUSH" | null>(raw, "ouResult", null),
    totalPoints: homeScore + awayScore,
    isConferenceGame: get<boolean>(raw, "isConferenceGame", false),
    isPlayoff: get<boolean>(raw, "isPlayoff", false),
    isNeutralSite: get<boolean>(raw, "isNeutralSite", false),
    week: get<string | null>(raw, "week", null),
    dayOfWeek: get<string | null>(raw, "dayOfWeek", null),
    isPrimetime: get<boolean>(raw, "isPrimetime", false),
    primetimeSlot: get<string | null>(raw, "primetimeSlot", null),
    weatherCategory: get<string | null>(raw, "weatherCategory", null),
    temperature: get<number | null>(raw, "temperature", null),
    windMph: get<number | null>(raw, "windMph", null),
    isBowlGame: get<boolean>(raw, "isBowlGame", false),
    bowlName: get<string | null>(raw, "bowlName", null),
    isNCAAT: false,
    isNIT: false,
    isConfTourney: false,
    overtimes: 0,
    homeSeed: null,
    awaySeed: null,
    homeAdjEM: null,
    awayAdjEM: null,
    homeAdjOE: null,
    awayAdjOE: null,
    homeAdjDE: null,
    awayAdjDE: null,
    homeAdjTempo: null,
    awayAdjTempo: null,
    fmHomePred: null,
    fmAwayPred: null,
    fmHomeWinProb: null,
    fmThrillScore: null,
    homeRestDays: get<number | null>(raw, "homeRestDays", null),
    awayRestDays: get<number | null>(raw, "awayRestDays", null),
    restAdvantage: get<number | null>(raw, "restAdvantage", null),
    homeIsByeWeek: get<boolean>(raw, "homeIsByeWeek", false),
    awayIsByeWeek: get<boolean>(raw, "awayIsByeWeek", false),
    isShortWeek: get<boolean>(raw, "isShortWeek", false),
    homeIsBackToBack: false,
    awayIsBackToBack: false,
    homeConference: get<string | null>(raw, "homeConference", null),
    awayConference: get<string | null>(raw, "awayConference", null),
    expectedPace: null,
    paceMismatch: null,
    efficiencyGap: null,
    kenpomPredMargin: null,
    isKenpomUpset: false,
    gameStyle: null,
    _raw: raw,
  };
}

/**
 * Normalize an NCAAMB raw game object into TrendGame.
 *
 * NCAAMB data uses homeTeam/awayTeam (no "Canonical" suffix),
 * has KenPom stats, seeds, overtime, and tournament flags.
 */
function normalizeNCAAMB(raw: Record<string, unknown>): TrendGame {
  const homeScore = get<number>(raw, "homeScore", 0);
  const awayScore = get<number>(raw, "awayScore", 0);
  const isNCAAT = get<boolean>(raw, "isNCAAT", false);

  return {
    sport: "NCAAMB",
    season: get<number>(raw, "season", 0),
    gameDate: get<string>(raw, "gameDate", ""),
    homeTeam: get<string>(raw, "homeTeam", ""),
    awayTeam: get<string>(raw, "awayTeam", ""),
    homeScore,
    awayScore,
    scoreDifference: get<number>(raw, "scoreDifference", homeScore - awayScore),
    winner: get<string>(raw, "winnerCanonical", ""),
    homeRank: get<number | null>(raw, "homeRank", null),
    awayRank: get<number | null>(raw, "awayRank", null),
    homeKenpomRank: get<number | null>(raw, "homeKenpomRank", null),
    awayKenpomRank: get<number | null>(raw, "awayKenpomRank", null),
    spread: get<number | null>(raw, "spread", null),
    overUnder: get<number | null>(raw, "overUnder", null),
    spreadResult: get<"COVERED" | "LOST" | "PUSH" | null>(
      raw,
      "spreadResult",
      null
    ),
    ouResult: get<"OVER" | "UNDER" | "PUSH" | null>(raw, "ouResult", null),
    totalPoints: homeScore + awayScore,
    isConferenceGame: get<boolean>(raw, "isConferenceGame", false),
    isPlayoff: isNCAAT,
    isNeutralSite: get<boolean>(raw, "isNeutralSite", false),
    week: null,
    dayOfWeek: null,
    isPrimetime: false,
    primetimeSlot: null,
    weatherCategory: null,
    temperature: null,
    windMph: null,
    isBowlGame: false,
    bowlName: null,
    isNCAAT,
    isNIT: get<boolean>(raw, "isNIT", false),
    isConfTourney: get<boolean>(raw, "isConfTourney", false),
    overtimes: get<number>(raw, "overtimes", 0),
    homeSeed: get<number | null>(raw, "homeSeed", null),
    awaySeed: get<number | null>(raw, "awaySeed", null),
    homeAdjEM: get<number | null>(raw, "homeAdjEM", null),
    awayAdjEM: get<number | null>(raw, "awayAdjEM", null),
    homeAdjOE: get<number | null>(raw, "homeAdjOE", null),
    awayAdjOE: get<number | null>(raw, "awayAdjOE", null),
    homeAdjDE: get<number | null>(raw, "homeAdjDE", null),
    awayAdjDE: get<number | null>(raw, "awayAdjDE", null),
    homeAdjTempo: get<number | null>(raw, "homeAdjTempo", null),
    awayAdjTempo: get<number | null>(raw, "awayAdjTempo", null),
    fmHomePred: get<number | null>(raw, "fmHomePred", null),
    fmAwayPred: get<number | null>(raw, "fmAwayPred", null),
    fmHomeWinProb: get<number | null>(raw, "fmHomeWinProb", null),
    fmThrillScore: get<number | null>(raw, "fmThrillScore", null),
    homeRestDays: get<number | null>(raw, "homeRestDays", null),
    awayRestDays: get<number | null>(raw, "awayRestDays", null),
    restAdvantage: get<number | null>(raw, "restAdvantage", null),
    homeIsByeWeek: false,
    awayIsByeWeek: false,
    isShortWeek: false,
    homeIsBackToBack: get<boolean>(raw, "homeIsBackToBack", false),
    awayIsBackToBack: get<boolean>(raw, "awayIsBackToBack", false),
    homeConference: get<string | null>(raw, "homeConference", null),
    awayConference: get<string | null>(raw, "awayConference", null),
    expectedPace: get<number | null>(raw, "expectedPace", null),
    paceMismatch: get<number | null>(raw, "paceMismatch", null),
    efficiencyGap: get<number | null>(raw, "efficiencyGap", null),
    kenpomPredMargin: get<number | null>(raw, "kenpomPredMargin", null),
    isKenpomUpset: get<boolean>(raw, "isKenpomUpset", false),
    gameStyle: get<string | null>(raw, "gameStyle", null),
    _raw: raw,
  };
}

// ─── Filter System ──────────────────────────────────────────────────────────────

/**
 * Resolve the value of a field from a TrendGame, supporting:
 * - Direct property access (e.g., "homeScore")
 * - Special computed fields ("month", "year", "monthName")
 * - Dot-notation for _raw access (e.g., "_raw.homeFBS")
 * - Fallback to _raw for unrecognized field names
 */
function resolveField(game: TrendGame, field: string): unknown {
  // Special computed fields
  switch (field) {
    case "month":
      return game.gameDate
        ? new Date(game.gameDate + "T12:00:00").getMonth() + 1
        : null;
    case "year":
      return game.gameDate
        ? new Date(game.gameDate + "T12:00:00").getFullYear()
        : null;
    case "monthName": {
      if (!game.gameDate) return null;
      const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      return months[new Date(game.gameDate + "T12:00:00").getMonth()];
    }
    default:
      break;
  }

  // Dot notation for nested access (e.g., "_raw.homeFBS")
  if (field.includes(".")) {
    const parts = field.split(".");
    let current: unknown = game;
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current ?? null;
  }

  // Direct property access on the TrendGame interface
  if (field in game) {
    return (game as unknown as Record<string, unknown>)[field];
  }

  // Fall through to _raw for any unrecognized field
  return game._raw[field] ?? null;
}

/**
 * Evaluate a single filter operator against a game field value.
 */
export function evaluateOperator(
  fieldValue: unknown,
  operator: FilterOperator,
  filterValue: unknown
): boolean {
  // Null field values: only "eq" with null should match
  if (fieldValue === null || fieldValue === undefined) {
    if (operator === "eq") return filterValue === null;
    if (operator === "neq") return filterValue !== null;
    return false;
  }

  switch (operator) {
    case "eq":
      if (typeof fieldValue === "string" && typeof filterValue === "string") {
        return fieldValue.toLowerCase() === filterValue.toLowerCase();
      }
      return fieldValue === filterValue;

    case "neq":
      if (typeof fieldValue === "string" && typeof filterValue === "string") {
        return fieldValue.toLowerCase() !== filterValue.toLowerCase();
      }
      return fieldValue !== filterValue;

    case "gt":
      return (fieldValue as number) > (filterValue as number);

    case "gte":
      return (fieldValue as number) >= (filterValue as number);

    case "lt":
      return (fieldValue as number) < (filterValue as number);

    case "lte":
      return (fieldValue as number) <= (filterValue as number);

    case "in": {
      const arr = filterValue as unknown[];
      if (typeof fieldValue === "string") {
        return arr.some(
          (v) =>
            typeof v === "string" &&
            v.toLowerCase() === (fieldValue as string).toLowerCase()
        );
      }
      return arr.includes(fieldValue);
    }

    case "notIn": {
      const arr2 = filterValue as unknown[];
      if (typeof fieldValue === "string") {
        return !arr2.some(
          (v) =>
            typeof v === "string" &&
            v.toLowerCase() === (fieldValue as string).toLowerCase()
        );
      }
      return !arr2.includes(fieldValue);
    }

    case "contains":
      if (typeof fieldValue === "string" && typeof filterValue === "string") {
        return fieldValue.toLowerCase().includes(filterValue.toLowerCase());
      }
      return false;

    case "between": {
      const [min, max] = filterValue as [number, number];
      const num = fieldValue as number;
      return num >= min && num <= max;
    }

    default:
      console.warn(`[trend-engine] Unknown filter operator: ${operator}`);
      return false;
  }
}

/**
 * Apply a single filter to an array of games.
 * Returns only games that match the filter predicate.
 */
export function applyFilter(
  games: TrendGame[],
  filter: TrendFilter
): TrendGame[] {
  return games.filter((game) => {
    const fieldValue = resolveField(game, filter.field);
    return evaluateOperator(fieldValue, filter.operator, filter.value);
  });
}

/**
 * Apply all filters from a query to a set of games.
 * Filters are ANDed together (all must match).
 */
function applyAllFilters(
  games: TrendGame[],
  filters: TrendFilter[]
): TrendGame[] {
  let result = games;
  for (const filter of filters) {
    result = applyFilter(result, filter);
  }
  return result;
}

// ─── Perspective System ─────────────────────────────────────────────────────────

/**
 * Case-insensitive team name matching.
 * Checks canonical names first, then raw name variants, then partial matches.
 */
function teamMatches(
  game: TrendGame,
  teamName: string
): "home" | "away" | null {
  const t = teamName.toLowerCase();

  // Check canonical names (exact match)
  if (game.homeTeam.toLowerCase() === t) return "home";
  if (game.awayTeam.toLowerCase() === t) return "away";

  // Check raw name variants (NFL uses homeTeamOriginal, NCAAF uses homeTeam, NCAAMB uses homeTeamRaw)
  const rawHome = [
    game._raw["homeTeamOriginal"],
    game._raw["homeTeam"],
    game._raw["homeTeamRaw"],
  ]
    .filter(Boolean)
    .map((s) => (s as string).toLowerCase());

  const rawAway = [
    game._raw["awayTeamOriginal"],
    game._raw["awayTeam"],
    game._raw["awayTeamRaw"],
  ]
    .filter(Boolean)
    .map((s) => (s as string).toLowerCase());

  if (rawHome.includes(t)) return "home";
  if (rawAway.includes(t)) return "away";

  // Partial match: check if the team name is contained in any name variant
  if (
    game.homeTeam.toLowerCase().includes(t) ||
    rawHome.some((n) => n.includes(t))
  )
    return "home";
  if (
    game.awayTeam.toLowerCase().includes(t) ||
    rawAway.some((n) => n.includes(t))
  )
    return "away";

  return null;
}

/**
 * Determine if the home team is the favorite based on spread.
 * spread < 0 means home is favored; spread > 0 means away is favored.
 * spread === 0 is a pick'em — we treat home as the favorite by convention.
 */
function isHomeFavorite(game: TrendGame): boolean | null {
  if (game.spread === null) return null;
  return game.spread <= 0;
}

/**
 * Compute the ATS result from a specific side's perspective.
 *
 * The spread in our data is from the home team's perspective:
 * - spread = -7 means home is favored by 7
 * - scoreDifference = homeScore - awayScore
 *
 * The key formula is: adjustedMargin = scoreDifference + spread
 *
 * For HOME:
 *   adjustedMargin > 0 -> home covered
 *   adjustedMargin < 0 -> home lost ATS
 *   adjustedMargin = 0 -> push
 *
 * For AWAY (they cover when the home team does NOT):
 *   adjustedMargin < 0 -> away covered
 *   adjustedMargin > 0 -> away lost ATS
 *   adjustedMargin = 0 -> push
 *
 * Example: Home -7, final 24-20 (scoreDiff = 4)
 *   adjustedMargin = 4 + (-7) = -3 -> home did NOT cover, away covered
 *
 * Example: Home -7, final 28-20 (scoreDiff = 8)
 *   adjustedMargin = 8 + (-7) = 1 -> home covered
 */
function computeAtsForSide(
  game: TrendGame,
  side: "home" | "away"
): "COVERED" | "LOST" | "PUSH" | null {
  if (game.spread === null) return null;

  const adjustedMargin = game.scoreDifference + game.spread;

  if (side === "home") {
    if (adjustedMargin > 0) return "COVERED";
    if (adjustedMargin < 0) return "LOST";
    return "PUSH";
  } else {
    if (adjustedMargin < 0) return "COVERED";
    if (adjustedMargin > 0) return "LOST";
    return "PUSH";
  }
}

/**
 * Apply perspective transformation to a set of games.
 *
 * This filters games to only those relevant to the chosen perspective:
 * - "home"/"away": keep all games
 * - "favorite"/"underdog": keep only games with spread data
 * - "team"/"opponent": keep only games involving query.team
 *
 * The actual orientation (which side's stats we compute) happens in
 * orientGame() during summary computation.
 */
export function applyPerspective(
  games: TrendGame[],
  query: TrendQuery
): TrendGame[] {
  const perspective = query.perspective ?? "home";

  switch (perspective) {
    case "home":
    case "away":
      return games;

    case "favorite":
    case "underdog":
      return games.filter((g) => g.spread !== null);

    case "team":
    case "opponent": {
      if (!query.team) {
        console.warn(
          `[trend-engine] Perspective "${perspective}" requires query.team to be set`
        );
        return games;
      }
      return games.filter((g) => teamMatches(g, query.team!) !== null);
    }

    default:
      return games;
  }
}

/**
 * Orient a single game from the specified perspective.
 *
 * Returns an OrientedGame with all stats computed from the correct side's POV.
 * This is the heart of the perspective system — it determines:
 * - Which score is "points for" vs "points against"
 * - Whether the team won or lost
 * - The ATS result from that side
 * - The spread from that side's view
 */
function orientGame(
  game: TrendGame,
  perspective: Perspective,
  team?: string
): OrientedGame {
  let side: "home" | "away";

  switch (perspective) {
    case "home":
      side = "home";
      break;

    case "away":
      side = "away";
      break;

    case "favorite": {
      const homeFav = isHomeFavorite(game);
      side = homeFav === true ? "home" : "away";
      break;
    }

    case "underdog": {
      const homeFav = isHomeFavorite(game);
      side = homeFav === true ? "away" : "home";
      break;
    }

    case "team": {
      if (!team) {
        side = "home";
        break;
      }
      const match = teamMatches(game, team);
      side = match === "away" ? "away" : "home";
      break;
    }

    case "opponent": {
      if (!team) {
        side = "away";
        break;
      }
      const match = teamMatches(game, team);
      side = match === "home" ? "away" : "home";
      break;
    }

    default:
      side = "home";
  }

  const pointsFor = side === "home" ? game.homeScore : game.awayScore;
  const pointsAgainst = side === "home" ? game.awayScore : game.homeScore;
  const margin = pointsFor - pointsAgainst;
  const isWin = margin > 0;
  const atsResult = computeAtsForSide(game, side);

  // Compute perspective spread:
  // If side is "home", the spread is as-is (negative = this team is favored)
  // If side is "away", flip the sign (away team's spread = -homeSpread)
  let perspectiveSpread: number | null = null;
  if (game.spread !== null) {
    perspectiveSpread = side === "home" ? game.spread : -game.spread;
  }

  return {
    game,
    pointsFor,
    pointsAgainst,
    margin,
    isWin,
    atsResult,
    perspectiveSpread,
  };
}

// ─── Summary Computation ────────────────────────────────────────────────────────

/**
 * Round a number to the specified decimal places.
 */
function round(value: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Format a record string like "45-32-2" (wins-losses-pushes).
 * Includes the push component only if pushes > 0.
 */
function formatRecord(wins: number, losses: number, pushes: number): string {
  if (pushes > 0) {
    return `${wins}-${losses}-${pushes}`;
  }
  return `${wins}-${losses}`;
}

/**
 * Compute summary statistics from a set of games, oriented by the given perspective.
 *
 * Each game is oriented from the perspective team's POV via orientGame(), then
 * we aggregate: wins, losses, ATS record, O/U record, scoring averages, spread
 * averages, and per-season breakdowns.
 *
 * @param games - The set of games to summarize
 * @param perspective - How to orient each game
 * @param team - Required when perspective is "team" or "opponent"
 */
export function computeSummary(
  games: TrendGame[],
  perspective: Perspective,
  team?: string
): TrendSummary {
  if (games.length === 0) {
    return emptyTrendSummary();
  }

  const oriented = games.map((g) => orientGame(g, perspective, team));
  const n = oriented.length;

  // Win/Loss (ties count as neither win nor loss)
  const wins = oriented.filter((o) => o.isWin).length;
  const losses = oriented.filter((o) => o.margin < 0).length;
  const totalDecided = wins + losses;
  const winPct = totalDecided > 0 ? round((wins / totalDecided) * 100) : 0;

  // ATS (Against the Spread)
  const atsGames = oriented.filter((o) => o.atsResult !== null);
  const atsCovered = atsGames.filter((o) => o.atsResult === "COVERED").length;
  const atsLost = atsGames.filter((o) => o.atsResult === "LOST").length;
  const atsPush = atsGames.filter((o) => o.atsResult === "PUSH").length;
  const atsDecided = atsCovered + atsLost;
  const atsPct = atsDecided > 0 ? round((atsCovered / atsDecided) * 100) : 0;

  // Over/Under (O/U result is the same regardless of perspective)
  const ouGames = oriented.filter((o) => o.game.ouResult !== null);
  const overs = ouGames.filter((o) => o.game.ouResult === "OVER").length;
  const unders = ouGames.filter((o) => o.game.ouResult === "UNDER").length;
  const ouPush = ouGames.filter((o) => o.game.ouResult === "PUSH").length;
  const ouDecided = overs + unders;
  const overPct = ouDecided > 0 ? round((overs / ouDecided) * 100) : 0;

  // Scoring averages
  const totalPointsFor = oriented.reduce((sum, o) => sum + o.pointsFor, 0);
  const totalPointsAgainst = oriented.reduce(
    (sum, o) => sum + o.pointsAgainst,
    0
  );
  const totalTotalPoints = oriented.reduce(
    (sum, o) => sum + o.game.totalPoints,
    0
  );
  const totalMargin = oriented.reduce((sum, o) => sum + o.margin, 0);

  // Average spread (from perspective team's view)
  const spreadGames = oriented.filter((o) => o.perspectiveSpread !== null);
  const avgSpread =
    spreadGames.length > 0
      ? round(
          spreadGames.reduce((sum, o) => sum + o.perspectiveSpread!, 0) /
            spreadGames.length
        )
      : null;

  // Average O/U line
  const ouGamesWithLine = oriented.filter((o) => o.game.overUnder !== null);
  const avgOverUnder =
    ouGamesWithLine.length > 0
      ? round(
          ouGamesWithLine.reduce((sum, o) => sum + o.game.overUnder!, 0) /
            ouGamesWithLine.length
        )
      : null;

  // Season breakdown
  const seasonMap = new Map<number, SeasonBreakdown>();
  for (const o of oriented) {
    const season = o.game.season;
    if (!seasonMap.has(season)) {
      seasonMap.set(season, {
        season,
        games: 0,
        wins: 0,
        losses: 0,
        atsCovered: 0,
        atsLost: 0,
      });
    }
    const sb = seasonMap.get(season)!;
    sb.games++;
    if (o.isWin) sb.wins++;
    else if (o.margin < 0) sb.losses++;
    if (o.atsResult === "COVERED") sb.atsCovered++;
    else if (o.atsResult === "LOST") sb.atsLost++;
  }
  const bySeasonBreakdown = Array.from(seasonMap.values()).sort(
    (a, b) => a.season - b.season
  );

  return {
    totalGames: n,
    wins,
    losses,
    winPct,
    atsCovered,
    atsLost,
    atsPush,
    atsPct,
    atsRecord: formatRecord(atsCovered, atsLost, atsPush),
    overs,
    unders,
    ouPush,
    overPct,
    ouRecord: formatRecord(overs, unders, ouPush),
    avgPointsFor: round(totalPointsFor / n),
    avgPointsAgainst: round(totalPointsAgainst / n),
    avgTotalPoints: round(totalTotalPoints / n),
    avgMargin: round(totalMargin / n),
    avgSpread,
    avgOverUnder,
    bySeasonBreakdown,
  };
}

/**
 * Return an empty TrendSummary for queries that match zero games.
 */
function emptyTrendSummary(): TrendSummary {
  return {
    totalGames: 0,
    wins: 0,
    losses: 0,
    winPct: 0,
    atsCovered: 0,
    atsLost: 0,
    atsPush: 0,
    atsPct: 0,
    atsRecord: "0-0",
    overs: 0,
    unders: 0,
    ouPush: 0,
    overPct: 0,
    ouRecord: "0-0",
    avgPointsFor: 0,
    avgPointsAgainst: 0,
    avgTotalPoints: 0,
    avgMargin: 0,
    avgSpread: null,
    avgOverUnder: null,
    bySeasonBreakdown: [],
  };
}

// ─── Query Orchestrator ─────────────────────────────────────────────────────────

/**
 * Execute a composable trend query against game data.
 *
 * Pipeline:
 * 1. Load games (or use provided games)
 * 2. Filter by sport
 * 3. Filter by season range
 * 4. Filter by team (if query.team is set)
 * 5. Apply user-defined filters
 * 6. Apply perspective (filters games relevant to the perspective)
 * 7. Sort results
 * 8. Apply limit
 * 9. Compute summary statistics
 *
 * @param query - The trend query to execute
 * @param games - Optional pre-loaded games (skips loading from disk if provided)
 * @returns TrendResult with matching games and summary statistics
 *
 * @example
 * // Home favorites of 7+ points in November in the NFL since 2018
 * const result = executeTrendQuery({
 *   sport: "NFL",
 *   perspective: "favorite",
 *   seasonRange: [2018, 2025],
 *   filters: [
 *     { field: "spread", operator: "lte", value: -7 },
 *     { field: "month", operator: "eq", value: 11 },
 *   ],
 * });
 *
 * @example
 * // Duke as away underdog in conference games
 * const result = executeTrendQuery({
 *   sport: "NCAAMB",
 *   team: "Duke",
 *   perspective: "team",
 *   filters: [
 *     { field: "isConferenceGame", operator: "eq", value: true },
 *   ],
 * });
 */
export function executeTrendQuery(
  query: TrendQuery,
  games?: TrendGame[]
): TrendResult {
  // Step 1: Load games if not provided
  let pool: TrendGame[];
  if (games) {
    pool = games;
  } else if (query.sport === "ALL") {
    pool = loadAllGames();
  } else {
    pool = loadGamesBySport(query.sport);
  }

  // Step 2: Filter by sport (when external games were provided and sport != ALL)
  if (games && query.sport !== "ALL") {
    pool = pool.filter((g) => g.sport === query.sport);
  }

  // Step 3: Filter by season range
  if (query.seasonRange) {
    const [startSeason, endSeason] = query.seasonRange;
    pool = pool.filter(
      (g) => g.season >= startSeason && g.season <= endSeason
    );
  }

  // Step 4: Filter by team (if set)
  if (query.team) {
    pool = pool.filter((g) => teamMatches(g, query.team!) !== null);
  }

  // Step 5: Apply user-defined filters
  pool = applyAllFilters(pool, query.filters);

  // Step 6: Apply perspective filter
  pool = applyPerspective(pool, query);

  // Step 7: Sort results
  if (query.orderBy) {
    const { field, direction } = query.orderBy;
    pool.sort((a, b) => {
      const aVal = resolveField(a, field);
      const bVal = resolveField(b, field);

      // Nulls sort to end
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = aVal.localeCompare(bVal);
        return direction === "asc" ? cmp : -cmp;
      }
      const cmp = (aVal as number) - (bVal as number);
      return direction === "asc" ? cmp : -cmp;
    });
  } else {
    // Default: most recent games first
    pool.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  }

  // Step 8: Apply limit
  if (query.limit && query.limit > 0) {
    pool = pool.slice(0, query.limit);
  }

  // Step 9: Compute summary
  const perspective = query.perspective ?? "home";
  const summary = computeSummary(pool, perspective, query.team);

  return {
    query,
    games: pool,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ─── Convenience Filter Builders ────────────────────────────────────────────────

/**
 * Create a filter for a specific month (1-12, January = 1).
 */
export function monthFilter(month: number): TrendFilter {
  return { field: "month", operator: "eq", value: month };
}

/**
 * Create a spread filter.
 *
 * @example
 * spreadFilter("lte", -7)       // Home favored by 7+
 * spreadFilter("between", [3, 10])  // Spread between 3 and 10
 */
export function spreadFilter(
  operator: FilterOperator,
  value: number | [number, number]
): TrendFilter {
  return { field: "spread", operator, value };
}

/**
 * Create a season range filter using the "between" operator.
 */
export function seasonRangeFilter(
  startSeason: number,
  endSeason: number
): TrendFilter {
  return {
    field: "season",
    operator: "between",
    value: [startSeason, endSeason],
  };
}

/**
 * Create a day-of-week filter.
 * @param days - e.g., "Sun" or ["Sun", "Mon"]
 */
export function dayOfWeekFilter(days: string | string[]): TrendFilter {
  if (Array.isArray(days)) {
    return { field: "dayOfWeek", operator: "in", value: days };
  }
  return { field: "dayOfWeek", operator: "eq", value: days };
}

/**
 * Create a conference filter matching the home team's conference.
 * For broader conference queries, combine with team perspective.
 */
export function conferenceFilter(conference: string): TrendFilter {
  return { field: "homeConference", operator: "eq", value: conference };
}

/**
 * Build a complete TrendQuery with defaults applied.
 *
 * @example
 * const query = buildQuery("NFL", {
 *   perspective: "favorite",
 *   seasonRange: [2018, 2025],
 *   filters: [spreadFilter("lte", -7), monthFilter(11)],
 * });
 */
export function buildQuery(
  sport: SportOrAll,
  options: Partial<Omit<TrendQuery, "sport">> = {}
): TrendQuery {
  return {
    sport,
    filters: [],
    ...options,
  };
}

// ─── Game Caching ───────────────────────────────────────────────────────────────

/**
 * In-memory cache to avoid re-reading JSON files on every query.
 * Call clearGameCache() to force a reload after data updates.
 */
let gameCache: Map<Sport, TrendGame[]> | null = null;

/**
 * Load all games with in-memory caching.
 * First call reads from disk; subsequent calls return cached data.
 */
export function loadAllGamesCached(): TrendGame[] {
  if (!gameCache) {
    gameCache = new Map();
    for (const sport of ["NFL", "NCAAF", "NCAAMB"] as Sport[]) {
      gameCache.set(sport, loadGamesBySport(sport));
    }
  }
  return [
    ...gameCache.get("NFL")!,
    ...gameCache.get("NCAAF")!,
    ...gameCache.get("NCAAMB")!,
  ];
}

/**
 * Load games for a single sport with caching.
 */
export function loadGamesBySportCached(sport: Sport): TrendGame[] {
  if (!gameCache) {
    loadAllGamesCached();
  }
  return gameCache!.get(sport) ?? [];
}

/**
 * Clear the in-memory game cache. Call after data file updates.
 */
export function clearGameCache(): void {
  gameCache = null;
}

/**
 * Execute a trend query using cached game data.
 * Preferred for API routes where multiple queries may run per request.
 */
export function executeTrendQueryCached(query: TrendQuery): TrendResult {
  const games =
    query.sport === "ALL"
      ? loadAllGamesCached()
      : loadGamesBySportCached(query.sport);
  return executeTrendQuery(query, games);
}
