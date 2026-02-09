/**
 * Player Trend Engine for TrendLine
 *
 * Provides composable queries over player-level game data for NFL.
 * Each row is one player's performance in one game, enriched with
 * game context (betting lines, weather, schedule).
 *
 * Architecture mirrors trend-engine.ts:
 * 1. PlayerTrendGame — flat record combining player stats + game context
 * 2. PlayerTrendFilter — reuses FilterOperator from trend-engine
 * 3. PlayerTrendQuery — query spec with player/position/team/filters
 * 4. PlayerTrendResult — results with position-aware stat summaries
 */

import * as fs from "fs";
import * as path from "path";
import {

  type TrendFilter,
  evaluateOperator,
} from "./trend-engine";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PlayerTrendGame {
  // Player identity
  player_id: string;
  player_name: string;
  player_display_name: string;
  position: string;
  position_group: string;
  jerseyNumber: number | null;

  // Player metadata
  birthDate: string | null;
  college: string | null;
  draftYear: number | null;
  draftPick: number | null;
  yearsExp: number | null;

  // Game context
  season: number;
  week: number;
  season_type: string; // "REG" | "POST"
  team: string; // nflverse abbreviation
  teamCanonical: string; // full team name
  opponent_team: string;
  opponentCanonical: string;
  gameDate: string | null;
  dayOfWeek: string | null;
  isHome: boolean | null;

  // Team score context
  teamScore: number | null;
  opponentScore: number | null;
  gameResult: "W" | "L" | "T" | null;

  // Betting context
  spread: number | null; // from player's team perspective
  overUnder: number | null;
  spreadResult: "COVERED" | "LOST" | "PUSH" | null;
  ouResult: "OVER" | "UNDER" | "PUSH" | null;

  // Game flags
  isPlayoff: boolean;
  isPrimetime: boolean | null;
  primetimeSlot: string | null;
  isNeutralSite: boolean | null;

  // Weather
  temperature: number | null;
  windMph: number | null;
  weatherCategory: string | null;

  // Schedule
  restDays: number | null;
  isByeWeek: boolean | null;

  // Passing stats
  completions: number | null;
  attempts: number | null;
  passing_yards: number | null;
  passing_tds: number | null;
  passing_interceptions: number | null;
  sacks_suffered: number | null;
  sack_yards_lost: number | null;
  passing_air_yards: number | null;
  passing_yards_after_catch: number | null;
  passing_first_downs: number | null;
  passing_epa: number | null;
  passing_cpoe: number | null;
  pacr: number | null;

  // Rushing stats
  carries: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  rushing_fumbles: number | null;
  rushing_fumbles_lost: number | null;
  rushing_first_downs: number | null;
  rushing_epa: number | null;

  // Receiving stats
  targets: number | null;
  receptions: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  receiving_fumbles: number | null;
  receiving_fumbles_lost: number | null;
  receiving_air_yards: number | null;
  receiving_yards_after_catch: number | null;
  receiving_first_downs: number | null;
  receiving_epa: number | null;
  racr: number | null;
  target_share: number | null;
  air_yards_share: number | null;
  wopr: number | null;

  // Defense stats
  def_tackles_solo: number | null;
  def_tackles_with_assist: number | null;
  def_tackles_for_loss: number | null;
  def_fumbles_forced: number | null;
  def_sacks: number | null;
  def_qb_hits: number | null;
  def_interceptions: number | null;
  def_interception_yards: number | null;
  def_pass_defended: number | null;
  def_tds: number | null;

  // Kicking
  fg_made: number | null;
  fg_att: number | null;
  fg_long: number | null;
  fg_pct: number | null;
  pat_made: number | null;
  pat_att: number | null;

  // Snap counts
  offensiveSnaps: number | null;
  offensiveSnapPct: number | null;
  defensiveSnaps: number | null;
  defensiveSnapPct: number | null;
  stSnaps: number | null;
  stSnapPct: number | null;

  // Fantasy
  fantasy_points: number | null;
  fantasy_points_ppr: number | null;

  // Catch-all for additional fields from JSON
  [key: string]: unknown;
}

export interface PlayerTrendQuery {
  player?: string;
  playerId?: string;
  position?: string;
  positionGroup?: string;
  team?: string;
  opponent?: string;
  filters: TrendFilter[];
  seasonRange?: [number, number];
  limit?: number;
  orderBy?: { field: string; direction: "asc" | "desc" };
}

export interface PlayerSeasonBreakdown {
  season: number;
  games: number;
  wins: number;
  losses: number;
  atsCovered: number;
  atsLost: number;
}

export interface PlayerTrendSummary {
  totalGames: number;
  uniquePlayers: number;

  // W/L record
  wins: number;
  losses: number;
  ties: number;
  winPct: number;

  // ATS record
  atsCovered: number;
  atsLost: number;
  atsPush: number;
  atsPct: number;
  atsRecord: string;

  // O/U record
  ouOver: number;
  ouUnder: number;
  ouPush: number;

  // Position-aware stat averages
  statAverages: Record<string, number>;

  // Season breakdown
  bySeasonBreakdown: PlayerSeasonBreakdown[];
}

export interface PlayerTrendResult {
  query: PlayerTrendQuery;
  games: PlayerTrendGame[];
  summary: PlayerTrendSummary;
  computedAt: string;
}

// ─── Data Loading ───────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data");

export function loadPlayerGames(): PlayerTrendGame[] {
  const filePath = path.join(DATA_DIR, "nfl-player-games.json");
  if (!fs.existsSync(filePath)) {
    console.warn(`[player-trend-engine] Data file not found: ${filePath}`);
    return [];
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<
    string,
    unknown
  >[];
  return raw as unknown as PlayerTrendGame[];
}

let playerGameCache: PlayerTrendGame[] | null = null;

export function loadPlayerGamesCached(): PlayerTrendGame[] {
  if (!playerGameCache) {
    playerGameCache = loadPlayerGames();
  }
  return playerGameCache;
}

export function clearPlayerGameCache(): void {
  playerGameCache = null;
}

// ─── Player Name Resolution ─────────────────────────────────────────────────────

/**
 * Build a name index from the loaded games for fuzzy matching.
 * Returns a map of lowercase name variants -> { playerId, displayName, position }
 */
function buildNameIndex(
  games: PlayerTrendGame[],
): Map<string, { playerId: string; displayName: string; position: string; gameCount: number }> {
  const playerStats = new Map<
    string,
    { displayName: string; position: string; gameCount: number }
  >();

  for (const g of games) {
    const pid = g.player_id;
    if (!pid) continue;
    const existing = playerStats.get(pid);
    if (existing) {
      existing.gameCount++;
    } else {
      playerStats.set(pid, {
        displayName: g.player_display_name || g.player_name || "",
        position: g.position || g.position_group || "",
        gameCount: 1,
      });
    }
  }

  const index = new Map<
    string,
    { playerId: string; displayName: string; position: string; gameCount: number }
  >();

  Array.from(playerStats.entries()).forEach(([pid, info]) => {
    const name = info.displayName;
    const entry = { playerId: pid, ...info };

    // Add full name
    index.set(name.toLowerCase(), entry);

    // Add last name only (for common queries like "mahomes")
    const parts = name.split(" ");
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1].toLowerCase();
      // Only set if not already taken, or this player has more games
      const existing = index.get(lastName);
      if (!existing || info.gameCount > existing.gameCount) {
        index.set(lastName, entry);
      }
    }

    // Add "F. LastName" format
    if (parts.length >= 2) {
      const initial = parts[0][0].toLowerCase();
      const lastName = parts[parts.length - 1].toLowerCase();
      index.set(`${initial}. ${lastName}`, entry);
    }
  });

  return index;
}

let nameIndexCache: ReturnType<typeof buildNameIndex> | null = null;

function getNameIndex(
  games: PlayerTrendGame[],
): ReturnType<typeof buildNameIndex> {
  if (!nameIndexCache) {
    nameIndexCache = buildNameIndex(games);
  }
  return nameIndexCache;
}

/**
 * Resolve a player name query to a player ID.
 * Supports exact match, last name, partial match.
 */
export function resolvePlayerName(
  input: string,
  games: PlayerTrendGame[],
): { playerId: string; displayName: string; position: string } | null {
  if (!input) return null;
  const nameIndex = getNameIndex(games);

  // Exact match
  const exact = nameIndex.get(input.toLowerCase());
  if (exact) return exact;

  // Partial match (input is substring of a known name)
  const inputLower = input.toLowerCase();
  let bestMatch: { playerId: string; displayName: string; position: string; gameCount: number } | null = null;
  let bestGameCount = 0;

  Array.from(nameIndex.entries()).forEach(([key, val]) => {
    if (key.includes(inputLower) || inputLower.includes(key)) {
      if (val.gameCount > bestGameCount) {
        bestMatch = val;
        bestGameCount = val.gameCount;
      }
    }
  });

  return bestMatch ?? null;
}

// ─── Field Resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a field value from a PlayerTrendGame.
 * Supports direct fields, computed fields (month, year), and bracket access.
 */
function resolvePlayerField(
  game: PlayerTrendGame,
  field: string,
): unknown {
  // Computed fields
  if (field === "month" && game.gameDate) {
    return parseInt(game.gameDate.substring(5, 7), 10);
  }
  if (field === "year" && game.gameDate) {
    return parseInt(game.gameDate.substring(0, 4), 10);
  }
  if (field === "monthName" && game.gameDate) {
    const months = [
      "",
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
    const m = parseInt(game.gameDate.substring(5, 7), 10);
    return months[m] || null;
  }
  if (field === "totalPoints") {
    const ts = game.teamScore;
    const os = game.opponentScore;
    if (ts != null && os != null) return ts + os;
    return null;
  }

  // Direct field access
  if (field in game) {
    return game[field] ?? null;
  }

  return null;
}

// ─── Filtering ──────────────────────────────────────────────────────────────────

function applyPlayerFilter(
  games: PlayerTrendGame[],
  filter: TrendFilter,
): PlayerTrendGame[] {
  return games.filter((game) => {
    const fieldValue = resolvePlayerField(game, filter.field);
    return evaluateOperator(fieldValue, filter.operator, filter.value);
  });
}

function applyAllPlayerFilters(
  games: PlayerTrendGame[],
  filters: TrendFilter[],
): PlayerTrendGame[] {
  let result = games;
  for (const filter of filters) {
    result = applyPlayerFilter(result, filter);
  }
  return result;
}

// ─── Summary Computation ────────────────────────────────────────────────────────

/**
 * Stats to average for each position group.
 */
const POSITION_STAT_KEYS: Record<string, string[]> = {
  QB: [
    "completions",
    "attempts",
    "passing_yards",
    "passing_tds",
    "passing_interceptions",
    "sacks_suffered",
    "passing_epa",
    "passing_cpoe",
    "carries",
    "rushing_yards",
    "rushing_tds",
    "fantasy_points",
    "fantasy_points_ppr",
  ],
  RB: [
    "carries",
    "rushing_yards",
    "rushing_tds",
    "rushing_fumbles_lost",
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "rushing_epa",
    "receiving_epa",
    "target_share",
    "fantasy_points",
    "fantasy_points_ppr",
  ],
  WR: [
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "receiving_air_yards",
    "receiving_yards_after_catch",
    "target_share",
    "air_yards_share",
    "wopr",
    "receiving_epa",
    "carries",
    "rushing_yards",
    "fantasy_points",
    "fantasy_points_ppr",
  ],
  TE: [
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "receiving_air_yards",
    "receiving_yards_after_catch",
    "target_share",
    "receiving_epa",
    "fantasy_points",
    "fantasy_points_ppr",
  ],
  K: [
    "fg_made",
    "fg_att",
    "fg_pct",
    "fg_long",
    "pat_made",
    "pat_att",
    "fantasy_points",
  ],
  DL: [
    "def_tackles_solo",
    "def_tackles_with_assist",
    "def_tackles_for_loss",
    "def_sacks",
    "def_qb_hits",
    "def_fumbles_forced",
    "def_tds",
  ],
  LB: [
    "def_tackles_solo",
    "def_tackles_with_assist",
    "def_tackles_for_loss",
    "def_sacks",
    "def_qb_hits",
    "def_interceptions",
    "def_pass_defended",
    "def_fumbles_forced",
    "def_tds",
  ],
  DB: [
    "def_tackles_solo",
    "def_tackles_with_assist",
    "def_interceptions",
    "def_interception_yards",
    "def_pass_defended",
    "def_tds",
  ],
};

// Fallback stats for unknown positions
const DEFAULT_STAT_KEYS = [
  "fantasy_points",
  "fantasy_points_ppr",
];

function computeStatAverages(
  games: PlayerTrendGame[],
): Record<string, number> {
  if (games.length === 0) return {};

  // Determine the dominant position group
  const posCounts = new Map<string, number>();
  for (const g of games) {
    const pg = g.position_group || "?";
    posCounts.set(pg, (posCounts.get(pg) || 0) + 1);
  }
  let dominantPos = "?";
  let maxCount = 0;
  Array.from(posCounts.entries()).forEach(([pos, count]) => {
    if (count > maxCount) {
      dominantPos = pos;
      maxCount = count;
    }
  });

  const statKeys = POSITION_STAT_KEYS[dominantPos] || DEFAULT_STAT_KEYS;
  const averages: Record<string, number> = {};

  for (const key of statKeys) {
    let sum = 0;
    let count = 0;
    for (const g of games) {
      const val = g[key];
      if (val != null && typeof val === "number") {
        sum += val;
        count++;
      }
    }
    if (count > 0) {
      averages[key] = Math.round((sum / count) * 100) / 100;
    }
  }

  return averages;
}

function computePlayerSummary(
  games: PlayerTrendGame[],
): PlayerTrendSummary {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let atsCovered = 0;
  let atsLost = 0;
  let atsPush = 0;
  let ouOver = 0;
  let ouUnder = 0;
  let ouPush = 0;

  const uniquePlayers = new Set<string>();
  const seasonMap = new Map<
    number,
    { games: number; wins: number; losses: number; atsCovered: number; atsLost: number }
  >();

  for (const g of games) {
    if (g.player_id) uniquePlayers.add(g.player_id);

    // W/L
    if (g.gameResult === "W") wins++;
    else if (g.gameResult === "L") losses++;
    else if (g.gameResult === "T") ties++;

    // ATS
    if (g.spreadResult === "COVERED") atsCovered++;
    else if (g.spreadResult === "LOST") atsLost++;
    else if (g.spreadResult === "PUSH") atsPush++;

    // O/U
    if (g.ouResult === "OVER") ouOver++;
    else if (g.ouResult === "UNDER") ouUnder++;
    else if (g.ouResult === "PUSH") ouPush++;

    // Season breakdown
    const s = g.season;
    if (s) {
      const existing = seasonMap.get(s) || {
        games: 0,
        wins: 0,
        losses: 0,
        atsCovered: 0,
        atsLost: 0,
      };
      existing.games++;
      if (g.gameResult === "W") existing.wins++;
      else if (g.gameResult === "L") existing.losses++;
      if (g.spreadResult === "COVERED") existing.atsCovered++;
      else if (g.spreadResult === "LOST") existing.atsLost++;
      seasonMap.set(s, existing);
    }
  }

  const totalGames = games.length;
  const gamesWithResult = wins + losses + ties;
  const winPct =
    gamesWithResult > 0
      ? Math.round((wins / gamesWithResult) * 1000) / 10
      : 0;

  const atsTotal = atsCovered + atsLost;
  const atsPct =
    atsTotal > 0
      ? Math.round((atsCovered / atsTotal) * 1000) / 10
      : 0;

  const atsRecord = `${atsCovered}-${atsLost}${atsPush > 0 ? `-${atsPush}` : ""}`;

  const bySeasonBreakdown: PlayerSeasonBreakdown[] = Array.from(
    seasonMap.entries(),
  )
    .sort(([a], [b]) => a - b)
    .map(([season, data]) => ({
      season,
      ...data,
    }));

  return {
    totalGames,
    uniquePlayers: uniquePlayers.size,
    wins,
    losses,
    ties,
    winPct,
    atsCovered,
    atsLost,
    atsPush,
    atsPct,
    atsRecord,
    ouOver,
    ouUnder,
    ouPush,
    statAverages: computeStatAverages(games),
    bySeasonBreakdown,
  };
}

// ─── Query Execution ────────────────────────────────────────────────────────────

/**
 * Execute a player trend query against the loaded data.
 */
export function executePlayerTrendQuery(
  query: PlayerTrendQuery,
  allGames?: PlayerTrendGame[],
): PlayerTrendResult {
  let games = allGames ?? loadPlayerGamesCached();

  // --- Player filter ---
  if (query.playerId) {
    games = games.filter((g) => g.player_id === query.playerId);
  } else if (query.player) {
    const resolved = resolvePlayerName(query.player, games);
    if (resolved) {
      games = games.filter((g) => g.player_id === resolved.playerId);
    } else {
      // Fallback: partial match on display name
      const q = query.player.toLowerCase();
      games = games.filter(
        (g) =>
          (g.player_display_name || "").toLowerCase().includes(q) ||
          (g.player_name || "").toLowerCase().includes(q),
      );
    }
  }

  // --- Position filter ---
  if (query.position) {
    const pos = query.position.toUpperCase();
    games = games.filter(
      (g) =>
        (g.position || "").toUpperCase() === pos ||
        (g.position_group || "").toUpperCase() === pos,
    );
  } else if (query.positionGroup) {
    const pg = query.positionGroup.toUpperCase();
    games = games.filter(
      (g) => (g.position_group || "").toUpperCase() === pg,
    );
  }

  // --- Team filter ---
  if (query.team) {
    const teamLower = query.team.toLowerCase();
    games = games.filter(
      (g) =>
        (g.team || "").toLowerCase() === teamLower ||
        (g.teamCanonical || "").toLowerCase().includes(teamLower),
    );
  }

  // --- Opponent filter ---
  if (query.opponent) {
    const oppLower = query.opponent.toLowerCase();
    games = games.filter(
      (g) =>
        (g.opponent_team || "").toLowerCase() === oppLower ||
        (g.opponentCanonical || "").toLowerCase().includes(oppLower),
    );
  }

  // --- Season range ---
  if (query.seasonRange) {
    const [start, end] = query.seasonRange;
    games = games.filter((g) => g.season >= start && g.season <= end);
  }

  // --- Composable filters ---
  if (query.filters.length > 0) {
    games = applyAllPlayerFilters(games, query.filters);
  }

  // --- Ordering ---
  if (query.orderBy) {
    const { field, direction } = query.orderBy;
    const multiplier = direction === "desc" ? -1 : 1;
    games.sort((a, b) => {
      const va = resolvePlayerField(a, field);
      const vb = resolvePlayerField(b, field);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * multiplier;
      }
      return String(va).localeCompare(String(vb)) * multiplier;
    });
  }

  // --- Limit ---
  if (query.limit && query.limit > 0) {
    games = games.slice(0, query.limit);
  }

  return {
    query,
    games,
    summary: computePlayerSummary(games),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Cached version of executePlayerTrendQuery.
 * Loads data once and reuses for subsequent queries.
 */
export function executePlayerTrendQueryCached(
  query: PlayerTrendQuery,
): PlayerTrendResult {
  const games = loadPlayerGamesCached();
  return executePlayerTrendQuery(query, games);
}
