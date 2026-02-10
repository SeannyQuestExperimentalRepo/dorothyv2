/**
 * Reverse Lookup / Auto-Surface Angles Engine
 *
 * Automatically discovers interesting betting angles by scanning predefined
 * filter combinations and surfacing statistically significant trends.
 *
 * Example output: "Home underdogs in cold weather cover 67% ATS (n=45, p=0.02)"
 *
 * Architecture:
 * 1. Define angle templates (filter combinations worth checking)
 * 2. Execute each as a TrendQuery with the existing engine
 * 3. Score each result via trend-stats significance testing
 * 4. Return the top N most interesting angles, ranked by significance
 */

import {
  executeTrendQuery,
  loadAllGamesCached,
  type TrendQuery,
  type TrendFilter,
  type TrendGame,
  type Perspective,
} from "./trend-engine";
import {
  analyzeTrendSignificance,
  type TrendSignificance,
  type TrendStrength,
} from "./trend-stats";

// ─── Types ──────────────────────────────────────────────────────────────────────

export type AngleCategory =
  | "weather"
  | "schedule"
  | "spread"
  | "ranking"
  | "primetime"
  | "conference"
  | "playoff"
  | "rest"
  | "tempo"
  | "month"
  | "combined";

export interface AngleTemplate {
  /** Unique identifier for this angle */
  id: string;
  /** Human-readable description template (uses {sport} placeholder) */
  label: string;
  /** Category for grouping */
  category: AngleCategory;
  /** Which sports this applies to */
  sports: ("NFL" | "NCAAF" | "NCAAMB")[];
  /** Perspective to use */
  perspective: Perspective;
  /** Filters to apply */
  filters: TrendFilter[];
  /** Optional team filter */
  team?: string;
  /** Minimum sample size to consider (default 20) */
  minSample?: number;
}

export interface DiscoveredAngle {
  /** The angle template that generated this */
  template: AngleTemplate;
  /** Sport this was found in */
  sport: "NFL" | "NCAAF" | "NCAAMB";
  /** The query result summary */
  record: {
    wins: number;
    losses: number;
    winPct: number;
    atsCovered: number;
    atsLost: number;
    atsPush: number;
    atsPct: number;
    atsRecord: string;
    overs: number;
    unders: number;
    overPct: number;
    ouRecord: string;
    avgMargin: number;
    avgSpread: number | null;
    avgTotalPoints: number;
    totalGames: number;
  };
  /** ATS significance analysis */
  atsSignificance: TrendSignificance;
  /** O/U significance analysis (if applicable) */
  ouSignificance: TrendSignificance | null;
  /** Win rate significance analysis */
  winSignificance: TrendSignificance;
  /** The most notable finding for this angle */
  headline: string;
  /** Composite score for ranking (higher = more interesting) */
  interestScore: number;
  /** Season range used */
  seasonRange: [number, number];
}

export interface ReverseLookupResult {
  /** All discovered angles, sorted by interest score */
  angles: DiscoveredAngle[];
  /** Total templates scanned */
  templatesScanned: number;
  /** How many passed the significance threshold */
  significantCount: number;
  /** Computation time */
  computedAt: string;
  /** Duration in ms */
  durationMs: number;
}

export interface ReverseLookupOptions {
  /** Which sport to scan */
  sport?: "NFL" | "NCAAF" | "NCAAMB";
  /** Optional team to focus on */
  team?: string;
  /** Season range (default last 5 years) */
  seasonRange?: [number, number];
  /** Maximum angles to return (default 25) */
  maxResults?: number;
  /** Minimum strength to include (default "weak") */
  minStrength?: TrendStrength;
  /** Categories to include (default all) */
  categories?: AngleCategory[];
}

// ─── Angle Templates ────────────────────────────────────────────────────────────

const ANGLE_TEMPLATES: AngleTemplate[] = [
  // ── Weather Angles (NFL, NCAAF) ──
  {
    id: "cold-home",
    label: "Home teams in cold weather (< 32°F)",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "temperature", operator: "lt", value: 32 }],
  },
  {
    id: "cold-away",
    label: "Away teams in cold weather (< 32°F)",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "away",
    filters: [{ field: "temperature", operator: "lt", value: 32 }],
  },
  {
    id: "cold-underdog",
    label: "Underdogs in cold weather (< 32°F)",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "underdog",
    filters: [{ field: "temperature", operator: "lt", value: 32 }],
  },
  {
    id: "wind-home",
    label: "Home teams in windy games (20+ mph)",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "windMph", operator: "gte", value: 20 }],
  },
  {
    id: "wind-under",
    label: "Unders in windy games (20+ mph)",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "windMph", operator: "gte", value: 20 }],
  },
  {
    id: "snow-home",
    label: "Home teams in snow games",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "weatherCategory", operator: "eq", value: "SNOW" }],
  },
  {
    id: "rain-underdog",
    label: "Underdogs in rain games",
    category: "weather",
    sports: ["NFL", "NCAAF"],
    perspective: "underdog",
    filters: [{ field: "weatherCategory", operator: "eq", value: "RAIN" }],
  },

  // ── Spread Angles ──
  {
    id: "home-big-fav",
    label: "Home favorites of 10+ points",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "favorite",
    filters: [{ field: "spread", operator: "lte", value: -10 }],
  },
  {
    id: "home-small-fav",
    label: "Home favorites of 1-3 points",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "favorite",
    filters: [{ field: "spread", operator: "between", value: [-3, -1] }],
  },
  {
    id: "away-underdog-3-7",
    label: "Road underdogs of 3-7 points",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "underdog",
    filters: [
      { field: "spread", operator: "between", value: [-7, -3] },
    ],
  },
  {
    id: "home-underdog",
    label: "Home underdogs",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "home",
    filters: [{ field: "spread", operator: "gt", value: 0 }],
  },
  {
    id: "big-underdog",
    label: "Underdogs of 14+ points",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "underdog",
    filters: [{ field: "spread", operator: "lte", value: -14 }],
  },
  {
    id: "pick-em",
    label: "Pick'em games (spread within 1 point)",
    category: "spread",
    sports: ["NFL", "NCAAF", "NCAAMB"],
    perspective: "home",
    filters: [{ field: "spread", operator: "between", value: [-1, 1] }],
  },

  // ── Schedule / Rest Angles ──
  {
    id: "rest-advantage-home",
    label: "Home teams with rest advantage (4+ extra days)",
    category: "rest",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "restAdvantage", operator: "gte", value: 4 }],
  },
  {
    id: "bye-week-home",
    label: "Home teams coming off bye week",
    category: "rest",
    sports: ["NFL"],
    perspective: "home",
    filters: [{ field: "homeIsByeWeek", operator: "eq", value: true }],
  },
  {
    id: "short-week-away",
    label: "Away teams on short week",
    category: "rest",
    sports: ["NFL"],
    perspective: "away",
    filters: [{ field: "isShortWeek", operator: "eq", value: true }],
  },
  {
    id: "back-to-back-home",
    label: "Home teams in back-to-back games",
    category: "rest",
    sports: ["NCAAMB"],
    perspective: "home",
    filters: [{ field: "homeIsBackToBack", operator: "eq", value: true }],
  },
  {
    id: "back-to-back-away",
    label: "Away teams in back-to-back games",
    category: "rest",
    sports: ["NCAAMB"],
    perspective: "away",
    filters: [{ field: "awayIsBackToBack", operator: "eq", value: true }],
  },

  // ── Primetime / Day-of-Week Angles ──
  {
    id: "primetime-home",
    label: "Home teams in primetime games",
    category: "primetime",
    sports: ["NFL"],
    perspective: "home",
    filters: [{ field: "isPrimetime", operator: "eq", value: true }],
  },
  {
    id: "primetime-underdog",
    label: "Underdogs in primetime games",
    category: "primetime",
    sports: ["NFL"],
    perspective: "underdog",
    filters: [{ field: "isPrimetime", operator: "eq", value: true }],
  },
  {
    id: "mnf-home",
    label: "Home teams on Monday Night Football",
    category: "primetime",
    sports: ["NFL"],
    perspective: "home",
    filters: [{ field: "dayOfWeek", operator: "eq", value: "Mon" }],
  },
  {
    id: "thursday-home",
    label: "Home teams on Thursday games",
    category: "primetime",
    sports: ["NFL"],
    perspective: "home",
    filters: [{ field: "dayOfWeek", operator: "eq", value: "Thu" }],
  },

  // ── Ranking Angles ──
  {
    id: "ranked-vs-unranked-home",
    label: "Ranked home teams vs unranked opponents",
    category: "ranking",
    sports: ["NCAAF"],
    perspective: "home",
    filters: [
      { field: "homeRank", operator: "lte", value: 25 },
      { field: "awayRank", operator: "eq", value: null },
    ],
  },
  {
    id: "unranked-home-vs-ranked",
    label: "Unranked home teams vs ranked opponents",
    category: "ranking",
    sports: ["NCAAF"],
    perspective: "home",
    filters: [
      { field: "homeRank", operator: "eq", value: null },
      { field: "awayRank", operator: "lte", value: 25 },
    ],
  },
  {
    id: "top10-matchup",
    label: "Top 10 vs Top 10 matchups",
    category: "ranking",
    sports: ["NCAAF"],
    perspective: "home",
    filters: [
      { field: "homeRank", operator: "lte", value: 10 },
      { field: "awayRank", operator: "lte", value: 10 },
    ],
  },

  // ── Conference / Playoff Angles ──
  {
    id: "conference-home",
    label: "Home teams in conference games",
    category: "conference",
    sports: ["NCAAF", "NCAAMB"],
    perspective: "home",
    filters: [{ field: "isConferenceGame", operator: "eq", value: true }],
  },
  {
    id: "non-conference-home",
    label: "Home teams in non-conference games",
    category: "conference",
    sports: ["NCAAF", "NCAAMB"],
    perspective: "home",
    filters: [{ field: "isConferenceGame", operator: "eq", value: false }],
  },
  {
    id: "bowl-favorite",
    label: "Favorites in bowl games",
    category: "playoff",
    sports: ["NCAAF"],
    perspective: "favorite",
    filters: [{ field: "isBowlGame", operator: "eq", value: true }],
  },
  {
    id: "bowl-underdog",
    label: "Underdogs in bowl games",
    category: "playoff",
    sports: ["NCAAF"],
    perspective: "underdog",
    filters: [{ field: "isBowlGame", operator: "eq", value: true }],
  },
  {
    id: "playoff-home",
    label: "Home teams in playoff games",
    category: "playoff",
    sports: ["NFL"],
    perspective: "home",
    filters: [{ field: "isPlayoff", operator: "eq", value: true }],
  },
  {
    id: "playoff-underdog",
    label: "Underdogs in playoff games",
    category: "playoff",
    sports: ["NFL"],
    perspective: "underdog",
    filters: [{ field: "isPlayoff", operator: "eq", value: true }],
  },
  {
    id: "ncaat-underdog",
    label: "Underdogs in NCAA Tournament",
    category: "playoff",
    sports: ["NCAAMB"],
    perspective: "underdog",
    filters: [{ field: "isNCAAT", operator: "eq", value: true }],
  },
  {
    id: "ncaat-high-seed",
    label: "Higher seeds (1-4) in NCAA Tournament",
    category: "playoff",
    sports: ["NCAAMB"],
    perspective: "home",
    filters: [
      { field: "isNCAAT", operator: "eq", value: true },
      { field: "homeSeed", operator: "lte", value: 4 },
    ],
  },
  {
    id: "conf-tourney-underdog",
    label: "Underdogs in conference tournaments",
    category: "playoff",
    sports: ["NCAAMB"],
    perspective: "underdog",
    filters: [{ field: "isConfTourney", operator: "eq", value: true }],
  },

  // ── Month Angles ──
  {
    id: "september-home",
    label: "Home teams in September (early season)",
    category: "month",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "month", operator: "eq", value: 9 }],
  },
  {
    id: "december-underdog",
    label: "Underdogs in December",
    category: "month",
    sports: ["NFL", "NCAAF"],
    perspective: "underdog",
    filters: [{ field: "month", operator: "eq", value: 12 }],
  },
  {
    id: "november-home",
    label: "Home teams in November",
    category: "month",
    sports: ["NFL", "NCAAF"],
    perspective: "home",
    filters: [{ field: "month", operator: "eq", value: 11 }],
  },
  {
    id: "march-underdog",
    label: "Underdogs in March (tournament time)",
    category: "month",
    sports: ["NCAAMB"],
    perspective: "underdog",
    filters: [{ field: "month", operator: "eq", value: 3 }],
  },

  // ── Combined / Complex Angles ──
  {
    id: "cold-home-underdog",
    label: "Home underdogs in cold weather (< 32°F)",
    category: "combined",
    sports: ["NFL", "NCAAF"],
    perspective: "underdog",
    filters: [
      { field: "temperature", operator: "lt", value: 32 },
      { field: "spread", operator: "lte", value: -1 },
    ],
  },
  {
    id: "primetime-road-dog",
    label: "Road underdogs in primetime",
    category: "combined",
    sports: ["NFL"],
    perspective: "underdog",
    filters: [
      { field: "isPrimetime", operator: "eq", value: true },
    ],
  },
  {
    id: "bye-week-fav",
    label: "Favorites coming off bye week",
    category: "combined",
    sports: ["NFL"],
    perspective: "favorite",
    filters: [{ field: "homeIsByeWeek", operator: "eq", value: true }],
  },
  {
    id: "neutral-underdog",
    label: "Underdogs at neutral sites",
    category: "combined",
    sports: ["NCAAF", "NCAAMB"],
    perspective: "underdog",
    filters: [{ field: "isNeutralSite", operator: "eq", value: true }],
  },
  {
    id: "kenpom-upset-pick",
    label: "KenPom predicted upsets (underdog by < 3)",
    category: "combined",
    sports: ["NCAAMB"],
    perspective: "underdog",
    filters: [
      { field: "kenpomPredMargin", operator: "between", value: [-3, 3] },
    ],
  },
];

// ─── Cache ──────────────────────────────────────────────────────────────────────

const anglesCache = new Map<string, { result: ReverseLookupResult; timestamp: number }>();
const ANGLES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function buildCacheKey(options: ReverseLookupOptions): string {
  const sorted = Object.keys(options)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = (options as Record<string, unknown>)[key];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  return JSON.stringify(sorted);
}

export function clearAnglesCache(): void {
  anglesCache.clear();
}

// ─── Execution ──────────────────────────────────────────────────────────────────

/**
 * Compute a composite interest score for ranking angles.
 * Higher = more interesting to bettors.
 *
 * Factors:
 * - Statistical significance (lower p-value = better)
 * - Effect size (further from 50% = better)
 * - Sample size (more games = more actionable)
 * - Recency relevance (recent trends > historical)
 */
function computeInterestScore(sig: TrendSignificance, totalGames: number): number {
  let score = 0;

  // Significance bonus: lower p-value = bigger bonus
  if (sig.pValue < 0.001) score += 40;
  else if (sig.pValue < 0.01) score += 30;
  else if (sig.pValue < 0.05) score += 20;
  else if (sig.pValue < 0.1) score += 10;

  // Effect size bonus: further from baseline
  const effect = Math.abs(sig.observedRate - sig.baselineRate);
  score += Math.round(effect * 200); // e.g., 65% = 0.15 effect = 30 points

  // Sample size bonus (diminishing returns)
  if (totalGames >= 100) score += 20;
  else if (totalGames >= 50) score += 15;
  else if (totalGames >= 30) score += 10;
  else if (totalGames >= 20) score += 5;

  // Strength multiplier
  if (sig.strength === "strong") score *= 1.5;
  else if (sig.strength === "moderate") score *= 1.2;

  return Math.round(score);
}

/**
 * Generate a human-readable headline for a discovered angle.
 */
function generateHeadline(
  template: AngleTemplate,
  sport: string,
  record: DiscoveredAngle["record"],
  atsSig: TrendSignificance,
  ouSig: TrendSignificance | null,
  winSig: TrendSignificance,
): string {
  const parts: string[] = [];

  // Determine the most notable finding
  const bestAts = atsSig.isSignificant && atsSig.sampleSize >= 20;
  const bestOu = ouSig?.isSignificant && ouSig.sampleSize >= 20;
  const bestWin = winSig.isSignificant && winSig.sampleSize >= 20;

  if (bestAts) {
    parts.push(
      `${record.atsRecord} ATS (${record.atsPct}%)`,
    );
  }
  if (bestWin) {
    parts.push(`${record.winPct}% win rate`);
  }
  if (bestOu && record.overPct > 55) {
    parts.push(`${record.ouRecord} O/U (${record.overPct}% overs)`);
  } else if (bestOu && record.overPct < 45) {
    parts.push(`${record.ouRecord} O/U (${(100 - record.overPct).toFixed(1)}% unders)`);
  }

  if (parts.length === 0) {
    // Fallback: just show the most striking stat
    if (record.atsPct > 55 || record.atsPct < 45) {
      parts.push(`${record.atsRecord} ATS (${record.atsPct}%)`);
    } else {
      parts.push(`${record.winPct}% win rate in ${record.totalGames} games`);
    }
  }

  return `${sport} ${template.label}: ${parts.join(", ")}`;
}

/**
 * Execute the reverse lookup scan.
 *
 * Scans all applicable angle templates for the given options and returns
 * the most interesting findings, ranked by statistical significance.
 */
export async function executeReverseLookup(
  options: ReverseLookupOptions = {},
): Promise<ReverseLookupResult> {
  const cacheKey = buildCacheKey(options);
  const cached = anglesCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ANGLES_CACHE_TTL) {
    return cached.result;
  }

  const start = performance.now();

  const {
    sport,
    team,
    seasonRange = [2015, 2025],
    maxResults = 25,
    minStrength = "weak",
    categories,
  } = options;

  // Pre-load all games from cache/DB
  const allGames: TrendGame[] = await loadAllGamesCached();

  // Filter templates by sport and category
  const sportsToScan: ("NFL" | "NCAAF" | "NCAAMB")[] = sport
    ? [sport]
    : ["NFL", "NCAAF", "NCAAMB"];

  const strengthOrder: TrendStrength[] = ["strong", "moderate", "weak", "noise"];
  const minStrengthIdx = strengthOrder.indexOf(minStrength);

  const discovered: DiscoveredAngle[] = [];
  let templatesScanned = 0;

  for (const scanSport of sportsToScan) {
    const templates = ANGLE_TEMPLATES.filter((t) => {
      if (!t.sports.includes(scanSport)) return false;
      if (categories && !categories.includes(t.category)) return false;
      return true;
    });

    for (const template of templates) {
      templatesScanned++;

      const query: TrendQuery = {
        sport: scanSport,
        perspective: template.perspective,
        filters: [...template.filters],
        seasonRange,
        team: team || template.team,
      };

      try {
        const result = executeTrendQuery(query, allGames);
        const summary = result.summary;

        const minSample = template.minSample || 20;
        if (summary.totalGames < minSample) continue;

        // Analyze ATS significance
        const atsTotal = summary.atsCovered + summary.atsLost;
        const atsSig = atsTotal >= 10
          ? analyzeTrendSignificance(summary.atsCovered, atsTotal, 0.5)
          : analyzeTrendSignificance(0, 0, 0.5);

        // Analyze O/U significance
        const ouTotal = summary.overs + summary.unders;
        const ouSig = ouTotal >= 10
          ? analyzeTrendSignificance(summary.overs, ouTotal, 0.5)
          : null;

        // Analyze win rate significance (baseline varies by perspective)
        // Home teams win ~57% in NFL, ~60% in NCAAF/NCAAMB. Use conservative 55%.
        const winBaseline =
          template.perspective === "home" ? 0.55 :
          template.perspective === "away" ? 0.45 :
          0.50;
        const winSig = analyzeTrendSignificance(
          summary.wins,
          summary.wins + summary.losses,
          winBaseline,
        );

        // Find the best significance among the three
        const bestSig = [atsSig, ouSig, winSig].reduce((best, sig) => {
          if (!sig) return best;
          if (!best) return sig;
          const bestIdx = strengthOrder.indexOf(best.strength);
          const sigIdx = strengthOrder.indexOf(sig.strength);
          return sigIdx < bestIdx ? sig : best;
        }, null as TrendSignificance | null)!;

        // Check if it meets minimum strength
        const bestIdx = strengthOrder.indexOf(bestSig.strength);
        if (bestIdx > minStrengthIdx) continue;

        const record = {
          wins: summary.wins,
          losses: summary.losses,
          winPct: summary.winPct,
          atsCovered: summary.atsCovered,
          atsLost: summary.atsLost,
          atsPush: summary.atsPush,
          atsPct: summary.atsPct,
          atsRecord: summary.atsRecord,
          overs: summary.overs,
          unders: summary.unders,
          overPct: summary.overPct,
          ouRecord: summary.ouRecord,
          avgMargin: summary.avgMargin,
          avgSpread: summary.avgSpread,
          avgTotalPoints: summary.avgTotalPoints,
          totalGames: summary.totalGames,
        };

        const headline = generateHeadline(
          template,
          scanSport,
          record,
          atsSig,
          ouSig,
          winSig,
        );

        const interestScore = Math.max(
          computeInterestScore(atsSig, summary.totalGames),
          ouSig ? computeInterestScore(ouSig, summary.totalGames) : 0,
          computeInterestScore(winSig, summary.totalGames),
        );

        discovered.push({
          template,
          sport: scanSport,
          record,
          atsSignificance: atsSig,
          ouSignificance: ouSig,
          winSignificance: winSig,
          headline,
          interestScore,
          seasonRange,
        });
      } catch {
        // Skip template on error (e.g., missing data for sport)
        continue;
      }
    }
  }

  // Sort by interest score (descending)
  discovered.sort((a, b) => b.interestScore - a.interestScore);

  const durationMs = Math.round(performance.now() - start);

  const result: ReverseLookupResult = {
    angles: discovered.slice(0, maxResults),
    templatesScanned,
    significantCount: discovered.filter(
      (a) => a.atsSignificance.isSignificant || a.winSignificance.isSignificant,
    ).length,
    computedAt: new Date().toISOString(),
    durationMs,
  };

  anglesCache.set(cacheKey, { result, timestamp: Date.now() });

  return result;
}

/**
 * Execute reverse lookup for a specific team.
 * Scans all angle templates from the team's perspective.
 */
export async function executeTeamReverseLookup(
  sport: "NFL" | "NCAAF" | "NCAAMB",
  team: string,
  seasonRange: [number, number] = [2015, 2025],
  maxResults: number = 15,
): Promise<ReverseLookupResult> {
  return executeReverseLookup({
    sport,
    team,
    seasonRange,
    maxResults,
    minStrength: "weak",
  });
}

/**
 * Get the angle templates (useful for building UI selectors or documentation).
 */
export function getAngleTemplates(
  sport?: "NFL" | "NCAAF" | "NCAAMB",
): AngleTemplate[] {
  if (!sport) return ANGLE_TEMPLATES;
  return ANGLE_TEMPLATES.filter((t) => t.sports.includes(sport));
}
