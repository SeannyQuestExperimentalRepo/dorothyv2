/**
 * Database-backed player game loader for TrendLine.
 *
 * Replaces the 268MB JSON file read with Prisma queries against
 * the PlayerGameLog table. Returns PlayerTrendGame[] so all downstream
 * engine logic (filters, summaries, prop analysis) works unchanged.
 */

import { prisma } from "./db";
import type { PlayerTrendGame } from "./player-trend-engine";

// ─── Player Resolution ───────────────────────────────────────────────────────

export interface ResolvedPlayer {
  playerId: string;
  displayName: string;
  position: string;
  positionGroup: string;
  gameCount: number;
}

/**
 * Search for players by name using ILIKE. Returns distinct matches
 * ordered by game count descending (most active players first).
 */
export async function resolvePlayerFromDB(
  nameQuery: string,
): Promise<ResolvedPlayer[]> {
  // Use raw query for efficient GROUP BY with ILIKE
  const results = await prisma.$queryRaw<
    {
      playerId: string;
      playerName: string;
      position: string;
      positionGroup: string;
      gameCount: bigint;
    }[]
  >`
    SELECT
      "playerId",
      "playerName",
      "position",
      "positionGroup",
      COUNT(*)::bigint AS "gameCount"
    FROM "PlayerGameLog"
    WHERE "playerName" ILIKE ${"%" + nameQuery + "%"}
    GROUP BY "playerId", "playerName", "position", "positionGroup"
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;

  return results.map((r) => ({
    playerId: r.playerId,
    displayName: r.playerName,
    position: r.position,
    positionGroup: r.positionGroup,
    gameCount: Number(r.gameCount),
  }));
}

// ─── Row → PlayerTrendGame Mapping ───────────────────────────────────────────

interface PlayerGameLogRow {
  id: number;
  playerId: string;
  playerName: string;
  position: string;
  positionGroup: string;
  season: number;
  week: number;
  seasonType: string;
  team: string;
  opponentTeam: string;
  gameDate: Date | null;
  isHome: boolean | null;
  teamScore: number | null;
  opponentScore: number | null;
  gameResult: string | null;
  spread: number | null;
  overUnder: number | null;
  spreadResult: string | null;
  ouResult: string | null;
  isPlayoff: boolean;
  isPrimetime: boolean | null;
  stats: Record<string, unknown>;
}

function rowToPlayerTrendGame(row: PlayerGameLogRow): PlayerTrendGame {
  const stats = (row.stats || {}) as Record<string, unknown>;

  return {
    // Player identity
    player_id: row.playerId,
    player_name: (stats.player_name as string) || row.playerName,
    player_display_name: row.playerName,
    position: row.position,
    position_group: row.positionGroup,
    jerseyNumber: (stats.jerseyNumber as number) ?? null,

    // Player metadata
    birthDate: (stats.birthDate as string) ?? null,
    college: (stats.college as string) ?? null,
    draftYear: (stats.draftYear as number) ?? null,
    draftPick: (stats.draftPick as number) ?? null,
    yearsExp: (stats.yearsExp as number) ?? null,

    // Game context
    season: row.season,
    week: row.week,
    season_type: row.seasonType,
    team: row.team,
    teamCanonical: (stats.teamCanonical as string) || "",
    opponent_team: row.opponentTeam,
    opponentCanonical: (stats.opponentCanonical as string) || "",
    gameDate: row.gameDate ? row.gameDate.toISOString().split("T")[0] : null,
    dayOfWeek: (stats.dayOfWeek as string) ?? null,
    isHome: row.isHome,

    // Scores
    teamScore: row.teamScore,
    opponentScore: row.opponentScore,
    gameResult: row.gameResult as "W" | "L" | "T" | null,

    // Betting
    spread: row.spread,
    overUnder: row.overUnder,
    spreadResult: row.spreadResult as "COVERED" | "LOST" | "PUSH" | null,
    ouResult: row.ouResult as "OVER" | "UNDER" | "PUSH" | null,

    // Flags
    isPlayoff: row.isPlayoff,
    isPrimetime: row.isPrimetime,
    primetimeSlot: (stats.primetimeSlot as string) ?? null,
    isNeutralSite: (stats.isNeutralSite as boolean) ?? null,

    // Weather
    temperature: (stats.temperature as number) ?? null,
    windMph: (stats.windMph as number) ?? null,
    weatherCategory: (stats.weatherCategory as string) ?? null,

    // Schedule
    restDays: (stats.restDays as number) ?? null,
    isByeWeek: (stats.isByeWeek as boolean) ?? null,

    // Passing
    completions: (stats.completions as number) ?? null,
    attempts: (stats.attempts as number) ?? null,
    passing_yards: (stats.passing_yards as number) ?? null,
    passing_tds: (stats.passing_tds as number) ?? null,
    passing_interceptions: (stats.passing_interceptions as number) ?? null,
    sacks_suffered: (stats.sacks_suffered as number) ?? null,
    sack_yards_lost: (stats.sack_yards_lost as number) ?? null,
    passing_air_yards: (stats.passing_air_yards as number) ?? null,
    passing_yards_after_catch: (stats.passing_yards_after_catch as number) ?? null,
    passing_first_downs: (stats.passing_first_downs as number) ?? null,
    passing_epa: (stats.passing_epa as number) ?? null,
    passing_cpoe: (stats.passing_cpoe as number) ?? null,
    pacr: (stats.pacr as number) ?? null,

    // Rushing
    carries: (stats.carries as number) ?? null,
    rushing_yards: (stats.rushing_yards as number) ?? null,
    rushing_tds: (stats.rushing_tds as number) ?? null,
    rushing_fumbles: (stats.rushing_fumbles as number) ?? null,
    rushing_fumbles_lost: (stats.rushing_fumbles_lost as number) ?? null,
    rushing_first_downs: (stats.rushing_first_downs as number) ?? null,
    rushing_epa: (stats.rushing_epa as number) ?? null,

    // Receiving
    targets: (stats.targets as number) ?? null,
    receptions: (stats.receptions as number) ?? null,
    receiving_yards: (stats.receiving_yards as number) ?? null,
    receiving_tds: (stats.receiving_tds as number) ?? null,
    receiving_fumbles: (stats.receiving_fumbles as number) ?? null,
    receiving_fumbles_lost: (stats.receiving_fumbles_lost as number) ?? null,
    receiving_air_yards: (stats.receiving_air_yards as number) ?? null,
    receiving_yards_after_catch: (stats.receiving_yards_after_catch as number) ?? null,
    receiving_first_downs: (stats.receiving_first_downs as number) ?? null,
    receiving_epa: (stats.receiving_epa as number) ?? null,
    racr: (stats.racr as number) ?? null,
    target_share: (stats.target_share as number) ?? null,
    air_yards_share: (stats.air_yards_share as number) ?? null,
    wopr: (stats.wopr as number) ?? null,

    // Defense
    def_tackles_solo: (stats.def_tackles_solo as number) ?? null,
    def_tackles_with_assist: (stats.def_tackles_with_assist as number) ?? null,
    def_tackles_for_loss: (stats.def_tackles_for_loss as number) ?? null,
    def_fumbles_forced: (stats.def_fumbles_forced as number) ?? null,
    def_sacks: (stats.def_sacks as number) ?? null,
    def_qb_hits: (stats.def_qb_hits as number) ?? null,
    def_interceptions: (stats.def_interceptions as number) ?? null,
    def_interception_yards: (stats.def_interception_yards as number) ?? null,
    def_pass_defended: (stats.def_pass_defended as number) ?? null,
    def_tds: (stats.def_tds as number) ?? null,

    // Kicking
    fg_made: (stats.fg_made as number) ?? null,
    fg_att: (stats.fg_att as number) ?? null,
    fg_long: (stats.fg_long as number) ?? null,
    fg_pct: (stats.fg_pct as number) ?? null,
    pat_made: (stats.pat_made as number) ?? null,
    pat_att: (stats.pat_att as number) ?? null,

    // Snaps
    offensiveSnaps: (stats.offensiveSnaps as number) ?? null,
    offensiveSnapPct: (stats.offensiveSnapPct as number) ?? null,
    defensiveSnaps: (stats.defensiveSnaps as number) ?? null,
    defensiveSnapPct: (stats.defensiveSnapPct as number) ?? null,
    stSnaps: (stats.stSnaps as number) ?? null,
    stSnapPct: (stats.stSnapPct as number) ?? null,

    // Fantasy
    fantasy_points: (stats.fantasy_points as number) ?? null,
    fantasy_points_ppr: (stats.fantasy_points_ppr as number) ?? null,
  };
}

// ─── Game Loading ────────────────────────────────────────────────────────────

/**
 * Load all games for a specific player by playerId.
 * Sorted by season ASC, week ASC (chronological).
 */
export async function loadPlayerGamesFromDB(
  playerId: string,
  seasonRange?: [number, number],
): Promise<PlayerTrendGame[]> {
  const where: Record<string, unknown> = { playerId };

  if (seasonRange) {
    where.season = { gte: seasonRange[0], lte: seasonRange[1] };
  }

  const rows = await prisma.playerGameLog.findMany({
    where,
    orderBy: [{ season: "asc" }, { week: "asc" }],
  });

  return rows.map((r) => rowToPlayerTrendGame(r as unknown as PlayerGameLogRow));
}

/**
 * Load player games by filters (position, team, opponent, season).
 * Used for queries like "all QBs on the Chiefs since 2022".
 */
export async function loadPlayerGamesByFilters(filters: {
  playerId?: string;
  playerName?: string;
  position?: string;
  positionGroup?: string;
  team?: string;
  opponent?: string;
  seasonRange?: [number, number];
  limit?: number;
}): Promise<PlayerTrendGame[]> {
  const where: Record<string, unknown> = {};

  if (filters.playerId) {
    where.playerId = filters.playerId;
  }
  if (filters.playerName) {
    where.playerName = { contains: filters.playerName, mode: "insensitive" };
  }
  if (filters.position) {
    where.OR = [
      { position: { equals: filters.position, mode: "insensitive" } },
      { positionGroup: { equals: filters.position, mode: "insensitive" } },
    ];
  }
  if (filters.positionGroup) {
    where.positionGroup = { equals: filters.positionGroup, mode: "insensitive" };
  }
  if (filters.team) {
    where.team = { equals: filters.team, mode: "insensitive" };
  }
  if (filters.opponent) {
    where.opponentTeam = { equals: filters.opponent, mode: "insensitive" };
  }
  if (filters.seasonRange) {
    where.season = { gte: filters.seasonRange[0], lte: filters.seasonRange[1] };
  }

  const rows = await prisma.playerGameLog.findMany({
    where,
    orderBy: [{ season: "asc" }, { week: "asc" }],
    take: filters.limit || 5000,
  });

  return rows.map((r) => rowToPlayerTrendGame(r as unknown as PlayerGameLogRow));
}
