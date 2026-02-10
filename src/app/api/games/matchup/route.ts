/**
 * GET /api/games/matchup?sport=NFL&home=Kansas+City+Chiefs&away=Buffalo+Bills
 *
 * Returns upcoming game odds (from UpcomingGame table) combined with
 * historical matchup context (trends, H2H, situational angles) from
 * the game-context engine.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getMatchupContext,
  type GameContext,
} from "@/lib/game-context-engine";
import {
  loadGamesBySportCached,
  executeTrendQuery,
  type TrendQuery,
  type TrendGame,
} from "@/lib/trend-engine";
import { analyzeTrendSignificance } from "@/lib/trend-stats";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB"];

// ─── Team Name Canonicalization ────────────────────────────────────────────
// The URL may carry an ESPN display name (e.g., "NC State") from the
// UpcomingGame table, but the Game tables reference Team.name (e.g.,
// "N.C. State"). This map resolves common mismatches so stats still load.
const NAME_ALIASES: Record<string, string> = {
  "NC State": "N.C. State",
  "Chicago State": "Chicago St.",
  "Jackson State": "Jackson St.",
  "Indiana State": "Indiana St.",
  "Arkansas-Pine Bluff": "Arkansas Pine Bluff",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris",
  "Appalachian State": "Appalachian St.",
  "Bethune-Cookman": "Bethune Cookman",
  "Louisiana-Monroe": "Louisiana Monroe",
  "Ole Miss": "Mississippi",
  "UConn": "Connecticut",
  "Hawai'i": "Hawaii",
  // Add more as discovered — these come from "Unresolved team" logs
};

/**
 * Resolve a team name (which may be an ESPN display name or canonical) to
 * the canonical Team.name stored in the DB. Returns the original name if
 * no better match is found.
 */
async function resolveCanonicalName(
  name: string,
  sport: string,
): Promise<string> {
  // Fast path: exact match in Team table
  const exact = await prisma.team.findFirst({
    where: { sport: sport as "NFL" | "NCAAF" | "NCAAMB", name },
    select: { name: true },
  });
  if (exact) return exact.name;

  // Check static alias map
  if (NAME_ALIASES[name]) {
    return NAME_ALIASES[name];
  }

  // Try common transformations
  const variants = [
    name.replace(/ State$/, " St."),
    name.replace(/-/g, " "),
    name.replace(/ State$/, " St.").replace(/-/g, " "),
  ];
  for (const v of variants) {
    const match = await prisma.team.findFirst({
      where: { sport: sport as "NFL" | "NCAAF" | "NCAAMB", name: v },
      select: { name: true },
    });
    if (match) return match.name;
  }

  // Fallback: return original (will just get empty stats)
  return name;
}

interface TeamRecentGame {
  gameDate: string;
  opponent: string;
  isHome: boolean;
  score: string;
  result: "W" | "L" | "T";
  spread: number | null;
  spreadResult: string | null;
  ouResult: string | null;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const start = performance.now();
  const { searchParams } = new URL(request.url);

  const sport = searchParams.get("sport")?.toUpperCase();
  const homeTeam = searchParams.get("home");
  const awayTeam = searchParams.get("away");

  if (!sport || !homeTeam || !awayTeam) {
    return errorResponse("sport, home, and away params are required", 400);
  }

  if (!VALID_SPORTS.includes(sport)) {
    return errorResponse("sport must be NFL, NCAAF, or NCAAMB", 400);
  }

  try {
    // 0. Resolve team names + load upcoming game + load sport games in parallel.
    // These are all independent DB operations — run concurrently.
    const sportEnum = sport as "NFL" | "NCAAF" | "NCAAMB";
    const [canonHome, canonAway, upcomingByOriginal, sportGames] = await Promise.all([
      resolveCanonicalName(homeTeam, sport),
      resolveCanonicalName(awayTeam, sport),
      prisma.upcomingGame.findFirst({
        where: {
          sport: sportEnum,
          homeTeam,
          awayTeam,
          gameDate: { gte: new Date() },
        },
        orderBy: { gameDate: "asc" },
      }),
      // Load only this sport's games (not all 150K across 3 sports)
      loadGamesBySportCached(sportEnum),
    ]);

    // If upcoming game not found with original names, try canonical names
    let upcomingGame = upcomingByOriginal;
    if (!upcomingGame && (canonHome !== homeTeam || canonAway !== awayTeam)) {
      upcomingGame = await prisma.upcomingGame.findFirst({
        where: {
          sport: sportEnum,
          homeTeam: canonHome,
          awayTeam: canonAway,
          gameDate: { gte: new Date() },
        },
        orderBy: { gameDate: "asc" },
      });
    }

    // 3. Build team trends for current season
    const now = new Date();
    const currentYear = now.getFullYear();
    // Determine current season based on sport
    let currentSeason: number;
    if (sport === "NCAAMB") {
      // NCAAMB season: Nov-Mar spans two calendar years, season = end year
      currentSeason = now.getMonth() >= 10 ? currentYear + 1 : currentYear;
    } else {
      // NFL/NCAAF: Aug-Feb, season = start year
      currentSeason = now.getMonth() <= 2 ? currentYear - 1 : currentYear;
    }

    // 4. Get historical context (uses existing engine)
    // Use canonical names for all game-data queries
    let matchupContext: GameContext | null = null;
    try {
      matchupContext = await getMatchupContext(
        sport as "NFL" | "NCAAF" | "NCAAMB",
        canonHome,
        canonAway,
        currentSeason,
      );
    } catch {
      // May fail if no historical matchup exists - that's OK
    }

    // 5. Build recent games for each team (last 10)
    const homeRecent = getRecentGames(sportGames, canonHome, 10);
    const awayRecent = getRecentGames(sportGames, canonAway, 10);

    // 6. Build team season stats
    const homeSeasonStats = buildSeasonStats(sportGames, canonHome, currentSeason);
    const awaySeasonStats = buildSeasonStats(sportGames, canonAway, currentSeason);

    // 7. Build additional trend queries
    const additionalTrends = await buildAdditionalTrends(
      sport as "NFL" | "NCAAF" | "NCAAMB",
      canonHome,
      canonAway,
      currentSeason,
      sportGames,
    );

    const durationMs = Math.round(performance.now() - start);

    const response = NextResponse.json({
      success: true,
      data: {
        // Upcoming game info (live odds)
        upcoming: upcomingGame
          ? {
              gameDate: upcomingGame.gameDate.toISOString(),
              spread: upcomingGame.spread,
              overUnder: upcomingGame.overUnder,
              moneylineHome: upcomingGame.moneylineHome,
              moneylineAway: upcomingGame.moneylineAway,
            }
          : null,

        // Matchup context from game context engine
        context: matchupContext,

        // Recent games for each team
        homeRecent,
        awayRecent,

        // Season stats
        homeSeasonStats,
        awaySeasonStats,

        // Additional trend insights
        additionalTrends,
      },
      meta: {
        sport,
        homeTeam: canonHome,
        awayTeam: canonAway,
        durationMs,
      },
    });

    // Cache at CDN for 5 min, serve stale for 10 min while revalidating
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (err) {
    console.error("[GET /api/games/matchup] Error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
    );
  }
}

function getRecentGames(
  allGames: TrendGame[],
  team: string,
  limit: number,
): TeamRecentGame[] {
  const teamGames = allGames
    .filter((g) => g.homeTeam === team || g.awayTeam === team)
    .sort((a, b) => (b.gameDate || "").localeCompare(a.gameDate || ""))
    .slice(0, limit);

  return teamGames.map((g) => {
    const isHome = g.homeTeam === team;
    const opponent = isHome ? g.awayTeam || "" : g.homeTeam || "";
    const won = isHome ? g.scoreDifference > 0 : g.scoreDifference < 0;
    const tied = g.scoreDifference === 0;

    return {
      gameDate: g.gameDate || "",
      opponent,
      isHome,
      score: isHome
        ? `${g.homeScore ?? 0}-${g.awayScore ?? 0}`
        : `${g.awayScore ?? 0}-${g.homeScore ?? 0}`,
      result: tied ? "T" as const : won ? "W" as const : "L" as const,
      spread: g.spread,
      spreadResult: isHome
        ? g.spreadResult
        : g.spreadResult === "COVERED"
          ? "LOST"
          : g.spreadResult === "LOST"
            ? "COVERED"
            : g.spreadResult,
      ouResult: g.ouResult,
    };
  });
}

interface SeasonStats {
  season: number;
  record: string;
  wins: number;
  losses: number;
  winPct: number;
  atsRecord: string;
  atsCovered: number;
  atsLost: number;
  atsPct: number;
  ouRecord: string;
  overs: number;
  unders: number;
  overPct: number;
  avgPointsFor: number;
  avgPointsAgainst: number;
  avgMargin: number;
  homeRecord: string;
  awayRecord: string;
}

function buildSeasonStats(
  allGames: TrendGame[],
  team: string,
  season: number,
): SeasonStats {
  const teamGames = allGames.filter(
    (g) => g.season === season && (g.homeTeam === team || g.awayTeam === team),
  );

  let wins = 0, losses = 0;
  let atsCov = 0, atsLost = 0;
  let overs = 0, unders = 0;
  let homeW = 0, homeL = 0, awayW = 0, awayL = 0;
  let totalPF = 0, totalPA = 0;

  for (const g of teamGames) {
    const isHome = g.homeTeam === team;
    const won = isHome ? g.scoreDifference > 0 : g.scoreDifference < 0;
    const pf = isHome ? (g.homeScore ?? 0) : (g.awayScore ?? 0);
    const pa = isHome ? (g.awayScore ?? 0) : (g.homeScore ?? 0);

    totalPF += pf;
    totalPA += pa;

    if (won) {
      wins++;
      if (isHome) homeW++;
      else awayW++;
    } else if (g.scoreDifference !== 0) {
      losses++;
      if (isHome) homeL++;
      else awayL++;
    }

    // ATS from team perspective
    if (isHome) {
      if (g.spreadResult === "COVERED") atsCov++;
      else if (g.spreadResult === "LOST") atsLost++;
    } else {
      if (g.spreadResult === "COVERED") atsLost++;
      else if (g.spreadResult === "LOST") atsCov++;
    }

    if (g.ouResult === "OVER") overs++;
    else if (g.ouResult === "UNDER") unders++;
  }

  const total = teamGames.length || 1;
  const atsTotal = atsCov + atsLost;
  const ouTotal = overs + unders;

  return {
    season,
    record: `${wins}-${losses}`,
    wins,
    losses,
    winPct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
    atsRecord: `${atsCov}-${atsLost}`,
    atsCovered: atsCov,
    atsLost,
    atsPct: atsTotal > 0 ? Math.round((atsCov / atsTotal) * 1000) / 10 : 0,
    ouRecord: `${overs}-${unders}`,
    overs,
    unders,
    overPct: ouTotal > 0 ? Math.round((overs / ouTotal) * 1000) / 10 : 0,
    avgPointsFor: Math.round((totalPF / total) * 10) / 10,
    avgPointsAgainst: Math.round((totalPA / total) * 10) / 10,
    avgMargin: Math.round(((totalPF - totalPA) / total) * 10) / 10,
    homeRecord: `${homeW}-${homeL}`,
    awayRecord: `${awayW}-${awayL}`,
  };
}

interface AdditionalTrend {
  label: string;
  description: string;
  record: string;
  rate: number;
  sampleSize: number;
  strength: "strong" | "moderate" | "weak" | "noise";
  favors: "home" | "away" | "over" | "under" | "neutral";
}

async function buildAdditionalTrends(
  sport: "NFL" | "NCAAF" | "NCAAMB",
  homeTeam: string,
  awayTeam: string,
  currentSeason: number,
  allGames: TrendGame[],
): Promise<AdditionalTrend[]> {
  const trends: AdditionalTrend[] = [];

  // Helper to run a trend query and extract results
  function runTrend(
    label: string,
    description: string,
    query: TrendQuery,
    favorsSide: "home" | "away",
  ) {
    try {
      const result = executeTrendQuery(query, allGames);
      const atsTotal = result.summary.atsCovered + result.summary.atsLost;
      if (atsTotal >= 5) {
        const sig = analyzeTrendSignificance(result.summary.atsCovered, atsTotal, 0.5);
        trends.push({
          label,
          description,
          record: result.summary.atsRecord,
          rate: result.summary.atsPct,
          sampleSize: atsTotal,
          strength: sig.strength,
          favors: sig.observedRate > 0.5 ? favorsSide : (favorsSide === "home" ? "away" : "home"),
        });
      }
    } catch {
      // skip
    }
  }

  // Home team as favorite (last 3 seasons)
  runTrend(
    `${homeTeam} as Favorite`,
    `ATS record when favored (last 3 seasons)`,
    {
      sport,
      team: homeTeam,
      perspective: "team",
      seasonRange: [currentSeason - 2, currentSeason],
      filters: [{ field: "spread", operator: "lt", value: 0 }],
    } as TrendQuery,
    "home",
  );

  // Away team as underdog (last 3 seasons)
  runTrend(
    `${awayTeam} as Underdog`,
    `ATS record when underdog (last 3 seasons)`,
    {
      sport,
      team: awayTeam,
      perspective: "team",
      seasonRange: [currentSeason - 2, currentSeason],
      filters: [{ field: "spread", operator: "gt", value: 0 }],
    } as TrendQuery,
    "away",
  );

  // Home team at home (last 3 seasons)
  runTrend(
    `${homeTeam} at Home`,
    `Home ATS record (last 3 seasons)`,
    {
      sport,
      team: homeTeam,
      perspective: "team",
      seasonRange: [currentSeason - 2, currentSeason],
      filters: [{ field: "isHome", operator: "eq", value: true }],
    } as TrendQuery,
    "home",
  );

  // Away team on the road (last 3 seasons)
  runTrend(
    `${awayTeam} on Road`,
    `Road ATS record (last 3 seasons)`,
    {
      sport,
      team: awayTeam,
      perspective: "team",
      seasonRange: [currentSeason - 2, currentSeason],
      filters: [{ field: "isHome", operator: "eq", value: false }],
    } as TrendQuery,
    "away",
  );

  // Sort by strength
  const strengthOrder: Record<string, number> = { strong: 0, moderate: 1, weak: 2, noise: 3 };
  trends.sort((a, b) => (strengthOrder[a.strength] ?? 3) - (strengthOrder[b.strength] ?? 3));

  return trends;
}
