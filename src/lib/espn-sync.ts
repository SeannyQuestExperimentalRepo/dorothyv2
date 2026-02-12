/**
 * ESPN Sync Logic
 *
 * Shared functions for:
 * 1. refreshUpcomingGames — fetch ESPN odds → upsert into UpcomingGame table
 * 2. syncCompletedGames — fetch ESPN scoreboard → insert completed games into
 *    NFLGame/NCAAFGame/NCAAMBGame tables (daily cron)
 *
 * The UpcomingGame table uses canonical team names as strings (no FK),
 * so we can upsert freely. Completed game sync requires mapping to team IDs.
 */

import { prisma } from "./db";
import { SpreadResult, OUResult } from "@prisma/client";
import {
  fetchUpcomingWithOdds,
  fetchScoreboard,
  fetchAPRankings,
  mapTeamToCanonical,
  type Sport,
} from "./espn-api";

// ─── Refresh Upcoming Games (Odds) ──────────────────────────────────────────

export interface RefreshResult {
  sport: Sport;
  fetched: number;
  upserted: number;
  cleaned: number;
}

/**
 * Fetch upcoming games with odds from ESPN and upsert into UpcomingGame table.
 * Also cleans up games older than 1 day.
 */
export async function refreshUpcomingGames(sport: Sport): Promise<RefreshResult> {
  const games = await fetchUpcomingWithOdds(sport);

  // Fetch AP Top 25 rankings (NCAAMB/NCAAF only; empty map for NFL)
  const apRankings = await fetchAPRankings(sport);

  let upserted = 0;
  for (const g of games) {
    // Only store games with at least one useful odds field
    if (g.odds.spread == null && g.odds.overUnder == null) continue;

    // Use canonical name if available, otherwise fall back to display name
    const homeTeam = g.homeCanonical ?? g.homeTeam.displayName;
    const awayTeam = g.awayCanonical ?? g.awayTeam.displayName;
    const gameDate = new Date(g.date);

    // Look up AP rankings — prefer ESPN team ID (reliable), fall back to name matching
    const homeRank = apRankings.get(`espn:${g.homeTeam.espnId}`)
      ?? apRankings.get(g.homeTeam.displayName)
      ?? apRankings.get(homeTeam)
      ?? g.homeTeam.rank
      ?? null;
    const awayRank = apRankings.get(`espn:${g.awayTeam.espnId}`)
      ?? apRankings.get(g.awayTeam.displayName)
      ?? apRankings.get(awayTeam)
      ?? g.awayTeam.rank
      ?? null;

    try {
      await prisma.upcomingGame.upsert({
        where: {
          sport_gameDate_homeTeam_awayTeam: {
            sport,
            gameDate,
            homeTeam,
            awayTeam,
          },
        },
        create: {
          sport,
          gameDate,
          homeTeam,
          awayTeam,
          homeRank,
          awayRank,
          spread: g.odds.spread,
          overUnder: g.odds.overUnder,
          moneylineHome: g.odds.moneylineHome,
          moneylineAway: g.odds.moneylineAway,
        },
        update: {
          homeRank,
          awayRank,
          spread: g.odds.spread,
          overUnder: g.odds.overUnder,
          moneylineHome: g.odds.moneylineHome,
          moneylineAway: g.odds.moneylineAway,
        },
      });
      upserted++;
    } catch (err) {
      console.warn(`[ESPN Sync] Upsert failed for ${awayTeam} @ ${homeTeam}:`, err);
    }
  }

  // Clean up old games (older than 3 days)
  // Keep a 3-day window so completed-game sync can still find pre-game odds
  // even if the cron runs a day late or timezone offsets cause date mismatches
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const { count: cleaned } = await prisma.upcomingGame.deleteMany({
    where: {
      sport,
      gameDate: { lt: cutoff },
    },
  });

  console.log(
    `[ESPN Sync] ${sport}: fetched=${games.length}, upserted=${upserted}, cleaned=${cleaned}`,
  );

  return { sport, fetched: games.length, upserted, cleaned };
}

// ─── Sync Completed Games (Daily Cron) ──────────────────────────────────────

export interface SyncResult {
  sport: Sport;
  fetched: number;
  inserted: number;
  skipped: number;
}

/**
 * Fetch yesterday's completed games from ESPN scoreboard and insert into
 * the appropriate game table (NFLGame, NCAAFGame, NCAAMBGame).
 *
 * Uses batched DB operations: resolves teams sequentially (may create),
 * then batch-finds existing games and batch-creates new ones.
 */
export async function syncCompletedGames(
  sport: Sport,
  date?: string,
): Promise<SyncResult> {
  // Default to yesterday
  const targetDate =
    date ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().split("T")[0];
    })();

  const games = await fetchScoreboard(sport, targetDate);
  const completed = games.filter((g) => g.status === "final");

  if (completed.length === 0) {
    return { sport, fetched: games.length, inserted: 0, skipped: 0 };
  }

  // Load team ID map
  const teamIdMap = await getTeamIdMap();
  let skipped = 0;

  // Phase 1: Resolve team IDs sequentially (may create teams) and prepare game data
  interface PreparedGame {
    homeTeamId: number;
    awayTeamId: number;
    homeScore: number;
    awayScore: number;
    gameDate: Date;
    homeRank: number | null;
    awayRank: number | null;
    homeCanonical: string;
    awayCanonical: string;
    inlineSpread: number | null;
    inlineOverUnder: number | null;
  }

  const prepared: PreparedGame[] = [];

  for (const game of completed) {
    const homeScore = game.homeTeam.score;
    const awayScore = game.awayTeam.score;

    if (homeScore == null || awayScore == null) {
      skipped++;
      continue;
    }

    const homeId = await resolveTeamId(game.homeTeam, sport, teamIdMap);
    const awayId = await resolveTeamId(game.awayTeam, sport, teamIdMap);

    if (!homeId || !awayId) {
      skipped++;
      continue;
    }

    prepared.push({
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeScore,
      awayScore,
      gameDate: new Date(game.date),
      homeRank: game.homeTeam.rank,
      awayRank: game.awayTeam.rank,
      homeCanonical: mapTeamToCanonical(game.homeTeam, sport) ?? game.homeTeam.displayName,
      awayCanonical: mapTeamToCanonical(game.awayTeam, sport) ?? game.awayTeam.displayName,
      inlineSpread: game.inlineOdds?.spread ?? null,
      inlineOverUnder: game.inlineOdds?.overUnder ?? null,
    });
  }

  if (prepared.length === 0) {
    return { sport, fetched: games.length, inserted: 0, skipped };
  }

  // Phase 2: Batch lookup pre-game odds from UpcomingGame table
  // Build date ranges for all games, then fetch matching upcoming records in one query
  const minDate = new Date(Math.min(...prepared.map((g) => g.gameDate.getTime())));
  const maxDate = new Date(Math.max(...prepared.map((g) => g.gameDate.getTime())));
  const rangeStart = new Date(minDate);
  rangeStart.setDate(rangeStart.getDate() - 1);
  const rangeEnd = new Date(maxDate);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const upcomingRecords = await prisma.upcomingGame.findMany({
    where: {
      sport,
      gameDate: { gte: rangeStart, lte: rangeEnd },
    },
    select: { homeTeam: true, awayTeam: true, gameDate: true, spread: true, overUnder: true, moneylineHome: true, moneylineAway: true, fmHomePred: true, fmAwayPred: true, fmHomeWinProb: true },
  });

  // Index upcoming records for fast lookup
  const oddsMap = new Map<string, {
    spread: number | null; overUnder: number | null;
    moneylineHome: number | null; moneylineAway: number | null;
    fmHomePred: number | null; fmAwayPred: number | null; fmHomeWinProb: number | null;
  }>();
  for (const u of upcomingRecords) {
    const entry = {
      spread: u.spread, overUnder: u.overUnder,
      moneylineHome: u.moneylineHome, moneylineAway: u.moneylineAway,
      fmHomePred: u.fmHomePred, fmAwayPred: u.fmAwayPred, fmHomeWinProb: u.fmHomeWinProb,
    };
    // Key by home+away+date (date normalized to YYYY-MM-DD)
    const dateKey = u.gameDate.toISOString().split("T")[0];
    oddsMap.set(`${u.homeTeam}|${u.awayTeam}|${dateKey}`, entry);
    // Also store with ±1 day for timezone tolerance
    const dayBefore = new Date(u.gameDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(u.gameDate);
    dayAfter.setDate(dayAfter.getDate() + 1);
    oddsMap.set(`${u.homeTeam}|${u.awayTeam}|${dayBefore.toISOString().split("T")[0]}`, entry);
    oddsMap.set(`${u.homeTeam}|${u.awayTeam}|${dayAfter.toISOString().split("T")[0]}`, entry);
  }

  // Phase 3: Batch find existing games (one query per sport)
  const dupeConditions = prepared.map((g) => ({
    gameDate: g.gameDate,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
  }));

  const existingSet = new Set<string>();
  const makeKey = (gameDate: Date, homeTeamId: number, awayTeamId: number) =>
    `${gameDate.toISOString()}|${homeTeamId}|${awayTeamId}`;

  if (sport === "NFL") {
    const existing = await prisma.nFLGame.findMany({
      where: { OR: dupeConditions },
      select: { gameDate: true, homeTeamId: true, awayTeamId: true },
    });
    for (const e of existing) existingSet.add(makeKey(e.gameDate, e.homeTeamId, e.awayTeamId));
  } else if (sport === "NCAAF") {
    const existing = await prisma.nCAAFGame.findMany({
      where: { OR: dupeConditions },
      select: { gameDate: true, homeTeamId: true, awayTeamId: true },
    });
    for (const e of existing) existingSet.add(makeKey(e.gameDate, e.homeTeamId, e.awayTeamId));
  } else if (sport === "NCAAMB") {
    const existing = await prisma.nCAAMBGame.findMany({
      where: { OR: dupeConditions },
      select: { gameDate: true, homeTeamId: true, awayTeamId: true },
    });
    for (const e of existing) existingSet.add(makeKey(e.gameDate, e.homeTeamId, e.awayTeamId));
  }

  // Phase 4: Filter out duplicates, build insert data, and batch create
  const newGames = prepared.filter(
    (g) => !existingSet.has(makeKey(g.gameDate, g.homeTeamId, g.awayTeamId)),
  );
  skipped += prepared.length - newGames.length;

  let inserted = 0;

  if (newGames.length > 0) {
    if (sport === "NFL") {
      const data = newGames.map((g) => {
        const dateKey = g.gameDate.toISOString().split("T")[0];
        const odds = oddsMap.get(`${g.homeCanonical}|${g.awayCanonical}|${dateKey}`);
        const spread = odds?.spread ?? g.inlineSpread;
        const overUnder = odds?.overUnder ?? g.inlineOverUnder;
        const season = getSeason(g.gameDate, sport);
        const scoreDifference = g.homeScore - g.awayScore;
        return {
          season,
          week: getWeek(g.gameDate, sport, season),
          dayOfWeek: g.gameDate.toLocaleDateString("en-US", { weekday: "long" }),
          gameDate: g.gameDate,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          scoreDifference,
          winnerId: scoreDifference > 0 ? g.homeTeamId : scoreDifference < 0 ? g.awayTeamId : null,
          spread,
          overUnder,
          spreadResult: calculateSpreadResult(g.homeScore, g.awayScore, spread),
          ouResult: calculateOUResult(g.homeScore, g.awayScore, overUnder),
        };
      });
      const result = await prisma.nFLGame.createMany({ data, skipDuplicates: true });
      inserted = result.count;
    } else if (sport === "NCAAF") {
      const data = newGames.map((g) => {
        const dateKey = g.gameDate.toISOString().split("T")[0];
        const odds = oddsMap.get(`${g.homeCanonical}|${g.awayCanonical}|${dateKey}`);
        const spread = odds?.spread ?? g.inlineSpread;
        const overUnder = odds?.overUnder ?? g.inlineOverUnder;
        const season = getSeason(g.gameDate, sport);
        const scoreDifference = g.homeScore - g.awayScore;
        return {
          season,
          week: getWeek(g.gameDate, sport, season),
          dayOfWeek: g.gameDate.toLocaleDateString("en-US", { weekday: "long" }),
          gameDate: g.gameDate,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          scoreDifference,
          winnerId: scoreDifference > 0 ? g.homeTeamId : scoreDifference < 0 ? g.awayTeamId : null,
          homeRank: g.homeRank,
          awayRank: g.awayRank,
          spread,
          overUnder,
          spreadResult: calculateSpreadResult(g.homeScore, g.awayScore, spread),
          ouResult: calculateOUResult(g.homeScore, g.awayScore, overUnder),
        };
      });
      const result = await prisma.nCAAFGame.createMany({ data, skipDuplicates: true });
      inserted = result.count;
    } else if (sport === "NCAAMB") {
      const data = newGames.map((g) => {
        const dateKey = g.gameDate.toISOString().split("T")[0];
        const odds = oddsMap.get(`${g.homeCanonical}|${g.awayCanonical}|${dateKey}`);
        const spread = odds?.spread ?? g.inlineSpread;
        const overUnder = odds?.overUnder ?? g.inlineOverUnder;
        const season = getSeason(g.gameDate, sport);
        const scoreDifference = g.homeScore - g.awayScore;
        return {
          season,
          gameDate: g.gameDate,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          scoreDifference,
          winnerId: scoreDifference > 0 ? g.homeTeamId : scoreDifference < 0 ? g.awayTeamId : null,
          homeRank: g.homeRank,
          awayRank: g.awayRank,
          spread,
          overUnder,
          moneylineHome: odds?.moneylineHome ?? null,
          moneylineAway: odds?.moneylineAway ?? null,
          fmHomePred: odds?.fmHomePred ?? null,
          fmAwayPred: odds?.fmAwayPred ?? null,
          fmHomeWinProb: odds?.fmHomeWinProb ?? null,
          spreadResult: calculateSpreadResult(g.homeScore, g.awayScore, spread),
          ouResult: calculateOUResult(g.homeScore, g.awayScore, overUnder),
        };
      });
      const result = await prisma.nCAAMBGame.createMany({ data, skipDuplicates: true });
      inserted = result.count;
    }
  }

  console.log(
    `[ESPN Sync] ${sport} ${targetDate}: fetched=${games.length}, completed=${completed.length}, inserted=${inserted}, skipped=${skipped}`,
  );

  return { sport, fetched: games.length, inserted, skipped };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Calculate spread result from HOME perspective. Exported for future use. */
export function calculateSpreadResult(
  homeScore: number,
  awayScore: number,
  spread: number | null,
): SpreadResult | null {
  if (spread == null) return null;
  const margin = homeScore - awayScore + spread;
  if (margin > 0) return SpreadResult.COVERED;
  if (margin < 0) return SpreadResult.LOST;
  return SpreadResult.PUSH;
}

/** Calculate over/under result. Exported for future use. */
export function calculateOUResult(
  homeScore: number,
  awayScore: number,
  overUnder: number | null,
): OUResult | null {
  if (overUnder == null) return null;
  const total = homeScore + awayScore;
  if (total > overUnder) return OUResult.OVER;
  if (total < overUnder) return OUResult.UNDER;
  return OUResult.PUSH;
}

/** Approximate week number for NFL/NCAAF from game date and season */
function getWeek(gameDate: Date, sport: Sport, season: number): string {
  if (sport === "NCAAMB") return "0"; // NCAAMB doesn't use weeks
  // NFL/NCAAF: approximate week from season start (early September)
  const seasonStart = new Date(season, 8, 1); // Sep 1
  const diffDays = Math.floor(
    (gameDate.getTime() - seasonStart.getTime()) / 86400000,
  );
  const week = Math.max(1, Math.ceil(diffDays / 7));
  return String(week);
}

/** Build a map of "SPORT:canonicalName" → team ID */
async function getTeamIdMap(): Promise<Map<string, number>> {
  const teams = await prisma.team.findMany({
    select: { id: true, name: true, sport: true },
  });

  const map = new Map<string, number>();
  for (const t of teams) {
    map.set(`${t.sport}:${t.name}`, t.id);
  }
  return map;
}

/**
 * Resolve an ESPN team to a DB team ID, creating the team if necessary.
 *
 * Strategy:
 * 1. Try mapTeamToCanonical() → teamIdMap (existing D1 teams)
 * 2. Search DB by ESPN display name (may have been created in a previous sync)
 * 3. Create a new Team record for non-D1 / unknown opponents
 *
 * Returns the team ID, or null only if creation fails.
 */
async function resolveTeamId(
  espnTeam: { espnId: string; displayName: string; shortName: string; abbreviation: string },
  sport: Sport,
  teamIdMap: Map<string, number>,
): Promise<number | null> {
  // 1. Standard canonical mapping (covers all known D1 teams)
  const canonical = mapTeamToCanonical(
    { ...espnTeam, score: 0, rank: null },
    sport,
  );
  if (canonical) {
    const id = teamIdMap.get(`${sport}:${canonical}`);
    if (id) return id;
  }

  // 2. Check if we already created this team in a previous run (by display name)
  const existing = await prisma.team.findFirst({
    where: { sport, name: espnTeam.displayName },
    select: { id: true },
  });
  if (existing) {
    // Cache for future lookups in this batch
    teamIdMap.set(`${sport}:${espnTeam.displayName}`, existing.id);
    return existing.id;
  }

  // 3. Create a new Team record for this non-D1 / unknown opponent
  try {
    const newTeam = await prisma.team.create({
      data: {
        name: espnTeam.displayName,
        abbreviation: espnTeam.abbreviation,
        sport,
        conference: "Non-D1",
        city: "Unknown",
        state: "Unknown",
      },
    });
    // Cache for future lookups
    teamIdMap.set(`${sport}:${espnTeam.displayName}`, newTeam.id);
    console.log(
      `[ESPN Sync] Created non-D1 team: "${espnTeam.displayName}" (${espnTeam.abbreviation}) → ID ${newTeam.id}`,
    );
    return newTeam.id;
  } catch (err) {
    console.warn(
      `[ESPN Sync] Failed to create team "${espnTeam.displayName}":`,
      err,
    );
    return null;
  }
}

/**
 * Determine the current season year for a given game date + sport.
 * NFL/NCAAF: season = year when season starts (Aug-Jan: year of Aug)
 * NCAAMB: season = year when season ends (Nov-Apr: year of Apr)
 */
function getSeason(date: Date, sport: Sport): number {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();

  if (sport === "NCAAMB") {
    // NCAAMB season spans Nov-Apr; season year = calendar year when it ends
    // Nov, Dec → next year's season. Jan-Apr → current year's season.
    return month >= 11 ? year + 1 : year;
  }

  // NFL & NCAAF: season starts in Aug/Sep, playoffs in Jan/Feb
  // Aug-Dec → current year. Jan-Feb → previous year.
  return month <= 2 ? year - 1 : year;
}

/** Insert a completed game into the appropriate sport table.
 *  Returns true if inserted, false if duplicate or unsupported sport.
 *  Now accepts pre-game odds from UpcomingGame table and calculates results. */
async function insertCompletedGame(
  sport: Sport,
  homeTeamId: number,
  awayTeamId: number,
  homeScore: number,
  awayScore: number,
  gameDate: Date,
  homeRank: number | null = null,
  awayRank: number | null = null,
  spread: number | null = null,
  overUnder: number | null = null,
): Promise<boolean> {
  const season = getSeason(gameDate, sport);
  const week = getWeek(gameDate, sport, season);

  // Calculate derived fields
  const scoreDifference = homeScore - awayScore;
  const winnerId =
    scoreDifference > 0 ? homeTeamId : scoreDifference < 0 ? awayTeamId : null;

  // Calculate spread and O/U results if odds available
  const spreadResult = calculateSpreadResult(homeScore, awayScore, spread);
  const ouResult = calculateOUResult(homeScore, awayScore, overUnder);

  // Check for existing game first to avoid noisy unique-constraint errors
  const dupeWhere = { gameDate, homeTeamId, awayTeamId };

  switch (sport) {
    case "NFL": {
      const existing = await prisma.nFLGame.findFirst({ where: dupeWhere });
      if (existing) return false;
      await prisma.nFLGame.create({
        data: {
          season,
          week,
          dayOfWeek: gameDate.toLocaleDateString("en-US", { weekday: "long" }),
          gameDate,
          homeTeamId,
          awayTeamId,
          homeScore,
          awayScore,
          scoreDifference,
          winnerId,
          spread,
          overUnder,
          spreadResult,
          ouResult,
        },
      });
      return true;
    }

    case "NCAAF": {
      const existing = await prisma.nCAAFGame.findFirst({ where: dupeWhere });
      if (existing) return false;
      await prisma.nCAAFGame.create({
        data: {
          season,
          week,
          dayOfWeek: gameDate.toLocaleDateString("en-US", { weekday: "long" }),
          gameDate,
          homeTeamId,
          awayTeamId,
          homeScore,
          awayScore,
          scoreDifference,
          winnerId,
          homeRank,
          awayRank,
          spread,
          overUnder,
          spreadResult,
          ouResult,
        },
      });
      return true;
    }

    case "NCAAMB": {
      const existing = await prisma.nCAAMBGame.findFirst({ where: dupeWhere });
      if (existing) return false;
      await prisma.nCAAMBGame.create({
        data: {
          season,
          gameDate,
          homeTeamId,
          awayTeamId,
          homeScore,
          awayScore,
          scoreDifference,
          winnerId,
          homeRank,
          awayRank,
          spread,
          overUnder,
          spreadResult,
          ouResult,
        },
      });
      return true;
    }

    default:
      return false;
  }
}

// ─── Team Schedule Sync ─────────────────────────────────────────────────────

/**
 * ESPN team schedule endpoint — returns ALL games for a specific team + season.
 * Unlike the scoreboard (which returns ~10-40 featured games/day), this returns
 * a complete schedule including every D1 game.
 *
 * URL format:
 *   https://site.api.espn.com/apis/site/v2/sports/{league}/teams/{espnId}/schedule?season={year}
 */
const TEAM_SCHEDULE_URLS: Record<Sport, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams",
  NCAAMB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams",
};

interface ESPNTeamScheduleEvent {
  date: string;
  competitions: Array<{
    status: { type: { state: string } };
    competitors: Array<{
      homeAway: "home" | "away";
      score?: { value?: number; displayValue?: string };
      team: { id: string; displayName: string; shortDisplayName: string; abbreviation: string };
      curatedRank?: { current?: number };
    }>;
  }>;
}

interface ESPNTeamScheduleResponse {
  events?: ESPNTeamScheduleEvent[];
}

/**
 * Sync all completed games for a specific ESPN team ID + season.
 * Uses the team schedule endpoint for complete coverage.
 */
export async function syncTeamSeason(
  sport: Sport,
  espnTeamId: string,
  season: number,
): Promise<SyncResult> {
  const url = `${TEAM_SCHEDULE_URLS[sport]}/${espnTeamId}/schedule?season=${season}`;

  let data: ESPNTeamScheduleResponse;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "TrendLine/1.0" },
      });
      if (!res.ok) throw new Error(`ESPN API ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error(`[ESPN] Team schedule fetch failed for ${espnTeamId}:`, err);
    return { sport, fetched: 0, inserted: 0, skipped: 0 };
  }

  const events = data.events ?? [];
  const completed = events.filter(
    (e) => e.competitions?.[0]?.status?.type?.state === "post",
  );

  if (completed.length === 0) {
    return { sport, fetched: events.length, inserted: 0, skipped: 0 };
  }

  const teamIdMap = await getTeamIdMap();
  let inserted = 0;
  let skipped = 0;

  for (const event of completed) {
    const comp = event.competitions[0];
    const homeComp = comp.competitors.find((c) => c.homeAway === "home");
    const awayComp = comp.competitors.find((c) => c.homeAway === "away");
    if (!homeComp || !awayComp) { skipped++; continue; }

    const homeScore = homeComp.score?.value ?? null;
    const awayScore = awayComp.score?.value ?? null;
    if (homeScore == null || awayScore == null) { skipped++; continue; }

    const homeESPN = {
      espnId: homeComp.team.id,
      displayName: homeComp.team.displayName,
      shortName: homeComp.team.shortDisplayName,
      abbreviation: homeComp.team.abbreviation,
      score: homeScore,
      rank: (homeComp.curatedRank?.current ?? 99) < 99
        ? homeComp.curatedRank!.current!
        : null,
    };
    const awayESPN = {
      espnId: awayComp.team.id,
      displayName: awayComp.team.displayName,
      shortName: awayComp.team.shortDisplayName,
      abbreviation: awayComp.team.abbreviation,
      score: awayScore,
      rank: (awayComp.curatedRank?.current ?? 99) < 99
        ? awayComp.curatedRank!.current!
        : null,
    };

    const homeId = await resolveTeamId(homeESPN, sport, teamIdMap);
    const awayId = await resolveTeamId(awayESPN, sport, teamIdMap);
    if (!homeId || !awayId) { skipped++; continue; }

    const gameDate = new Date(event.date);

    try {
      const success = await insertCompletedGame(
        sport, homeId, awayId,
        homeScore, awayScore, gameDate,
        homeESPN.rank, awayESPN.rank,
      );
      if (success) inserted++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  console.log(
    `[ESPN Sync] Team ${espnTeamId} season ${season}: completed=${completed.length}, inserted=${inserted}, skipped=${skipped}`,
  );

  return { sport, fetched: events.length, inserted, skipped };
}
