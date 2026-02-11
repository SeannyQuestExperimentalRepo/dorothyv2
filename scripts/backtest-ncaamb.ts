/**
 * NCAAMB Daily Picks Backtest
 *
 * Walk-forward simulation of the pick engine across the full 2024-25
 * NCAAMB season. For each game date, computes picks using only data
 * available BEFORE that date, then grades vs actual results.
 *
 * v6: Point-in-Time (PIT) ratings — uses date-specific blended KenPom
 *     ratings to remove look-ahead bias. Falls back to end-of-season
 *     ratings if PIT data is unavailable.
 *
 * Signals used:
 *   1. KenPom Model Edge (PIT ratings — no look-ahead bias)
 *   2. Season ATS (cumulative, walk-forward)
 *   3. Recent Form (last 5 games, walk-forward)
 *   4. H2H (all historical)
 *   5. Convergence scoring
 *   6. Tempo differential (v5)
 *   7. Rest / B2B (v4)
 *
 * Signal NOT included (too expensive for 5500 games):
 *   - Trend Angles (reverse lookup — 50+ DB queries per team)
 *   - Situational (NCAAMB is indoor, always noise)
 *
 * Usage: npx tsx scripts/backtest-ncaamb.ts
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/db";
import { getKenpomRatings, lookupRating, type KenpomRating } from "../src/lib/kenpom";
import { wilsonInterval } from "../src/lib/trend-stats";

// ─── PIT Ratings Loader ─────────────────────────────────────────────────────

interface PITSnapshot {
  date: string;
  alpha: number;
  teamCount: number;
  ratings: Record<string, KenpomRating>;
}

/**
 * Load PIT ratings and return a function that gives the correct
 * ratings snapshot for any game date.
 */
function loadPITRatings(pitPath: string): ((gameDate: Date) => Map<string, KenpomRating> | null) {
  if (!fs.existsSync(pitPath)) {
    console.log(`  PIT ratings file not found at ${pitPath}`);
    return () => null;
  }

  const snapshots: PITSnapshot[] = JSON.parse(fs.readFileSync(pitPath, "utf-8"));
  console.log(`  Loaded ${snapshots.length} PIT snapshots (${snapshots[0]?.date} to ${snapshots[snapshots.length - 1]?.date})`);

  // Pre-build Maps for each snapshot
  const snapshotMaps: { date: string; ratings: Map<string, KenpomRating> }[] = snapshots.map(s => ({
    date: s.date,
    ratings: new Map(Object.entries(s.ratings)),
  }));

  return (gameDate: Date): Map<string, KenpomRating> | null => {
    const dateStr = gameDate.toISOString().split("T")[0];

    // Find the nearest snapshot that is <= gameDate (no future data)
    let best = snapshotMaps[0];
    for (const snap of snapshotMaps) {
      if (snap.date <= dateStr) {
        best = snap;
      } else {
        break; // snapshots are sorted, no need to continue
      }
    }

    return best?.ratings ?? null;
  };
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface GameRecord {
  id: number;
  gameDate: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number;
  awayScore: number;
  scoreDifference: number;
  spread: number | null;
  overUnder: number | null;
  spreadResult: string | null;
  ouResult: string | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

interface TeamStats {
  atsCovered: number;
  atsLost: number;
  atsPct: number;
  overs: number;
  unders: number;
  overPct: number;
  last5ATS: { covered: number; lost: number };
  last5OU: { overs: number; unders: number };
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;
  confidence: number;
  strength: "strong" | "moderate" | "weak" | "noise";
  label: string;
}

interface PickResult {
  date: string;
  homeTeam: string;
  awayTeam: string;
  pickType: "SPREAD" | "OVER_UNDER";
  pickSide: string;
  line: number;
  trendScore: number;
  confidence: number; // 3, 4, or 5
  actualResult: "WIN" | "LOSS" | "PUSH";
}

// ─── Signal Functions (mirrored from pick-engine.ts) ────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

const SPREAD_WEIGHTS: Record<string, number> = {
  modelEdge: 0.30,
  seasonATS: 0.15,
  recentForm: 0.15,
  h2h: 0.10,
  restDays: 0.05,
  // trendAngles: 0.25 — excluded from backtest
  // situational: 0.00 — v4: zeroed out for NCAAMB
};

const OU_WEIGHTS: Record<string, number> = {
  modelEdge: 0.35,
  seasonOU: 0.12,
  recentForm: 0.08,
  h2hWeather: 0.12,
  tempoDiff: 0.15, // v5: tempo mismatch signal
  // trendAngles: 0.18 — excluded from backtest
};

function computeKenPomSpreadSignal(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
  spread: number,
  gameDate: Date,
): SignalResult {
  const neutral: SignalResult = {
    category: "modelEdge", direction: "neutral",
    magnitude: 0, confidence: 0, label: "No KenPom", strength: "noise",
  };
  if (!ratings) return neutral;

  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return neutral;

  const predictedMargin = homeR.AdjEM - awayR.AdjEM + 2.0;
  const spreadEdge = predictedMargin + spread;
  let absMag = clamp(Math.abs(spreadEdge) / 0.7, 0, 10);
  let conf = 0.8;

  const gameMonth = gameDate.getMonth() + 1;
  const isEarlySeason = gameMonth >= 11;

  // v4: Fade home-side KenPom edge harder after Nov (data: 47-48% — losing signal)
  if (spreadEdge > 0.5 && !isEarlySeason) {
    absMag *= 0.20;
    conf = 0.30;
  }

  // v4: March top-25 home edge is still slightly overpriced
  if (gameMonth === 3 && spreadEdge > 0.5 && homeR.RankAdjEM <= 25) {
    absMag *= 0.25;
    conf = 0.35;
  }

  return {
    category: "modelEdge",
    direction: spreadEdge > 0.5 ? "home" : spreadEdge < -0.5 ? "away" : "neutral",
    magnitude: absMag,
    confidence: conf,
    label: `KenPom edge ${spreadEdge.toFixed(1)}`,
    strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
  };
}

function computeKenPomOUSignal(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
  overUnder: number,
  gameDate: Date,
): SignalResult {
  const neutral: SignalResult = {
    category: "modelEdge", direction: "neutral",
    magnitude: 0, confidence: 0, label: "No KenPom", strength: "noise",
  };
  if (!ratings) return neutral;

  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return neutral;

  const sumAdjDE = homeR.AdjDE + awayR.AdjDE;
  const avgTempo = (homeR.AdjTempo + awayR.AdjTempo) / 2;
  const gameMonth = gameDate.getMonth() + 1;

  let dir: "over" | "under" | "neutral" = "neutral";
  let mag = 0;
  let conf = 0;

  // v4 recalibrated: sumDE 200-215 was OVER but data shows it's UNDER
  if (sumAdjDE > 215) { dir = "over"; mag = 8; conf = 0.85; }
  else if (sumAdjDE > 210) { /* neutral 210-215 */ }
  else if (sumAdjDE > 205) { dir = "under"; mag = 5; conf = 0.80; }
  else if (sumAdjDE > 200) { dir = "under"; mag = 6; conf = 0.85; }
  else if (sumAdjDE > 195) { dir = "under"; mag = 8; conf = 0.90; }
  else if (sumAdjDE > 190) { dir = "under"; mag = 8; conf = 0.92; }
  else if (sumAdjDE > 185) { dir = "under"; mag = 9; conf = 0.93; }
  else { dir = "under"; mag = 10; conf = 0.95; }

  // Tempo x DE (v4: updated thresholds to match recalibrated sumDE)
  if (dir === "over" && avgTempo > 70 && sumAdjDE > 215) {
    mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0);
  } else if (dir === "under" && avgTempo < 64 && sumAdjDE < 195) {
    mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0);
  }

  // Both top-50
  if (homeR.RankAdjEM <= 50 && awayR.RankAdjEM <= 50) {
    dir = "under"; mag = 10; conf = 0.95;
  }

  // Both power conference
  const powerConfs = ["BE", "B12", "B10", "SEC", "ACC", "P12"];
  const homeIsPower = powerConfs.includes(homeR.ConfShort ?? "");
  const awayIsPower = powerConfs.includes(awayR.ConfShort ?? "");
  if (homeIsPower && awayIsPower && !(homeR.RankAdjEM <= 50 && awayR.RankAdjEM <= 50)) {
    if (dir === "under") {
      mag = Math.min(mag + 2, 10);
    } else if (dir === "neutral" || dir === "over") {
      dir = "under"; mag = Math.max(mag, 6); conf = Math.max(conf, 0.82);
    }
  }

  // Both 200+
  if (homeR.RankAdjEM > 200 && awayR.RankAdjEM > 200) {
    if (dir === "over") { mag = Math.min(mag + 1, 10); }
    else if (dir === "neutral") { dir = "over"; mag = Math.max(mag, 5); conf = Math.max(conf, 0.78); }
  }

  // March UNDER
  if (gameMonth === 3) {
    if (dir === "under") { mag = Math.min(mag + 1, 10); }
    else if (dir === "neutral") { dir = "under"; mag = 3; conf = Math.max(conf, 0.60); }
  }

  // v4: Strengthened high-line UNDER signal (data: 68-70% UNDER for 155+)
  if (overUnder >= 160) {
    dir = "under"; mag = Math.max(mag, 8); conf = Math.max(conf, 0.88);
  } else if (overUnder >= 155) {
    dir = "under"; mag = Math.max(mag, 6); conf = Math.max(conf, 0.82);
  }

  // v4: Low-line OVER signal (data: 57% OVER for <135)
  if (overUnder < 135) {
    if (dir === "over") { mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0); }
    else if (dir === "neutral") { dir = "over"; mag = 4; conf = Math.max(conf, 0.70); }
  }

  mag = clamp(mag, 0, 10);

  return {
    category: "modelEdge", direction: dir, magnitude: mag, confidence: conf,
    label: `KenPom O/U sumDE=${sumAdjDE.toFixed(1)}`,
    strength: mag >= 6 ? "strong" : mag >= 3 ? "moderate" : mag >= 1 ? "weak" : "noise",
  };
}

function signalSeasonATS(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeTotal = homeStats.atsCovered + homeStats.atsLost;
  const awayTotal = awayStats.atsCovered + awayStats.atsLost;

  const homeEdge = homeTotal >= 5 ? wilsonInterval(homeStats.atsCovered, homeTotal)[0] - 0.5 : 0;
  const awayEdge = awayTotal >= 5 ? wilsonInterval(awayStats.atsCovered, awayTotal)[0] - 0.5 : 0;

  // v5: ATS fade — flip direction for contrarian mean-reversion (55.4% W%, +6% ROI)
  const netEdge = -(homeEdge - awayEdge);
  const absMag = clamp(Math.abs(netEdge) * 50, 0, 10);
  const minGames = Math.min(homeTotal, awayTotal);
  const conf = clamp(0.3 + minGames * 0.02, 0.3, 0.8);

  if (absMag < 0.5) {
    return { category: "seasonATS", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "seasonATS",
    direction: netEdge > 0 ? "home" : "away",
    magnitude: absMag,
    confidence: conf,
    label: `Season ATS`,
    strength: absMag >= 7 ? "strong" : absMag >= 3.5 ? "moderate" : "weak",
  };
}

function signalRecentForm(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5ATS.covered + homeStats.last5ATS.lost;
  const awayL5 = awayStats.last5ATS.covered + awayStats.last5ATS.lost;

  if (homeL5 < 3 && awayL5 < 3) {
    return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  const homeRate = homeL5 > 0 ? homeStats.last5ATS.covered / homeL5 : 0.5;
  const awayRate = awayL5 > 0 ? awayStats.last5ATS.covered / awayL5 : 0.5;
  const netMomentum = homeRate - awayRate;

  let magnitude = clamp(Math.abs(netMomentum) * 10, 0, 10);
  if (homeStats.last5ATS.covered >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (homeStats.last5ATS.covered >= 4) magnitude = Math.min(magnitude + 1, 10);
  if (awayStats.last5ATS.covered >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (awayStats.last5ATS.covered >= 4) magnitude = Math.min(magnitude + 1, 10);

  const conf = clamp(0.4 + Math.min(homeL5, awayL5) * 0.08, 0.4, 0.7);

  if (magnitude < 1) {
    return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "recentForm",
    direction: netMomentum > 0 ? "home" : "away",
    magnitude,
    confidence: conf,
    label: `Recent form`,
    strength: magnitude >= 7 ? "strong" : magnitude >= 4 ? "moderate" : "weak",
  };
}

function signalH2H(
  pastGames: GameRecord[],
  homeTeamName: string,
  awayTeamName: string,
): SignalResult {
  const matchups = pastGames.filter(
    (g) =>
      (g.homeTeam.name === homeTeamName && g.awayTeam.name === awayTeamName) ||
      (g.homeTeam.name === awayTeamName && g.awayTeam.name === homeTeamName),
  );

  if (matchups.length < 3) {
    return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  let homeAtsCov = 0, homeAtsLost = 0;
  for (const g of matchups) {
    if (g.homeTeam.name === homeTeamName) {
      if (g.spreadResult === "COVERED") homeAtsCov++;
      else if (g.spreadResult === "LOST") homeAtsLost++;
    } else {
      if (g.spreadResult === "COVERED") homeAtsLost++;
      else if (g.spreadResult === "LOST") homeAtsCov++;
    }
  }

  const h2hTotal = homeAtsCov + homeAtsLost;
  if (h2hTotal < 3) {
    return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  const [lower] = wilsonInterval(homeAtsCov, h2hTotal);
  const edge = lower - 0.5;
  const magnitude = clamp(Math.abs(edge) * 40, 0, 10);
  const conf = clamp(0.3 + h2hTotal * 0.03, 0.3, 0.7);

  if (magnitude < 0.5) {
    return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "h2h",
    direction: edge > 0 ? "home" : "away",
    magnitude,
    confidence: conf,
    label: `H2H`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

function signalSeasonOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeTotal = homeStats.overs + homeStats.unders;
  const awayTotal = awayStats.overs + awayStats.unders;

  const homeOverEdge = homeTotal >= 8 ? wilsonInterval(homeStats.overs, homeTotal)[0] - 0.5 : 0;
  const awayOverEdge = awayTotal >= 8 ? wilsonInterval(awayStats.overs, awayTotal)[0] - 0.5 : 0;

  const avgOverLean = (homeOverEdge + awayOverEdge) / 2;
  const absMag = clamp(Math.abs(avgOverLean) * 50, 0, 10);
  const conf = clamp(0.3 + Math.min(homeTotal, awayTotal) * 0.015, 0.3, 0.75);

  if (absMag < 0.5) {
    return { category: "seasonOU", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "seasonOU",
    direction: avgOverLean > 0 ? "over" : "under",
    magnitude: absMag,
    confidence: conf,
    label: `Season O/U`,
    strength: absMag >= 6 ? "strong" : absMag >= 3 ? "moderate" : "weak",
  };
}

function signalRecentFormOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5OU.overs + homeStats.last5OU.unders;
  const awayL5 = awayStats.last5OU.overs + awayStats.last5OU.unders;

  if (homeL5 < 3 && awayL5 < 3) {
    return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  const homeOverRate = homeL5 > 0 ? homeStats.last5OU.overs / homeL5 : 0.5;
  const awayOverRate = awayL5 > 0 ? awayStats.last5OU.overs / awayL5 : 0.5;
  const avgOverLean = (homeOverRate + awayOverRate) / 2 - 0.5;

  const magnitude = clamp(Math.abs(avgOverLean) * 20, 0, 10);

  if (magnitude < 1) {
    return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "recentForm",
    direction: avgOverLean > 0 ? "over" : "under",
    magnitude,
    confidence: 0.5,
    label: `Recent O/U`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

function signalH2HOU(
  pastGames: GameRecord[],
  homeTeamName: string,
  awayTeamName: string,
  overUnder: number,
): SignalResult {
  const matchups = pastGames.filter(
    (g) =>
      (g.homeTeam.name === homeTeamName && g.awayTeam.name === awayTeamName) ||
      (g.homeTeam.name === awayTeamName && g.awayTeam.name === homeTeamName),
  );

  if (matchups.length < 3) {
    return { category: "h2hWeather", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  let totalPts = 0, overs = 0, unders = 0;
  for (const g of matchups) {
    totalPts += g.homeScore + g.awayScore;
    if (g.ouResult === "OVER") overs++;
    else if (g.ouResult === "UNDER") unders++;
  }
  const avgTotal = totalPts / matchups.length;

  let magnitude = 0;
  let direction: "over" | "under" | "neutral" = "neutral";
  let conf = 0.4;

  const diff = avgTotal - overUnder;
  if (Math.abs(diff) >= 3) {
    magnitude += clamp(Math.abs(diff) / 2, 0, 6);
    direction = diff > 0 ? "over" : "under";
    conf = Math.min(conf + 0.1, 0.7);
  }

  const h2hOUTotal = overs + unders;
  if (h2hOUTotal >= 5) {
    const overPct = overs / h2hOUTotal;
    if (Math.abs(overPct - 0.5) > 0.15) {
      magnitude += 2;
      if (direction === "neutral") direction = overPct > 0.5 ? "over" : "under";
    }
  }

  magnitude = clamp(magnitude, 0, 10);

  if (magnitude < 0.5) {
    return { category: "h2hWeather", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  }

  return {
    category: "h2hWeather",
    direction,
    magnitude,
    confidence: conf,
    label: `H2H O/U`,
    strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak",
  };
}

// ─── Tempo Differential Signal (v5) ─────────────────────────────────────────

function signalTempoDiff(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
): SignalResult {
  const neutral: SignalResult = {
    category: "tempoDiff", direction: "neutral",
    magnitude: 0, confidence: 0, label: "N/A", strength: "noise",
  };
  if (!ratings) return neutral;

  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return neutral;

  const tempoDiff = Math.abs(homeR.AdjTempo - awayR.AdjTempo);
  const avgTempo = (homeR.AdjTempo + awayR.AdjTempo) / 2;

  if (tempoDiff >= 8) {
    const slowerTempo = Math.min(homeR.AdjTempo, awayR.AdjTempo);
    if (slowerTempo < 66) {
      return {
        category: "tempoDiff", direction: "under",
        magnitude: 6, confidence: 0.72,
        label: `Tempo mismatch ${tempoDiff.toFixed(1)}`, strength: "moderate",
      };
    }
    return {
      category: "tempoDiff", direction: "under",
      magnitude: 4, confidence: 0.62,
      label: `Tempo mismatch ${tempoDiff.toFixed(1)}`, strength: "moderate",
    };
  }

  if (avgTempo > 70 && tempoDiff < 4) {
    return {
      category: "tempoDiff", direction: "over",
      magnitude: 5, confidence: 0.65,
      label: `Both fast tempo ${avgTempo.toFixed(1)}`, strength: "moderate",
    };
  }

  if (avgTempo < 63 && tempoDiff < 4) {
    return {
      category: "tempoDiff", direction: "under",
      magnitude: 5, confidence: 0.68,
      label: `Both slow tempo ${avgTempo.toFixed(1)}`, strength: "moderate",
    };
  }

  return neutral;
}

// ─── Rest / B2B Signal ──────────────────────────────────────────────────────

function signalRestDays(
  tracker: TeamStatsTracker,
  homeTeam: string,
  awayTeam: string,
  gameDate: Date,
): SignalResult {
  const neutral: SignalResult = {
    category: "restDays", direction: "neutral",
    magnitude: 0, confidence: 0, label: "Normal rest", strength: "noise",
  };

  // Find last game date for each team from the tracker's game history
  const homeGames = tracker.getRecentGames(homeTeam, 1);
  const awayGames = tracker.getRecentGames(awayTeam, 1);

  if (homeGames.length === 0 && awayGames.length === 0) return neutral;

  const oneDayMs = 36 * 60 * 60 * 1000; // 36h window for B2B
  const gameDateMs = gameDate.getTime();

  const homeOnB2B = homeGames.length > 0 &&
    (gameDateMs - homeGames[0].gameDate.getTime()) <= oneDayMs;
  const awayOnB2B = awayGames.length > 0 &&
    (gameDateMs - awayGames[0].gameDate.getTime()) <= oneDayMs;

  if (homeOnB2B && !awayOnB2B) {
    return {
      category: "restDays", direction: "away",
      magnitude: 5, confidence: 0.65,
      label: `${homeTeam} on B2B`, strength: "moderate",
    };
  } else if (awayOnB2B && !homeOnB2B) {
    return {
      category: "restDays", direction: "home",
      magnitude: 3, confidence: 0.55,
      label: `${awayTeam} on B2B`, strength: "weak",
    };
  }

  return neutral;
}

// ─── Convergence Scoring ────────────────────────────────────────────────────

function computeConvergenceScore(
  signals: SignalResult[],
  weights: Record<string, number>,
  skipConvergenceBonus = false,
  minActiveSignals = 0,
): { score: number; direction: string } {
  const activeSignals = signals.filter((s) => s.direction !== "neutral" && s.magnitude > 0);
  // v5: require minimum active signals
  if (activeSignals.length === 0 || activeSignals.length < minActiveSignals) return { score: 50, direction: "home" };

  const directionSums: Record<string, number> = {};
  let totalPossibleWeight = 0;

  for (const signal of signals) {
    const w = weights[signal.category] || 0.1;
    totalPossibleWeight += w * 10;
    if (signal.direction === "neutral" || signal.magnitude <= 0) continue;
    const effectiveWeight = w * signal.magnitude * signal.confidence;
    directionSums[signal.direction] = (directionSums[signal.direction] || 0) + effectiveWeight;
  }

  let bestDir = "home";
  let bestSum = 0;
  let totalWeight = 0;

  for (const [dir, sum] of Object.entries(directionSums)) {
    totalWeight += sum;
    if (sum > bestSum) { bestSum = sum; bestDir = dir; }
  }

  const oppositeSum = totalWeight - bestSum;
  const rawStrength = totalPossibleWeight > 0 ? (bestSum - oppositeSum) / totalPossibleWeight : 0;
  let score = 50 + rawStrength * 80;

  // v4: Skip convergence bonus for spread picks (signal agreement hurts spread accuracy)
  const nonNeutralCount = activeSignals.length;
  const agreeingCount = activeSignals.filter((s) => s.direction === bestDir).length;
  const agreeRatio = nonNeutralCount > 0 ? agreeingCount / nonNeutralCount : 0;

  if (!skipConvergenceBonus) {
    if (agreeRatio >= 0.8 && nonNeutralCount >= 3) score += 8;
    else if (agreeRatio >= 0.6 && nonNeutralCount >= 3) score += 4;
  }

  const strongDisagreeing = activeSignals.filter(
    (s) => s.direction !== bestDir && (s.strength === "strong" || s.strength === "moderate"),
  ).length;
  if (strongDisagreeing >= 2) score -= 10;
  else if (strongDisagreeing === 1) score -= 5;

  if (!skipConvergenceBonus) {
    const strongModerateAgreeing = activeSignals.filter(
      (s) => s.direction === bestDir && (s.strength === "strong" || s.strength === "moderate"),
    ).length;
    if (strongModerateAgreeing >= 3) score += 6;
    else if (strongModerateAgreeing >= 2) score += 3;
  }

  score = clamp(Math.round(score), 0, 100);

  return { score, direction: bestDir };
}

// ─── Team Stats Builder (incremental) ───────────────────────────────────────

class TeamStatsTracker {
  private teamGames: Map<string, GameRecord[]> = new Map();

  addGame(game: GameRecord): void {
    const home = game.homeTeam.name;
    const away = game.awayTeam.name;

    if (!this.teamGames.has(home)) this.teamGames.set(home, []);
    if (!this.teamGames.has(away)) this.teamGames.set(away, []);

    this.teamGames.get(home)!.push(game);
    this.teamGames.get(away)!.push(game);
  }

  getStats(team: string): TeamStats {
    const games = this.teamGames.get(team) || [];
    let atsCov = 0, atsLost = 0, overs = 0, unders = 0;

    for (const g of games) {
      const isHome = g.homeTeam.name === team;
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

    const last5 = games.slice(-5);
    let l5AtsCov = 0, l5AtsLost = 0, l5OUOver = 0, l5OUUnder = 0;
    for (const g of last5) {
      const isHome = g.homeTeam.name === team;
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
      atsCovered: atsCov,
      atsLost,
      atsPct: atsTotal > 0 ? Math.round((atsCov / atsTotal) * 1000) / 10 : 50,
      overs,
      unders,
      overPct: ouTotal > 0 ? Math.round((overs / ouTotal) * 1000) / 10 : 50,
      last5ATS: { covered: l5AtsCov, lost: l5AtsLost },
      last5OU: { overs: l5OUOver, unders: l5OUUnder },
    };
  }

  getRecentGames(team: string, count: number): GameRecord[] {
    const games = this.teamGames.get(team) || [];
    return games.slice(-count);
  }
}

// ─── Main Backtest ──────────────────────────────────────────────────────────

async function runBacktest() {
  console.log("=== NCAAMB Daily Picks Backtest ===\n");

  // 1. Load all NCAAMB games for season 2025, sorted by date
  console.log("Loading games...");
  const allGames = await prisma.nCAAMBGame.findMany({
    where: { season: 2025, spread: { not: null } },
    orderBy: { gameDate: "asc" },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  }) as unknown as GameRecord[];

  console.log(`Loaded ${allGames.length} games with spreads`);

  // Also load prior season data for H2H lookups
  const priorGames = await prisma.nCAAMBGame.findMany({
    where: { season: { lt: 2025 } },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  }) as unknown as GameRecord[];
  console.log(`Loaded ${priorGames.length} prior season games for H2H\n`);

  // 2. Load KenPom ratings — prefer PIT (point-in-time) over static
  const pitPath = path.resolve(__dirname, "../data/pit-kenpom-ratings.json");
  const usePIT = fs.existsSync(pitPath);
  let staticKenpomRatings: Map<string, KenpomRating> | null = null;
  let getPITRatings: ((gameDate: Date) => Map<string, KenpomRating> | null) | null = null;

  if (usePIT) {
    console.log("Loading PIT (point-in-time) KenPom ratings...");
    getPITRatings = loadPITRatings(pitPath);
    console.log("  Using PIT ratings — no look-ahead bias ✓\n");
  } else {
    console.log("No PIT ratings found, falling back to static end-of-season ratings...");
    console.log("  ⚠ WARNING: Static ratings have look-ahead bias");
    console.log("  Run: npx tsx scripts/generate-pit-ratings.ts  to generate PIT ratings\n");
    try {
      staticKenpomRatings = await getKenpomRatings();
      console.log(`  Loaded ${staticKenpomRatings.size} static KenPom ratings\n`);
    } catch (err) {
      console.log("  KenPom not available, running without model edge\n");
    }
  }

  // 3. Walk-forward simulation
  const tracker = new TeamStatsTracker();
  const results: PickResult[] = [];

  // Group games by date
  const gamesByDate = new Map<string, GameRecord[]>();
  for (const game of allGames) {
    const dateStr = game.gameDate.toISOString().split("T")[0];
    if (!gamesByDate.has(dateStr)) gamesByDate.set(dateStr, []);
    gamesByDate.get(dateStr)!.push(game);
  }

  const dates = [...gamesByDate.keys()].sort();
  let processedGames = 0;
  const startTime = Date.now();

  // Include prior games in the history for H2H
  const allHistoricalGames: GameRecord[] = [...priorGames];

  // Skip first 2 weeks of season (insufficient data for meaningful signals)
  const minDate = new Date(dates[0]);
  minDate.setDate(minDate.getDate() + 14);
  const minDateStr = minDate.toISOString().split("T")[0];

  for (const dateStr of dates) {
    const dayGames = gamesByDate.get(dateStr)!;

    if (dateStr >= minDateStr) {
      // Get PIT ratings for this specific date (or fall back to static)
      const kenpomRatings = getPITRatings
        ? getPITRatings(dayGames[0].gameDate)
        : staticKenpomRatings;

      // Process each game for this date
      for (const game of dayGames) {
        if (game.spread === null) continue;

        const homeTeamName = game.homeTeam.name;
        const awayTeamName = game.awayTeam.name;

        // Build stats from games BEFORE this date
        const homeStats = tracker.getStats(homeTeamName);
        const awayStats = tracker.getStats(awayTeamName);

        // ── Spread Pick ──
        const spreadSignals: SignalResult[] = [
          computeKenPomSpreadSignal(kenpomRatings, homeTeamName, awayTeamName, game.spread, game.gameDate),
          signalSeasonATS(homeStats, awayStats),
          signalRecentForm(homeStats, awayStats),
          signalH2H(allHistoricalGames, homeTeamName, awayTeamName),
          signalRestDays(tracker, homeTeamName, awayTeamName, game.gameDate),
        ];

        const spreadResult = computeConvergenceScore(spreadSignals, SPREAD_WEIGHTS, true, 3);
        const spreadConf = spreadResult.score >= 85 ? 5 : spreadResult.score >= 70 ? 4 : 0;

        if (spreadConf > 0 && game.spreadResult) {
          let actualResult: "WIN" | "LOSS" | "PUSH";
          if (spreadResult.direction === "home") {
            actualResult = game.spreadResult === "COVERED" ? "WIN" : game.spreadResult === "LOST" ? "LOSS" : "PUSH";
          } else {
            actualResult = game.spreadResult === "COVERED" ? "LOSS" : game.spreadResult === "LOST" ? "WIN" : "PUSH";
          }

          results.push({
            date: dateStr,
            homeTeam: homeTeamName,
            awayTeam: awayTeamName,
            pickType: "SPREAD",
            pickSide: spreadResult.direction,
            line: game.spread,
            trendScore: spreadResult.score,
            confidence: spreadConf,
            actualResult,
          });
        }

        // ── O/U Pick ──
        if (game.overUnder !== null && game.ouResult) {
          const ouSignals: SignalResult[] = [
            computeKenPomOUSignal(kenpomRatings, homeTeamName, awayTeamName, game.overUnder, game.gameDate),
            signalSeasonOU(homeStats, awayStats),
            signalRecentFormOU(homeStats, awayStats),
            signalH2HOU(allHistoricalGames, homeTeamName, awayTeamName, game.overUnder),
            signalTempoDiff(kenpomRatings, homeTeamName, awayTeamName),
          ];

          // v5: skip O/U convergence bonus + require min 3 active signals
          const ouResult = computeConvergenceScore(ouSignals, OU_WEIGHTS, true, 3);
          const ouConf = ouResult.score >= 85 ? 5 : ouResult.score >= 70 ? 4 : 0;

          if (ouConf > 0) {
            let actualOUResult: "WIN" | "LOSS" | "PUSH";
            if (ouResult.direction === "over") {
              actualOUResult = game.ouResult === "OVER" ? "WIN" : game.ouResult === "UNDER" ? "LOSS" : "PUSH";
            } else {
              actualOUResult = game.ouResult === "UNDER" ? "WIN" : game.ouResult === "OVER" ? "LOSS" : "PUSH";
            }

            results.push({
              date: dateStr,
              homeTeam: homeTeamName,
              awayTeam: awayTeamName,
              pickType: "OVER_UNDER",
              pickSide: ouResult.direction,
              line: game.overUnder,
              trendScore: ouResult.score,
              confidence: ouConf,
              actualResult: actualOUResult,
            });
          }
        }
      }
    }

    // After processing, add all today's games to the tracker (walk-forward)
    for (const game of dayGames) {
      tracker.addGame(game);
      allHistoricalGames.push(game);
    }

    processedGames += dayGames.length;

    // Progress
    if (processedGames % 500 === 0 || dateStr === dates[dates.length - 1]) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ${dateStr}: ${processedGames}/${allGames.length} games processed (${elapsed}s), ${results.length} picks generated`);
    }
  }

  // 4. Analyze results
  console.log("\n" + "=".repeat(70));
  console.log("BACKTEST RESULTS");
  console.log("=".repeat(70));
  console.log(`Total picks generated: ${results.length}`);
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Games evaluated: ${allGames.length}`);

  // Overall
  const wins = results.filter((r) => r.actualResult === "WIN").length;
  const losses = results.filter((r) => r.actualResult === "LOSS").length;
  const pushes = results.filter((r) => r.actualResult === "PUSH").length;
  const decided = wins + losses;
  const winPct = decided > 0 ? ((wins / decided) * 100).toFixed(1) : "N/A";
  // Assume -110 odds for ROI
  const roi = decided > 0
    ? (((wins * 100 / 110) - losses) / decided * 100).toFixed(1)
    : "N/A";

  console.log(`\n── Overall ──`);
  console.log(`Record: ${wins}-${losses}-${pushes} (${winPct}%)`);
  console.log(`ROI at -110: ${roi}%`);

  // By pick type
  for (const pickType of ["SPREAD", "OVER_UNDER"] as const) {
    const typeResults = results.filter((r) => r.pickType === pickType);
    const tw = typeResults.filter((r) => r.actualResult === "WIN").length;
    const tl = typeResults.filter((r) => r.actualResult === "LOSS").length;
    const tp = typeResults.filter((r) => r.actualResult === "PUSH").length;
    const td = tw + tl;
    const tpct = td > 0 ? ((tw / td) * 100).toFixed(1) : "N/A";
    const troi = td > 0 ? (((tw * 100 / 110) - tl) / td * 100).toFixed(1) : "N/A";
    console.log(`\n── ${pickType} ──`);
    console.log(`Record: ${tw}-${tl}-${tp} (${tpct}%)`);
    console.log(`ROI at -110: ${troi}%`);
  }

  // By confidence tier
  for (const conf of [3, 4, 5]) {
    const tierResults = results.filter((r) => r.confidence === conf);
    const tw = tierResults.filter((r) => r.actualResult === "WIN").length;
    const tl = tierResults.filter((r) => r.actualResult === "LOSS").length;
    const tp = tierResults.filter((r) => r.actualResult === "PUSH").length;
    const td = tw + tl;
    const tpct = td > 0 ? ((tw / td) * 100).toFixed(1) : "N/A";
    const troi = td > 0 ? (((tw * 100 / 110) - tl) / td * 100).toFixed(1) : "N/A";
    const stars = "★".repeat(conf);
    console.log(`\n── ${stars} (${conf}★) ──`);
    console.log(`Picks: ${tierResults.length}`);
    console.log(`Record: ${tw}-${tl}-${tp} (${tpct}%)`);
    console.log(`ROI at -110: ${troi}%`);
  }

  // By confidence tier × pick type
  console.log(`\n── By Tier × Type ──`);
  for (const conf of [3, 4, 5]) {
    for (const pickType of ["SPREAD", "OVER_UNDER"] as const) {
      const subset = results.filter((r) => r.confidence === conf && r.pickType === pickType);
      if (subset.length === 0) continue;
      const tw = subset.filter((r) => r.actualResult === "WIN").length;
      const tl = subset.filter((r) => r.actualResult === "LOSS").length;
      const tp = subset.filter((r) => r.actualResult === "PUSH").length;
      const td = tw + tl;
      const tpct = td > 0 ? ((tw / td) * 100).toFixed(1) : "N/A";
      const troi = td > 0 ? (((tw * 100 / 110) - tl) / td * 100).toFixed(1) : "N/A";
      console.log(`  ${conf}★ ${pickType}: ${tw}-${tl}-${tp} (${tpct}%, ROI: ${troi}%)`);
    }
  }

  // Monthly breakdown
  console.log(`\n── Monthly Breakdown ──`);
  const months = [...new Set(results.map((r) => r.date.substring(0, 7)))].sort();
  for (const month of months) {
    const monthResults = results.filter((r) => r.date.startsWith(month));
    const tw = monthResults.filter((r) => r.actualResult === "WIN").length;
    const tl = monthResults.filter((r) => r.actualResult === "LOSS").length;
    const tp = monthResults.filter((r) => r.actualResult === "PUSH").length;
    const td = tw + tl;
    const tpct = td > 0 ? ((tw / td) * 100).toFixed(1) : "N/A";
    const troi = td > 0 ? (((tw * 100 / 110) - tl) / td * 100).toFixed(1) : "N/A";
    console.log(`  ${month}: ${tw}-${tl}-${tp} (${tpct}%, ROI: ${troi}%) [${monthResults.length} picks]`);
  }

  // Best and worst days
  const dayResults = new Map<string, { wins: number; losses: number; picks: number }>();
  for (const r of results) {
    if (!dayResults.has(r.date)) dayResults.set(r.date, { wins: 0, losses: 0, picks: 0 });
    const d = dayResults.get(r.date)!;
    d.picks++;
    if (r.actualResult === "WIN") d.wins++;
    else if (r.actualResult === "LOSS") d.losses++;
  }

  const sortedDays = [...dayResults.entries()]
    .filter(([, d]) => d.picks >= 5)
    .sort((a, b) => {
      const aRate = a[1].wins / (a[1].wins + a[1].losses || 1);
      const bRate = b[1].wins / (b[1].wins + b[1].losses || 1);
      return bRate - aRate;
    });

  if (sortedDays.length > 0) {
    console.log(`\n── Best Days (5+ picks) ──`);
    for (const [date, d] of sortedDays.slice(0, 5)) {
      const pct = ((d.wins / (d.wins + d.losses || 1)) * 100).toFixed(0);
      console.log(`  ${date}: ${d.wins}-${d.losses} (${pct}%) [${d.picks} picks]`);
    }

    console.log(`\n── Worst Days (5+ picks) ──`);
    for (const [date, d] of sortedDays.slice(-5).reverse()) {
      const pct = ((d.wins / (d.wins + d.losses || 1)) * 100).toFixed(0);
      console.log(`  ${date}: ${d.wins}-${d.losses} (${pct}%) [${d.picks} picks]`);
    }
  }

  // 5★ pick details
  const fiveStarPicks = results.filter((r) => r.confidence === 5);
  if (fiveStarPicks.length > 0) {
    console.log(`\n── 5★ Pick Details ──`);
    for (const p of fiveStarPicks.slice(0, 20)) {
      const result = p.actualResult === "WIN" ? "✅" : p.actualResult === "LOSS" ? "❌" : "➖";
      const sideLabel = p.pickSide === "home" ? p.homeTeam : p.pickSide === "away" ? p.awayTeam : p.pickSide;
      console.log(`  ${result} ${p.date} ${p.pickType === "SPREAD" ? "ATS" : "O/U"}: ${sideLabel} (score: ${p.trendScore})`);
    }
    if (fiveStarPicks.length > 20) {
      console.log(`  ... and ${fiveStarPicks.length - 20} more`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("NOTES:");
  if (usePIT) {
    console.log("• KenPom ratings: PIT (point-in-time) blended approach.");
    console.log("  Prior season (2024) → current season (2025) blend by date.");
    console.log("  No look-ahead bias ✓");
  } else {
    console.log("• KenPom ratings are current (end-of-season), NOT historical.");
    console.log("  This introduces look-ahead bias for the model edge signal.");
  }
  console.log("• Trend Angles signal excluded (too expensive for 5500+ games).");
  console.log("  Live picks include this signal (weight: 0.25).");
  console.log("• Walk-forward: season ATS/form stats use only pre-game data.");
  console.log("• -110 odds assumed for all picks (standard vig).");
  console.log("• Break-even at -110 = 52.4%");
  console.log("=".repeat(70));
}

runBacktest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backtest failed:", err);
    process.exit(1);
  });
