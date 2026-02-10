/**
 * NLP Query Parser for TrendLine
 *
 * Converts natural language betting trend queries into structured TrendQuery
 * objects. Uses a two-tier approach:
 *
 * 1. Local parser (parseQueryLocal) — regex/keyword-based, handles common
 *    patterns without an API call. Returns null if it can't parse.
 * 2. OpenAI parser (parseNaturalLanguageQuery) — uses gpt-4o-mini with a
 *    detailed system prompt to interpret complex or ambiguous queries.
 *
 * The module never throws — all errors are caught and a fallback result is
 * returned so the UI always has something to display.
 */

import type {
  TrendQuery,
  SportOrAll,
  Perspective,
  TrendFilter,
  FilterOperator,
} from "./trend-engine";
import type { PlayerTrendQuery } from "./player-trend-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  trendQuery: TrendQuery;
  /** Set when the query targets player-level data */
  playerTrendQuery?: PlayerTrendQuery;
  /** Which engine should handle this query */
  queryType: "game" | "player";
  /** Human-readable interpretation of what the engine will search */
  interpretation: string;
  /** 0-1 confidence score */
  confidence: number;
  /** Alternative queries the user might want */
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_YEAR = 2026;
const CURRENT_NFL_SEASON = 2025; // NFL / NCAAF season year
const CURRENT_NCAAMB_SEASON = 2026; // academic-year sport

const MODEL = "gpt-4o-mini";
const TEMPERATURE = 0.1;
const MAX_TOKENS = 1000;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a sports betting trend query parser. Your job is to convert natural language queries about betting trends into structured JSON objects.

## Output Schema

Return a JSON object with exactly these keys:
{
  "trendQuery": {
    "sport": "NFL" | "NCAAF" | "NCAAMB" | "ALL",
    "team": string | undefined,
    "perspective": "home" | "away" | "favorite" | "underdog" | "team" | "opponent" | undefined,
    "filters": [{ "field": string, "operator": "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"notIn"|"contains"|"between", "value": any }],
    "seasonRange": [startYear, endYear] | undefined,
    "limit": number | undefined,
    "orderBy": { "field": string, "direction": "asc"|"desc" } | undefined
  },
  "interpretation": "Human-readable sentence describing the search",
  "confidence": 0.0 to 1.0,
  "suggestions": ["alternative query 1", ...] | undefined
}

## Available filter fields and their types

### Core game info
- sport: "NFL" | "NCAAF" | "NCAAMB"
- season: number (year)
- gameDate: string (ISO date)
- homeTeam / awayTeam: string
- homeScore / awayScore: number
- scoreDifference: number
- totalPoints: number
- winner: string

### Rankings
- homeRank / awayRank: number (AP/coaches poll rank, null if unranked)
- homeKenpomRank / awayKenpomRank: number (KenPom ranking for NCAAMB)

### Betting lines
- spread: number — IMPORTANT: negative means home team is favored. e.g. spread = -7 means home favored by 7.
- overUnder: number (total points line)
- spreadResult: "COVERED" | "PUSH" | "LOST" (did the favorite cover?)
- ouResult: "OVER" | "PUSH" | "UNDER"

### Game context (booleans)
- isConferenceGame, isPlayoff, isNeutralSite

### Scheduling
- week: number (1-18 for NFL, 0-15 for college)
- dayOfWeek: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
- isPrimetime: boolean
- primetimeSlot: "SNF" | "MNF" | "TNF" | null

### Weather
- weatherCategory: "CLEAR" | "CLOUDY" | "RAIN" | "SNOW" | "WIND" | "DOME"
- temperature: number (Fahrenheit)
- windMph: number

### Bowl games (NCAAF)
- isBowlGame: boolean
- bowlName: string

### March Madness / tournaments (NCAAMB)
- isNCAAT: boolean (NCAA Tournament)
- isNIT: boolean
- isConfTourney: boolean
- overtimes: number
- homeSeed / awaySeed: number (tournament seed 1-16)

### Advanced metrics (KenPom — NCAAMB)
- homeAdjEM / awayAdjEM: number (adjusted efficiency margin)
- homeAdjOE / awayAdjOE: number (adjusted offensive efficiency)
- homeAdjDE / awayAdjDE: number (adjusted defensive efficiency)
- homeAdjTempo / awayAdjTempo: number

### Prediction model fields
- fmHomePred / fmAwayPred: number (predicted scores)
- fmHomeWinProb: number (0-1 win probability)
- fmThrillScore: number

### Rest / scheduling
- homeRestDays / awayRestDays: number
- restAdvantage: number (home rest minus away rest)
- homeIsByeWeek / awayIsByeWeek: boolean (coming off bye)
- isShortWeek: boolean
- homeIsBackToBack / awayIsBackToBack: boolean

### Game style analytics
- expectedPace: number
- paceMismatch: number
- efficiencyGap: number
- kenpomPredMargin: number
- isKenpomUpset: boolean
- gameStyle: string

### Computed fields
- month: number (1-12)
- year: number
- monthName: string ("January", "February", etc.)

### Conference
- homeConference / awayConference: string

## Perspective guide

- "home" — analyze from the home team's point of view
- "away" — analyze from the away team's point of view
- "favorite" — analyze from the point spread favorite's point of view
- "underdog" — analyze from the underdog's point of view
- "team" — when a specific team is mentioned, analyze from their perspective
- "opponent" — analyze from the opponent of a specific team

Use "team" perspective when a specific team name is given. Use "favorite" / "underdog" when the query is about point spread favorites/underdogs in general (no specific team). Use "home" / "away" when the query is specifically about home or away teams.

## Spread conventions

The spread field is from the home team's perspective:
- spread = -7 means the home team is favored by 7
- spread = 3 means the away team is favored by 3 (home is a 3-point underdog)

When the user says "favorites of 7+", they mean the spread magnitude is >= 7. Since favorites can be home or away:
- For home favorites of 7+: spread <= -7
- For away favorites of 7+: spread >= 7
- For any favorite of 7+: use perspective "favorite" and filter spread <= -7 (the engine handles perspective rotation)

## Season references

- Current year is ${CURRENT_YEAR}.
- NFL and NCAAF "this season" = ${CURRENT_NFL_SEASON} season.
- NCAAMB "this season" = ${CURRENT_NCAAMB_SEASON} season (academic year sport).
- "Last 5 years" from NFL/NCAAF -> seasonRange: [${CURRENT_NFL_SEASON - 4}, ${CURRENT_NFL_SEASON}]
- "Last 5 years" from NCAAMB -> seasonRange: [${CURRENT_NCAAMB_SEASON - 4}, ${CURRENT_NCAAMB_SEASON}]
- "Since 2020" -> seasonRange: [2020, ${CURRENT_NFL_SEASON}] (or ${CURRENT_NCAAMB_SEASON} for NCAAMB)

## Sport detection

- "NFL", "pro football" -> NFL
- "college football", "CFB", "NCAAF", "FBS" -> NCAAF
- "college basketball", "CBB", "NCAAMB", "March Madness" -> NCAAMB
- If sport is unclear and no team is mentioned, use "ALL"
- If a known NFL team is mentioned (e.g. "Chiefs", "Patriots"), infer NFL
- If a known college team is mentioned in a basketball context, infer NCAAMB
- If a known college team is mentioned with football context, infer NCAAF

## Examples

Query: "Home favorites of 7+ points in November in the NFL since 2018"
Result: sport: "NFL", perspective: "favorite", seasonRange: [2018, 2025],
  filters: [{ field: "spread", operator: "lte", value: -7 }, { field: "month", operator: "eq", value: 11 }]

Query: "Duke as an away underdog in conference games"
Result: sport: "NCAAMB", team: "Duke", perspective: "team",
  filters: [{ field: "isConferenceGame", operator: "eq", value: true }]

Query: "Big Ten teams after a bye week"
Result: sport: "NCAAF", perspective: "home",
  filters: [{ field: "homeConference", operator: "eq", value: "Big Ten" }, { field: "homeIsByeWeek", operator: "eq", value: true }]

Query: "NFL Thursday night games since 2020"
Result: sport: "NFL", seasonRange: [2020, 2025],
  filters: [{ field: "dayOfWeek", operator: "eq", value: "Thu" }]

Query: "Snow games in college football"
Result: sport: "NCAAF",
  filters: [{ field: "weatherCategory", operator: "eq", value: "SNOW" }]

Query: "March Madness upsets where a 12 seed or higher beats a 5 seed or lower"
Result: sport: "NCAAMB",
  filters: [{ field: "isNCAAT", operator: "eq", value: true }, { field: "isKenpomUpset", operator: "eq", value: true }]

Query: "Kansas City Chiefs playoff games"
Result: sport: "NFL", team: "Kansas City Chiefs", perspective: "team",
  filters: [{ field: "isPlayoff", operator: "eq", value: true }]

Query: "Cold weather games under 30 degrees with wind over 15 mph"
Result: sport: "ALL",
  filters: [{ field: "temperature", operator: "lt", value: 30 }, { field: "windMph", operator: "gt", value: 15 }]

## Rules

1. Always return valid JSON matching the schema above.
2. When ambiguous, choose the most likely interpretation and note alternatives in "suggestions".
3. Do NOT invent fields that are not listed above.
4. For team names, pass through exactly what the user said — the engine does partial matching.
5. If you cannot parse the query at all, return sport: "ALL" with empty filters and low confidence.
6. Confidence should reflect how certain you are about the interpretation:
   - 0.9-1.0: Unambiguous, clear query
   - 0.7-0.9: Mostly clear, minor assumptions made
   - 0.5-0.7: Significant ambiguity resolved
   - Below 0.5: Very uncertain, user should clarify`;

// ---------------------------------------------------------------------------
// OpenAI-powered parser
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Player query detection (local)
// ---------------------------------------------------------------------------

/**
 * Detect if a query is a player-level query by checking for player names,
 * position keywords, and player-stat keywords.
 */
function detectPlayerQuery(query: string): ParsedQuery | null {
  const q = query.toLowerCase().trim();

  // Check for known player names
  let playerName: string | undefined;
  let playerPosition: string | undefined;

  // Sort by alias length descending so multi-word names match first
  const playerAliases = Object.keys(NFL_PLAYER_NAMES).sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of playerAliases) {
    const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
    if (regex.test(q)) {
      playerName = NFL_PLAYER_NAMES[alias].name;
      playerPosition = NFL_PLAYER_NAMES[alias].position;
      break;
    }
  }

  // Check for position keywords
  let positionGroup: string | undefined;
  const posAliases = Object.keys(POSITION_KEYWORDS).sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of posAliases) {
    const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
    if (regex.test(q)) {
      positionGroup = POSITION_KEYWORDS[alias];
      break;
    }
  }

  // Check for player-stat keywords
  const hasPlayerStatKeyword = PLAYER_STAT_KEYWORDS.some((kw) =>
    q.includes(kw),
  );

  // Must have at least a player name, position keyword, or stat keyword
  if (!playerName && !positionGroup && !hasPlayerStatKeyword) {
    return null;
  }

  // Build filters from common patterns
  const filters: TrendFilter[] = [];

  // Temperature / cold weather
  if (/\bcold\b/.test(q) || /\bfreezing\b/.test(q)) {
    filters.push({ field: "temperature", operator: "lt", value: 40 });
  }

  // Primetime
  if (/\bprime\s*time\b/.test(q)) {
    filters.push({ field: "isPrimetime", operator: "eq", value: true });
  }

  // Playoffs
  if (/\bplayoffs?\b/.test(q) || /\bpostseason\b/.test(q)) {
    filters.push({ field: "isPlayoff", operator: "eq", value: true });
  }

  // Home / away
  if (/\bhome\b/.test(q)) {
    filters.push({ field: "isHome", operator: "eq", value: true });
  } else if (/\baway\b/.test(q) || /\broad\b/.test(q)) {
    filters.push({ field: "isHome", operator: "eq", value: false });
  }

  // Stat thresholds (e.g., "100+ rushing yards", "300 passing yards")
  const statThreshold = q.match(
    /(\d+)\+?\s*(passing|rushing|receiving|rush|pass|rec)\s*(yards?|yds?|tds?|touchdowns?)/i,
  );
  if (statThreshold) {
    const threshold = parseInt(statThreshold[1], 10);
    const statType = statThreshold[2].toLowerCase();
    const statMetric = statThreshold[3].toLowerCase();

    let field: string | null = null;
    if (statType.startsWith("pass")) {
      field = statMetric.startsWith("td") || statMetric.startsWith("touch")
        ? "passing_tds" : "passing_yards";
    } else if (statType.startsWith("rush")) {
      field = statMetric.startsWith("td") || statMetric.startsWith("touch")
        ? "rushing_tds" : "rushing_yards";
    } else if (statType.startsWith("rec")) {
      field = statMetric.startsWith("td") || statMetric.startsWith("touch")
        ? "receiving_tds" : "receiving_yards";
    }

    if (field) {
      filters.push({ field, operator: "gte", value: threshold });
    }
  }

  // Season range detection
  let seasonRange: [number, number] | undefined;
  const sinceMatch = q.match(/\bsince\s+(\d{4})\b/);
  if (sinceMatch) {
    seasonRange = [parseInt(sinceMatch[1], 10), CURRENT_NFL_SEASON];
  }
  const lastYearsMatch = q.match(/\blast\s+(\d+)\s+years?\b/);
  if (lastYearsMatch && !seasonRange) {
    const n = parseInt(lastYearsMatch[1], 10);
    seasonRange = [CURRENT_NFL_SEASON - (n - 1), CURRENT_NFL_SEASON];
  }

  // Team filter (opponent context: "against the Chiefs", "vs Bills")
  let team: string | undefined;
  let opponent: string | undefined;
  const vsMatch = q.match(/\b(?:against|vs\.?|versus)\s+(?:the\s+)?(\w+)/i);
  if (vsMatch) {
    const oppAlias = vsMatch[1].toLowerCase();
    const nflAliases = Object.keys(NFL_TEAMS).sort((a, b) => b.length - a.length);
    for (const alias of nflAliases) {
      if (oppAlias === alias || alias.includes(oppAlias)) {
        opponent = NFL_TEAMS[alias];
        break;
      }
    }
  }

  // If a player name was found alongside a team (not as opponent), treat as team filter
  if (!playerName && !opponent) {
    const nflAliases = Object.keys(NFL_TEAMS).sort((a, b) => b.length - a.length);
    for (const alias of nflAliases) {
      const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      if (regex.test(q)) {
        team = NFL_TEAMS[alias];
        break;
      }
    }
  }

  const playerTrendQuery: PlayerTrendQuery = {
    player: playerName,
    position: playerPosition,
    positionGroup: positionGroup || undefined,
    team,
    opponent,
    filters,
    seasonRange,
  };

  // Build interpretation
  const parts: string[] = [];
  if (playerName) parts.push(playerName);
  if (positionGroup && !playerName) parts.push(`${positionGroup}s`);
  if (team) parts.push(`on ${team}`);
  if (opponent) parts.push(`vs ${opponent}`);
  if (seasonRange) parts.push(`${seasonRange[0]}-${seasonRange[1]}`);
  for (const f of filters) {
    parts.push(`${f.field} ${f.operator} ${JSON.stringify(f.value)}`);
  }

  return {
    trendQuery: { sport: "NFL", filters: [] },
    playerTrendQuery,
    queryType: "player",
    interpretation: `Player search: ${parts.join(", ")}`,
    confidence: playerName ? 0.85 : 0.7,
  };
}

/**
 * Parse a natural language betting trend query into a structured TrendQuery.
 *
 * First attempts a local regex/keyword parse. If that fails (returns null),
 * falls through to the OpenAI API. If OpenAI also fails, returns a safe
 * fallback with sport = "ALL" and empty filters.
 *
 * This function NEVER throws.
 */
export async function parseNaturalLanguageQuery(
  query: string,
): Promise<ParsedQuery> {
  try {
    // Check for player query first
    const playerResult = detectPlayerQuery(query);
    if (playerResult) {
      return playerResult;
    }

    // Attempt local parse for game-level queries
    const localResult = parseQueryLocal(query);
    if (localResult) {
      return {
        trendQuery: localResult,
        queryType: "game" as const,
        interpretation: buildLocalInterpretation(localResult, query),
        confidence: 0.75,
        suggestions: undefined,
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("[nlp-query-parser] No OPENAI_API_KEY — falling back");
      return fallbackResult(query);
    }

    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: MODEL,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Parse this betting trend query into a structured TrendQuery:\n\n"${query}"`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return fallbackResult(query);
    }

    const parsed = JSON.parse(content);
    return validateAndNormalize(parsed, query);
  } catch (error) {
    console.error("[nlp-query-parser] OpenAI parse failed:", error);
    return fallbackResult(query);
  }
}

// ---------------------------------------------------------------------------
// Validation & normalization
// ---------------------------------------------------------------------------

const VALID_SPORTS: Set<string> = new Set(["NFL", "NCAAF", "NCAAMB", "ALL"]);
const VALID_PERSPECTIVES: Set<string> = new Set([
  "home",
  "away",
  "favorite",
  "underdog",
  "team",
  "opponent",
]);
const VALID_OPERATORS: Set<string> = new Set([
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

/**
 * Validate and normalize the raw JSON returned by OpenAI into a well-typed
 * ParsedQuery. Gracefully handles missing/malformed fields by falling back to
 * safe defaults.
 */
function validateAndNormalize(
  raw: unknown,
  originalQuery: string,
): ParsedQuery {
  const obj = raw as Record<string, unknown> | null;
  const tq = (obj?.trendQuery ?? obj) as Record<string, unknown> | null;

  const sport: SportOrAll = VALID_SPORTS.has(tq?.sport as string)
    ? (tq!.sport as SportOrAll)
    : "ALL";

  const perspective: Perspective | undefined =
    tq?.perspective && VALID_PERSPECTIVES.has(tq.perspective as string)
      ? (tq.perspective as Perspective)
      : undefined;

  const filters: TrendFilter[] = Array.isArray(tq?.filters)
    ? (tq!.filters as Record<string, unknown>[])
        .filter(
          (f) =>
            typeof f?.field === "string" &&
            VALID_OPERATORS.has(f?.operator as string) &&
            f?.value !== undefined,
        )
        .map((f) => ({
          field: f.field as string,
          operator: f.operator as FilterOperator,
          value: f.value,
        }))
    : [];

  const rawSeasonRange = tq?.seasonRange;
  const seasonRange: [number, number] | undefined =
    Array.isArray(rawSeasonRange) &&
    rawSeasonRange.length === 2 &&
    typeof rawSeasonRange[0] === "number" &&
    typeof rawSeasonRange[1] === "number"
      ? [rawSeasonRange[0], rawSeasonRange[1]]
      : undefined;

  const team: string | undefined =
    typeof tq?.team === "string" && (tq.team as string).trim() !== ""
      ? (tq.team as string).trim()
      : undefined;

  const limit: number | undefined =
    typeof tq?.limit === "number" && (tq.limit as number) > 0
      ? (tq.limit as number)
      : undefined;

  const rawOrderBy = tq?.orderBy as Record<string, unknown> | undefined;
  const orderBy =
    rawOrderBy &&
    typeof rawOrderBy.field === "string" &&
    (rawOrderBy.direction === "asc" || rawOrderBy.direction === "desc")
      ? {
          field: rawOrderBy.field as string,
          direction: rawOrderBy.direction as "asc" | "desc",
        }
      : undefined;

  const interpretation: string =
    typeof obj?.interpretation === "string" &&
    (obj.interpretation as string).length > 0
      ? (obj.interpretation as string)
      : `Search for: ${originalQuery}`;

  const rawConfidence = obj?.confidence;
  const confidence: number =
    typeof rawConfidence === "number" &&
    rawConfidence >= 0 &&
    rawConfidence <= 1
      ? rawConfidence
      : 0.5;

  const rawSuggestions = obj?.suggestions;
  const suggestions: string[] | undefined =
    Array.isArray(rawSuggestions) && rawSuggestions.length > 0
      ? (rawSuggestions as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : undefined;

  // Detect if OpenAI returned a player query
  const rawQueryType = obj?.queryType;
  const isPlayerQuery = rawQueryType === "player" ||
    (obj?.playerTrendQuery != null);
  const queryType: "game" | "player" = isPlayerQuery ? "player" : "game";

  const result: ParsedQuery = {
    trendQuery: {
      sport,
      team,
      perspective,
      filters,
      seasonRange,
      limit,
      orderBy,
    },
    queryType,
    interpretation,
    confidence,
    suggestions,
  };

  // If OpenAI detected a player query, extract the player fields
  if (isPlayerQuery) {
    const ptq = (obj?.playerTrendQuery ?? obj) as Record<string, unknown>;
    result.playerTrendQuery = {
      player: typeof ptq?.player === "string" ? ptq.player : undefined,
      playerId: typeof ptq?.playerId === "string" ? ptq.playerId : undefined,
      position: typeof ptq?.position === "string" ? ptq.position : undefined,
      positionGroup: typeof ptq?.positionGroup === "string" ? ptq.positionGroup : undefined,
      team: typeof ptq?.team === "string" ? ptq.team : undefined,
      opponent: typeof ptq?.opponent === "string" ? ptq.opponent : undefined,
      filters,
      seasonRange,
      limit,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fallback result
// ---------------------------------------------------------------------------

function fallbackResult(query: string): ParsedQuery {
  return {
    trendQuery: {
      sport: "ALL",
      filters: [],
    },
    queryType: "game",
    interpretation: `Could not fully parse query. Showing all results for: "${query}"`,
    confidence: 0.1,
    suggestions: [
      "Try being more specific, e.g. 'NFL home favorites since 2020'",
      "Specify a sport: NFL, college football, or college basketball",
      "Try a player query, e.g. 'Mahomes in cold weather'",
    ],
  };
}

// ---------------------------------------------------------------------------
// Local interpretation builder (for local-parsed queries)
// ---------------------------------------------------------------------------

function buildLocalInterpretation(
  tq: TrendQuery,
  originalQuery: string,
): string {
  const parts: string[] = [];

  if (tq.sport !== "ALL") {
    parts.push(tq.sport);
  }

  if (tq.team) {
    parts.push(tq.team);
  }

  if (tq.perspective) {
    parts.push(`(${tq.perspective} perspective)`);
  }

  if (tq.seasonRange) {
    if (tq.seasonRange[0] === tq.seasonRange[1]) {
      parts.push(`in the ${tq.seasonRange[0]} season`);
    } else {
      parts.push(`from ${tq.seasonRange[0]} to ${tq.seasonRange[1]}`);
    }
  }

  for (const f of tq.filters) {
    parts.push(`${f.field} ${f.operator} ${JSON.stringify(f.value)}`);
  }

  return parts.length > 0
    ? `Searching: ${parts.join(", ")}`
    : `Search for: ${originalQuery}`;
}

// ---------------------------------------------------------------------------
// Local (regex/keyword) parser — saves OpenAI calls for simple queries
// ---------------------------------------------------------------------------

/**
 * Common NFL team aliases mapped to canonical full names.
 * Sorted by length descending at lookup time so multi-word names match first.
 */
const NFL_TEAMS: Record<string, string> = {
  chiefs: "Kansas City Chiefs",
  "kansas city chiefs": "Kansas City Chiefs",
  "kansas city": "Kansas City Chiefs",
  eagles: "Philadelphia Eagles",
  philadelphia: "Philadelphia Eagles",
  philly: "Philadelphia Eagles",
  bills: "Buffalo Bills",
  buffalo: "Buffalo Bills",
  dolphins: "Miami Dolphins",
  patriots: "New England Patriots",
  "new england": "New England Patriots",
  pats: "New England Patriots",
  jets: "New York Jets",
  ravens: "Baltimore Ravens",
  baltimore: "Baltimore Ravens",
  bengals: "Cincinnati Bengals",
  browns: "Cleveland Browns",
  cleveland: "Cleveland Browns",
  steelers: "Pittsburgh Steelers",
  texans: "Houston Texans",
  colts: "Indianapolis Colts",
  indianapolis: "Indianapolis Colts",
  jaguars: "Jacksonville Jaguars",
  jags: "Jacksonville Jaguars",
  jacksonville: "Jacksonville Jaguars",
  titans: "Tennessee Titans",
  broncos: "Denver Broncos",
  denver: "Denver Broncos",
  chargers: "Los Angeles Chargers",
  raiders: "Las Vegas Raiders",
  "las vegas raiders": "Las Vegas Raiders",
  "las vegas": "Las Vegas Raiders",
  packers: "Green Bay Packers",
  "green bay": "Green Bay Packers",
  bears: "Chicago Bears",
  chicago: "Chicago Bears",
  lions: "Detroit Lions",
  detroit: "Detroit Lions",
  vikings: "Minnesota Vikings",
  cowboys: "Dallas Cowboys",
  dallas: "Dallas Cowboys",
  giants: "New York Giants",
  commanders: "Washington Commanders",
  washington: "Washington Commanders",
  "49ers": "San Francisco 49ers",
  niners: "San Francisco 49ers",
  "san francisco": "San Francisco 49ers",
  seahawks: "Seattle Seahawks",
  seattle: "Seattle Seahawks",
  rams: "Los Angeles Rams",
  cardinals: "Arizona Cardinals",
  falcons: "Atlanta Falcons",
  atlanta: "Atlanta Falcons",
  panthers: "Carolina Panthers",
  carolina: "Carolina Panthers",
  saints: "New Orleans Saints",
  "new orleans": "New Orleans Saints",
  buccaneers: "Tampa Bay Buccaneers",
  bucs: "Tampa Bay Buccaneers",
  "tampa bay": "Tampa Bay Buccaneers",
  tampa: "Tampa Bay Buccaneers",
};

/**
 * Common college team names. Used only for detection — the engine itself
 * handles fuzzy matching, so we pass through the matched name as-is
 * (capitalized).
 */
const COLLEGE_TEAMS: Set<string> = new Set([
  "duke",
  "north carolina",
  "unc",
  "tar heels",
  "kentucky",
  "kansas",
  "gonzaga",
  "villanova",
  "virginia",
  "michigan",
  "michigan state",
  "ohio state",
  "alabama",
  "georgia",
  "clemson",
  "lsu",
  "oklahoma",
  "texas",
  "oregon",
  "florida",
  "florida state",
  "penn state",
  "notre dame",
  "auburn",
  "wisconsin",
  "iowa",
  "purdue",
  "indiana",
  "illinois",
  "uconn",
  "connecticut",
  "baylor",
  "creighton",
  "marquette",
  "xavier",
  "arkansas",
  "arizona state",
  "ucla",
  "usc",
  "colorado",
  "utah",
  "stanford",
  "cal",
  "iowa state",
  "texas tech",
  "tcu",
  "oklahoma state",
  "west virginia",
  "memphis",
  "smu",
  "pitt",
  "louisville",
  "syracuse",
  "wake forest",
  "nc state",
  "virginia tech",
  "georgia tech",
  "mississippi state",
  "ole miss",
  "vanderbilt",
  "south carolina",
  "missouri",
  "nebraska",
  "northwestern",
  "maryland",
  "rutgers",
]);

/**
 * Well-known NFL player names for local detection.
 * When a player name is detected, the query is routed to the player engine.
 */
const NFL_PLAYER_NAMES: Record<string, { name: string; position: string }> = {
  // QBs
  mahomes: { name: "Patrick Mahomes", position: "QB" },
  "patrick mahomes": { name: "Patrick Mahomes", position: "QB" },
  "josh allen": { name: "Josh Allen", position: "QB" },
  allen: { name: "Josh Allen", position: "QB" },
  "lamar jackson": { name: "Lamar Jackson", position: "QB" },
  lamar: { name: "Lamar Jackson", position: "QB" },
  "jalen hurts": { name: "Jalen Hurts", position: "QB" },
  hurts: { name: "Jalen Hurts", position: "QB" },
  "joe burrow": { name: "Joe Burrow", position: "QB" },
  burrow: { name: "Joe Burrow", position: "QB" },
  "dak prescott": { name: "Dak Prescott", position: "QB" },
  dak: { name: "Dak Prescott", position: "QB" },
  "tua tagovailoa": { name: "Tua Tagovailoa", position: "QB" },
  tua: { name: "Tua Tagovailoa", position: "QB" },
  "justin herbert": { name: "Justin Herbert", position: "QB" },
  herbert: { name: "Justin Herbert", position: "QB" },
  "trevor lawrence": { name: "Trevor Lawrence", position: "QB" },
  "jordan love": { name: "Jordan Love", position: "QB" },
  "brock purdy": { name: "Brock Purdy", position: "QB" },
  purdy: { name: "Brock Purdy", position: "QB" },
  "c.j. stroud": { name: "C.J. Stroud", position: "QB" },
  stroud: { name: "C.J. Stroud", position: "QB" },
  "jared goff": { name: "Jared Goff", position: "QB" },
  goff: { name: "Jared Goff", position: "QB" },
  "kirk cousins": { name: "Kirk Cousins", position: "QB" },
  "baker mayfield": { name: "Baker Mayfield", position: "QB" },
  "matthew stafford": { name: "Matthew Stafford", position: "QB" },
  stafford: { name: "Matthew Stafford", position: "QB" },
  "aaron rodgers": { name: "Aaron Rodgers", position: "QB" },
  rodgers: { name: "Aaron Rodgers", position: "QB" },
  "russell wilson": { name: "Russell Wilson", position: "QB" },
  "caleb williams": { name: "Caleb Williams", position: "QB" },
  "jayden daniels": { name: "Jayden Daniels", position: "QB" },
  "drake maye": { name: "Drake Maye", position: "QB" },
  // RBs
  "derrick henry": { name: "Derrick Henry", position: "RB" },
  "saquon barkley": { name: "Saquon Barkley", position: "RB" },
  saquon: { name: "Saquon Barkley", position: "RB" },
  "josh jacobs": { name: "Josh Jacobs", position: "RB" },
  "bijan robinson": { name: "Bijan Robinson", position: "RB" },
  bijan: { name: "Bijan Robinson", position: "RB" },
  "breece hall": { name: "Breece Hall", position: "RB" },
  "jahmyr gibbs": { name: "Jahmyr Gibbs", position: "RB" },
  "jonathan taylor": { name: "Jonathan Taylor", position: "RB" },
  "de'von achane": { name: "De'Von Achane", position: "RB" },
  achane: { name: "De'Von Achane", position: "RB" },
  "nick chubb": { name: "Nick Chubb", position: "RB" },
  "alvin kamara": { name: "Alvin Kamara", position: "RB" },
  kamara: { name: "Alvin Kamara", position: "RB" },
  // WRs
  "tyreek hill": { name: "Tyreek Hill", position: "WR" },
  tyreek: { name: "Tyreek Hill", position: "WR" },
  "ja'marr chase": { name: "Ja'Marr Chase", position: "WR" },
  "jamarr chase": { name: "Ja'Marr Chase", position: "WR" },
  "ceedee lamb": { name: "CeeDee Lamb", position: "WR" },
  "justin jefferson": { name: "Justin Jefferson", position: "WR" },
  jefferson: { name: "Justin Jefferson", position: "WR" },
  "amon-ra st. brown": { name: "Amon-Ra St. Brown", position: "WR" },
  "davante adams": { name: "Davante Adams", position: "WR" },
  "a.j. brown": { name: "A.J. Brown", position: "WR" },
  "stefon diggs": { name: "Stefon Diggs", position: "WR" },
  "puka nacua": { name: "Puka Nacua", position: "WR" },
  "nico collins": { name: "Nico Collins", position: "WR" },
  "deebo samuel": { name: "Deebo Samuel", position: "WR" },
  "dk metcalf": { name: "DK Metcalf", position: "WR" },
  metcalf: { name: "DK Metcalf", position: "WR" },
  "mike evans": { name: "Mike Evans", position: "WR" },
  // TEs
  "travis kelce": { name: "Travis Kelce", position: "TE" },
  kelce: { name: "Travis Kelce", position: "TE" },
  "mark andrews": { name: "Mark Andrews", position: "TE" },
  "george kittle": { name: "George Kittle", position: "TE" },
  kittle: { name: "George Kittle", position: "TE" },
  "sam laporta": { name: "Sam LaPorta", position: "TE" },
  "dallas goedert": { name: "Dallas Goedert", position: "TE" },
  "t.j. hockenson": { name: "T.J. Hockenson", position: "TE" },
  // Kickers
  "justin tucker": { name: "Justin Tucker", position: "K" },
  tucker: { name: "Justin Tucker", position: "K" },
};

// Position keywords that indicate a player query
const POSITION_KEYWORDS: Record<string, string> = {
  qb: "QB", qbs: "QB", quarterback: "QB", quarterbacks: "QB",
  rb: "RB", rbs: "RB", "running back": "RB", "running backs": "RB",
  wr: "WR", wrs: "WR", "wide receiver": "WR", "wide receivers": "WR", receiver: "WR", receivers: "WR",
  te: "TE", tes: "TE", "tight end": "TE", "tight ends": "TE",
  k: "K", kicker: "K", kickers: "K",
};

// Player stat keywords that indicate a player query
const PLAYER_STAT_KEYWORDS = [
  "passing yards", "pass yards", "completions", "passer rating",
  "rushing yards", "rush yards", "carries",
  "receiving yards", "rec yards", "receptions", "catches", "targets",
  "touchdowns", "tds", "interceptions", "ints",
  "fantasy points", "fantasy", "sacks", "tackles",
  "snap count", "snaps", "target share",
];

/**
 * Attempt to parse a natural language query using only regex and keyword
 * matching. Returns a TrendQuery if enough structure is detected, or null
 * if the query is too ambiguous for local parsing (should fall through to
 * OpenAI).
 */
export function parseQueryLocal(query: string): TrendQuery | null {
  const q = query.toLowerCase().trim();

  // --- Detect sport --------------------------------------------------------
  let sport: SportOrAll = "ALL";
  let sportDetected = false;

  if (/\bnfl\b/.test(q) || /\bpro football\b/.test(q)) {
    sport = "NFL";
    sportDetected = true;
  } else if (
    /\bncaaf\b/.test(q) ||
    /\bcollege football\b/.test(q) ||
    /\bcfb\b/.test(q) ||
    /\bfbs\b/.test(q)
  ) {
    sport = "NCAAF";
    sportDetected = true;
  } else if (
    /\bncaamb\b/.test(q) ||
    /\bcollege basketball\b/.test(q) ||
    /\bcbb\b/.test(q) ||
    /\bmarch madness\b/.test(q)
  ) {
    sport = "NCAAMB";
    sportDetected = true;
  }

  // --- Detect team ---------------------------------------------------------
  let team: string | undefined;

  // Check NFL teams (sort by alias length descending so multi-word names
  // like "kansas city chiefs" match before "chiefs")
  const nflAliases = Object.keys(NFL_TEAMS).sort(
    (a, b) => b.length - a.length,
  );
  for (const alias of nflAliases) {
    const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
    if (regex.test(q)) {
      team = NFL_TEAMS[alias];
      if (!sportDetected) {
        sport = "NFL";
        sportDetected = true;
      }
      break;
    }
  }

  // Check college teams if no NFL team found
  if (!team) {
    const sortedCollege = Array.from(COLLEGE_TEAMS).sort(
      (a, b) => b.length - a.length,
    );
    for (const collegeName of sortedCollege) {
      const regex = new RegExp(`\\b${escapeRegex(collegeName)}\\b`, "i");
      if (regex.test(q)) {
        // Capitalize each word
        team = collegeName
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        break;
      }
    }
  }

  // --- Detect perspective ---------------------------------------------------
  let perspective: Perspective | undefined;

  // Check favorite/underdog first (more specific than home/away)
  if (/\bfavou?rites?\b/.test(q) || /\bchalk\b/.test(q)) {
    perspective = "favorite";
  } else if (/\bunderdogs?\b/.test(q) || /\bpuppy\b/.test(q)) {
    perspective = "underdog";
  } else if (/\bhome\b/.test(q)) {
    perspective = "home";
  } else if (/\baway\b/.test(q) || /\broad\b/.test(q)) {
    perspective = "away";
  } else if (team) {
    perspective = "team";
  }

  // --- Detect filters -------------------------------------------------------
  const filters: TrendFilter[] = [];

  // Playoff / postseason
  if (/\bplayoffs?\b/.test(q) || /\bpostseason\b/.test(q)) {
    filters.push({ field: "isPlayoff", operator: "eq", value: true });
  }

  // Super Bowl (NFL playoff)
  if (/\bsuper\s*bowl\b/.test(q)) {
    if (!filters.some((f) => f.field === "isPlayoff")) {
      filters.push({ field: "isPlayoff", operator: "eq", value: true });
    }
    if (!sportDetected) {
      sport = "NFL";
      sportDetected = true;
    }
  }

  // Bowl games (NCAAF — but not "Super Bowl")
  if (/\bbowl\s*games?\b/.test(q) && !/\bsuper\s*bowl\b/.test(q)) {
    filters.push({ field: "isBowlGame", operator: "eq", value: true });
    if (!sportDetected) {
      sport = "NCAAF";
      sportDetected = true;
    }
  }

  // March Madness / NCAA Tournament
  if (
    /\bmarch\s*madness\b/.test(q) ||
    /\bncaa\s*tournament\b/.test(q) ||
    /\bncaat\b/.test(q)
  ) {
    filters.push({ field: "isNCAAT", operator: "eq", value: true });
    if (!sportDetected) {
      sport = "NCAAMB";
      sportDetected = true;
    }
  }

  // Conference tournament
  if (/\bconference\s*tournament\b/.test(q) || /\bconf\s*tourney\b/.test(q)) {
    filters.push({ field: "isConfTourney", operator: "eq", value: true });
  }

  // Conference games
  if (/\bconference\s*games?\b/.test(q) || /\bin[- ]conference\b/.test(q)) {
    filters.push({ field: "isConferenceGame", operator: "eq", value: true });
  }

  // Primetime
  if (/\bprime\s*time\b/.test(q)) {
    filters.push({ field: "isPrimetime", operator: "eq", value: true });
  }

  // Specific primetime slots (check these before generic dayOfWeek)
  if (/\bsunday\s*night\b/.test(q) || /\bsnf\b/.test(q)) {
    filters.push({ field: "primetimeSlot", operator: "eq", value: "SNF" });
  } else if (/\bmonday\s*night\b/.test(q) || /\bmnf\b/.test(q)) {
    filters.push({ field: "primetimeSlot", operator: "eq", value: "MNF" });
  } else if (/\bthursday\s*night\b/.test(q) || /\btnf\b/.test(q)) {
    filters.push({ field: "primetimeSlot", operator: "eq", value: "TNF" });
  }

  // Day of week (only if not already captured as a primetime slot context)
  const dayMatch = q.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (dayMatch && !filters.some((f) => f.field === "primetimeSlot")) {
    const dayMap: Record<string, string> = {
      monday: "Mon",
      tuesday: "Tue",
      wednesday: "Wed",
      thursday: "Thu",
      friday: "Fri",
      saturday: "Sat",
      sunday: "Sun",
    };
    filters.push({
      field: "dayOfWeek",
      operator: "eq",
      value: dayMap[dayMatch[1]],
    });
  }

  // Weather categories
  if (/\bsnow\b/.test(q)) {
    filters.push({ field: "weatherCategory", operator: "eq", value: "SNOW" });
  } else if (/\brain\b/.test(q) && !/\brain\s*delay\b/.test(q)) {
    filters.push({ field: "weatherCategory", operator: "eq", value: "RAIN" });
  } else if (/\bdome\b/.test(q) || /\bindoor\b/.test(q)) {
    filters.push({ field: "weatherCategory", operator: "eq", value: "DOME" });
  }

  // Bye week
  if (
    /\bbye\s*week\b/.test(q) ||
    /\bafter\s+(?:a\s+)?bye\b/.test(q) ||
    /\boff\s+(?:a\s+)?bye\b/.test(q) ||
    /\bcoming\s+off\s+(?:a\s+)?bye\b/.test(q)
  ) {
    if (perspective === "away") {
      filters.push({ field: "awayIsByeWeek", operator: "eq", value: true });
    } else {
      filters.push({ field: "homeIsByeWeek", operator: "eq", value: true });
    }
  }

  // Neutral site
  if (/\bneutral\s*site\b/.test(q) || /\bneutral[- ]field\b/.test(q)) {
    filters.push({ field: "isNeutralSite", operator: "eq", value: true });
  }

  // Ranked teams
  if (/\branked\b/.test(q)) {
    if (perspective === "away") {
      filters.push({ field: "awayRank", operator: "gt", value: 0 });
    } else {
      filters.push({ field: "homeRank", operator: "gt", value: 0 });
    }
  }

  // --- Detect season range ---------------------------------------------------
  let seasonRange: [number, number] | undefined;

  // "since YYYY"
  const sinceMatch = q.match(/\bsince\s+(\d{4})\b/);
  if (sinceMatch) {
    const startYear = parseInt(sinceMatch[1], 10);
    const endYear =
      sport === "NCAAMB" ? CURRENT_NCAAMB_SEASON : CURRENT_NFL_SEASON;
    seasonRange = [startYear, endYear];
  }

  // "last N years"
  const lastYearsMatch = q.match(/\blast\s+(\d+)\s+years?\b/);
  if (lastYearsMatch && !seasonRange) {
    const n = parseInt(lastYearsMatch[1], 10);
    const endYear =
      sport === "NCAAMB" ? CURRENT_NCAAMB_SEASON : CURRENT_NFL_SEASON;
    seasonRange = [endYear - (n - 1), endYear];
  }

  // "this season" / "this year"
  if (
    (/\bthis\s+season\b/.test(q) || /\bthis\s+year\b/.test(q)) &&
    !seasonRange
  ) {
    const yr =
      sport === "NCAAMB" ? CURRENT_NCAAMB_SEASON : CURRENT_NFL_SEASON;
    seasonRange = [yr, yr];
  }

  // "YYYY season" or "in YYYY" — only if no other range was detected
  if (!seasonRange && !sinceMatch) {
    const specificYearMatch = q.match(
      /\b(?:in\s+)?(\d{4})\s*(?:season)?\b/,
    );
    if (specificYearMatch) {
      const yr = parseInt(specificYearMatch[1], 10);
      if (yr >= 1970 && yr <= CURRENT_YEAR) {
        seasonRange = [yr, yr];
      }
    }
  }

  // --- Bail out if we didn't capture enough to be useful --------------------
  // Must have detected at least a sport OR a team OR a filter to be useful.
  if (!sportDetected && !team && filters.length === 0 && !seasonRange) {
    return null;
  }

  // If we only detected a sport keyword and nothing else, the query is
  // probably more nuanced — let OpenAI handle it.
  if (
    sportDetected &&
    !team &&
    !perspective &&
    filters.length === 0 &&
    !seasonRange
  ) {
    return null;
  }

  return {
    sport,
    team,
    perspective,
    filters,
    seasonRange,
    limit: undefined,
    orderBy: undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
