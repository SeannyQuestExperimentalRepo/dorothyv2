/**
 * Database-backed game loader for the TrendLine trend engine.
 *
 * Replaces JSON file reads with Prisma queries against Neon PostgreSQL.
 * Returns the same TrendGame[] shape so all downstream logic
 * (filters, perspectives, summaries) works unchanged.
 *
 * Performance optimization:
 * 1. Load all teams into a Map (1 query, ~1500 rows)
 * 2. Load games WITHOUT JOINs (3 queries, ~149K rows total)
 * 3. Resolve team names from the in-memory Map
 * This avoids 3 JOINs on 120K+ row tables and is 5-10x faster.
 */

import { prisma } from "./db";
import type { Sport, TrendGame } from "./trend-engine";

// ─── Team Lookup ─────────────────────────────────────────────────────────────

interface TeamInfo {
  name: string;
  abbreviation: string;
  conference: string;
}

let teamMap: Map<number, TeamInfo> | null = null;

async function getTeamMap(): Promise<Map<number, TeamInfo>> {
  if (teamMap) return teamMap;

  const teams = await prisma.team.findMany({
    select: { id: true, name: true, abbreviation: true, conference: true },
  });

  teamMap = new Map();
  for (const t of teams) {
    teamMap.set(t.id, {
      name: t.name,
      abbreviation: t.abbreviation,
      conference: t.conference,
    });
  }
  return teamMap;
}

function getTeam(map: Map<number, TeamInfo>, id: number): TeamInfo {
  return map.get(id) ?? { name: "", abbreviation: "", conference: "" };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ─── Filter Types ───────────────────────────────────────────────────────────

export interface DBLoadFilters {
  teamId?: number;
  seasonRange?: [number, number];
}

function buildWhereClause(filters?: DBLoadFilters) {
  if (!filters) return undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  if (filters.teamId != null) {
    where.OR = [
      { homeTeamId: filters.teamId },
      { awayTeamId: filters.teamId },
    ];
  }

  if (filters.seasonRange) {
    where.season = {
      gte: filters.seasonRange[0],
      lte: filters.seasonRange[1],
    };
  }

  return Object.keys(where).length > 0 ? where : undefined;
}

// ─── DB Query Functions (no JOINs) ───────────────────────────────────────────

async function loadNFLFromDB(filters?: DBLoadFilters): Promise<TrendGame[]> {
  const teams = await getTeamMap();
  const rows = await prisma.nFLGame.findMany({
    where: buildWhereClause(filters),
    orderBy: { gameDate: "desc" },
  });

  return rows.map((row) => {
    const home = getTeam(teams, row.homeTeamId);
    const away = getTeam(teams, row.awayTeamId);
    const winner = row.winnerId ? getTeam(teams, row.winnerId) : null;
    const homeScore = row.homeScore ?? 0;
    const awayScore = row.awayScore ?? 0;

    return {
      sport: "NFL" as const,
      season: row.season,
      gameDate: formatDate(row.gameDate),
      homeTeam: home.name,
      awayTeam: away.name,
      homeScore,
      awayScore,
      scoreDifference: row.scoreDifference ?? homeScore - awayScore,
      winner: winner?.name ?? "",
      homeRank: null,
      awayRank: null,
      homeKenpomRank: null,
      awayKenpomRank: null,
      spread: row.spread,
      overUnder: row.overUnder,
      spreadResult: row.spreadResult as TrendGame["spreadResult"],
      ouResult: row.ouResult as TrendGame["ouResult"],
      totalPoints: homeScore + awayScore,
      isConferenceGame: false,
      isPlayoff: row.isPlayoff,
      isNeutralSite: row.isNeutralSite,
      week: row.week,
      dayOfWeek: row.dayOfWeek,
      isPrimetime: row.isPrimetime,
      primetimeSlot: row.primetimeSlot,
      weatherCategory: row.weatherCategory,
      temperature: row.temperature,
      windMph: row.windMph,
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
      homeRestDays: null,
      awayRestDays: null,
      restAdvantage: null,
      homeIsByeWeek: false,
      awayIsByeWeek: false,
      isShortWeek: false,
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
      _raw: {
        homeTeamCanonical: home.name,
        awayTeamCanonical: away.name,
        winnerCanonical: winner?.name ?? "",
        homeTeamAbbr: home.abbreviation,
        awayTeamAbbr: away.abbreviation,
      },
    };
  });
}

async function loadNCAAFFromDB(filters?: DBLoadFilters): Promise<TrendGame[]> {
  const teams = await getTeamMap();
  const rows = await prisma.nCAAFGame.findMany({
    where: buildWhereClause(filters),
    orderBy: { gameDate: "desc" },
  });

  return rows.map((row) => {
    const home = getTeam(teams, row.homeTeamId);
    const away = getTeam(teams, row.awayTeamId);
    const winner = row.winnerId ? getTeam(teams, row.winnerId) : null;
    const homeScore = row.homeScore ?? 0;
    const awayScore = row.awayScore ?? 0;

    return {
      sport: "NCAAF" as const,
      season: row.season,
      gameDate: formatDate(row.gameDate),
      homeTeam: home.name,
      awayTeam: away.name,
      homeScore,
      awayScore,
      scoreDifference: row.scoreDifference ?? homeScore - awayScore,
      winner: winner?.name ?? "",
      homeRank: row.homeRank,
      awayRank: row.awayRank,
      homeKenpomRank: null,
      awayKenpomRank: null,
      spread: row.spread,
      overUnder: row.overUnder,
      spreadResult: row.spreadResult as TrendGame["spreadResult"],
      ouResult: row.ouResult as TrendGame["ouResult"],
      totalPoints: homeScore + awayScore,
      isConferenceGame: row.isConferenceGame,
      isPlayoff: row.isPlayoff,
      isNeutralSite: row.isNeutralSite,
      week: row.week,
      dayOfWeek: row.dayOfWeek,
      isPrimetime: row.isPrimetime,
      primetimeSlot: row.primetimeSlot,
      weatherCategory: row.weatherCategory,
      temperature: row.temperature,
      windMph: row.windMph,
      isBowlGame: row.isBowlGame,
      bowlName: row.bowlName,
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
      homeRestDays: null,
      awayRestDays: null,
      restAdvantage: null,
      homeIsByeWeek: false,
      awayIsByeWeek: false,
      isShortWeek: false,
      homeIsBackToBack: false,
      awayIsBackToBack: false,
      homeConference: home.conference,
      awayConference: away.conference,
      expectedPace: null,
      paceMismatch: null,
      efficiencyGap: null,
      kenpomPredMargin: null,
      isKenpomUpset: false,
      gameStyle: null,
      _raw: {
        homeTeamCanonical: home.name,
        awayTeamCanonical: away.name,
        winnerCanonical: winner?.name ?? "",
      },
    };
  });
}

async function loadNCAAMBFromDB(filters?: DBLoadFilters): Promise<TrendGame[]> {
  const teams = await getTeamMap();
  const rows = await prisma.nCAAMBGame.findMany({
    where: buildWhereClause(filters),
    orderBy: { gameDate: "desc" },
  });

  return rows.map((row) => {
    const home = getTeam(teams, row.homeTeamId);
    const away = getTeam(teams, row.awayTeamId);
    const winner = row.winnerId ? getTeam(teams, row.winnerId) : null;
    const homeScore = row.homeScore ?? 0;
    const awayScore = row.awayScore ?? 0;
    const isNCAAT = row.isTournament;

    return {
      sport: "NCAAMB" as const,
      season: row.season,
      gameDate: formatDate(row.gameDate),
      homeTeam: home.name,
      awayTeam: away.name,
      homeScore,
      awayScore,
      scoreDifference: row.scoreDifference ?? homeScore - awayScore,
      winner: winner?.name ?? "",
      homeRank: row.homeRank,
      awayRank: row.awayRank,
      homeKenpomRank: row.homeKenpomRank,
      awayKenpomRank: row.awayKenpomRank,
      spread: row.spread,
      overUnder: row.overUnder,
      spreadResult: row.spreadResult as TrendGame["spreadResult"],
      ouResult: row.ouResult as TrendGame["ouResult"],
      totalPoints: homeScore + awayScore,
      isConferenceGame: row.isConferenceGame,
      isPlayoff: isNCAAT,
      isNeutralSite: row.isNeutralSite,
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
      isNIT: row.isNIT,
      isConfTourney: row.isConferenceTourney,
      overtimes: row.overtimes,
      homeSeed: row.homeSeed,
      awaySeed: row.awaySeed,
      homeAdjEM: row.homeAdjEM,
      awayAdjEM: row.awayAdjEM,
      homeAdjOE: row.homeAdjOE,
      awayAdjOE: row.awayAdjOE,
      homeAdjDE: row.homeAdjDE,
      awayAdjDE: row.awayAdjDE,
      homeAdjTempo: row.homeAdjTempo,
      awayAdjTempo: row.awayAdjTempo,
      fmHomePred: row.fmHomePred,
      fmAwayPred: row.fmAwayPred,
      fmHomeWinProb: row.fmHomeWinProb,
      fmThrillScore: row.fmThrillScore,
      homeRestDays: null,
      awayRestDays: null,
      restAdvantage: null,
      homeIsByeWeek: false,
      awayIsByeWeek: false,
      isShortWeek: false,
      homeIsBackToBack: false,
      awayIsBackToBack: false,
      homeConference: home.conference,
      awayConference: away.conference,
      expectedPace: null,
      paceMismatch: null,
      efficiencyGap: null,
      kenpomPredMargin: null,
      isKenpomUpset: false,
      gameStyle: null,
      _raw: {
        homeTeam: home.name,
        awayTeam: away.name,
        winnerCanonical: winner?.name ?? "",
      },
    };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load games for a single sport from PostgreSQL.
 * When filters are provided, queries DB directly with WHERE clauses.
 */
export async function loadGamesBySportFromDB(sport: Sport, filters?: DBLoadFilters): Promise<TrendGame[]> {
  switch (sport) {
    case "NFL":
      return loadNFLFromDB(filters);
    case "NCAAF":
      return loadNCAAFFromDB(filters);
    case "NCAAMB":
      return loadNCAAMBFromDB(filters);
    default:
      return [];
  }
}

/**
 * Look up a team ID by name (case-insensitive partial match).
 * Returns the first matching team's ID, or null if not found.
 */
export async function resolveTeamIdByName(
  teamName: string,
  sport?: Sport,
): Promise<number | null> {
  const map = await getTeamMap();
  const lower = teamName.toLowerCase();

  // Exact match first
  let exactMatch: number | null = null;
  map.forEach((info, id) => {
    if (exactMatch == null && info.name.toLowerCase() === lower) {
      exactMatch = id;
    }
  });
  if (exactMatch != null) return exactMatch;

  // Partial match
  let partialMatch: number | null = null;
  map.forEach((info, id) => {
    if (partialMatch == null && info.name.toLowerCase().includes(lower)) {
      partialMatch = id;
    }
  });
  if (partialMatch != null) return partialMatch;

  // If sport provided, try DB query with contains for robustness
  if (sport) {
    const team = await prisma.team.findFirst({
      where: {
        sport,
        name: { contains: teamName, mode: "insensitive" },
      },
      select: { id: true },
    });
    return team?.id ?? null;
  }

  return null;
}

/**
 * Load all games across all sports from PostgreSQL.
 */
export async function loadAllGamesFromDB(): Promise<TrendGame[]> {
  const [nfl, ncaaf, ncaamb] = await Promise.all([
    loadNFLFromDB(),
    loadNCAAFFromDB(),
    loadNCAAMBFromDB(),
  ]);
  return [...nfl, ...ncaaf, ...ncaamb];
}
