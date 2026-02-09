/**
 * Daily Game Context Engine
 *
 * For a given game date, generates contextual trend cards for each matchup.
 * Combines historical matchup data, situational trends, and key statistical
 * angles into a comprehensive preview.
 *
 * Each game context includes:
 * - Basic matchup info (teams, records, spread)
 * - Historical head-to-head record
 * - Relevant situational trends for each team
 * - Key angle discoveries (from reverse lookup)
 * - Significance assessment
 */

import {
  loadAllGames,
  executeTrendQuery,
  type TrendGame,
  type TrendQuery,
} from "./trend-engine";
import {
  analyzeTrendSignificance,
  type TrendSignificance,
} from "./trend-stats";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GameContext {
  /** Game identification */
  gameDate: string;
  sport: "NFL" | "NCAAF" | "NCAAMB";
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  spread: number | null;
  overUnder: number | null;
  week: string | null;

  /** Home team historical trends */
  homeTrends: TeamGameTrends;
  /** Away team historical trends */
  awayTrends: TeamGameTrends;

  /** Head-to-head matchup history */
  headToHead: HeadToHeadRecord;

  /** Situational angles (from reverse lookup-style analysis) */
  situationalAngles: SituationalAngle[];

  /** Quick summary insight */
  insight: string;
}

export interface TeamGameTrends {
  team: string;
  /** Overall record this season */
  seasonRecord: { wins: number; losses: number; winPct: number };
  /** ATS record this season */
  seasonAts: { covered: number; lost: number; push: number; atsPct: number; atsRecord: string };
  /** Last 5 games record */
  last5: { wins: number; losses: number; atsCovered: number; atsLost: number };
  /** Home/Away specific record this season */
  venueRecord: { wins: number; losses: number; winPct: number; label: string };
  /** As favorite or underdog this season (if spread available) */
  spreadRole: {
    asFavorite: { wins: number; losses: number; atsCovered: number; atsLost: number } | null;
    asUnderdog: { wins: number; losses: number; atsCovered: number; atsLost: number } | null;
  };
}

export interface HeadToHeadRecord {
  /** Total games in the matchup history */
  totalGames: number;
  /** Home team wins in h2h */
  homeTeamWins: number;
  /** Away team wins in h2h */
  awayTeamWins: number;
  /** ATS record in h2h (home team perspective) */
  homeAtsRecord: string;
  /** Average total points in h2h */
  avgTotalPoints: number;
  /** O/U trend in h2h */
  overPct: number;
  /** Last meeting info */
  lastMeeting: {
    date: string;
    homeScore: number;
    awayScore: number;
    homeTeam: string;
    awayTeam: string;
  } | null;
  /** Significance of h2h trends */
  significance: TrendSignificance | null;
}

export interface SituationalAngle {
  /** Description of the angle */
  description: string;
  /** Which team this favors */
  favors: "home" | "away" | "over" | "under" | "neutral";
  /** The record for this angle */
  record: string;
  /** Hit rate percentage */
  rate: number;
  /** Sample size */
  sampleSize: number;
  /** Significance */
  significance: TrendSignificance;
}

export interface DailyContextResult {
  /** The date for these previews */
  date: string;
  /** Game context cards */
  games: GameContext[];
  /** Computation info */
  computedAt: string;
  durationMs: number;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────────

/**
 * Get game context for all games on a specific date.
 */
export function getDailyGameContext(
  date: string,
  sport?: "NFL" | "NCAAF" | "NCAAMB",
): DailyContextResult {
  const start = performance.now();
  const allGames = loadAllGames();

  // Find games on this date
  let gamesOnDate = allGames.filter((g) => g.gameDate === date);
  if (sport) {
    gamesOnDate = gamesOnDate.filter((g) => g.sport === sport);
  }

  const contexts: GameContext[] = [];

  for (const game of gamesOnDate) {
    const ctx = buildGameContext(game, allGames);
    contexts.push(ctx);
  }

  // Sort: games with spread data first, then by time/order
  contexts.sort((a, b) => {
    if (a.spread !== null && b.spread === null) return -1;
    if (a.spread === null && b.spread !== null) return 1;
    return 0;
  });

  return {
    date,
    games: contexts,
    computedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
  };
}

/**
 * Get game context for a specific matchup (by teams and season).
 */
export function getMatchupContext(
  sport: "NFL" | "NCAAF" | "NCAAMB",
  homeTeam: string,
  awayTeam: string,
  season?: number,
): GameContext | null {
  const allGames = loadAllGames();

  // Find the most recent game for this matchup
  const matchingGames = allGames
    .filter(
      (g) =>
        g.sport === sport &&
        ((g.homeTeam === homeTeam && g.awayTeam === awayTeam) ||
          (g.homeTeam === awayTeam && g.awayTeam === homeTeam)),
    )
    .sort((a, b) => (b.gameDate || "").localeCompare(a.gameDate || ""));

  if (matchingGames.length === 0) return null;

  // Use the most recent game or specific season
  let targetGame = matchingGames[0];
  if (season) {
    const seasonGame = matchingGames.find((g) => g.season === season);
    if (seasonGame) targetGame = seasonGame;
  }

  return buildGameContext(targetGame, allGames);
}

// ─── Build Context for a Single Game ────────────────────────────────────────────

function buildGameContext(
  game: TrendGame,
  allGames: TrendGame[],
): GameContext {
  const sport = game.sport as "NFL" | "NCAAF" | "NCAAMB";
  const season = game.season;

  // Get team trends
  const homeTrends = buildTeamTrends(sport, game.homeTeam || "", season, "home", allGames);
  const awayTrends = buildTeamTrends(sport, game.awayTeam || "", season, "away", allGames);

  // Head-to-head
  const h2h = buildHeadToHead(sport, game.homeTeam || "", game.awayTeam || "", allGames);

  // Situational angles
  const angles = buildSituationalAngles(game);

  // Generate insight
  const insight = generateInsight(game, homeTrends, awayTrends, h2h, angles);

  return {
    gameDate: game.gameDate || "",
    sport,
    homeTeam: game.homeTeam || "",
    awayTeam: game.awayTeam || "",
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    spread: game.spread,
    overUnder: game.overUnder,
    week: game.week,
    homeTrends,
    awayTrends,
    headToHead: h2h,
    situationalAngles: angles,
    insight,
  };
}

function buildTeamTrends(
  sport: string,
  team: string,
  season: number,
  role: "home" | "away",
  allGames: TrendGame[],
): TeamGameTrends {
  // Get all games for this team this season (before current game date)
  const teamGames = allGames.filter(
    (g) =>
      g.sport === sport &&
      g.season === season &&
      (g.homeTeam === team || g.awayTeam === team),
  );

  let wins = 0, losses = 0;
  let atsCovered = 0, atsLost = 0, atsPush = 0;
  let venueWins = 0, venueLosses = 0;

  let favWins = 0, favLosses = 0, favAtsCov = 0, favAtsLost = 0;
  let dogWins = 0, dogLosses = 0, dogAtsCov = 0, dogAtsLost = 0;
  let hasFav = false, hasDog = false;

  for (const g of teamGames) {
    const isHome = g.homeTeam === team;
    const won = isHome ? g.scoreDifference > 0 : g.scoreDifference < 0;

    if (won) wins++;
    else if (g.scoreDifference !== 0) losses++;

    // ATS (from team perspective)
    if (isHome) {
      if (g.spreadResult === "COVERED") atsCovered++;
      else if (g.spreadResult === "LOST") atsLost++;
      else if (g.spreadResult === "PUSH") atsPush++;
    } else {
      // Away: ATS is flipped
      if (g.spreadResult === "COVERED") atsLost++;
      else if (g.spreadResult === "LOST") atsCovered++;
      else if (g.spreadResult === "PUSH") atsPush++;
    }

    // Venue record
    if ((role === "home" && isHome) || (role === "away" && !isHome)) {
      if (won) venueWins++;
      else if (g.scoreDifference !== 0) venueLosses++;
    }

    // Favorite/underdog
    if (g.spread !== null) {
      const teamFav = isHome ? g.spread < 0 : g.spread > 0;
      if (teamFav) {
        hasFav = true;
        if (won) favWins++;
        else favLosses++;
        if (isHome && g.spreadResult === "COVERED") favAtsCov++;
        else if (isHome && g.spreadResult === "LOST") favAtsLost++;
        else if (!isHome && g.spreadResult === "LOST") favAtsCov++;
        else if (!isHome && g.spreadResult === "COVERED") favAtsLost++;
      } else {
        hasDog = true;
        if (won) dogWins++;
        else dogLosses++;
        if (isHome && g.spreadResult === "COVERED") dogAtsCov++;
        else if (isHome && g.spreadResult === "LOST") dogAtsLost++;
        else if (!isHome && g.spreadResult === "LOST") dogAtsCov++;
        else if (!isHome && g.spreadResult === "COVERED") dogAtsLost++;
      }
    }
  }

  const totalAts = atsCovered + atsLost;
  const atsPct = totalAts > 0 ? Math.round((atsCovered / totalAts) * 1000) / 10 : 0;

  // Last 5 games
  const recentGames = teamGames.slice(-5);
  let l5Wins = 0, l5Losses = 0, l5AtsCov = 0, l5AtsLost = 0;
  for (const g of recentGames) {
    const isHome = g.homeTeam === team;
    const won = isHome ? g.scoreDifference > 0 : g.scoreDifference < 0;
    if (won) l5Wins++;
    else if (g.scoreDifference !== 0) l5Losses++;

    if (isHome) {
      if (g.spreadResult === "COVERED") l5AtsCov++;
      else if (g.spreadResult === "LOST") l5AtsLost++;
    } else {
      if (g.spreadResult === "COVERED") l5AtsLost++;
      else if (g.spreadResult === "LOST") l5AtsCov++;
    }
  }

  return {
    team,
    seasonRecord: {
      wins,
      losses,
      winPct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
    },
    seasonAts: {
      covered: atsCovered,
      lost: atsLost,
      push: atsPush,
      atsPct,
      atsRecord: `${atsCovered}-${atsLost}${atsPush > 0 ? `-${atsPush}` : ""}`,
    },
    last5: {
      wins: l5Wins,
      losses: l5Losses,
      atsCovered: l5AtsCov,
      atsLost: l5AtsLost,
    },
    venueRecord: {
      wins: venueWins,
      losses: venueLosses,
      winPct: venueWins + venueLosses > 0
        ? Math.round((venueWins / (venueWins + venueLosses)) * 1000) / 10
        : 0,
      label: role === "home" ? "At Home" : "On Road",
    },
    spreadRole: {
      asFavorite: hasFav ? { wins: favWins, losses: favLosses, atsCovered: favAtsCov, atsLost: favAtsLost } : null,
      asUnderdog: hasDog ? { wins: dogWins, losses: dogLosses, atsCovered: dogAtsCov, atsLost: dogAtsLost } : null,
    },
  };
}

function buildHeadToHead(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  allGames: TrendGame[],
): HeadToHeadRecord {
  // Find all matchups between these two teams (any venue)
  const matchups = allGames.filter(
    (g) =>
      g.sport === sport &&
      ((g.homeTeam === homeTeam && g.awayTeam === awayTeam) ||
        (g.homeTeam === awayTeam && g.awayTeam === homeTeam)),
  );

  if (matchups.length === 0) {
    return {
      totalGames: 0,
      homeTeamWins: 0,
      awayTeamWins: 0,
      homeAtsRecord: "0-0",
      avgTotalPoints: 0,
      overPct: 0,
      lastMeeting: null,
      significance: null,
    };
  }

  let homeTeamWins = 0;
  let awayTeamWins = 0;
  let homeAtsCov = 0;
  let homeAtsLost = 0;
  let totalPts = 0;
  let overs = 0;
  let unders = 0;

  for (const g of matchups) {
    const pts = (g.homeScore || 0) + (g.awayScore || 0);
    totalPts += pts;

    if (g.homeTeam === homeTeam) {
      if (g.scoreDifference > 0) homeTeamWins++;
      else if (g.scoreDifference < 0) awayTeamWins++;
      if (g.spreadResult === "COVERED") homeAtsCov++;
      else if (g.spreadResult === "LOST") homeAtsLost++;
    } else {
      // Swapped — this game has awayTeam as home
      if (g.scoreDifference < 0) homeTeamWins++;
      else if (g.scoreDifference > 0) awayTeamWins++;
      if (g.spreadResult === "COVERED") homeAtsLost++;
      else if (g.spreadResult === "LOST") homeAtsCov++;
    }

    if (g.ouResult === "OVER") overs++;
    else if (g.ouResult === "UNDER") unders++;
  }

  const ouTotal = overs + unders;

  // Last meeting
  const sorted = [...matchups].sort((a, b) =>
    (b.gameDate || "").localeCompare(a.gameDate || ""),
  );
  const last = sorted[0];

  // Significance of h2h win rate
  const h2hSig = matchups.length >= 10
    ? analyzeTrendSignificance(homeTeamWins, homeTeamWins + awayTeamWins, 0.5)
    : null;

  return {
    totalGames: matchups.length,
    homeTeamWins,
    awayTeamWins,
    homeAtsRecord: `${homeAtsCov}-${homeAtsLost}`,
    avgTotalPoints: Math.round((totalPts / matchups.length) * 10) / 10,
    overPct: ouTotal > 0 ? Math.round((overs / ouTotal) * 1000) / 10 : 0,
    lastMeeting: last
      ? {
          date: last.gameDate || "",
          homeScore: last.homeScore || 0,
          awayScore: last.awayScore || 0,
          homeTeam: last.homeTeam || "",
          awayTeam: last.awayTeam || "",
        }
      : null,
    significance: h2hSig,
  };
}

function buildSituationalAngles(
  game: TrendGame,
): SituationalAngle[] {
  const angles: SituationalAngle[] = [];
  const sport = game.sport as "NFL" | "NCAAF" | "NCAAMB";
  const season = game.season;

  // Angle 1: Home team's home record vs the spread
  if (game.homeTeam) {
    try {
      const homeAtsResult = executeTrendQuery({
        sport,
        team: game.homeTeam,
        perspective: "team",
        seasonRange: [season - 2, season],
        filters: [{ field: "isHome", operator: "eq", value: true }],
      } as TrendQuery);

      if (homeAtsResult.summary.totalGames >= 10) {
        const atsTotal = homeAtsResult.summary.atsCovered + homeAtsResult.summary.atsLost;
        if (atsTotal >= 5) {
          const sig = analyzeTrendSignificance(
            homeAtsResult.summary.atsCovered,
            atsTotal,
            0.5,
          );
          if (sig.strength !== "noise") {
            angles.push({
              description: `${game.homeTeam} at home ATS (last 3 seasons)`,
              favors: sig.observedRate > 0.5 ? "home" : "away",
              record: homeAtsResult.summary.atsRecord,
              rate: homeAtsResult.summary.atsPct,
              sampleSize: atsTotal,
              significance: sig,
            });
          }
        }
      }
    } catch {
      // Skip on error
    }
  }

  // Angle 2: Away team's road record vs the spread
  if (game.awayTeam) {
    try {
      const awayAtsResult = executeTrendQuery({
        sport,
        team: game.awayTeam,
        perspective: "team",
        seasonRange: [season - 2, season],
        filters: [{ field: "isHome", operator: "eq", value: false }],
      } as TrendQuery);

      if (awayAtsResult.summary.totalGames >= 10) {
        const atsTotal = awayAtsResult.summary.atsCovered + awayAtsResult.summary.atsLost;
        if (atsTotal >= 5) {
          const sig = analyzeTrendSignificance(
            awayAtsResult.summary.atsCovered,
            atsTotal,
            0.5,
          );
          if (sig.strength !== "noise") {
            angles.push({
              description: `${game.awayTeam} on the road ATS (last 3 seasons)`,
              favors: sig.observedRate > 0.5 ? "away" : "home",
              record: awayAtsResult.summary.atsRecord,
              rate: awayAtsResult.summary.atsPct,
              sampleSize: atsTotal,
              significance: sig,
            });
          }
        }
      }
    } catch {
      // Skip on error
    }
  }

  // Angle 3: O/U trend for this matchup
  if (game.overUnder !== null && game.homeTeam && game.awayTeam) {
    try {
      const ouResult = executeTrendQuery({
        sport,
        team: game.homeTeam,
        perspective: "team",
        seasonRange: [season - 2, season],
        filters: [],
      } as TrendQuery);

      const ouTotal = ouResult.summary.overs + ouResult.summary.unders;
      if (ouTotal >= 10) {
        const ouSig = analyzeTrendSignificance(
          ouResult.summary.overs,
          ouTotal,
          0.5,
        );
        if (ouSig.strength !== "noise") {
          angles.push({
            description: `${game.homeTeam} games O/U trend (last 3 seasons)`,
            favors: ouSig.observedRate > 0.5 ? "over" : "under",
            record: ouResult.summary.ouRecord,
            rate: ouResult.summary.overPct,
            sampleSize: ouTotal,
            significance: ouSig,
          });
        }
      }
    } catch {
      // Skip
    }
  }

  // Sort by significance strength
  const strengthOrder: Record<string, number> = { strong: 0, moderate: 1, weak: 2, noise: 3 };
  angles.sort(
    (a, b) =>
      (strengthOrder[a.significance.strength] ?? 3) -
      (strengthOrder[b.significance.strength] ?? 3),
  );

  return angles.slice(0, 5);
}

function generateInsight(
  game: TrendGame,
  homeTrends: TeamGameTrends,
  awayTrends: TeamGameTrends,
  h2h: HeadToHeadRecord,
  angles: SituationalAngle[],
): string {
  const parts: string[] = [];

  // Season records
  if (homeTrends.seasonRecord.wins + homeTrends.seasonRecord.losses > 0) {
    parts.push(
      `${homeTrends.team} (${homeTrends.seasonRecord.wins}-${homeTrends.seasonRecord.losses}) hosts ${awayTrends.team} (${awayTrends.seasonRecord.wins}-${awayTrends.seasonRecord.losses})`,
    );
  }

  // Spread info
  if (game.spread !== null) {
    const favTeam = game.spread < 0 ? game.homeTeam : game.awayTeam;
    const spreadVal = Math.abs(game.spread);
    parts.push(`${favTeam} favored by ${spreadVal}`);
  }

  // H2H if notable
  if (h2h.totalGames >= 5) {
    const dominant = h2h.homeTeamWins > h2h.awayTeamWins
      ? game.homeTeam
      : game.awayTeam;
    parts.push(
      `H2H: ${h2h.homeTeamWins}-${h2h.awayTeamWins} (${dominant} leads)`,
    );
  }

  // Top angle
  if (angles.length > 0 && angles[0].significance.strength !== "noise") {
    parts.push(angles[0].description + `: ${angles[0].record}`);
  }

  return parts.join(". ") + ".";
}
