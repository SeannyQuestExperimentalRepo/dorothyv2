/**
 * Daily Pick Engine v9
 *
 * Signal Convergence Scoring Model — generates daily betting picks by
 * evaluating 9 independent signal categories:
 *
 *   1. Model Edge — KenPom FanMatch predictions (NCAAMB) or power ratings (NFL/NCAAF)
 *   2. Season ATS — Wilson-adjusted ATS performance (CONTRARIAN for NCAAMB)
 *   3. Trend Angles — auto-discovered via reverse lookup (50+ templates)
 *   4. Recent Form — last 5 game ATS momentum
 *   5. Head-to-Head — historical H2H ATS with Wilson intervals
 *   6. Situational — weather, rest advantages
 *   7. Rest/B2B — schedule fatigue (NCAAMB)
 *   8. Tempo Differential — pace mismatch O/U signal (NCAAMB)
 *   9. Market Edge — KenPom WP vs moneyline implied probability (NCAAMB)
 *
 * v9 changes (PIT honest backtest):
 *   - O/U regression: EOS 7-feature → PIT 4-feature model (eliminates look-ahead bias)
 *   - Coefficients trained on 70,303 games (2012-2025) with point-in-time KenPom snapshots
 *   - Walk-forward validated: 62.8% across 13/14 profitable seasons
 *   - NCAAMB O/U tiers recalibrated (config #26, monotonic in 12/13 seasons):
 *     - 5★: UNDER + edge >= 12 + avgTempo <= 64 (82.3% OOS, ~2.4/wk)
 *     - 4★: UNDER + edge >= 10 (74.9% OOS, ~16.7/wk)
 *     - 3★: edge >= 9 (68.0% OOS, ~59.1/wk)
 *   - Non-NCAAMB O/U and all spread picks unchanged
 *
 * v8 changes:
 *   - O/U regression: OLS → Ridge (λ=1000) — reduces overfitting gap from 17.4pp to 4.3pp
 *   - OOS accuracy: 52.2% (v7) → 65.7% (v8) on 2026 holdout
 *   - REMOVED all 5 contextual overrides (top-50, power conf, 200+, March, line range)
 *     Root cause: overrides were 78%+ in-sample but coin-flip OOS (Phase 1 diagnostic)
 *   - Walk-forward validated: 68.9-73.0% across all monthly folds
 *   - 95% CI on 2026: [63.1%, 68.2%], z=9.78 vs break-even
 *
 * v7 changes:
 *   - O/U model replaced: sumAdjDE thresholds (51.2%) → OLS regression (69.3%)
 *   - Regression uses AdjDE_sum + AdjOE_sum + AdjTempo_avg + FM_total + conference
 *   - Edge = predictedTotal - overUnder → continuous signal (not thresholds)
 *   - Removed redundant AdjOE, FanMatch, tempo×DE modifiers (baked into regression)
 *   - Kept contextual overrides: top-50, power conf, 200+, March, line range
 *
 * v6 changes:
 *   - FanMatch predicted margin replaces AdjEM+HCA for spread model edge
 *   - Context-aware HCA fallback (conf=2.5, non-conf=1.5, Nov=1.0, March=0.5)
 *   - New moneyline market edge signal (KenPom WP vs market implied probability)
 *
 * v5 changes (41-experiment backtest on 5,523 NCAAMB games):
 *   - Flipped ATS to contrarian/fade for NCAAMB (55.4% spread W%, +6% ROI)
 *   - Added tempo differential O/U signal (5★ O/U +2.9% ROI)
 *   - Disabled O/U convergence bonus (5★ O/U +2.6% ROI)
 *   - Required minimum 3 active signals to generate a pick (+1.5% ROI)
 *
 * Confidence tiers:
 *   - 5★ NCAAMB O/U: Aggressive — UNDER, edge >= 2, slow tempo <= 67 (75.7%)
 *   - 4★ NCAAMB O/U: Hybrid — UNDER e>=2 OR OVER line<140 e>=5 (70.7%)
 *   - 3★ NCAAMB O/U: Base — edge >= 1.5 (63.3%)
 *   - 5★ (other): convergence score >= 85
 *   - 4★ (other): convergence score >= 70
 *
 * Also grades past picks after games complete.
 */

import { prisma } from "./db";
import { loadGamesBySportCached, type TrendGame } from "./trend-engine";
import { wilsonInterval } from "./trend-stats";
import { executeTeamReverseLookup } from "./reverse-lookup-engine";
import { executePlayerPropQueryFromDB } from "./prop-trend-engine";
import { getKenpomRatings, getKenpomFanMatch, lookupRating, type KenpomRating, type KenpomFanMatch } from "./kenpom";
import { getCFBDRatings, lookupCFBDRating, type CFBDRating } from "./cfbd";
import type { Sport } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ReasoningEntry {
  angle: string;
  weight: number;
  strength: "strong" | "moderate" | "weak" | "noise";
  record?: string;
}

export interface GeneratedPick {
  sport: Sport;
  pickType: "SPREAD" | "OVER_UNDER" | "PLAYER_PROP";
  homeTeam: string;
  awayTeam: string;
  gameDate: Date;
  pickSide: string;
  line: number | null;
  pickLabel: string;
  playerName: string | null;
  propStat: string | null;
  propLine: number | null;
  trendScore: number;
  confidence: number;
  headline: string;
  reasoning: ReasoningEntry[];
  homeRank: number | null;
  awayRank: number | null;
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number; // 0-10
  confidence: number; // 0-1
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
}

// ─── Signal Weight Configs ───────────────────────────────────────────────────

const SPREAD_WEIGHTS: Record<string, Record<string, number>> = {
  NCAAMB: {
    modelEdge: 0.30,
    seasonATS: 0.15,
    trendAngles: 0.25,
    recentForm: 0.10,  // v6: reduced from 0.15 to make room for marketEdge
    h2h: 0.05,         // v6: reduced from 0.10 to make room for marketEdge
    situational: 0.00,
    restDays: 0.05,
    marketEdge: 0.10,  // v6: KenPom WP vs moneyline implied probability
  },
  NFL: {
    modelEdge: 0.20,
    seasonATS: 0.15,
    trendAngles: 0.25,
    recentForm: 0.20,
    h2h: 0.10,
    situational: 0.10,
  },
  NCAAF: {
    modelEdge: 0.30,     // SP+ efficiency ratings (up from 0.20 with power ratings)
    seasonATS: 0.15,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2h: 0.10,
    situational: 0.10,
  },
  NBA: {
    modelEdge: 0.25,
    seasonATS: 0.15,
    trendAngles: 0.25,
    recentForm: 0.15,
    h2h: 0.05,
    situational: 0.05,
    restDays: 0.10,
  },
};

const OU_WEIGHTS: Record<string, Record<string, number>> = {
  NCAAMB: {
    modelEdge: 0.35, // v7: OLS regression predicted total (69.3% accuracy, +32% ROI)
    seasonOU: 0.12,
    trendAngles: 0.18,
    recentForm: 0.08,
    h2hWeather: 0.12,
    tempoDiff: 0.15, // v5: tempo mismatch signal (5★ O/U +2.9% ROI)
  },
  NFL: {
    modelEdge: 0.20,
    seasonOU: 0.20,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2hWeather: 0.25,
  },
  NCAAF: {
    modelEdge: 0.30,     // SP+ efficiency ratings (up from 0.20 with power ratings)
    seasonOU: 0.15,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2hWeather: 0.20,
  },
  NBA: {
    modelEdge: 0.25,
    seasonOU: 0.20,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2hWeather: 0.05,
    tempoDiff: 0.15,
  },
};

// ─── Team Name Resolution ────────────────────────────────────────────────────

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
};

async function resolveCanonicalName(
  name: string,
  sport: string,
): Promise<string> {
  const exact = await prisma.team.findFirst({
    where: { sport: sport as Sport, name },
    select: { name: true },
  });
  if (exact) return exact.name;

  if (NAME_ALIASES[name]) return NAME_ALIASES[name];

  const variants = [
    name.replace(/ State$/, " St."),
    name.replace(/-/g, " "),
    name.replace(/ State$/, " St.").replace(/-/g, " "),
  ];
  for (const v of variants) {
    const match = await prisma.team.findFirst({
      where: { sport: sport as Sport, name: v },
      select: { name: true },
    });
    if (match) return match.name;
  }

  return name;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentSeason(sport: string, date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  if (sport === "NCAAMB") {
    return month >= 10 ? year + 1 : year;
  }
  return month <= 2 ? year - 1 : year;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Convert a DiscoveredAngle's interestScore to a pick weight.
 */
function interestToWeight(interestScore: number): number {
  if (interestScore >= 70) return 10;
  if (interestScore >= 50) return 7;
  if (interestScore >= 35) return 5;
  if (interestScore >= 20) return 3;
  return 1;
}

// ─── Season Stats ────────────────────────────────────────────────────────────

interface TeamStats {
  wins: number;
  losses: number;
  atsCovered: number;
  atsLost: number;
  atsPct: number;
  overs: number;
  unders: number;
  overPct: number;
  last5AtsCov: number;
  last5AtsLost: number;
  last5OUOvers: number;
  last5OUUnders: number;
}

function buildTeamStats(
  allGames: TrendGame[],
  team: string,
  sport: string,
  season: number,
): TeamStats {
  const teamGames = allGames
    .filter(
      (g) =>
        g.sport === sport &&
        g.season === season &&
        (g.homeTeam === team || g.awayTeam === team),
    )
    .sort((a, b) => (a.gameDate || "").localeCompare(b.gameDate || ""));

  let wins = 0, losses = 0, atsCov = 0, atsLost = 0, overs = 0, unders = 0;

  for (const g of teamGames) {
    const isHome = g.homeTeam === team;
    const won = isHome ? g.scoreDifference > 0 : g.scoreDifference < 0;
    if (won) wins++;
    else if (g.scoreDifference !== 0) losses++;

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

  const last5 = teamGames.slice(-5);
  let l5AtsCov = 0, l5AtsLost = 0, l5OUOver = 0, l5OUUnder = 0;
  for (const g of last5) {
    const isHome = g.homeTeam === team;
    if (isHome) {
      if (g.spreadResult === "COVERED") l5AtsCov++;
      else if (g.spreadResult === "LOST") l5AtsLost++;
    } else {
      if (g.spreadResult === "COVERED") l5AtsLost++;
      else if (g.spreadResult === "LOST") l5AtsCov++;
    }
    if (g.ouResult === "OVER") l5OUOver++;
    else if (g.ouResult === "UNDER") l5OUUnder++;
  }

  const atsTotal = atsCov + atsLost;
  const ouTotal = overs + unders;

  return {
    wins,
    losses,
    atsCovered: atsCov,
    atsLost,
    atsPct: atsTotal > 0 ? Math.round((atsCov / atsTotal) * 1000) / 10 : 50,
    overs,
    unders,
    overPct: ouTotal > 0 ? Math.round((overs / ouTotal) * 1000) / 10 : 50,
    last5AtsCov: l5AtsCov,
    last5AtsLost: l5AtsLost,
    last5OUOvers: l5OUOver,
    last5OUUnders: l5OUUnder,
  };
}

// ─── H2H Stats ───────────────────────────────────────────────────────────────

interface H2HStats {
  totalGames: number;
  homeAtsCov: number;
  homeAtsLost: number;
  avgTotalPoints: number;
  overs: number;
  unders: number;
}

function buildH2H(
  allGames: TrendGame[],
  homeTeam: string,
  awayTeam: string,
  sport: string,
): H2HStats {
  const matchups = allGames.filter(
    (g) =>
      g.sport === sport &&
      ((g.homeTeam === homeTeam && g.awayTeam === awayTeam) ||
        (g.homeTeam === awayTeam && g.awayTeam === homeTeam)),
  );

  let homeAtsCov = 0, homeAtsLost = 0, totalPts = 0, overs = 0, unders = 0;

  for (const g of matchups) {
    totalPts += (g.homeScore || 0) + (g.awayScore || 0);
    if (g.homeTeam === homeTeam) {
      if (g.spreadResult === "COVERED") homeAtsCov++;
      else if (g.spreadResult === "LOST") homeAtsLost++;
    } else {
      if (g.spreadResult === "COVERED") homeAtsLost++;
      else if (g.spreadResult === "LOST") homeAtsCov++;
    }
    if (g.ouResult === "OVER") overs++;
    else if (g.ouResult === "UNDER") unders++;
  }

  return {
    totalGames: matchups.length,
    homeAtsCov,
    homeAtsLost,
    avgTotalPoints: matchups.length > 0 ? Math.round((totalPts / matchups.length) * 10) / 10 : 0,
    overs,
    unders,
  };
}

// ─── Model Edge: KenPom (NCAAMB) ────────────────────────────────────────────
//
// Research-backed model from 93,554 games (2010-2025), LOSO validated.
// 14-topic analysis with 10 iterations each. Key findings:
//
// SPREAD: kenpom_edge = (homeEM - awayEM) + HCA + spread
//   - HCA = 2.0 (optimal, was 3.5; conference=2.5, non-conf=1.5, March=0.5)
//   - Home side (edge > 0): only profitable Nov-Dec (60.2%). Jan+ drops to 52%.
//   - Away side (edge < 0): stable year-round (57-58%).
//   - March top-25 home: 43.8% cover (regression/fatigue → fade).
//
// O/U: Regression-predicted total (v7, 69.3% accuracy, +32% ROI on test set)
//   - OLS on AdjDE_sum + AdjOE_sum + AdjTempo_avg + FM_total + conference
//   - Replaces v4 sumAdjDE thresholds (51.2%) with continuous prediction
//   - Contextual overrides: top-50 (78% UNDER), power conf (70% UNDER),
//     200+ (69% OVER), March UNDER, line range bias

function computeKenPomEdge(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
  sport: string,
  spread: number | null,
  overUnder: number | null,
  gameDate: Date,
  fanMatch: KenpomFanMatch[] | null = null,
): { spread: SignalResult; ou: SignalResult; ouMeta?: { absEdge: number; avgTempo: number; ouDir: "over" | "under" } } {
  const neutral: SignalResult = {
    category: "modelEdge",
    direction: "neutral",
    magnitude: 0,
    confidence: 0,
    label: "No KenPom data available",
    strength: "noise",
  };

  if (sport !== "NCAAMB" || !ratings) return { spread: neutral, ou: { ...neutral } };

  const homeRating = lookupRating(ratings, homeTeam);
  const awayRating = lookupRating(ratings, awayTeam);

  if (!homeRating || !awayRating) {
    return { spread: neutral, ou: { ...neutral } };
  }

  const homeEM = homeRating.AdjEM;
  const awayEM = awayRating.AdjEM;
  const homeTempo = homeRating.AdjTempo;
  const awayTempo = awayRating.AdjTempo;
  const homeDE = homeRating.AdjDE;
  const awayDE = awayRating.AdjDE;
  const gameMonth = gameDate.getMonth() + 1; // 1-indexed

  // v6: Look up FanMatch prediction for this specific game
  const fm = fanMatch?.find(
    (f) => f.Home.toLowerCase() === homeTeam.toLowerCase()
      && f.Visitor.toLowerCase() === awayTeam.toLowerCase(),
  ) ?? null;

  // ── Spread: kenpom_edge with season-half awareness ──
  let spreadSignal: SignalResult = neutral;
  if (spread !== null) {
    let predictedMargin: number;
    let marginSource: string;

    if (fm) {
      // v6: FanMatch game-level prediction (accounts for HCA, travel, altitude)
      predictedMargin = fm.HomePred - fm.VisitorPred;
      marginSource = `FanMatch: ${fm.HomePred.toFixed(0)}-${fm.VisitorPred.toFixed(0)} (WP ${(fm.HomeWP * 100).toFixed(0)}%)`;
    } else {
      // Fallback: AdjEM + context-aware HCA
      const isConfGame = homeRating.ConfShort === awayRating.ConfShort;
      const hca = isConfGame ? 2.5
        : gameMonth >= 3 && gameMonth <= 4 ? 0.5  // March Madness (neutral sites)
        : gameMonth >= 11 ? 1.0                    // November (MTE/exempt tourneys)
        : 1.5;                                      // non-conference regular season
      predictedMargin = homeEM - awayEM + hca;
      marginSource = `AdjEM (HCA=${hca.toFixed(1)})`;
    }
    const spreadEdge = predictedMargin + spread; // spread negative when home favored
    let absMag = clamp(Math.abs(spreadEdge) / 0.7, 0, 10);
    let conf = 0.8;

    // v4 Season-half adjustment (backtest validated):
    // Home-side KenPom edge (positive) is a LOSING signal after November.
    // Backtest: home edge >+6 → 48.3% (losing), away edge <-6 → 53.6% (profitable).
    // After Nov: flip home-side edges to contrarian away fade.
    const isEarlySeason = gameMonth >= 11; // Nov, Dec
    let marchNote = "";
    let seasonNote = "";

    if (spreadEdge > 0.5 && !isEarlySeason) {
      // March top-25 home: strongest fade (43.8% hist.)
      if (gameMonth === 3 && homeRating.RankAdjEM <= 25) {
        absMag *= 0.25;
        conf = 0.35;
        marchNote = " [March top-25 home fade: 44% hist.]";
      } else {
        // Jan-Apr: home-side edge runs 47-48% — fade it
        absMag *= 0.20;
        conf = 0.30;
        seasonNote = " [home edge faded Jan+: 47% hist.]";
      }
    }
    spreadSignal = {
      category: "modelEdge",
      direction: spreadEdge > 0.5 ? "home" : spreadEdge < -0.5 ? "away" : "neutral",
      magnitude: absMag,
      confidence: conf,
      label: `KenPom [${marginSource}]: #${homeRating.RankAdjEM} (${homeEM > 0 ? "+" : ""}${homeEM.toFixed(1)}) vs #${awayRating.RankAdjEM} (${awayEM > 0 ? "+" : ""}${awayEM.toFixed(1)}), edge ${spreadEdge > 0 ? "+" : ""}${spreadEdge.toFixed(1)}${seasonNote}${marchNote}`,
      strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
    };
  }

  // ── O/U: Ridge regression-predicted total (v9) ──
  // PIT Ridge λ=1000, 4 features, trained on 70,303 games (2012-2025 PIT snapshots).
  // Walk-forward validated: 62.8% across 14 seasons (13/14 profitable).
  // Coefficients from scripts/backtest/extract-pit-coefficients.js.
  let ouSignal: SignalResult = { ...neutral };
  let ouMeta: { absEdge: number; avgTempo: number; ouDir: "over" | "under" } | undefined;
  if (overUnder !== null) {
    const sumAdjDE = homeDE + awayDE;
    const sumAdjOE = homeRating.AdjOE + awayRating.AdjOE;
    const avgTempo = (homeTempo + awayTempo) / 2;

    // v9: PIT Ridge λ=1000, trained on 70,303 games (2012-2025 PIT snapshots)
    const predictedTotal =
      -233.5315 +
      0.4346 * sumAdjDE +
      0.4451 * sumAdjOE +
      2.8399 * avgTempo;

    const edge = predictedTotal - overUnder;
    let ouDir: "over" | "under" | "neutral" = "neutral";
    let ouMag = 0;
    let ouConf = 0;
    const labelParts: string[] = [];

    // Edge-to-magnitude mapping based on regression confidence buckets:
    // |edge| >= 5: 76.5% accuracy (high conf), |edge| 2-5: 59.4% (medium)
    const absEdge = Math.abs(edge);
    if (absEdge >= 10) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 10; ouConf = 0.93;
    } else if (absEdge >= 7) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 9; ouConf = 0.90;
    } else if (absEdge >= 5) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 8; ouConf = 0.85;
    } else if (absEdge >= 3) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 6; ouConf = 0.75;
    } else if (absEdge >= 2) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 5; ouConf = 0.65;
    } else if (absEdge >= 1.5) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 3; ouConf = 0.55;
    } else {
      // |edge| < 1.5: too close to call (tightened from 1.0 — v7 backtest showed marginal edges dilute quality)
      labelParts.push(`regression pred=${predictedTotal.toFixed(1)} (edge ${edge > 0 ? "+" : ""}${edge.toFixed(1)}, neutral)`);
    }

    if (ouDir !== "neutral") {
      labelParts.push(`regression pred=${predictedTotal.toFixed(1)} vs line ${overUnder} (edge ${edge > 0 ? "+" : ""}${edge.toFixed(1)})`);
      labelParts.push(`DE_sum=${sumAdjDE.toFixed(0)} OE_sum=${sumAdjOE.toFixed(0)} tempo=${avgTempo.toFixed(1)}`);
    }

    // v8+: All contextual overrides removed. Ridge regression alone validated at 62.8% PIT.

    const finalMag = clamp(ouMag, 0, 10);
    ouSignal = {
      category: "modelEdge",
      direction: ouDir,
      magnitude: finalMag,
      confidence: ouConf,
      label: `KenPom O/U: ${labelParts.join(" | ")}`,
      strength: finalMag >= 6 ? "strong" : finalMag >= 3 ? "moderate" : finalMag >= 1 ? "weak" : "noise",
    };

    if (ouDir !== "neutral") {
      ouMeta = { absEdge, avgTempo, ouDir: ouDir as "over" | "under" };
    }
  }

  return { spread: spreadSignal, ou: ouSignal, ouMeta };
}

// ─── Model Edge: Power Rating (NFL/NCAAF) ───────────────────────────────────

function computePowerRatingEdge(
  allGames: TrendGame[],
  homeTeam: string,
  awayTeam: string,
  sport: string,
  currentSeason: number,
  spread: number | null,
  overUnder: number | null,
): { spread: SignalResult; ou: SignalResult } {
  const neutral: SignalResult = {
    category: "modelEdge",
    direction: "neutral",
    magnitude: 0,
    confidence: 0,
    label: "Insufficient data for power rating",
    strength: "noise",
  };

  function getTeamPR(team: string) {
    const games = allGames.filter((g) =>
      g.sport === sport && g.season === currentSeason &&
      (g.homeTeam === team || g.awayTeam === team),
    );
    if (games.length < 4) return null;

    let totalMargin = 0, totalFor = 0, totalAgainst = 0;
    for (const g of games) {
      const isHome = g.homeTeam === team;
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const oppScore = isHome ? g.awayScore : g.homeScore;
      totalMargin += teamScore - oppScore;
      totalFor += teamScore;
      totalAgainst += oppScore;
    }
    return {
      avgMargin: totalMargin / games.length,
      avgFor: totalFor / games.length,
      avgAgainst: totalAgainst / games.length,
      gameCount: games.length,
    };
  }

  const homePR = getTeamPR(homeTeam);
  const awayPR = getTeamPR(awayTeam);

  if (!homePR || !awayPR) return { spread: neutral, ou: { ...neutral } };

  const hca = sport === "NFL" ? 2.5 : 3.0;
  const predictedMargin = (homePR.avgMargin - awayPR.avgMargin) / 2 + hca;

  // Predicted total
  const homeExpected = (homePR.avgFor + awayPR.avgAgainst) / 2;
  const awayExpected = (awayPR.avgFor + homePR.avgAgainst) / 2;
  const predictedTotal = homeExpected + awayExpected;

  // Lower confidence than KenPom — power rating is crude
  const baseConfidence = clamp(
    0.3 + (Math.min(homePR.gameCount, awayPR.gameCount) - 4) * 0.03,
    0.3, 0.55,
  );

  // Spread signal
  let spreadSignal: SignalResult = neutral;
  if (spread !== null) {
    const spreadEdge = predictedMargin + spread;
    const absMag = clamp(Math.abs(spreadEdge) / 1.0, 0, 10);
    spreadSignal = {
      category: "modelEdge",
      direction: spreadEdge > 1.0 ? "home" : spreadEdge < -1.0 ? "away" : "neutral",
      magnitude: absMag,
      confidence: baseConfidence,
      label: `Power rating: predicted margin ${predictedMargin > 0 ? "+" : ""}${predictedMargin.toFixed(1)}, line ${spread > 0 ? "+" : ""}${spread}, edge ${spreadEdge > 0 ? "+" : ""}${spreadEdge.toFixed(1)}`,
      strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
    };
  }

  // O/U signal
  let ouSignal: SignalResult = { ...neutral };
  if (overUnder !== null) {
    const totalEdge = predictedTotal - overUnder;
    const absMag = clamp(Math.abs(totalEdge) / 2.0, 0, 10);
    ouSignal = {
      category: "modelEdge",
      direction: totalEdge > 2.0 ? "over" : totalEdge < -2.0 ? "under" : "neutral",
      magnitude: absMag,
      confidence: baseConfidence * 0.9,
      label: `Power rating total: predicted ${predictedTotal.toFixed(1)} vs line ${overUnder} (${totalEdge > 0 ? "+" : ""}${totalEdge.toFixed(1)})`,
      strength: absMag >= 5 ? "strong" : absMag >= 3 ? "moderate" : absMag >= 1 ? "weak" : "noise",
    };
  }

  return { spread: spreadSignal, ou: ouSignal };
}

// ─── Model Edge: SP+ Ratings (NCAAF) ─────────────────────────────────────────
// Uses CollegeFootballData.com SP+ efficiency ratings as the NCAAF equivalent
// of KenPom for NCAAMB. SP+ overall ≈ AdjEM, offense ≈ AdjOE, defense ≈ AdjDE.

function computeSPEdge(
  cfbdRatings: Map<string, CFBDRating>,
  homeTeam: string,
  awayTeam: string,
  spread: number | null,
  overUnder: number | null,
  isNeutralSite = false,
): { spread: SignalResult; ou: SignalResult } {
  const neutral: SignalResult = {
    category: "modelEdge",
    direction: "neutral",
    magnitude: 0,
    confidence: 0,
    label: "No SP+ data available",
    strength: "noise",
  };

  const homeR = lookupCFBDRating(cfbdRatings, homeTeam);
  const awayR = lookupCFBDRating(cfbdRatings, awayTeam);

  if (!homeR || !awayR) return { spread: neutral, ou: { ...neutral } };

  const homeEM = homeR.rating;   // SP+ overall
  const awayEM = awayR.rating;
  const homeOff = homeR.offense.rating;
  const awayOff = awayR.offense.rating;
  const homeDef = homeR.defense.rating;
  const awayDef = awayR.defense.rating;

  const hca = isNeutralSite ? 0 : 3.0;  // NCAAF HCA ~3 points

  // ── Spread: SP+ predicted margin ──
  let spreadSignal: SignalResult = neutral;
  if (spread !== null) {
    const predictedMargin = homeEM - awayEM + hca;
    const spreadEdge = predictedMargin + spread;
    const absMag = clamp(Math.abs(spreadEdge) / 0.8, 0, 10);  // More sensitive than power rating (1.0)
    const conf = 0.75;  // SP+ is well-calibrated; higher than crude power rating (0.55)

    spreadSignal = {
      category: "modelEdge",
      direction: spreadEdge > 0.5 ? "home" : spreadEdge < -0.5 ? "away" : "neutral",
      magnitude: absMag,
      confidence: conf,
      label: `SP+ [#${homeR.ranking} ${homeEM > 0 ? "+" : ""}${homeEM.toFixed(1)} vs #${awayR.ranking} ${awayEM > 0 ? "+" : ""}${awayEM.toFixed(1)}]: margin ${predictedMargin > 0 ? "+" : ""}${predictedMargin.toFixed(1)}, edge ${spreadEdge > 0 ? "+" : ""}${spreadEdge.toFixed(1)}`,
      strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
    };
  }

  // ── O/U: SP+ predicted total via offense/defense matchups ──
  let ouSignal: SignalResult = { ...neutral };
  if (overUnder !== null) {
    // SP+ defense is inverse to KenPom (lower = better defense in SP+)
    // Predicted total based on offense/defense matchups:
    // Each team's expected score ≈ (teamOff - oppDef) adjusted to average
    const avgTotal = 49;  // NCAAF average total points
    const homeExpected = avgTotal / 2 + (homeOff + awayDef) / 4;
    const awayExpected = avgTotal / 2 + (awayOff + homeDef) / 4;
    const predictedTotal = homeExpected + awayExpected;

    const edge = predictedTotal - overUnder;
    const absEdge = Math.abs(edge);

    let ouDir: "over" | "under" | "neutral" = "neutral";
    let ouMag = 0;
    let ouConf = 0;

    // Edge-to-confidence mapping (similar to KenPom regression, but less tuned)
    if (absEdge >= 8) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 9; ouConf = 0.85;
    } else if (absEdge >= 5) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 7; ouConf = 0.75;
    } else if (absEdge >= 3) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 5; ouConf = 0.65;
    } else if (absEdge >= 2) {
      ouDir = edge > 0 ? "over" : "under";
      ouMag = 4; ouConf = 0.55;
    } else {
      // < 2 points: too close
    }

    if (ouDir !== "neutral") {
      ouSignal = {
        category: "modelEdge",
        direction: ouDir,
        magnitude: ouMag,
        confidence: ouConf,
        label: `SP+ O/U: pred=${predictedTotal.toFixed(1)} vs line ${overUnder} (edge ${edge > 0 ? "+" : ""}${edge.toFixed(1)}), Off=${(homeOff + awayOff).toFixed(0)} Def=${(homeDef + awayDef).toFixed(0)}`,
        strength: ouMag >= 7 ? "strong" : ouMag >= 4 ? "moderate" : ouMag >= 1.5 ? "weak" : "noise",
      };
    }
  }

  return { spread: spreadSignal, ou: ouSignal };
}

// ─── Auto-Discovered Angle Signals ──────────────────────────────────────────

interface AngleSignal {
  label: string;
  record: string;
  rate: number;
  weight: number;
  favors: "home" | "away";
  strength: ReasoningEntry["strength"];
  isATS: boolean;
}

interface OUAngleSignal {
  label: string;
  record: string;
  rate: number;
  weight: number;
  favors: "over" | "under";
  strength: ReasoningEntry["strength"];
}

async function discoverTeamAngles(
  sport: Sport,
  team: string,
  side: "home" | "away",
  currentSeason: number,
): Promise<{ ats: AngleSignal[]; ou: OUAngleSignal[] }> {
  const ats: AngleSignal[] = [];
  const ou: OUAngleSignal[] = [];

  try {
    // Reverse lookup only supports NFL/NCAAF/NCAAMB — skip for NBA
    if (sport === "NBA") return { ats, ou };

    const result = await executeTeamReverseLookup(
      sport,
      team,
      [currentSeason - 2, currentSeason],
      10,
    );

    for (const angle of result.angles) {
      const weight = interestToWeight(angle.interestScore);

      // ATS signals
      if (angle.atsSignificance.strength !== "noise") {
        const atsPct = angle.record.atsPct;
        const favorsTeam = atsPct > 50;

        ats.push({
          label: `${team}: ${angle.headline}`,
          record: angle.record.atsRecord,
          rate: atsPct,
          weight,
          favors: favorsTeam ? side : (side === "home" ? "away" : "home"),
          strength: angle.atsSignificance.strength,
          isATS: true,
        });
      }

      // O/U signals
      if (angle.ouSignificance && angle.ouSignificance.strength !== "noise") {
        const overPct = angle.record.overPct;
        ou.push({
          label: `${team}: ${angle.template.label} O/U: ${angle.record.ouRecord}`,
          record: angle.record.ouRecord,
          rate: overPct,
          weight: Math.round(weight * 0.7),
          favors: overPct > 50 ? "over" : "under",
          strength: angle.ouSignificance.strength,
        });
      }
    }
  } catch (err) {
    console.error(`[pick-engine] Reverse lookup failed for ${team}:`, err);
  }

  return { ats, ou };
}

// ─── Signal Functions: Spread ────────────────────────────────────────────────

function signalSeasonATS(homeStats: TeamStats, awayStats: TeamStats, sport: Sport = "NFL"): SignalResult {
  const homeTotal = homeStats.atsCovered + homeStats.atsLost;
  const awayTotal = awayStats.atsCovered + awayStats.atsLost;

  // Wilson lower bound edge for each side
  const homeEdge = homeTotal >= 5
    ? wilsonInterval(homeStats.atsCovered, homeTotal)[0] - 0.5
    : 0;
  const awayEdge = awayTotal >= 5
    ? wilsonInterval(awayStats.atsCovered, awayTotal)[0] - 0.5
    : 0;

  // Net edge: positive favors home
  let netEdge = homeEdge - awayEdge;

  // v5: NCAAMB ATS fade — strong ATS records mean-revert (55.4% when fading, +6% ROI)
  // Teams that have been covering tend to stop covering. Flip direction for contrarian edge.
  if (sport === "NCAAMB") {
    netEdge = -netEdge;
  }

  const absMag = clamp(Math.abs(netEdge) * 50, 0, 10);

  // Confidence increases with sample size
  const minGames = Math.min(homeTotal, awayTotal);
  const conf = clamp(0.3 + minGames * 0.02, 0.3, 0.8);

  if (absMag < 0.5) {
    return {
      category: "seasonATS",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `Season ATS: home ${homeStats.atsCovered}-${homeStats.atsLost}, away ${awayStats.atsCovered}-${awayStats.atsLost}`,
      strength: "noise",
    };
  }

  const favorsSide = netEdge > 0 ? "home" as const : "away" as const;
  const favStats = favorsSide === "home" ? homeStats : awayStats;
  const oppStats = favorsSide === "home" ? awayStats : homeStats;
  const fadeLabel = sport === "NCAAMB" ? " (fade)" : "";

  return {
    category: "seasonATS",
    direction: favorsSide,
    magnitude: absMag,
    confidence: conf,
    label: `Season ATS${fadeLabel}: ${favStats.atsCovered}-${favStats.atsLost} (${favStats.atsPct}%) vs opponent ${oppStats.atsCovered}-${oppStats.atsLost} (${oppStats.atsPct}%)`,
    strength: absMag >= 7 ? "strong" : absMag >= 3.5 ? "moderate" : "weak",
  };
}

function signalTrendAnglesSpread(
  homeAngles: AngleSignal[],
  awayAngles: AngleSignal[],
): SignalResult {
  const allAngles = [...homeAngles, ...awayAngles];
  if (allAngles.length === 0) {
    return {
      category: "trendAngles",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "No trend angles discovered",
      strength: "noise",
    };
  }

  // Weight by strength: strong=3, moderate=2, weak=1
  const strengthMultiplier: Record<string, number> = { strong: 3, moderate: 2, weak: 1, noise: 0 };
  let homeScore = 0, awayScore = 0, totalScore = 0, significantCount = 0;

  for (const a of allAngles) {
    const w = strengthMultiplier[a.strength] || 0;
    if (w === 0) continue;
    totalScore += w;
    if (a.favors === "home") homeScore += w;
    else awayScore += w;
    if (a.strength === "strong" || a.strength === "moderate") significantCount++;
  }

  if (totalScore === 0) {
    return {
      category: "trendAngles",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "All trend angles are noise",
      strength: "noise",
    };
  }

  const dominance = Math.abs(homeScore - awayScore) / totalScore;
  const magnitude = clamp(dominance * 10 + significantCount * 0.5, 0, 10);
  const conf = clamp(0.4 + significantCount * 0.08, 0.4, 0.9);
  const dir = homeScore > awayScore ? "home" as const : homeScore < awayScore ? "away" as const : "neutral" as const;

  const homeAngleCount = allAngles.filter((a) => a.favors === "home" && a.strength !== "noise").length;
  const awayAngleCount = allAngles.filter((a) => a.favors === "away" && a.strength !== "noise").length;

  return {
    category: "trendAngles",
    direction: dir,
    magnitude,
    confidence: conf,
    label: `${homeAngleCount + awayAngleCount} angles: ${homeAngleCount} home, ${awayAngleCount} away (${significantCount} significant)`,
    strength: magnitude >= 7 ? "strong" : magnitude >= 4 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}

function signalRecentForm(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5AtsCov + homeStats.last5AtsLost;
  const awayL5 = awayStats.last5AtsCov + awayStats.last5AtsLost;

  if (homeL5 < 3 && awayL5 < 3) {
    return {
      category: "recentForm",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "Insufficient recent data",
      strength: "noise",
    };
  }

  // Net momentum: positive = home hot, negative = away hot
  const homeRate = homeL5 > 0 ? homeStats.last5AtsCov / homeL5 : 0.5;
  const awayRate = awayL5 > 0 ? awayStats.last5AtsCov / awayL5 : 0.5;
  const netMomentum = homeRate - awayRate;

  let magnitude = clamp(Math.abs(netMomentum) * 10, 0, 10);

  // Streak bonuses
  if (homeStats.last5AtsCov >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (homeStats.last5AtsCov >= 4) magnitude = Math.min(magnitude + 1, 10);
  if (awayStats.last5AtsCov >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (awayStats.last5AtsCov >= 4) magnitude = Math.min(magnitude + 1, 10);

  const conf = clamp(0.4 + Math.min(homeL5, awayL5) * 0.08, 0.4, 0.7);

  if (magnitude < 1) {
    return {
      category: "recentForm",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `Last 5 ATS: home ${homeStats.last5AtsCov}-${homeStats.last5AtsLost}, away ${awayStats.last5AtsCov}-${awayStats.last5AtsLost}`,
      strength: "noise",
    };
  }

  return {
    category: "recentForm",
    direction: netMomentum > 0 ? "home" : "away",
    magnitude,
    confidence: conf,
    label: `Last 5 ATS: home ${homeStats.last5AtsCov}-${homeStats.last5AtsLost}, away ${awayStats.last5AtsCov}-${awayStats.last5AtsLost}`,
    strength: magnitude >= 7 ? "strong" : magnitude >= 4 ? "moderate" : "weak",
  };
}

function signalH2HSpread(h2h: H2HStats): SignalResult {
  if (h2h.totalGames < 3) {
    return {
      category: "h2h",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `H2H: ${h2h.totalGames} games (insufficient)`,
      strength: "noise",
    };
  }

  const h2hTotal = h2h.homeAtsCov + h2h.homeAtsLost;
  if (h2hTotal < 3) {
    return {
      category: "h2h",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "H2H ATS data insufficient",
      strength: "noise",
    };
  }

  const [lower] = wilsonInterval(h2h.homeAtsCov, h2hTotal);
  const edge = lower - 0.5;
  const magnitude = clamp(Math.abs(edge) * 40, 0, 10);
  const conf = clamp(0.3 + h2hTotal * 0.03, 0.3, 0.7);

  if (magnitude < 0.5) {
    return {
      category: "h2h",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `H2H ATS: ${h2h.homeAtsCov}-${h2h.homeAtsLost} (even)`,
      strength: "noise",
    };
  }

  const h2hPct = Math.round((h2h.homeAtsCov / h2hTotal) * 100);

  return {
    category: "h2h",
    direction: edge > 0 ? "home" : "away",
    magnitude,
    confidence: conf,
    label: `H2H ATS: ${h2h.homeAtsCov}-${h2h.homeAtsLost} (${h2hPct}%) in ${h2hTotal} games`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

function signalSituational(
  forecastWindMph: number | null,
  forecastTemp: number | null,
  forecastCategory: string | null,
  sport: string,
): SignalResult {
  if (sport === "NCAAMB") {
    return {
      category: "situational",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "Indoor sport",
      strength: "noise",
    };
  }

  let magnitude = 0;
  const parts: string[] = [];

  if (forecastWindMph !== null && forecastWindMph >= 20) {
    magnitude += forecastWindMph >= 30 ? 4 : 2;
    parts.push(`Wind: ${forecastWindMph} mph`);
  }

  if (forecastTemp !== null && forecastTemp <= 20) {
    magnitude += 2;
    parts.push(`Cold: ${forecastTemp}°F`);
  }

  if (forecastCategory === "SNOW") {
    magnitude += 3;
    parts.push("Snow game");
  } else if (forecastCategory === "RAIN") {
    magnitude += 1;
    parts.push("Rain");
  }

  magnitude = clamp(magnitude, 0, 10);

  if (magnitude < 1) {
    return {
      category: "situational",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "No significant situational factors",
      strength: "noise",
    };
  }

  return {
    category: "situational",
    direction: "home", // Weather generally favors home team
    magnitude,
    confidence: 0.4,
    label: parts.join(", ") + " — home advantage",
    strength: magnitude >= 5 ? "moderate" : "weak",
  };
}

// ─── Signal: Rest Days / Back-to-Back ────────────────────────────────────────
// v4: Home team on B2B (≤1 day rest) covers at only ~42%. Fade home in that spot.

function signalRestDays(
  allGames: TrendGame[],
  canonHome: string,
  canonAway: string,
  gameDate: string,
  sport: Sport,
): SignalResult {
  // Only meaningful for NCAAMB (frequent B2B in conference play)
  if (sport !== "NCAAMB") {
    return { category: "restDays", direction: "neutral", magnitude: 0, confidence: 0, label: "N/A", strength: "noise" };
  }

  const gameDateObj = new Date(gameDate + "T12:00:00Z");
  const oneDayAgo = new Date(gameDateObj.getTime() - 36 * 60 * 60 * 1000); // 36h window

  // Find most recent game for each team before this game date
  let homeLastGame: string | null = null;
  let awayLastGame: string | null = null;

  for (const g of allGames) {
    if (g.gameDate >= gameDate) continue; // only prior games
    if (g.homeTeam === canonHome || g.awayTeam === canonHome) {
      if (!homeLastGame || g.gameDate > homeLastGame) homeLastGame = g.gameDate;
    }
    if (g.homeTeam === canonAway || g.awayTeam === canonAway) {
      if (!awayLastGame || g.gameDate > awayLastGame) awayLastGame = g.gameDate;
    }
  }

  const homeOnB2B = homeLastGame ? new Date(homeLastGame + "T12:00:00Z") >= oneDayAgo : false;
  const awayOnB2B = awayLastGame ? new Date(awayLastGame + "T12:00:00Z") >= oneDayAgo : false;

  if (homeOnB2B && !awayOnB2B) {
    // Home team on B2B, away rested → pro-away
    return {
      category: "restDays",
      direction: "away",
      magnitude: 5,
      confidence: 0.65,
      label: `${canonHome} on B2B, ${canonAway} rested`,
      strength: "moderate",
    };
  } else if (awayOnB2B && !homeOnB2B) {
    // Away on B2B, home rested → slight pro-home (but weaker — home advantage already priced)
    return {
      category: "restDays",
      direction: "home",
      magnitude: 3,
      confidence: 0.55,
      label: `${canonAway} on B2B, ${canonHome} rested`,
      strength: "weak",
    };
  } else if (homeOnB2B && awayOnB2B) {
    // Both on B2B — wash
    return {
      category: "restDays",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "Both teams on B2B",
      strength: "noise",
    };
  }

  return { category: "restDays", direction: "neutral", magnitude: 0, confidence: 0, label: "Normal rest", strength: "noise" };
}

// ─── Signal: Moneyline Market Edge (Spread) ──────────────────────────────────
// v6: Compare KenPom win probability vs market-implied probability from moneylines.
// Large divergence signals a mispriced line or sharp model edge.

function signalMoneylineEdge(
  moneylineHome: number | null,
  moneylineAway: number | null,
  kenpomHomeWP: number | null,
): SignalResult {
  const neutral: SignalResult = {
    category: "marketEdge", direction: "neutral",
    magnitude: 0, confidence: 0, label: "N/A", strength: "noise",
  };

  if (moneylineHome == null || moneylineAway == null || kenpomHomeWP == null) return neutral;

  // Convert American moneylines to implied probabilities
  const impliedHome = moneylineHome < 0
    ? (-moneylineHome) / (-moneylineHome + 100)
    : 100 / (moneylineHome + 100);
  const impliedAway = moneylineAway < 0
    ? (-moneylineAway) / (-moneylineAway + 100)
    : 100 / (moneylineAway + 100);

  // Remove vig: normalize to sum to 1.0
  const totalImplied = impliedHome + impliedAway;
  if (totalImplied <= 0) return neutral;
  const marketHomeWP = impliedHome / totalImplied;

  // Edge = KenPom WP - Market WP (positive = KenPom likes home more)
  const edge = kenpomHomeWP - marketHomeWP;
  const absEdge = Math.abs(edge);

  if (absEdge < 0.08) return neutral; // Not enough divergence

  const direction: "home" | "away" = edge > 0 ? "home" : "away";
  const isStrong = absEdge >= 0.15;
  const magnitude = isStrong ? 7 : 5;
  const confidence = isStrong ? 0.75 : 0.60;

  return {
    category: "marketEdge",
    direction,
    magnitude,
    confidence,
    label: `ML edge: KenPom ${(kenpomHomeWP * 100).toFixed(0)}% vs market ${(marketHomeWP * 100).toFixed(0)}% (${edge > 0 ? "+" : ""}${(edge * 100).toFixed(1)}%)`,
    strength: isStrong ? "strong" : "moderate",
  };
}

// ─── Signal: Tempo Differential (O/U) ────────────────────────────────────────
// v5: Pace mismatch between teams predicts O/U outcomes.
// Big tempo mismatch (≥8) → slower team drags game UNDER.
// Both fast (avg >70, diff <4) → OVER. Both slow (avg <63, diff <4) → UNDER.

function signalTempoDiff(
  kenpomRatings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
): SignalResult {
  const neutral: SignalResult = {
    category: "tempoDiff", direction: "neutral",
    magnitude: 0, confidence: 0, label: "N/A", strength: "noise",
  };
  if (!kenpomRatings) return neutral;

  const homeR = lookupRating(kenpomRatings, homeTeam);
  const awayR = lookupRating(kenpomRatings, awayTeam);
  if (!homeR || !awayR) return neutral;

  const tempoDiff = Math.abs(homeR.AdjTempo - awayR.AdjTempo);
  const avgTempo = (homeR.AdjTempo + awayR.AdjTempo) / 2;

  // Big tempo mismatch: slow team drags game under
  if (tempoDiff >= 8) {
    const slowerTempo = Math.min(homeR.AdjTempo, awayR.AdjTempo);
    if (slowerTempo < 66) {
      return {
        category: "tempoDiff", direction: "under",
        magnitude: 6, confidence: 0.72,
        label: `Tempo mismatch ${tempoDiff.toFixed(1)} (slower team ${slowerTempo.toFixed(1)})`,
        strength: "moderate",
      };
    }
    return {
      category: "tempoDiff", direction: "under",
      magnitude: 4, confidence: 0.62,
      label: `Tempo mismatch ${tempoDiff.toFixed(1)}`,
      strength: "moderate",
    };
  }

  // Both fast teams → over
  if (avgTempo > 70 && tempoDiff < 4) {
    return {
      category: "tempoDiff", direction: "over",
      magnitude: 5, confidence: 0.65,
      label: `Both fast tempo ${avgTempo.toFixed(1)}`,
      strength: "moderate",
    };
  }

  // Both slow teams → under
  if (avgTempo < 63 && tempoDiff < 4) {
    return {
      category: "tempoDiff", direction: "under",
      magnitude: 5, confidence: 0.68,
      label: `Both slow tempo ${avgTempo.toFixed(1)}`,
      strength: "moderate",
    };
  }

  return neutral;
}

// ─── Signal Functions: O/U ───────────────────────────────────────────────────

function signalSeasonOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeTotal = homeStats.overs + homeStats.unders;
  const awayTotal = awayStats.overs + awayStats.unders;

  const homeOverEdge = homeTotal >= 8
    ? wilsonInterval(homeStats.overs, homeTotal)[0] - 0.5
    : 0;
  const awayOverEdge = awayTotal >= 8
    ? wilsonInterval(awayStats.overs, awayTotal)[0] - 0.5
    : 0;

  // Average over lean of both teams
  const avgOverLean = (homeOverEdge + awayOverEdge) / 2;
  const absMag = clamp(Math.abs(avgOverLean) * 50, 0, 10);

  const minGames = Math.min(homeTotal, awayTotal);
  const conf = clamp(0.3 + minGames * 0.015, 0.3, 0.75);

  if (absMag < 0.5) {
    return {
      category: "seasonOU",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `Season O/U: home ${homeStats.overs}-${homeStats.unders}, away ${awayStats.overs}-${awayStats.unders}`,
      strength: "noise",
    };
  }

  return {
    category: "seasonOU",
    direction: avgOverLean > 0 ? "over" : "under",
    magnitude: absMag,
    confidence: conf,
    label: `Season O/U: home ${homeStats.overs}-${homeStats.unders} (${homeStats.overPct}%), away ${awayStats.overs}-${awayStats.unders} (${awayStats.overPct}%)`,
    strength: absMag >= 6 ? "strong" : absMag >= 3 ? "moderate" : "weak",
  };
}

function signalTrendAnglesOU(
  homeOUAngles: OUAngleSignal[],
  awayOUAngles: OUAngleSignal[],
): SignalResult {
  const allAngles = [...homeOUAngles, ...awayOUAngles];
  if (allAngles.length === 0) {
    return {
      category: "trendAngles",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "No O/U trend angles",
      strength: "noise",
    };
  }

  const strengthMultiplier: Record<string, number> = { strong: 3, moderate: 2, weak: 1, noise: 0 };
  let overScore = 0, underScore = 0, totalScore = 0, significantCount = 0;

  for (const a of allAngles) {
    const w = strengthMultiplier[a.strength] || 0;
    if (w === 0) continue;
    totalScore += w;
    if (a.favors === "over") overScore += w;
    else underScore += w;
    if (a.strength === "strong" || a.strength === "moderate") significantCount++;
  }

  if (totalScore === 0) {
    return {
      category: "trendAngles",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "All O/U angles are noise",
      strength: "noise",
    };
  }

  const dominance = Math.abs(overScore - underScore) / totalScore;
  const magnitude = clamp(dominance * 10 + significantCount * 0.5, 0, 10);
  const conf = clamp(0.35 + significantCount * 0.08, 0.35, 0.85);
  const dir = overScore > underScore ? "over" as const : overScore < underScore ? "under" as const : "neutral" as const;

  return {
    category: "trendAngles",
    direction: dir,
    magnitude,
    confidence: conf,
    label: `O/U angles: ${allAngles.filter((a) => a.favors === "over").length} over, ${allAngles.filter((a) => a.favors === "under").length} under (${significantCount} sig)`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1 ? "weak" : "noise",
  };
}

function signalRecentFormOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5OUOvers + homeStats.last5OUUnders;
  const awayL5 = awayStats.last5OUOvers + awayStats.last5OUUnders;

  if (homeL5 < 3 && awayL5 < 3) {
    return {
      category: "recentForm",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "Insufficient recent O/U data",
      strength: "noise",
    };
  }

  const homeOverRate = homeL5 > 0 ? homeStats.last5OUOvers / homeL5 : 0.5;
  const awayOverRate = awayL5 > 0 ? awayStats.last5OUOvers / awayL5 : 0.5;
  const avgOverLean = (homeOverRate + awayOverRate) / 2 - 0.5;

  const magnitude = clamp(Math.abs(avgOverLean) * 20, 0, 10);
  const conf = 0.5;

  if (magnitude < 1) {
    return {
      category: "recentForm",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: `Recent O/U: home ${homeStats.last5OUOvers}-${homeStats.last5OUUnders}, away ${awayStats.last5OUOvers}-${awayStats.last5OUUnders}`,
      strength: "noise",
    };
  }

  return {
    category: "recentForm",
    direction: avgOverLean > 0 ? "over" : "under",
    magnitude,
    confidence: conf,
    label: `Recent O/U: home ${homeStats.last5OUOvers}-${homeStats.last5OUUnders}, away ${awayStats.last5OUOvers}-${awayStats.last5OUUnders}`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

function signalH2HWeatherOU(
  h2h: H2HStats,
  overUnder: number | null,
  forecastWindMph: number | null,
  forecastTemp: number | null,
  forecastCategory: string | null,
  sport: string,
): SignalResult {
  let magnitude = 0;
  let direction: "over" | "under" | "neutral" = "neutral";
  const parts: string[] = [];
  let conf = 0.4;

  // H2H total vs line
  if (h2h.totalGames >= 3 && overUnder !== null && h2h.avgTotalPoints > 0) {
    const diff = h2h.avgTotalPoints - overUnder;
    if (Math.abs(diff) >= 3) {
      magnitude += clamp(Math.abs(diff) / 2, 0, 6);
      direction = diff > 0 ? "over" : "under";
      parts.push(`H2H avg ${h2h.avgTotalPoints.toFixed(1)} vs line ${overUnder} (${diff > 0 ? "+" : ""}${diff.toFixed(1)})`);
      conf = Math.min(conf + 0.1, 0.7);
    }

    // H2H O/U record
    const h2hOUTotal = h2h.overs + h2h.unders;
    if (h2hOUTotal >= 5) {
      const overPct = h2h.overs / h2hOUTotal;
      if (Math.abs(overPct - 0.5) > 0.15) {
        magnitude += 2;
        if (direction === "neutral") direction = overPct > 0.5 ? "over" : "under";
        parts.push(`H2H O/U: ${h2h.overs}-${h2h.unders}`);
      }
    }
  }

  // Weather effects (NFL/NCAAF only)
  if (sport !== "NCAAMB") {
    if (forecastWindMph !== null && forecastWindMph >= 15) {
      const windBonus = forecastWindMph >= 25 ? 4 : forecastWindMph >= 20 ? 3 : 2;
      magnitude += windBonus;
      if (direction === "neutral") direction = "under";
      parts.push(`Wind: ${forecastWindMph} mph`);
      conf = Math.min(conf + 0.1, 0.7);
    }

    if (forecastTemp !== null && forecastTemp <= 25) {
      magnitude += 2;
      if (direction === "neutral") direction = "under";
      parts.push(`Cold: ${forecastTemp}°F`);
    }

    if (forecastCategory === "SNOW" || forecastCategory === "RAIN") {
      magnitude += 2;
      if (direction === "neutral") direction = "under";
      parts.push(`Weather: ${forecastCategory.toLowerCase()}`);
    }
  }

  magnitude = clamp(magnitude, 0, 10);

  if (magnitude < 0.5) {
    return {
      category: "h2hWeather",
      direction: "neutral",
      magnitude: 0,
      confidence: 0,
      label: "No significant H2H/weather O/U signal",
      strength: "noise",
    };
  }

  return {
    category: "h2hWeather",
    direction,
    magnitude,
    confidence: conf,
    label: parts.join(" | ") || "H2H + weather factors",
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

// ─── Convergence Scoring ─────────────────────────────────────────────────────

function computeConvergenceScore(
  signals: SignalResult[],
  weights: Record<string, number>,
  skipConvergenceBonus = false,
  minActiveSignals = 0,
): {
  score: number;
  direction: "home" | "away" | "over" | "under";
  reasons: ReasoningEntry[];
} {
  const activeSignals = signals.filter((s) => s.direction !== "neutral" && s.magnitude > 0);

  // v5: require minimum active signals to avoid noise picks
  if (activeSignals.length === 0 || activeSignals.length < minActiveSignals) {
    return { score: 50, direction: "home", reasons: [] };
  }

  // Weighted sums per direction, normalized against total possible weight
  const directionSums: Record<string, number> = {};
  let totalPossibleWeight = 0;

  for (const signal of signals) {
    const w = weights[signal.category] || 0.1;
    totalPossibleWeight += w * 10; // max magnitude=10, confidence=1

    if (signal.direction === "neutral" || signal.magnitude <= 0) continue;
    const effectiveWeight = w * signal.magnitude * signal.confidence;
    directionSums[signal.direction] = (directionSums[signal.direction] || 0) + effectiveWeight;
  }

  // Pick winning direction
  let bestDir = "home" as string;
  let bestSum = 0;
  let totalWeight = 0;

  for (const [dir, sum] of Object.entries(directionSums)) {
    totalWeight += sum;
    if (sum > bestSum) {
      bestSum = sum;
      bestDir = dir;
    }
  }

  const oppositeSum = totalWeight - bestSum;

  // Raw strength: how much winning side dominates vs theoretical max
  // This naturally produces variance — weak/mixed signals stay low
  const rawStrength = totalPossibleWeight > 0
    ? (bestSum - oppositeSum) / totalPossibleWeight
    : 0;

  let score = 50 + rawStrength * 80;

  // ── Convergence bonus: when many signals agree ──
  // v4: Skip for spread picks — backtest showed signal agreement HURTS spread accuracy
  // (KenPom + ATS agreeing → 39.7% win rate due to ATS mean-reversion)
  const nonNeutralCount = activeSignals.length;
  const agreeingCount = activeSignals.filter((s) => s.direction === bestDir).length;
  const agreeRatio = nonNeutralCount > 0 ? agreeingCount / nonNeutralCount : 0;

  if (!skipConvergenceBonus) {
    if (agreeRatio >= 0.8 && nonNeutralCount >= 3) score += 8;
    else if (agreeRatio >= 0.6 && nonNeutralCount >= 3) score += 4;
  }

  // ── Contradiction penalty: strong opposing signals ──
  const strongDisagreeing = activeSignals.filter(
    (s) => s.direction !== bestDir && (s.strength === "strong" || s.strength === "moderate"),
  ).length;
  if (strongDisagreeing >= 2) score -= 10;
  else if (strongDisagreeing === 1) score -= 5;

  // ── Statistical evidence bonus: multiple strong/moderate signals agreeing ──
  if (!skipConvergenceBonus) {
    const strongModerateAgreeing = activeSignals.filter(
      (s) => s.direction === bestDir && (s.strength === "strong" || s.strength === "moderate"),
    ).length;
    if (strongModerateAgreeing >= 3) score += 6;
    else if (strongModerateAgreeing >= 2) score += 3;
  }

  score = clamp(Math.round(score), 0, 100);

  // Build reasoning from all non-noise signals
  const reasons: ReasoningEntry[] = activeSignals
    .filter((s) => s.strength !== "noise")
    .sort((a, b) => {
      const aWin = a.direction === bestDir ? 1 : 0;
      const bWin = b.direction === bestDir ? 1 : 0;
      if (aWin !== bWin) return bWin - aWin;
      return (b.magnitude * b.confidence) - (a.magnitude * a.confidence);
    })
    .map((s) => ({
      angle: s.direction === bestDir ? s.label : `[OPPOSING] ${s.label}`,
      weight: Math.round(s.magnitude * s.confidence * 10),
      strength: s.strength,
    }));

  return {
    score,
    direction: bestDir as "home" | "away" | "over" | "under",
    reasons,
  };
}

// ─── Headline Generation (v3) ────────────────────────────────────────────────

function buildHeadlineV3(
  teamName: string,
  spreadVal: number,
  score: number,
  signals: SignalResult[],
  direction: string,
): string {
  const confidence = score >= 85 ? 5 : score >= 70 ? 4 : 3;
  const spreadLabel = `${spreadVal > 0 ? "+" : ""}${spreadVal}`;

  const modelEdge = signals.find((s) => s.category === "modelEdge" && s.direction === direction);
  const agreeingSignals = signals.filter((s) => s.direction === direction && s.strength !== "noise");

  if (confidence >= 5) {
    if (modelEdge && modelEdge.magnitude >= 5) {
      const edgeMatch = modelEdge.label.match(/edge ([+-]?\d+\.?\d*)/);
      const edgeVal = edgeMatch ? edgeMatch[1] : "";
      return `${agreeingSignals.length} signals align — model sees ${edgeVal} pts of value on ${teamName}`;
    }
    return `Strong convergence: ${agreeingSignals.length} independent edges favor ${teamName} ${spreadLabel}`;
  }

  if (confidence >= 4) {
    if (modelEdge && modelEdge.magnitude >= 3) {
      const edgeMatch = modelEdge.label.match(/edge ([+-]?\d+\.?\d*)/);
      const edgeVal = edgeMatch ? edgeMatch[1] : "";
      return `Model edge: ${teamName} has ${edgeVal} pts of line value`;
    }
    if (agreeingSignals.length >= 3) {
      return `${agreeingSignals.length} trend angles favor ${teamName} ${spreadLabel}`;
    }
    return `ATS advantage backs ${teamName} ${spreadLabel}`;
  }

  // 3★
  if (agreeingSignals.length >= 2) {
    return `${agreeingSignals.length} factors lean ${teamName} ${spreadLabel}`;
  }
  return `Slight lean: ${teamName} ${spreadLabel}`;
}

function buildOUHeadlineV3(
  side: string,
  lineVal: number,
  score: number,
  signals: SignalResult[],
  direction: string,
  confidenceOverride?: number,
): string {
  const confidence = confidenceOverride ?? (score >= 85 ? 5 : score >= 70 ? 4 : 3);

  const modelEdge = signals.find((s) => s.category === "modelEdge" && s.direction === direction);
  const weatherSignal = signals.find((s) => s.category === "h2hWeather" && s.direction === direction);
  const agreeingSignals = signals.filter((s) => s.direction === direction && s.strength !== "noise");

  if (confidence >= 5 && modelEdge && modelEdge.magnitude >= 4) {
    const totalMatch = modelEdge.label.match(/predicted (\d+\.?\d*)/);
    const totalVal = totalMatch ? totalMatch[1] : "";
    const edgeMatch = modelEdge.label.match(/\(([+-]\d+\.?\d*)\)/);
    const edgeVal = edgeMatch ? edgeMatch[1] : "";
    return `Model projects ${totalVal} total — ${edgeVal} pts from the ${side.toLowerCase()} (${lineVal})`;
  }

  if (confidence >= 4) {
    if (weatherSignal && weatherSignal.magnitude >= 3) {
      const windMatch = weatherSignal.label.match(/(\d+) mph/);
      const windVal = windMatch ? `${windMatch[1]} mph wind + ` : "";
      return `${windVal}trend data favor ${side} ${lineVal}`;
    }
    return `${agreeingSignals.length} signals favor ${side} ${lineVal}`;
  }

  return `Lean: ${side} ${lineVal}`;
}

// ─── Prop Auto-Discovery (v2 — splits + opponent) ───────────────────────────

const POSITION_PROPS: Record<string, string[]> = {
  QB: ["passing_yards", "passing_tds"],
  RB: ["rushing_yards"],
  WR: ["receiving_yards", "receptions"],
  TE: ["receiving_yards", "receptions"],
};

const PROP_LABELS: Record<string, string> = {
  passing_yards: "Pass Yds",
  passing_tds: "Pass TDs",
  rushing_yards: "Rush Yds",
  receiving_yards: "Rec Yds",
  receptions: "Receptions",
};

async function discoverProps(
  sport: Sport,
  homeTeam: string,
  awayTeam: string,
  gameDate: Date,
  currentSeason: number,
): Promise<GeneratedPick[]> {
  if (sport !== "NFL") return [];

  const picks: GeneratedPick[] = [];

  for (const [team, isHome] of [[homeTeam, true], [awayTeam, false]] as [string, boolean][]) {
    const teamRecord = await prisma.team.findFirst({
      where: { sport: "NFL", name: team },
      select: { abbreviation: true },
    });
    if (!teamRecord) continue;

    const abbrev = teamRecord.abbreviation;

    const playerGroups = await prisma.playerGameLog.groupBy({
      by: ["playerId", "playerName", "position", "positionGroup"],
      where: {
        team: abbrev,
        season: currentSeason,
        positionGroup: { in: ["QB", "RB", "WR", "TE"] },
      },
      _count: { id: true },
      having: { id: { _count: { gte: 8 } } },
      orderBy: { _count: { id: "desc" } },
      take: 6,
    });

    for (const player of playerGroups) {
      const statKeys = POSITION_PROPS[player.positionGroup] || [];

      for (const stat of statKeys) {
        try {
          const playerGames = await prisma.playerGameLog.findMany({
            where: { playerId: player.playerId, season: currentSeason },
            select: { stats: true },
          });

          const values: number[] = [];
          for (const g of playerGames) {
            const stats = g.stats as Record<string, unknown>;
            const val = stats[stat];
            if (typeof val === "number" && val > 0) values.push(val);
          }

          if (values.length < 8) continue;
          const avg = values.reduce((s, v) => s + v, 0) / values.length;
          const sorted = [...values].sort((a, b) => a - b);
          const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
          const propLine = Math.round(median * 2) / 2;
          if (propLine <= 0) continue;

          const opponent = isHome ? awayTeam : homeTeam;

          const result = await executePlayerPropQueryFromDB({
            player: player.playerName,
            stat,
            line: propLine,
            direction: "over",
            homeAway: isHome ? "home" : "away",
            filters: [],
          });

          if (
            result.overall.total < 8 ||
            result.overall.hitRate < 58 ||
            result.overall.significance.strength === "noise"
          ) {
            continue;
          }

          const [wilsonLower] = wilsonInterval(result.overall.hits, result.overall.total);
          let score = 50;

          const wilsonEdge = wilsonLower - 0.5;
          if (wilsonEdge > 0) {
            score += Math.round(wilsonEdge * 80);
          }

          score += result.overall.significance.strength === "strong" ? 12
            : result.overall.significance.strength === "moderate" ? 8 : 3;

          const relevantSplit = result.splits.find(
            (s) => s.label === (isHome ? "Home" : "Away"),
          );
          if (relevantSplit && relevantSplit.total >= 5) {
            if (relevantSplit.hitRate >= 70 && relevantSplit.significance.strength !== "noise") {
              score += 6;
            } else if (relevantSplit.hitRate >= 60) {
              score += 3;
            }
          }

          if (median > propLine * 1.10) score += 5;
          else if (median > propLine * 1.05) score += 3;

          if (result.recentTrend.last5.total >= 4 && result.recentTrend.last5.hitRate >= 80) score += 8;
          else if (result.recentTrend.last5.total >= 4 && result.recentTrend.last5.hitRate >= 60) score += 4;

          if (result.currentStreak >= 4) score += 5;
          else if (result.currentStreak >= 2) score += 2;

          score = clamp(Math.round(score), 0, 100);
          const confidence = score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : 0;
          if (confidence === 0) continue;

          const label = PROP_LABELS[stat] || stat.replace(/_/g, " ");

          const reasoning: ReasoningEntry[] = [
            {
              angle: `Overall: ${result.overall.hits}/${result.overall.total} (${result.overall.hitRate}%, floor ${(wilsonLower * 100).toFixed(0)}%)`,
              weight: 10,
              strength: result.overall.significance.strength as ReasoningEntry["strength"],
              record: `${result.overall.hits}-${result.overall.total - result.overall.hits}`,
            },
          ];

          if (relevantSplit && relevantSplit.total >= 3) {
            reasoning.push({
              angle: `${relevantSplit.label}: ${relevantSplit.hits}/${relevantSplit.total} (${relevantSplit.hitRate}%)`,
              weight: 7,
              strength: relevantSplit.significance.strength as ReasoningEntry["strength"],
              record: `${relevantSplit.hits}-${relevantSplit.total - relevantSplit.hits}`,
            });
          }

          const favDogSplit = result.splits.find(
            (s) => s.label === "As Favorite" || s.label === "As Underdog",
          );
          if (favDogSplit && favDogSplit.total >= 3 && favDogSplit.hitRate >= 60) {
            reasoning.push({
              angle: `${favDogSplit.label}: ${favDogSplit.hits}/${favDogSplit.total} (${favDogSplit.hitRate}%)`,
              weight: 5,
              strength: favDogSplit.significance.strength as ReasoningEntry["strength"],
            });
          }

          reasoning.push({
            angle: `Last 5: ${result.recentTrend.last5.hits}/${result.recentTrend.last5.total} (${result.recentTrend.last5.hitRate}%)`,
            weight: 5,
            strength: result.recentTrend.last5.hitRate >= 80 ? "strong" : result.recentTrend.last5.hitRate >= 60 ? "moderate" : "weak",
          });

          reasoning.push({
            angle: `Avg: ${avg.toFixed(1)} | Median: ${median.toFixed(1)} | Line: ${propLine}`,
            weight: 3,
            strength: median > propLine * 1.05 ? "moderate" : "weak",
          });

          picks.push({
            sport,
            pickType: "PLAYER_PROP",
            homeTeam,
            awayTeam,
            gameDate,
            pickSide: "over",
            line: null,
            pickLabel: `${player.playerName} Over ${propLine} ${label}`,
            playerName: player.playerName,
            propStat: stat,
            propLine,
            trendScore: score,
            confidence,
            headline: `${result.overall.hitRate}% hit rate (${result.overall.hits}/${result.overall.total}) — ${(wilsonLower * 100).toFixed(0)}% floor vs ${opponent}`,
            reasoning,
            homeRank: null,
            awayRank: null,
          });
        } catch (err) {
          console.warn(`[pick-engine] Prop query failed for ${player.playerName} ${stat}:`, err);
        }
      }
    }
  }

  return picks.sort((a, b) => b.trendScore - a.trendScore).slice(0, 5);
}

// ─── Main: Generate Daily Picks ──────────────────────────────────────────────

export interface PickGenerationContext {
  kenpomAvailable: boolean;
  cfbdAvailable: boolean;
  fanmatchAvailable: boolean;
  gamesProcessed: number;
  gamesErrored: number;
  picksGenerated: number;
  rejectedInsufficientSignals: number;
  staleOddsGames: number;
}

export async function generateDailyPicks(
  dateStr: string,
  sport: Sport,
): Promise<{ picks: GeneratedPick[]; context: PickGenerationContext }> {
  const context: PickGenerationContext = {
    kenpomAvailable: false,
    cfbdAvailable: false,
    fanmatchAvailable: false,
    gamesProcessed: 0,
    gamesErrored: 0,
    picksGenerated: 0,
    rejectedInsufficientSignals: 0,
    staleOddsGames: 0,
  };
  // Use ET boundaries so the game window matches the US sports calendar.
  // ET midnight = 05:00 UTC (EST). Without this, yesterday's 7 PM+ ET games
  // bleed in because they cross UTC midnight.
  const dateStart = new Date(dateStr + "T05:00:00Z"); // midnight ET (EST)
  const nextDay = new Date(dateStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const dateEnd = new Date(nextDay.getTime() - 1); // 04:59:59.999 UTC next day

  // Include all games for the requested ET date (even if some have tipped off)
  const upcomingGames = await prisma.upcomingGame.findMany({
    where: {
      sport,
      gameDate: { gte: dateStart, lte: dateEnd },
    },
    orderBy: { gameDate: "asc" },
  });

  if (upcomingGames.length === 0) return { picks: [], context };

  // Check odds freshness — warn if odds are >12h old
  const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
  const now = Date.now();
  for (const game of upcomingGames) {
    if (now - game.lastUpdated.getTime() > STALE_THRESHOLD_MS) {
      context.staleOddsGames++;
    }
  }
  if (context.staleOddsGames > 0) {
    console.warn(
      `[pick-engine] ${sport}: ${context.staleOddsGames}/${upcomingGames.length} games have stale odds (>12h old)`,
    );
  }

  const allGames = await loadGamesBySportCached(sport);
  const currentSeason = getCurrentSeason(sport, dateStart);
  const sportWeightsSpread = SPREAD_WEIGHTS[sport] || SPREAD_WEIGHTS.NFL;
  const sportWeightsOU = OU_WEIGHTS[sport] || OU_WEIGHTS.NFL;

  // Fetch live KenPom ratings for NCAAMB (cached for 6h)
  let kenpomRatings: Map<string, KenpomRating> | null = null;
  let kenpomFanMatch: KenpomFanMatch[] | null = null;
  if (sport === "NCAAMB") {
    try {
      kenpomRatings = await getKenpomRatings();
      context.kenpomAvailable = kenpomRatings !== null && kenpomRatings.size > 0;
    } catch (err) {
      console.error("[pick-engine] KenPom fetch failed, continuing without:", err);
    }
    // v6: Fetch FanMatch game-level predictions (cached for 2h)
    try {
      kenpomFanMatch = await getKenpomFanMatch(dateStr);
      context.fanmatchAvailable = kenpomFanMatch !== null && kenpomFanMatch.length > 0;
    } catch (err) {
      console.error("[pick-engine] FanMatch fetch failed, continuing without:", err);
    }
  }

  // Fetch SP+ ratings for NCAAF (cached for 6h)
  let cfbdRatings: Map<string, CFBDRating> | null = null;
  if (sport === "NCAAF") {
    try {
      cfbdRatings = await getCFBDRatings();
      context.cfbdAvailable = cfbdRatings !== null && cfbdRatings.size > 0;
    } catch (err) {
      console.error("[pick-engine] CFBD SP+ fetch failed, continuing without:", err);
    }
  }

  const allPicks: GeneratedPick[] = [];
  const batchSize = 4;

  for (let i = 0; i < upcomingGames.length; i += batchSize) {
    const batch = upcomingGames.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (game) => {
        const picks: GeneratedPick[] = [];

        try {
          const [canonHome, canonAway] = await Promise.all([
            resolveCanonicalName(game.homeTeam, sport),
            resolveCanonicalName(game.awayTeam, sport),
          ]);

          // Build base stats
          const homeStats = buildTeamStats(allGames, canonHome, sport, currentSeason);
          const awayStats = buildTeamStats(allGames, canonAway, sport, currentSeason);
          const h2h = buildH2H(allGames, canonHome, canonAway, sport);

          // Auto-discover angles via reverse lookup (50+ templates per team)
          const [homeDiscovery, awayDiscovery] = await Promise.all([
            discoverTeamAngles(sport, canonHome, "home", currentSeason),
            discoverTeamAngles(sport, canonAway, "away", currentSeason),
          ]);

          // Compute model edge (KenPom for NCAAMB, SP+ for NCAAF, power rating for NFL/NBA)
          const modelPrediction = sport === "NCAAMB"
            ? computeKenPomEdge(kenpomRatings, game.homeTeam, game.awayTeam, sport, game.spread, game.overUnder, game.gameDate, kenpomFanMatch)
            : sport === "NCAAF" && cfbdRatings && cfbdRatings.size > 0
              ? computeSPEdge(cfbdRatings, game.homeTeam, game.awayTeam, game.spread, game.overUnder)
              : computePowerRatingEdge(allGames, canonHome, canonAway, sport, currentSeason, game.spread, game.overUnder);

          // ── Score Spread ──
          if (game.spread !== null) {
            // v6: Look up FanMatch HomeWP for moneyline edge signal
            const gameFM = kenpomFanMatch?.find(
              (f) => f.Home.toLowerCase() === game.homeTeam.toLowerCase()
                && f.Visitor.toLowerCase() === game.awayTeam.toLowerCase(),
            );

            const spreadSignals: SignalResult[] = [
              modelPrediction.spread,
              signalSeasonATS(homeStats, awayStats, sport),
              signalTrendAnglesSpread(homeDiscovery.ats, awayDiscovery.ats),
              signalRecentForm(homeStats, awayStats),
              signalH2HSpread(h2h),
              signalSituational(
                game.forecastWindMph, game.forecastTemp,
                game.forecastCategory, sport,
              ),
              signalRestDays(allGames, canonHome, canonAway, dateStr, sport),
              signalMoneylineEdge(game.moneylineHome, game.moneylineAway, gameFM?.HomeWP ?? null),
            ];

            // v5: skip convergence bonus + require min 3 active signals
            const result = computeConvergenceScore(spreadSignals, sportWeightsSpread, true, 3);
            const confidence = result.score >= 85 ? 5 : result.score >= 70 ? 4 : 0;

            if (confidence === 0) {
              context.rejectedInsufficientSignals++;
            } else {
              const teamName = result.direction === "home" ? canonHome : canonAway;
              const spreadVal = result.direction === "home" ? game.spread : -(game.spread);

              picks.push({
                sport,
                pickType: "SPREAD",
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDate: game.gameDate,
                pickSide: result.direction,
                line: game.spread,
                pickLabel: `${teamName} ${spreadVal > 0 ? "+" : ""}${spreadVal}`,
                playerName: null,
                propStat: null,
                propLine: null,
                trendScore: result.score,
                confidence,
                headline: buildHeadlineV3(teamName, spreadVal, result.score, spreadSignals, result.direction),
                reasoning: result.reasons,
                homeRank: game.homeRank,
                awayRank: game.awayRank,
              });
            }
          }

          // ── Score O/U ──
          if (game.overUnder !== null) {
            const ouSignals: SignalResult[] = [
              modelPrediction.ou,
              signalSeasonOU(homeStats, awayStats),
              signalTrendAnglesOU(homeDiscovery.ou, awayDiscovery.ou),
              signalRecentFormOU(homeStats, awayStats),
              signalH2HWeatherOU(
                h2h, game.overUnder,
                game.forecastWindMph, game.forecastTemp,
                game.forecastCategory, sport,
              ),
            ];

            // v5: Add tempo differential signal for NCAAMB
            if (sport === "NCAAMB") {
              ouSignals.push(signalTempoDiff(kenpomRatings, game.homeTeam, game.awayTeam));
            }

            // v5: skip O/U convergence bonus + require min 3 active signals
            const result = computeConvergenceScore(ouSignals, sportWeightsOU, true, 3);

            // v9: NCAAMB O/U uses PIT-calibrated tier gates (config #26).
            // Honest walk-forward backtest, monotonic in 12/13 seasons.
            let confidence: number;
            const ouMeta = (modelPrediction as { ouMeta?: { absEdge: number; avgTempo: number; ouDir: "over" | "under" } }).ouMeta;
            if (sport === "NCAAMB" && ouMeta) {
              const { absEdge, avgTempo, ouDir } = ouMeta;
              if (ouDir === "under" && absEdge >= 12 && avgTempo <= 64) {
                confidence = 5; // 82.3% OOS, ~2.4/wk
              } else if (ouDir === "under" && absEdge >= 10) {
                confidence = 4; // 74.9% OOS, ~16.7/wk
              } else if (absEdge >= 9) {
                confidence = 3; // 68.0% OOS, ~59.1/wk
              } else {
                confidence = 0;
              }
            } else {
              confidence = result.score >= 85 ? 5 : result.score >= 70 ? 4 : 0;
            }

            if (confidence === 0) {
              context.rejectedInsufficientSignals++;
            } else {
              // v9: For NCAAMB O/U, use regression direction (PIT-validated)
              // instead of convergence direction (multi-signal consensus)
              const pickDir = (sport === "NCAAMB" && ouMeta)
                ? ouMeta.ouDir
                : result.direction;
              const label = pickDir === "over" ? "Over" : "Under";

              picks.push({
                sport,
                pickType: "OVER_UNDER",
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDate: game.gameDate,
                pickSide: pickDir,
                line: game.overUnder,
                pickLabel: `${label} ${game.overUnder}`,
                playerName: null,
                propStat: null,
                propLine: null,
                trendScore: result.score,
                confidence,
                headline: buildOUHeadlineV3(label, game.overUnder!, result.score, ouSignals, pickDir, confidence),
                reasoning: result.reasons,
                homeRank: game.homeRank,
                awayRank: game.awayRank,
              });
            }
          }

          // Discover props (NFL only)
          const propPicks = await discoverProps(
            sport,
            canonHome,
            canonAway,
            game.gameDate,
            currentSeason,
          );
          picks.push(...propPicks.map(p => ({ ...p, homeRank: game.homeRank, awayRank: game.awayRank })));
          context.gamesProcessed++;
        } catch (err) {
          context.gamesErrored++;
          console.error(`[pick-engine] Error processing ${game.homeTeam} vs ${game.awayTeam}:`, err);
        }

        return picks;
      }),
    );

    allPicks.push(...batchResults.flat());
  }

  context.picksGenerated = allPicks.length;
  console.log(
    `[pick-engine] ${sport}: processed=${context.gamesProcessed}, errored=${context.gamesErrored}, picks=${context.picksGenerated}, rejected=${context.rejectedInsufficientSignals}`,
  );

  return { picks: allPicks.sort((a, b) => b.trendScore - a.trendScore), context };
}

// ─── Grade Yesterday's Picks ─────────────────────────────────────────────────

export async function gradeYesterdaysPicks(): Promise<{
  graded: number;
  errors: number;
}> {
  const pendingPicks = await prisma.dailyPick.findMany({
    where: {
      result: "PENDING",
      gameDate: { lt: new Date() },
    },
  });

  let graded = 0, errors = 0;

  for (const pick of pendingPicks) {
    try {
      if (pick.pickType === "SPREAD" || pick.pickType === "OVER_UNDER") {
        const result = await gradeGamePick(pick);
        if (result) {
          await prisma.dailyPick.update({
            where: { id: pick.id },
            data: { result: result.result, actualValue: result.actualValue, gradedAt: new Date() },
          });
          graded++;
        }
      } else if (pick.pickType === "PLAYER_PROP") {
        const result = await gradePropPick(pick);
        if (result) {
          await prisma.dailyPick.update({
            where: { id: pick.id },
            data: { result: result.result, actualValue: result.actualValue, gradedAt: new Date() },
          });
          graded++;
        }
      }
    } catch (err) {
      console.error(`[grade] Failed to grade pick ${pick.id}:`, err);
      errors++;
    }
  }

  return { graded, errors };
}

async function gradeGamePick(
  pick: { sport: Sport; homeTeam: string; awayTeam: string; gameDate: Date; pickType: string; pickSide: string; line: number | null },
): Promise<{ result: string; actualValue: number | null } | null> {
  const [canonHome, canonAway] = await Promise.all([
    resolveCanonicalName(pick.homeTeam, pick.sport),
    resolveCanonicalName(pick.awayTeam, pick.sport),
  ]);

  const homeTeamRecord = await prisma.team.findFirst({
    where: { sport: pick.sport, name: canonHome },
    select: { id: true },
  });
  const awayTeamRecord = await prisma.team.findFirst({
    where: { sport: pick.sport, name: canonAway },
    select: { id: true },
  });

  if (!homeTeamRecord || !awayTeamRecord) return null;

  const dayBefore = new Date(pick.gameDate.getTime() - 86400000);
  const dayAfter = new Date(pick.gameDate.getTime() + 86400000);

  const table = pick.sport === "NFL" ? "NFLGame" : pick.sport === "NCAAF" ? "NCAAFGame" : "NCAAMBGame";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const games = await (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)].findMany({
    where: {
      homeTeamId: homeTeamRecord.id,
      awayTeamId: awayTeamRecord.id,
      gameDate: { gte: dayBefore, lte: dayAfter },
    },
    take: 1,
  });

  if (games.length === 0) return null;

  const game = games[0];

  if (pick.pickType === "SPREAD") {
    const homeResult = game.spreadResult;
    if (!homeResult) return null;

    if (pick.pickSide === "home") {
      return {
        result: homeResult === "COVERED" ? "WIN" : homeResult === "LOST" ? "LOSS" : "PUSH",
        actualValue: game.scoreDifference != null ? game.scoreDifference : null,
      };
    } else {
      return {
        result: homeResult === "COVERED" ? "LOSS" : homeResult === "LOST" ? "WIN" : "PUSH",
        actualValue: game.scoreDifference != null ? -game.scoreDifference : null,
      };
    }
  }

  if (pick.pickType === "OVER_UNDER") {
    const ouResult = game.ouResult;
    if (!ouResult) return null;

    const totalPts = (game.homeScore || 0) + (game.awayScore || 0);

    if (pick.pickSide === "over") {
      return {
        result: ouResult === "OVER" ? "WIN" : ouResult === "UNDER" ? "LOSS" : "PUSH",
        actualValue: totalPts,
      };
    } else {
      return {
        result: ouResult === "UNDER" ? "WIN" : ouResult === "OVER" ? "LOSS" : "PUSH",
        actualValue: totalPts,
      };
    }
  }

  return null;
}

async function gradePropPick(
  pick: { playerName: string | null; propStat: string | null; propLine: number | null; gameDate: Date },
): Promise<{ result: string; actualValue: number | null } | null> {
  if (!pick.playerName || !pick.propStat || pick.propLine == null) return null;

  const dayBefore = new Date(pick.gameDate.getTime() - 86400000);
  const dayAfter = new Date(pick.gameDate.getTime() + 86400000);

  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerName: { contains: pick.playerName, mode: "insensitive" },
      gameDate: { gte: dayBefore, lte: dayAfter },
    },
    take: 1,
  });

  if (logs.length === 0) return null;

  const stats = logs[0].stats as Record<string, unknown>;
  const actual = stats[pick.propStat];

  if (typeof actual !== "number") return null;

  if (actual === pick.propLine) {
    return { result: "PUSH", actualValue: actual };
  }

  const hit = actual > pick.propLine;

  return {
    result: hit ? "WIN" : "LOSS",
    actualValue: actual,
  };
}

// ─── Bet Auto-Grading ──────────────────────────────────────────────────────────

/** Calculate profit from a graded bet */
function calculateBetProfit(
  stake: number,
  odds: number,
  result: string,
): number | null {
  if (result === "PENDING") return null;
  if (result === "PUSH") return 0;
  if (result === "WIN") {
    const mult = odds >= 100 ? odds / 100 : 100 / Math.abs(odds);
    return Math.round(stake * mult * 100) / 100;
  }
  return -stake; // LOSS
}

/**
 * Grade pending bets. Two strategies:
 * 1. Linked bets (dailyPickId set): mirror the DailyPick result
 * 2. Unlinked bets: use game-matching logic (same as pick grading)
 */
export async function gradePendingBets(): Promise<{
  graded: number;
  errors: number;
}> {
  const pendingBets = await prisma.bet.findMany({
    where: {
      result: "PENDING",
      gameDate: { lt: new Date() },
    },
  });

  let graded = 0, errors = 0;

  for (const bet of pendingBets) {
    try {
      let result: string | null = null;

      // Strategy 1: Mirror linked DailyPick result
      if (bet.dailyPickId) {
        const pick = await prisma.dailyPick.findUnique({
          where: { id: bet.dailyPickId },
          select: { result: true },
        });
        if (pick && pick.result !== "PENDING") {
          result = pick.result;
        }
      }

      // Strategy 2: Grade via game matching (if no linked pick or pick still pending)
      if (!result) {
        const betType = bet.betType as string;
        if (betType === "SPREAD" || betType === "OVER_UNDER") {
          const gradeResult = await gradeGamePick({
            sport: bet.sport as Sport,
            homeTeam: bet.homeTeam,
            awayTeam: bet.awayTeam,
            gameDate: bet.gameDate,
            pickType: betType,
            pickSide: bet.pickSide,
            line: bet.line,
          });
          if (gradeResult) result = gradeResult.result;
        } else if (betType === "PLAYER_PROP") {
          const gradeResult = await gradePropPick({
            playerName: bet.playerName,
            propStat: bet.propStat,
            propLine: bet.propLine,
            gameDate: bet.gameDate,
          });
          if (gradeResult) result = gradeResult.result;
        }
      }

      if (result && result !== "PENDING") {
        const profit = calculateBetProfit(bet.stake, bet.oddsValue, result);
        await prisma.bet.update({
          where: { id: bet.id },
          data: {
            result: result as "WIN" | "LOSS" | "PUSH",
            profit,
            gradedAt: new Date(),
          },
        });
        graded++;
      }
    } catch (err) {
      console.error(`[grade] Failed to grade bet ${bet.id}:`, err);
      errors++;
    }
  }

  return { graded, errors };
}
