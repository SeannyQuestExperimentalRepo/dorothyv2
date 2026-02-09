/**
 * Player Prop Trend Engine
 *
 * Analyzes player prop hit rates with situational filtering.
 * Example: "Mahomes over 275.5 passing yards at home as a favorite since 2022"
 *
 * Built on top of the player-trend-engine (filtering/name resolution) and
 * trend-stats (significance testing).
 */

import {
  type PlayerTrendGame,
  type PlayerTrendQuery,
  executePlayerTrendQuery,
  loadPlayerGamesCached,
  resolvePlayerName,
} from "./player-trend-engine";
import {
  type TrendFilter,
} from "./trend-engine";
import {
  analyzePlayerProp,

  type PropHitRate,
  type TrendSignificance,
} from "./trend-stats";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PropQuery {
  /** Player name (e.g., "Patrick Mahomes") */
  player: string;
  /** Stat to analyze (e.g., "passing_yards") */
  stat: string;
  /** The prop line (e.g., 275.5) */
  line: number;
  /** "over" or "under" */
  direction: "over" | "under";
  /** Optional situational filters */
  filters?: TrendFilter[];
  /** Optional season range */
  seasonRange?: [number, number];
  /** Optional: limit to home or away games */
  homeAway?: "home" | "away";
  /** Optional: only when team is favorite or underdog */
  favDog?: "favorite" | "underdog";
  /** Optional: only against specific opponent */
  opponent?: string;
}

export interface PropSplitRecord {
  label: string;
  hits: number;
  total: number;
  hitRate: number;
  significance: TrendSignificance;
}

export interface PropResult {
  /** The player's resolved display name */
  playerName: string;
  /** The prop query */
  query: PropQuery;
  /** Overall hit rate analysis */
  overall: PropHitRate;
  /** Situational splits (home/away, fav/dog, by season, etc.) */
  splits: PropSplitRecord[];
  /** Recent trend (last 5 and last 10 games) */
  recentTrend: {
    last5: { hits: number; total: number; hitRate: number };
    last10: { hits: number; total: number; hitRate: number };
  };
  /** Streak: consecutive games hitting the prop (positive = over streak) */
  currentStreak: number;
  /** Average stat value across all matching games */
  avgValue: number;
  /** Median stat value */
  medianValue: number;
  /** The individual game logs (most recent first) */
  games: PropGameLog[];
  /** Computed timestamp */
  computedAt: string;
}

export interface PropGameLog {
  gameDate: string;
  opponent: string;
  isHome: boolean | null;
  statValue: number;
  hit: boolean;
  teamScore: number | null;
  opponentScore: number | null;
  gameResult: string | null;
  spread: number | null;
  weatherCategory: string | null;
  season: number;
  week: number;
}

// ─── Common Prop Stat Mappings ──────────────────────────────────────────────────

/** Maps common prop names to actual field names */
export const PROP_STAT_MAP: Record<string, string> = {
  // Passing
  "passing yards": "passing_yards",
  "pass yards": "passing_yards",
  "passing_yards": "passing_yards",
  "passing tds": "passing_tds",
  "pass tds": "passing_tds",
  "passing touchdowns": "passing_tds",
  "passing_tds": "passing_tds",
  "completions": "completions",
  "attempts": "attempts",
  "interceptions": "passing_interceptions",
  "passing_interceptions": "passing_interceptions",

  // Rushing
  "rushing yards": "rushing_yards",
  "rush yards": "rushing_yards",
  "rushing_yards": "rushing_yards",
  "rushing tds": "rushing_tds",
  "rush tds": "rushing_tds",
  "rushing_tds": "rushing_tds",
  "carries": "carries",
  "rush attempts": "carries",

  // Receiving
  "receiving yards": "receiving_yards",
  "rec yards": "receiving_yards",
  "receiving_yards": "receiving_yards",
  "receptions": "receptions",
  "catches": "receptions",
  "receiving tds": "receiving_tds",
  "rec tds": "receiving_tds",
  "receiving_tds": "receiving_tds",
  "targets": "targets",

  // Fantasy
  "fantasy points": "fantasy_points_ppr",
  "fantasy_points_ppr": "fantasy_points_ppr",
  "fantasy_points": "fantasy_points",

  // Defense
  "sacks": "def_sacks",
  "def_sacks": "def_sacks",
  "tackles": "def_tackles_solo",
  "def_tackles_solo": "def_tackles_solo",
  "interceptions_def": "def_interceptions",
  "def_interceptions": "def_interceptions",

  // Kicking
  "fg_made": "fg_made",
  "field goals": "fg_made",
  "pat_made": "pat_made",
};

/**
 * Resolve a stat name to a field name.
 */
export function resolveStatName(input: string): string {
  const lower = input.toLowerCase().trim();
  return PROP_STAT_MAP[lower] || lower;
}

// ─── Core Execution ─────────────────────────────────────────────────────────────

/**
 * Execute a player prop trend query.
 */
export function executePlayerPropQuery(query: PropQuery): PropResult {
  const allGames = loadPlayerGamesCached();
  const statField = resolveStatName(query.stat);

  // Build the underlying player trend query
  const filters: TrendFilter[] = [...(query.filters || [])];

  // Add home/away filter
  if (query.homeAway === "home") {
    filters.push({ field: "isHome", operator: "eq", value: true });
  } else if (query.homeAway === "away") {
    filters.push({ field: "isHome", operator: "eq", value: false });
  }

  // Add fav/dog filter (spread-based)
  // Player data spread is from the player's team perspective:
  //   positive = team is favored, negative = team is underdog
  if (query.favDog === "favorite") {
    filters.push({ field: "spread", operator: "gt", value: 0 });
  } else if (query.favDog === "underdog") {
    filters.push({ field: "spread", operator: "lt", value: 0 });
  }

  const playerQuery: PlayerTrendQuery = {
    player: query.player,
    opponent: query.opponent,
    filters,
    seasonRange: query.seasonRange,
  };

  const result = executePlayerTrendQuery(playerQuery, allGames);
  const games = result.games;

  // Resolve player name
  const resolved = resolvePlayerName(query.player, allGames);
  const playerName = resolved?.displayName || query.player;

  // Extract stat values
  const statValues = games.map((g) => {
    const val = g[statField];
    return typeof val === "number" ? val : null;
  });

  // Overall hit rate
  const overall = analyzePlayerProp(statValues, query.line, query.direction, statField);

  // Build game logs (most recent first)
  const gameLogs: PropGameLog[] = [];
  for (let i = games.length - 1; i >= 0; i--) {
    const g = games[i];
    const val = g[statField];
    if (typeof val !== "number") continue;

    const hit =
      query.direction === "over" ? val > query.line : val < query.line;

    gameLogs.push({
      gameDate: g.gameDate || "",
      opponent: g.opponentCanonical || g.opponent_team || "",
      isHome: g.isHome,
      statValue: val,
      hit,
      teamScore: g.teamScore,
      opponentScore: g.opponentScore,
      gameResult: g.gameResult,
      spread: g.spread,
      weatherCategory: g.weatherCategory,
      season: g.season,
      week: g.week,
    });
  }

  // Recent trends
  const last5 = gameLogs.slice(0, 5);
  const last10 = gameLogs.slice(0, 10);
  const last5Hits = last5.filter((g) => g.hit).length;
  const last10Hits = last10.filter((g) => g.hit).length;

  // Current streak
  let streak = 0;
  if (gameLogs.length > 0) {
    const firstHit = gameLogs[0].hit;
    for (const g of gameLogs) {
      if (g.hit === firstHit) {
        streak++;
      } else {
        break;
      }
    }
    // Negative streak if currently NOT hitting
    if (!firstHit) streak = -streak;
  }

  // Average and median
  const validValues = statValues.filter((v): v is number => v !== null);
  const avgValue =
    validValues.length > 0
      ? Math.round(
          (validValues.reduce((a, b) => a + b, 0) / validValues.length) * 10,
        ) / 10
      : 0;
  const sorted = [...validValues].sort((a, b) => a - b);
  const medianValue =
    sorted.length > 0
      ? sorted.length % 2 === 0
        ? Math.round(((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) * 10) / 10
        : sorted[Math.floor(sorted.length / 2)]
      : 0;

  // Build splits
  const splits: PropSplitRecord[] = [];

  // Home vs Away split
  const homeGames = games.filter((g) => g.isHome === true);
  const awayGames = games.filter((g) => g.isHome === false);
  if (homeGames.length > 0) {
    const homeVals = homeGames.map((g) => {
      const v = g[statField];
      return typeof v === "number" ? v : null;
    });
    const homeProp = analyzePlayerProp(homeVals, query.line, query.direction, statField);
    splits.push({
      label: "Home",
      hits: homeProp.hits,
      total: homeProp.total,
      hitRate: homeProp.hitRate,
      significance: homeProp.significance,
    });
  }
  if (awayGames.length > 0) {
    const awayVals = awayGames.map((g) => {
      const v = g[statField];
      return typeof v === "number" ? v : null;
    });
    const awayProp = analyzePlayerProp(awayVals, query.line, query.direction, statField);
    splits.push({
      label: "Away",
      hits: awayProp.hits,
      total: awayProp.total,
      hitRate: awayProp.hitRate,
      significance: awayProp.significance,
    });
  }

  // Favorite vs Underdog split
  // Player data: positive spread = team favored, negative = underdog
  const favGames = games.filter((g) => g.spread !== null && g.spread > 0);
  const dogGames = games.filter((g) => g.spread !== null && g.spread < 0);
  if (favGames.length > 0) {
    const favVals = favGames.map((g) => {
      const v = g[statField];
      return typeof v === "number" ? v : null;
    });
    const favProp = analyzePlayerProp(favVals, query.line, query.direction, statField);
    splits.push({
      label: "As Favorite",
      hits: favProp.hits,
      total: favProp.total,
      hitRate: favProp.hitRate,
      significance: favProp.significance,
    });
  }
  if (dogGames.length > 0) {
    const dogVals = dogGames.map((g) => {
      const v = g[statField];
      return typeof v === "number" ? v : null;
    });
    const dogProp = analyzePlayerProp(dogVals, query.line, query.direction, statField);
    splits.push({
      label: "As Underdog",
      hits: dogProp.hits,
      total: dogProp.total,
      hitRate: dogProp.hitRate,
      significance: dogProp.significance,
    });
  }

  // By-season split
  const seasons = new Map<number, PlayerTrendGame[]>();
  for (const g of games) {
    const arr = seasons.get(g.season) || [];
    arr.push(g);
    seasons.set(g.season, arr);
  }
  for (const [season, seasonGames] of Array.from(seasons.entries()).sort(
    ([a], [b]) => b - a,
  )) {
    const seasonVals = seasonGames.map((g) => {
      const v = g[statField];
      return typeof v === "number" ? v : null;
    });
    const seasonProp = analyzePlayerProp(
      seasonVals,
      query.line,
      query.direction,
      statField,
    );
    splits.push({
      label: `${season} Season`,
      hits: seasonProp.hits,
      total: seasonProp.total,
      hitRate: seasonProp.hitRate,
      significance: seasonProp.significance,
    });
  }

  return {
    playerName,
    query,
    overall,
    splits,
    recentTrend: {
      last5: {
        hits: last5Hits,
        total: last5.length,
        hitRate:
          last5.length > 0
            ? Math.round((last5Hits / last5.length) * 1000) / 10
            : 0,
      },
      last10: {
        hits: last10Hits,
        total: last10.length,
        hitRate:
          last10.length > 0
            ? Math.round((last10Hits / last10.length) * 1000) / 10
            : 0,
      },
    },
    currentStreak: streak,
    avgValue,
    medianValue,
    games: gameLogs.slice(0, 50), // Cap at 50 most recent
    computedAt: new Date().toISOString(),
  };
}
