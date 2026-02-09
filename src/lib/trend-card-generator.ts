/**
 * Shareable Trend Card Generator
 *
 * Generates structured card data for game trends, player trends, and prop
 * trends that can be rendered as shareable social media cards or web components.
 *
 * Cards include:
 * - Headline and subtitle
 * - Key stat display (big number + context)
 * - Visual indicators (streak dots, significance badge)
 * - Source attribution and timestamp
 *
 * Cards are pure data — the frontend decides how to render them.
 */

import type { TrendResult } from "./trend-engine";
import type { PlayerTrendResult } from "./player-trend-engine";
import type { PropResult } from "./prop-trend-engine";
import type { SignificanceEnrichment } from "./significance-enrichment";
import { enrichGameSummary, enrichPlayerSummary } from "./significance-enrichment";
import { type TrendStrength } from "./trend-stats";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TrendCard {
  /** Unique ID for this card (hash of query params) */
  id: string;
  /** Card type */
  type: "game" | "player" | "prop";
  /** Main headline (e.g., "Chiefs at Home Since 2020") */
  headline: string;
  /** Subtitle with context */
  subtitle: string;
  /** The hero stat — the big number on the card */
  heroStat: {
    value: string;
    label: string;
    /** Whether this is "good" (green), "bad" (red), or "neutral" */
    sentiment: "positive" | "negative" | "neutral";
  };
  /** Supporting stats (2-4 additional data points) */
  supportingStats: {
    value: string;
    label: string;
  }[];
  /** Visual streak dots: true = hit, false = miss (most recent first) */
  streakDots: boolean[];
  /** Significance badge */
  significance: {
    strength: TrendStrength;
    label: string;
    /** Confidence interval as display string (e.g., "55.2% - 68.1%") */
    confidenceRange: string;
  };
  /** Tags for categorization and search */
  tags: string[];
  /** Card metadata */
  meta: {
    sport: string;
    sampleSize: number;
    seasonRange: string;
    generatedAt: string;
    /** URL-safe query string to reproduce this card */
    shareParam: string;
  };
}

// ─── Card ID Generation ─────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).substring(0, 8);
}

// ─── Sentiment Helpers ──────────────────────────────────────────────────────────

function atsSentiment(atsPct: number): "positive" | "negative" | "neutral" {
  if (atsPct >= 55) return "positive";
  if (atsPct <= 45) return "negative";
  return "neutral";
}

function winSentiment(winPct: number, baseline: number = 50): "positive" | "negative" | "neutral" {
  if (winPct >= baseline + 5) return "positive";
  if (winPct <= baseline - 5) return "negative";
  return "neutral";
}

// ─── Game Trend Card ────────────────────────────────────────────────────────────

/**
 * Generate a shareable card for a game trend query result.
 */
export function generateGameTrendCard(
  result: TrendResult,
  significance?: SignificanceEnrichment,
): TrendCard {
  const { summary, query } = result;
  const sig = significance || enrichGameSummary(summary, query.perspective, query.sport);

  // Build headline
  const parts: string[] = [];
  if (query.sport) parts.push(query.sport);
  if (query.team) parts.push(query.team);
  if (query.perspective && query.perspective !== "team") {
    parts.push(capitalize(query.perspective) + "s");
  }
  const headline = parts.join(" ") || "Game Trend";

  // Season range string
  const seasonStr = query.seasonRange
    ? `${query.seasonRange[0]}-${query.seasonRange[1]}`
    : "All Seasons";

  // Subtitle with filter description
  const filterDescs = query.filters.map(describeFilter).filter(Boolean);
  const subtitle = filterDescs.length > 0
    ? filterDescs.join(", ") + ` (${seasonStr})`
    : seasonStr;

  // Determine hero stat (most notable finding)
  const atsTotal = summary.atsCovered + summary.atsLost;
  const heroStat = atsTotal > 0
    ? {
        value: `${summary.atsPct}%`,
        label: `ATS (${summary.atsRecord})`,
        sentiment: atsSentiment(summary.atsPct),
      }
    : {
        value: `${summary.winPct}%`,
        label: `Win Rate (${summary.wins}-${summary.losses})`,
        sentiment: winSentiment(summary.winPct) as "positive" | "negative" | "neutral",
      };

  // Supporting stats
  const supportingStats: TrendCard["supportingStats"] = [];
  if (atsTotal > 0) {
    supportingStats.push({
      value: `${summary.winPct}%`,
      label: "Win Rate",
    });
  }
  if (summary.overs + summary.unders > 0) {
    supportingStats.push({
      value: summary.ouRecord,
      label: `O/U (${summary.overPct}% overs)`,
    });
  }
  supportingStats.push({
    value: summary.avgMargin > 0 ? `+${summary.avgMargin.toFixed(1)}` : summary.avgMargin.toFixed(1),
    label: "Avg Margin",
  });
  supportingStats.push({
    value: summary.avgTotalPoints.toFixed(1),
    label: "Avg Total",
  });

  // Streak dots from recent games
  const streakDots = result.games.slice(-10).reverse().map((g) => {
    if (g.spreadResult === "COVERED") return true;
    if (g.spreadResult === "LOST") return false;
    return g.scoreDifference > 0;
  });

  // Best significance finding
  const bestSig = getBestSignificance(sig);

  // Tags
  const tags: string[] = [];
  if (query.sport) tags.push(query.sport);
  if (query.team) tags.push(query.team);
  if (query.perspective) tags.push(query.perspective);
  if (bestSig.strength === "strong") tags.push("significant");

  // Share param
  const shareParam = encodeURIComponent(
    JSON.stringify({ sport: query.sport, team: query.team, perspective: query.perspective, seasonRange: query.seasonRange, filters: query.filters }),
  );

  return {
    id: simpleHash(`game-${query.sport}-${query.team}-${query.perspective}-${seasonStr}`),
    type: "game",
    headline,
    subtitle,
    heroStat,
    supportingStats: supportingStats.slice(0, 4),
    streakDots: streakDots.slice(0, 10),
    significance: {
      strength: bestSig.strength,
      label: bestSig.label,
      confidenceRange: `${(bestSig.confidenceInterval[0] * 100).toFixed(1)}% - ${(bestSig.confidenceInterval[1] * 100).toFixed(1)}%`,
    },
    tags,
    meta: {
      sport: query.sport || "ALL",
      sampleSize: summary.totalGames,
      seasonRange: seasonStr,
      generatedAt: new Date().toISOString(),
      shareParam,
    },
  };
}

// ─── Player Trend Card ──────────────────────────────────────────────────────────

/**
 * Generate a shareable card for a player trend query result.
 */
export function generatePlayerTrendCard(
  result: PlayerTrendResult,
): TrendCard {
  const { summary, query } = result;
  const sig = enrichPlayerSummary(summary);

  // Headline
  const headline = query.player || query.position || query.positionGroup || "Player Trend";

  // Subtitle
  const parts: string[] = [];
  if (query.opponent) parts.push(`vs ${query.opponent}`);
  if (query.seasonRange) parts.push(`${query.seasonRange[0]}-${query.seasonRange[1]}`);
  if (query.filters.length > 0) {
    parts.push(query.filters.map(describeFilter).filter(Boolean).join(", "));
  }
  const subtitle = parts.join(" | ") || "Career Stats";

  // Hero stat
  const heroStat = {
    value: `${summary.winPct}%`,
    label: `Win Rate (${summary.wins}-${summary.losses})`,
    sentiment: winSentiment(summary.winPct) as "positive" | "negative" | "neutral",
  };

  // Supporting stats (include key stat averages)
  const supportingStats: TrendCard["supportingStats"] = [];
  if (summary.atsCovered + summary.atsLost > 0) {
    supportingStats.push({
      value: summary.atsRecord,
      label: `ATS (${summary.atsPct}%)`,
    });
  }

  // Add top stat averages
  const statEntries = Object.entries(summary.statAverages)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  for (const [key, val] of statEntries.slice(0, 2)) {
    supportingStats.push({
      value: val.toFixed(1),
      label: formatStatLabel(key),
    });
  }

  supportingStats.push({
    value: `${summary.totalGames}`,
    label: "Games",
  });

  // Streak dots from recent games
  const streakDots = result.games.slice(-10).reverse().map((g) => {
    return g.gameResult === "W";
  });

  const bestSig = getBestSignificance(sig);

  const tags: string[] = [];
  if (query.player) tags.push(query.player);
  if (query.position) tags.push(query.position);
  if (bestSig.strength === "strong") tags.push("significant");

  const seasonStr = query.seasonRange
    ? `${query.seasonRange[0]}-${query.seasonRange[1]}`
    : "Career";

  const shareParam = encodeURIComponent(
    JSON.stringify({ player: query.player, opponent: query.opponent, seasonRange: query.seasonRange }),
  );

  return {
    id: simpleHash(`player-${query.player}-${query.opponent}-${seasonStr}`),
    type: "player",
    headline,
    subtitle,
    heroStat,
    supportingStats: supportingStats.slice(0, 4),
    streakDots: streakDots.slice(0, 10),
    significance: {
      strength: bestSig.strength,
      label: bestSig.label,
      confidenceRange: `${(bestSig.confidenceInterval[0] * 100).toFixed(1)}% - ${(bestSig.confidenceInterval[1] * 100).toFixed(1)}%`,
    },
    tags,
    meta: {
      sport: "NFL",
      sampleSize: summary.totalGames,
      seasonRange: seasonStr,
      generatedAt: new Date().toISOString(),
      shareParam,
    },
  };
}

// ─── Prop Trend Card ────────────────────────────────────────────────────────────

/**
 * Generate a shareable card for a player prop trend result.
 */
export function generatePropTrendCard(result: PropResult): TrendCard {
  const { overall, query } = result;

  // Headline
  const directionLabel = query.direction === "over" ? "Over" : "Under";
  const headline = `${result.playerName} ${directionLabel} ${query.line}`;

  // Subtitle
  const parts: string[] = [formatStatLabel(query.stat)];
  if (query.homeAway) parts.push(capitalize(query.homeAway));
  if (query.favDog) parts.push(`As ${capitalize(query.favDog)}`);
  if (query.opponent) parts.push(`vs ${query.opponent}`);
  if (query.seasonRange) parts.push(`${query.seasonRange[0]}-${query.seasonRange[1]}`);
  const subtitle = parts.join(" | ");

  // Hero stat = hit rate
  const heroStat = {
    value: `${overall.hitRate}%`,
    label: `Hit Rate (${overall.hits}/${overall.total})`,
    sentiment: hitRateSentiment(overall.hitRate),
  };

  // Supporting stats
  const supportingStats: TrendCard["supportingStats"] = [];
  supportingStats.push({
    value: result.avgValue.toString(),
    label: "Average",
  });
  supportingStats.push({
    value: result.medianValue.toString(),
    label: "Median",
  });

  // Recent trend
  const { last5, last10 } = result.recentTrend;
  if (last5.total > 0) {
    supportingStats.push({
      value: `${last5.hits}/${last5.total}`,
      label: `Last ${last5.total} (${last5.hitRate}%)`,
    });
  }
  if (last10.total > 0) {
    supportingStats.push({
      value: `${last10.hits}/${last10.total}`,
      label: `Last ${last10.total} (${last10.hitRate}%)`,
    });
  }

  // Streak dots from game logs
  const streakDots = result.games.slice(0, 10).map((g) => g.hit);

  // Streak description
  const streakLabel = result.currentStreak > 0
    ? `${result.currentStreak} game ${query.direction} streak`
    : result.currentStreak < 0
    ? `${Math.abs(result.currentStreak)} game ${query.direction === "over" ? "under" : "over"} streak`
    : "";

  const bestSig = overall.significance;

  const tags: string[] = [result.playerName, formatStatLabel(query.stat), directionLabel];
  if (bestSig.strength === "strong" || bestSig.strength === "moderate") {
    tags.push("significant");
  }
  if (streakLabel) tags.push(streakLabel);

  const seasonStr = query.seasonRange
    ? `${query.seasonRange[0]}-${query.seasonRange[1]}`
    : "Career";

  const shareParam = encodeURIComponent(
    JSON.stringify({
      player: query.player,
      stat: query.stat,
      line: query.line,
      direction: query.direction,
      homeAway: query.homeAway,
      favDog: query.favDog,
    }),
  );

  return {
    id: simpleHash(`prop-${query.player}-${query.stat}-${query.line}-${query.direction}`),
    type: "prop",
    headline,
    subtitle,
    heroStat,
    supportingStats: supportingStats.slice(0, 4),
    streakDots: streakDots.slice(0, 10),
    significance: {
      strength: bestSig.strength,
      label: bestSig.label,
      confidenceRange: `${(bestSig.confidenceInterval[0] * 100).toFixed(1)}% - ${(bestSig.confidenceInterval[1] * 100).toFixed(1)}%`,
    },
    tags,
    meta: {
      sport: "NFL",
      sampleSize: overall.total,
      seasonRange: seasonStr,
      generatedAt: new Date().toISOString(),
      shareParam,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hitRateSentiment(rate: number): "positive" | "negative" | "neutral" {
  if (rate >= 60) return "positive";
  if (rate <= 40) return "negative";
  return "neutral";
}

function formatStatLabel(stat: string): string {
  return stat
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeFilter(f: { field: string; operator: string; value: unknown }): string {
  const field = formatStatLabel(f.field);
  switch (f.operator) {
    case "eq": return `${field}: ${f.value}`;
    case "gt": return `${field} > ${f.value}`;
    case "gte": return `${field} >= ${f.value}`;
    case "lt": return `${field} < ${f.value}`;
    case "lte": return `${field} <= ${f.value}`;
    case "between": {
      const [lo, hi] = f.value as [number, number];
      return `${field}: ${lo}-${hi}`;
    }
    case "in": return `${field} in [${(f.value as unknown[]).join(", ")}]`;
    default: return `${field} ${f.operator} ${f.value}`;
  }
}

function getBestSignificance(sig: SignificanceEnrichment) {
  const candidates = [sig.winRate, sig.ats, sig.overUnder];
  const strengthOrder: Record<string, number> = { strong: 0, moderate: 1, weak: 2, noise: 3 };

  return candidates.reduce((best, current) => {
    const bestRank = strengthOrder[best.strength] ?? 3;
    const currentRank = strengthOrder[current.strength] ?? 3;
    if (currentRank < bestRank) return current;
    if (currentRank === bestRank && current.pValue < best.pValue) return current;
    return best;
  });
}
