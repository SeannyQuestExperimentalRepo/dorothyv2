import "server-only";
import { prisma } from "./db";
import type { Sport } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EloConfig {
  kFactor: number;
  homefieldAdvantage: number;
  seasonRegression: number;
  initialElo: number;
  movMultiplier: boolean;
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;
  confidence: number;
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
}

// ─── Sport Configs ──────────────────────────────────────────────────────────

const SPORT_CONFIGS: Record<string, EloConfig> = {
  NFL:    { kFactor: 20, homefieldAdvantage: 48, seasonRegression: 0.33, initialElo: 1500, movMultiplier: true },
  NBA:    { kFactor: 20, homefieldAdvantage: 100, seasonRegression: 0.25, initialElo: 1500, movMultiplier: true },
  NCAAMB: { kFactor: 32, homefieldAdvantage: 100, seasonRegression: 0.50, initialElo: 1500, movMultiplier: true },
  NCAAF:  { kFactor: 25, homefieldAdvantage: 55, seasonRegression: 0.50, initialElo: 1500, movMultiplier: true },
};

// ─── Core Elo Math ──────────────────────────────────────────────────────────

/** MOV multiplier (FiveThirtyEight formula) */
function movMultiplier(mov: number, eloDiff: number): number {
  return Math.log(Math.abs(mov) + 1) * 2.2 / ((eloDiff * 0.001) + 2.2);
}

/** Expected win probability given rating difference */
export function expectedWinProb(ratingDiff: number): number {
  return 1 / (1 + Math.pow(10, -ratingDiff / 400));
}

/** Convert Elo difference to predicted spread (points) */
export function eloToSpread(eloDiff: number, _sport: string): number {
  return eloDiff / 25;
}

// ─── Game Fetchers ──────────────────────────────────────────────────────────

interface CompletedGame {
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  gameDate: Date;
  season: number;
  isNeutralSite: boolean;
}

async function fetchCompletedGames(sport: string): Promise<CompletedGame[]> {
  const where = { homeScore: { not: null }, awayScore: { not: null } };
  const orderBy = { gameDate: "asc" as const };
  const select = {
    homeTeamId: true,
    awayTeamId: true,
    homeScore: true,
    awayScore: true,
    gameDate: true,
    season: true,
    isNeutralSite: true,
  };

  let raw: any[];
  switch (sport) {
    case "NFL":
      raw = await prisma.nFLGame.findMany({ where, orderBy, select });
      break;
    case "NBA":
      raw = await prisma.nBAGame.findMany({ where, orderBy, select });
      break;
    case "NCAAMB":
      raw = await prisma.nCAAMBGame.findMany({ where, orderBy, select });
      break;
    case "NCAAF":
      raw = await prisma.nCAAFGame.findMany({ where, orderBy, select });
      break;
    default:
      throw new Error(`Unknown sport: ${sport}`);
  }

  return raw.map((g: any) => ({
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homeScore: g.homeScore!,
    awayScore: g.awayScore!,
    gameDate: g.gameDate,
    season: g.season,
    isNeutralSite: g.isNeutralSite ?? false,
  }));
}

// ─── Recalculate Elo ────────────────────────────────────────────────────────

/**
 * Full Elo rebuild for a sport. Processes all completed games chronologically,
 * applies season regression at boundaries, and stores daily ratings.
 */
export async function recalculateElo(sport: string): Promise<void> {
  const config = SPORT_CONFIGS[sport];
  if (!config) throw new Error(`No Elo config for sport: ${sport}`);

  const games = await fetchCompletedGames(sport);
  if (games.length === 0) {
    console.log(`[elo] No completed games for ${sport}`);
    return;
  }

  // Clear existing ratings for this sport
  await prisma.eloRating.deleteMany({ where: { sport: sport as Sport } });

  const ratings = new Map<number, number>(); // teamId -> current elo
  let lastSeason: number | null = null;

  // Batch inserts
  const toInsert: { teamId: number; sport: Sport; date: Date; elo: number }[] = [];

  for (const game of games) {
    // Season regression
    if (lastSeason !== null && game.season !== lastSeason) {
      ratings.forEach((elo, teamId) => {
        const regressed = config.initialElo + (elo - config.initialElo) * (1 - config.seasonRegression);
        ratings.set(teamId, regressed);
      });
    }
    lastSeason = game.season;

    // Initialize new teams
    if (!ratings.has(game.homeTeamId)) ratings.set(game.homeTeamId, config.initialElo);
    if (!ratings.has(game.awayTeamId)) ratings.set(game.awayTeamId, config.initialElo);

    const homeElo = ratings.get(game.homeTeamId)!;
    const awayElo = ratings.get(game.awayTeamId)!;

    // HFA: only if not neutral site
    const hfa = game.isNeutralSite ? 0 : config.homefieldAdvantage;
    const eloDiff = homeElo + hfa - awayElo;

    const expectedHome = expectedWinProb(eloDiff);
    const actualHome = game.homeScore > game.awayScore ? 1 : game.homeScore < game.awayScore ? 0 : 0.5;

    let k = config.kFactor;
    if (config.movMultiplier) {
      const mov = game.homeScore - game.awayScore;
      const winnerEloDiff = actualHome === 1 ? eloDiff : -eloDiff;
      k *= movMultiplier(mov, winnerEloDiff);
    }

    const delta = k * (actualHome - expectedHome);
    const newHomeElo = homeElo + delta;
    const newAwayElo = awayElo - delta;

    ratings.set(game.homeTeamId, newHomeElo);
    ratings.set(game.awayTeamId, newAwayElo);

    // Store snapshot for game date
    const dateOnly = new Date(game.gameDate);
    dateOnly.setUTCHours(0, 0, 0, 0);

    toInsert.push(
      { teamId: game.homeTeamId, sport: sport as Sport, date: dateOnly, elo: newHomeElo },
      { teamId: game.awayTeamId, sport: sport as Sport, date: dateOnly, elo: newAwayElo },
    );
  }

  // Batch upsert (use createMany with skipDuplicates, then update conflicts)
  // Since we cleared the table, createMany is fine
  const BATCH_SIZE = 500;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    // Use upsert-style: for same team+sport+date, keep last value
    for (const row of batch) {
      await prisma.eloRating.upsert({
        where: {
          teamId_sport_date: { teamId: row.teamId, sport: row.sport, date: row.date },
        },
        create: row,
        update: { elo: row.elo },
      });
    }
  }

  console.log(`[elo] Rebuilt ${sport}: ${toInsert.length} ratings from ${games.length} games, ${ratings.size} teams`);
}

// ─── Current Elo Lookup ─────────────────────────────────────────────────────

/**
 * Get the most recent Elo rating for every team in a sport.
 * Returns Map<teamName, elo>.
 */
export async function getCurrentElo(sport: string): Promise<Map<string, number>> {
  // Get the latest date for this sport
  const latest = await prisma.eloRating.findFirst({
    where: { sport: sport as Sport },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  if (!latest) return new Map();

  const ratings = await prisma.eloRating.findMany({
    where: { sport: sport as Sport, date: latest.date },
    include: { team: { select: { name: true } } },
  });

  const result = new Map<string, number>();
  for (const r of ratings) {
    result.set(r.team.name, r.elo);
  }
  return result;
}

// ─── Signal: Elo Edge ───────────────────────────────────────────────────────

/**
 * Compare Elo-predicted spread vs actual spread to find market edge.
 * Returns a SignalResult compatible with the pick engine.
 */
export function signalEloEdge(
  homeElo: number,
  awayElo: number,
  spread: number | null,
  sport: string,
): SignalResult {
  const neutral: SignalResult = {
    category: "eloEdge",
    direction: "neutral",
    magnitude: 0,
    confidence: 0,
    label: "No Elo edge",
    strength: "noise",
  };

  if (spread === null) return neutral;

  const config = SPORT_CONFIGS[sport];
  if (!config) return neutral;

  const hfa = config.homefieldAdvantage;
  const eloDiff = homeElo + hfa - awayElo;
  const predictedSpread = eloToSpread(eloDiff, sport);

  // Edge = predicted margin + spread (spread is negative when home favored)
  const edge = predictedSpread + spread;
  const absEdge = Math.abs(edge);

  if (absEdge < 1.5) return neutral;

  const direction: "home" | "away" = edge > 0 ? "home" : "away";
  const magnitude = Math.min(absEdge / 0.8, 10);
  const confidence = Math.min(0.5 + absEdge * 0.04, 0.85);

  return {
    category: "eloEdge",
    direction,
    magnitude,
    confidence,
    label: `Elo: ${homeElo.toFixed(0)} vs ${awayElo.toFixed(0)}, pred spread ${predictedSpread > 0 ? "+" : ""}${predictedSpread.toFixed(1)}, line ${spread > 0 ? "+" : ""}${spread}, edge ${edge > 0 ? "+" : ""}${edge.toFixed(1)}`,
    strength: magnitude >= 7 ? "strong" : magnitude >= 4 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}
