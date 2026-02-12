/**
 * Pick Engine v5 vs v6 Backtest Comparison
 *
 * Runs the same walk-forward simulation twice:
 *   - v5 config: flat HCA=2.0, no AdjOE modifier
 *   - v6 config: context-aware HCA, AdjOE modifier
 *
 * Prints side-by-side comparison of:
 *   - Overall ATS and O/U records
 *   - 4★ and 5★ breakdowns
 *   - ROI at -110 for each tier
 *
 * Also tests moneyline market edge signal when data is available.
 * FanMatch win probability is computed from KenPom AdjEM as a proxy for
 * games without stored FanMatch data.
 *
 * Usage: npx tsx scripts/backtest-v6-compare.ts [--season 2025|2026]
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/db";
import { getKenpomRatings, lookupRating, type KenpomRating } from "../src/lib/kenpom";
import { wilsonInterval } from "../src/lib/trend-stats";

// ─── Config ──────────────────────────────────────────────────────────────────

interface BacktestConfig {
  name: string;
  hcaMode: "flat" | "context";
  adjOEModifier: boolean;
  marketEdge: boolean;
  // Tunable thresholds for sensitivity analysis
  hcaConf?: number;      // Conference HCA (default 2.5)
  hcaNonConf?: number;   // Non-conference HCA (default 1.5)
  hcaNov?: number;       // November HCA (default 1.0)
  hcaMar?: number;       // March HCA (default 0.5)
  adjOEOverThresh?: number;  // AdjOE over threshold (default 220)
  adjOEUnderThresh?: number; // AdjOE under threshold (default 195)
  mlEdgeThresh?: number;     // Market edge threshold (default 0.08)
}

const V5_CONFIG: BacktestConfig = {
  name: "v5 (flat HCA, no AdjOE)",
  hcaMode: "flat",
  adjOEModifier: false,
  marketEdge: false,
};

const V6_CONFIG: BacktestConfig = {
  name: "v6 (context HCA + AdjOE + ML edge)",
  hcaMode: "context",
  adjOEModifier: true,
  marketEdge: true,
};

// ─── PIT Ratings ─────────────────────────────────────────────────────────────

interface PITSnapshot {
  date: string;
  alpha: number;
  teamCount: number;
  ratings: Record<string, KenpomRating>;
}

function loadPITRatings(pitPath: string): ((gameDate: Date) => Map<string, KenpomRating> | null) {
  if (!fs.existsSync(pitPath)) return () => null;
  const snapshots: PITSnapshot[] = JSON.parse(fs.readFileSync(pitPath, "utf-8"));
  const snapshotMaps = snapshots.map(s => ({
    date: s.date,
    ratings: new Map(Object.entries(s.ratings)),
  }));
  return (gameDate: Date) => {
    const dateStr = gameDate.toISOString().split("T")[0];
    let best = snapshotMaps[0];
    for (const snap of snapshotMaps) {
      if (snap.date <= dateStr) best = snap;
      else break;
    }
    return best?.ratings ?? null;
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

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
  moneylineHome: number | null;
  moneylineAway: number | null;
  fmHomeWinProb: number | null;
  spreadResult: string | null;
  ouResult: string | null;
  homeTeam: { name: true extends true ? string : never };
  awayTeam: { name: true extends true ? string : never };
}

interface TeamStats {
  atsCovered: number;
  atsLost: number;
  overs: number;
  unders: number;
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
  pickType: "SPREAD" | "OVER_UNDER";
  pickSide: string;
  trendScore: number;
  confidence: number;
  actualResult: "WIN" | "LOSS" | "PUSH";
}

interface RunSummary {
  configName: string;
  total: number;
  spreadWins: number; spreadLosses: number; spreadPushes: number;
  ouWins: number; ouLosses: number; ouPushes: number;
  star4Spread: { w: number; l: number; p: number };
  star5Spread: { w: number; l: number; p: number };
  star4OU: { w: number; l: number; p: number };
  star5OU: { w: number; l: number; p: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

// ─── Weights ─────────────────────────────────────────────────────────────────

const SPREAD_WEIGHTS: Record<string, number> = {
  modelEdge: 0.30, seasonATS: 0.15, recentForm: 0.10, h2h: 0.05, restDays: 0.05, marketEdge: 0.10,
};
const OU_WEIGHTS: Record<string, number> = {
  modelEdge: 0.35, seasonOU: 0.12, recentForm: 0.08, h2hWeather: 0.12, tempoDiff: 0.15,
};

// ─── Signal Functions ────────────────────────────────────────────────────────

function computeKenPomSpreadSignal(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string, awayTeam: string,
  spread: number, gameDate: Date,
  config: BacktestConfig,
): SignalResult {
  const neutral: SignalResult = {
    category: "modelEdge", direction: "neutral",
    magnitude: 0, confidence: 0, label: "No KenPom", strength: "noise",
  };
  if (!ratings) return neutral;
  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return neutral;

  const gameMonth = gameDate.getMonth() + 1;

  // HCA selection based on config
  let hca: number;
  if (config.hcaMode === "context") {
    const isConfGame = homeR.ConfShort === awayR.ConfShort;
    hca = isConfGame ? (config.hcaConf ?? 2.5)
      : gameMonth >= 3 && gameMonth <= 4 ? (config.hcaMar ?? 0.5)
      : gameMonth >= 11 ? (config.hcaNov ?? 1.0)
      : (config.hcaNonConf ?? 1.5);
  } else {
    hca = 2.0;
  }

  const predictedMargin = homeR.AdjEM - awayR.AdjEM + hca;
  const spreadEdge = predictedMargin + spread;
  let absMag = clamp(Math.abs(spreadEdge) / 0.7, 0, 10);
  let conf = 0.8;

  const isEarlySeason = gameMonth >= 11;
  if (spreadEdge > 0.5 && !isEarlySeason) { absMag *= 0.20; conf = 0.30; }
  if (gameMonth === 3 && spreadEdge > 0.5 && homeR.RankAdjEM <= 25) { absMag *= 0.25; conf = 0.35; }

  return {
    category: "modelEdge",
    direction: spreadEdge > 0.5 ? "home" : spreadEdge < -0.5 ? "away" : "neutral",
    magnitude: absMag, confidence: conf,
    label: `KenPom edge ${spreadEdge.toFixed(1)} (HCA=${hca})`,
    strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
  };
}

function computeKenPomOUSignal(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string, awayTeam: string,
  overUnder: number, gameDate: Date,
  config: BacktestConfig,
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

  if (sumAdjDE > 215) { dir = "over"; mag = 8; conf = 0.85; }
  else if (sumAdjDE > 210) { /* neutral */ }
  else if (sumAdjDE > 205) { dir = "under"; mag = 5; conf = 0.80; }
  else if (sumAdjDE > 200) { dir = "under"; mag = 6; conf = 0.85; }
  else if (sumAdjDE > 195) { dir = "under"; mag = 8; conf = 0.90; }
  else if (sumAdjDE > 190) { dir = "under"; mag = 8; conf = 0.92; }
  else if (sumAdjDE > 185) { dir = "under"; mag = 9; conf = 0.93; }
  else { dir = "under"; mag = 10; conf = 0.95; }

  if (dir === "over" && avgTempo > 70 && sumAdjDE > 215) {
    mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0);
  } else if (dir === "under" && avgTempo < 64 && sumAdjDE < 195) {
    mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0);
  }

  // v6: AdjOE modifier
  if (config.adjOEModifier) {
    const sumAdjOE = homeR.AdjOE + awayR.AdjOE;
    const overThresh = config.adjOEOverThresh ?? 220;
    const underThresh = config.adjOEUnderThresh ?? 195;
    if (sumAdjOE > overThresh && dir === "over") {
      mag = Math.min(mag + 1, 10);
    } else if (sumAdjOE < underThresh && dir === "under") {
      mag = Math.min(mag + 1, 10);
    }
  }

  if (homeR.RankAdjEM <= 50 && awayR.RankAdjEM <= 50) { dir = "under"; mag = 10; conf = 0.95; }

  const powerConfs = ["BE", "B12", "B10", "SEC", "ACC", "P12"];
  const homeIsPower = powerConfs.includes(homeR.ConfShort ?? "");
  const awayIsPower = powerConfs.includes(awayR.ConfShort ?? "");
  if (homeIsPower && awayIsPower && !(homeR.RankAdjEM <= 50 && awayR.RankAdjEM <= 50)) {
    if (dir === "under") mag = Math.min(mag + 2, 10);
    else if (dir === "neutral" || dir === "over") { dir = "under"; mag = Math.max(mag, 6); conf = Math.max(conf, 0.82); }
  }

  if (homeR.RankAdjEM > 200 && awayR.RankAdjEM > 200) {
    if (dir === "over") mag = Math.min(mag + 1, 10);
    else if (dir === "neutral") { dir = "over"; mag = Math.max(mag, 5); conf = Math.max(conf, 0.78); }
  }

  if (gameMonth === 3) {
    if (dir === "under") mag = Math.min(mag + 1, 10);
    else if (dir === "neutral") { dir = "under"; mag = 3; conf = Math.max(conf, 0.60); }
  }

  if (overUnder >= 160) { dir = "under"; mag = Math.max(mag, 8); conf = Math.max(conf, 0.88); }
  else if (overUnder >= 155) { dir = "under"; mag = Math.max(mag, 6); conf = Math.max(conf, 0.82); }

  if (overUnder < 135) {
    if (dir === "over") { mag = Math.min(mag + 2, 10); conf = Math.min(conf + 0.05, 1.0); }
    else if (dir === "neutral") { dir = "over"; mag = 4; conf = Math.max(conf, 0.70); }
  }

  mag = clamp(mag, 0, 10);
  return {
    category: "modelEdge", direction: dir, magnitude: mag, confidence: conf,
    label: `O/U sumDE=${sumAdjDE.toFixed(1)}`,
    strength: mag >= 6 ? "strong" : mag >= 3 ? "moderate" : mag >= 1 ? "weak" : "noise",
  };
}

// ─── Walk-forward signals (same as backtest-ncaamb.ts) ───────────────────────

function signalSeasonATS(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeTotal = homeStats.atsCovered + homeStats.atsLost;
  const awayTotal = awayStats.atsCovered + awayStats.atsLost;
  const homeEdge = homeTotal >= 5 ? wilsonInterval(homeStats.atsCovered, homeTotal)[0] - 0.5 : 0;
  const awayEdge = awayTotal >= 5 ? wilsonInterval(awayStats.atsCovered, awayTotal)[0] - 0.5 : 0;
  const netEdge = -(homeEdge - awayEdge);
  const absMag = clamp(Math.abs(netEdge) * 50, 0, 10);
  const minGames = Math.min(homeTotal, awayTotal);
  const conf = clamp(0.3 + minGames * 0.02, 0.3, 0.8);
  if (absMag < 0.5) return { category: "seasonATS", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "seasonATS", direction: netEdge > 0 ? "home" : "away", magnitude: absMag, confidence: conf, label: "Season ATS", strength: absMag >= 7 ? "strong" : absMag >= 3.5 ? "moderate" : "weak" };
}

function signalRecentForm(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5ATS.covered + homeStats.last5ATS.lost;
  const awayL5 = awayStats.last5ATS.covered + awayStats.last5ATS.lost;
  if (homeL5 < 3 && awayL5 < 3) return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  const homeRate = homeL5 > 0 ? homeStats.last5ATS.covered / homeL5 : 0.5;
  const awayRate = awayL5 > 0 ? awayStats.last5ATS.covered / awayL5 : 0.5;
  const netMomentum = homeRate - awayRate;
  let magnitude = clamp(Math.abs(netMomentum) * 10, 0, 10);
  if (homeStats.last5ATS.covered >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (homeStats.last5ATS.covered >= 4) magnitude = Math.min(magnitude + 1, 10);
  if (awayStats.last5ATS.covered >= 5) magnitude = Math.min(magnitude + 2, 10);
  else if (awayStats.last5ATS.covered >= 4) magnitude = Math.min(magnitude + 1, 10);
  const conf = clamp(0.4 + Math.min(homeL5, awayL5) * 0.08, 0.4, 0.7);
  if (magnitude < 1) return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "recentForm", direction: netMomentum > 0 ? "home" : "away", magnitude, confidence: conf, label: "Recent form", strength: magnitude >= 7 ? "strong" : magnitude >= 4 ? "moderate" : "weak" };
}

function signalH2H(pastGames: GameRecord[], homeTeamName: string, awayTeamName: string): SignalResult {
  const matchups = pastGames.filter(g => (g.homeTeam.name === homeTeamName && g.awayTeam.name === awayTeamName) || (g.homeTeam.name === awayTeamName && g.awayTeam.name === homeTeamName));
  if (matchups.length < 3) return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  let homeAtsCov = 0, homeAtsLost = 0;
  for (const g of matchups) {
    if (g.homeTeam.name === homeTeamName) { if (g.spreadResult === "COVERED") homeAtsCov++; else if (g.spreadResult === "LOST") homeAtsLost++; }
    else { if (g.spreadResult === "COVERED") homeAtsLost++; else if (g.spreadResult === "LOST") homeAtsCov++; }
  }
  const h2hTotal = homeAtsCov + homeAtsLost;
  if (h2hTotal < 3) return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  const [lower] = wilsonInterval(homeAtsCov, h2hTotal);
  const edge = lower - 0.5;
  const magnitude = clamp(Math.abs(edge) * 40, 0, 10);
  const conf = clamp(0.3 + h2hTotal * 0.03, 0.3, 0.7);
  if (magnitude < 0.5) return { category: "h2h", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "h2h", direction: edge > 0 ? "home" : "away", magnitude, confidence: conf, label: "H2H", strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak" };
}

function signalSeasonOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeTotal = homeStats.overs + homeStats.unders;
  const awayTotal = awayStats.overs + awayStats.unders;
  const homeOverEdge = homeTotal >= 8 ? wilsonInterval(homeStats.overs, homeTotal)[0] - 0.5 : 0;
  const awayOverEdge = awayTotal >= 8 ? wilsonInterval(awayStats.overs, awayTotal)[0] - 0.5 : 0;
  const avgOverLean = (homeOverEdge + awayOverEdge) / 2;
  const absMag = clamp(Math.abs(avgOverLean) * 50, 0, 10);
  const conf = clamp(0.3 + Math.min(homeTotal, awayTotal) * 0.015, 0.3, 0.75);
  if (absMag < 0.5) return { category: "seasonOU", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "seasonOU", direction: avgOverLean > 0 ? "over" : "under", magnitude: absMag, confidence: conf, label: "Season O/U", strength: absMag >= 6 ? "strong" : absMag >= 3 ? "moderate" : "weak" };
}

function signalRecentFormOU(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
  const homeL5 = homeStats.last5OU.overs + homeStats.last5OU.unders;
  const awayL5 = awayStats.last5OU.overs + awayStats.last5OU.unders;
  if (homeL5 < 3 && awayL5 < 3) return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  const homeOverRate = homeL5 > 0 ? homeStats.last5OU.overs / homeL5 : 0.5;
  const awayOverRate = awayL5 > 0 ? awayStats.last5OU.overs / awayL5 : 0.5;
  const avgOverLean = (homeOverRate + awayOverRate) / 2 - 0.5;
  const magnitude = clamp(Math.abs(avgOverLean) * 20, 0, 10);
  if (magnitude < 1) return { category: "recentForm", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "recentForm", direction: avgOverLean > 0 ? "over" : "under", magnitude, confidence: 0.5, label: "Recent O/U", strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak" };
}

function signalH2HOU(pastGames: GameRecord[], homeTeamName: string, awayTeamName: string, overUnder: number): SignalResult {
  const matchups = pastGames.filter(g => (g.homeTeam.name === homeTeamName && g.awayTeam.name === awayTeamName) || (g.homeTeam.name === awayTeamName && g.awayTeam.name === homeTeamName));
  if (matchups.length < 3) return { category: "h2hWeather", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  let totalPts = 0, overs = 0, unders = 0;
  for (const g of matchups) { totalPts += g.homeScore + g.awayScore; if (g.ouResult === "OVER") overs++; else if (g.ouResult === "UNDER") unders++; }
  const avgTotal = totalPts / matchups.length;
  let magnitude = 0;
  let direction: "over" | "under" | "neutral" = "neutral";
  let conf = 0.4;
  const diff = avgTotal - overUnder;
  if (Math.abs(diff) >= 3) { magnitude += clamp(Math.abs(diff) / 2, 0, 6); direction = diff > 0 ? "over" : "under"; conf = Math.min(conf + 0.1, 0.7); }
  const h2hOUTotal = overs + unders;
  if (h2hOUTotal >= 5) { const overPct = overs / h2hOUTotal; if (Math.abs(overPct - 0.5) > 0.15) { magnitude += 2; if (direction === "neutral") direction = overPct > 0.5 ? "over" : "under"; } }
  magnitude = clamp(magnitude, 0, 10);
  if (magnitude < 0.5) return { category: "h2hWeather", direction: "neutral", magnitude: 0, confidence: 0, label: "", strength: "noise" };
  return { category: "h2hWeather", direction, magnitude, confidence: conf, label: "H2H O/U", strength: magnitude >= 6 ? "strong" : magnitude >= 3 ? "moderate" : "weak" };
}

function signalTempoDiff(ratings: Map<string, KenpomRating> | null, homeTeam: string, awayTeam: string): SignalResult {
  const neutral: SignalResult = { category: "tempoDiff", direction: "neutral", magnitude: 0, confidence: 0, label: "N/A", strength: "noise" };
  if (!ratings) return neutral;
  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return neutral;
  const tempoDiff = Math.abs(homeR.AdjTempo - awayR.AdjTempo);
  const avgTempo = (homeR.AdjTempo + awayR.AdjTempo) / 2;
  if (tempoDiff >= 8) {
    const slowerTempo = Math.min(homeR.AdjTempo, awayR.AdjTempo);
    if (slowerTempo < 66) return { category: "tempoDiff", direction: "under", magnitude: 6, confidence: 0.72, label: `Tempo mismatch ${tempoDiff.toFixed(1)}`, strength: "moderate" };
    return { category: "tempoDiff", direction: "under", magnitude: 4, confidence: 0.62, label: `Tempo mismatch ${tempoDiff.toFixed(1)}`, strength: "moderate" };
  }
  if (avgTempo > 70 && tempoDiff < 4) return { category: "tempoDiff", direction: "over", magnitude: 5, confidence: 0.65, label: `Both fast tempo`, strength: "moderate" };
  if (avgTempo < 63 && tempoDiff < 4) return { category: "tempoDiff", direction: "under", magnitude: 5, confidence: 0.68, label: `Both slow tempo`, strength: "moderate" };
  return neutral;
}

// ─── Signal: Moneyline Market Edge ────────────────────────────────────────────
// Compare KenPom win probability vs market-implied probability from moneylines.
// Uses stored fmHomeWinProb or computes approximate WP from AdjEM.

function computeKenpomWP(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string, awayTeam: string,
  hca: number,
): number | null {
  if (!ratings) return null;
  const homeR = lookupRating(ratings, homeTeam);
  const awayR = lookupRating(ratings, awayTeam);
  if (!homeR || !awayR) return null;
  // Standard logistic model: WP = 1 / (1 + e^(-0.175 * margin))
  const margin = homeR.AdjEM - awayR.AdjEM + hca;
  return 1 / (1 + Math.exp(-0.175 * margin));
}

function signalMoneylineEdge(
  moneylineHome: number | null,
  moneylineAway: number | null,
  kenpomHomeWP: number | null,
  threshold = 0.08,
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

  if (absEdge < threshold) return neutral; // Not enough divergence

  const direction: "home" | "away" = edge > 0 ? "home" : "away";
  const isStrong = absEdge >= 0.15;
  const magnitude = isStrong ? 7 : 5;
  const confidence = isStrong ? 0.75 : 0.60;

  return {
    category: "marketEdge", direction, magnitude, confidence,
    label: `ML edge: KP ${(kenpomHomeWP * 100).toFixed(0)}% vs mkt ${(marketHomeWP * 100).toFixed(0)}%`,
    strength: isStrong ? "strong" : "moderate",
  };
}

// ─── Rest / B2B ──────────────────────────────────────────────────────────────

class TeamStatsTracker {
  private teamGames: Map<string, GameRecord[]> = new Map();
  addGame(game: GameRecord) {
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
      if (isHome) { if (g.spreadResult === "COVERED") atsCov++; else if (g.spreadResult === "LOST") atsLost++; }
      else { if (g.spreadResult === "COVERED") atsLost++; else if (g.spreadResult === "LOST") atsCov++; }
      if (g.ouResult === "OVER") overs++; else if (g.ouResult === "UNDER") unders++;
    }
    const last5 = games.slice(-5);
    let l5AtsCov = 0, l5AtsLost = 0, l5OUOver = 0, l5OUUnder = 0;
    for (const g of last5) {
      const isHome = g.homeTeam.name === team;
      if (isHome) { if (g.spreadResult === "COVERED") l5AtsCov++; else if (g.spreadResult === "LOST") l5AtsLost++; }
      else { if (g.spreadResult === "COVERED") l5AtsLost++; else if (g.spreadResult === "LOST") l5AtsCov++; }
      if (g.ouResult === "OVER") l5OUOver++; else if (g.ouResult === "UNDER") l5OUUnder++;
    }
    return { atsCovered: atsCov, atsLost, overs, unders, last5ATS: { covered: l5AtsCov, lost: l5AtsLost }, last5OU: { overs: l5OUOver, unders: l5OUUnder } };
  }
  getRecentGames(team: string, count: number): GameRecord[] {
    return (this.teamGames.get(team) || []).slice(-count);
  }
}

function signalRestDays(tracker: TeamStatsTracker, homeTeam: string, awayTeam: string, gameDate: Date): SignalResult {
  const neutral: SignalResult = { category: "restDays", direction: "neutral", magnitude: 0, confidence: 0, label: "Normal rest", strength: "noise" };
  const homeGames = tracker.getRecentGames(homeTeam, 1);
  const awayGames = tracker.getRecentGames(awayTeam, 1);
  if (homeGames.length === 0 && awayGames.length === 0) return neutral;
  const oneDayMs = 36 * 60 * 60 * 1000;
  const gameDateMs = gameDate.getTime();
  const homeOnB2B = homeGames.length > 0 && (gameDateMs - homeGames[0].gameDate.getTime()) <= oneDayMs;
  const awayOnB2B = awayGames.length > 0 && (gameDateMs - awayGames[0].gameDate.getTime()) <= oneDayMs;
  if (homeOnB2B && !awayOnB2B) return { category: "restDays", direction: "away", magnitude: 5, confidence: 0.65, label: `${homeTeam} on B2B`, strength: "moderate" };
  else if (awayOnB2B && !homeOnB2B) return { category: "restDays", direction: "home", magnitude: 3, confidence: 0.55, label: `${awayTeam} on B2B`, strength: "weak" };
  return neutral;
}

// ─── Convergence ─────────────────────────────────────────────────────────────

function computeConvergenceScore(
  signals: SignalResult[], weights: Record<string, number>,
  skipConvergenceBonus = false, minActiveSignals = 0,
): { score: number; direction: string } {
  const activeSignals = signals.filter(s => s.direction !== "neutral" && s.magnitude > 0);
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
  const nonNeutralCount = activeSignals.length;
  const agreeingCount = activeSignals.filter(s => s.direction === bestDir).length;
  const agreeRatio = nonNeutralCount > 0 ? agreeingCount / nonNeutralCount : 0;
  if (!skipConvergenceBonus) {
    if (agreeRatio >= 0.8 && nonNeutralCount >= 3) score += 8;
    else if (agreeRatio >= 0.6 && nonNeutralCount >= 3) score += 4;
  }
  const strongDisagreeing = activeSignals.filter(s => s.direction !== bestDir && (s.strength === "strong" || s.strength === "moderate")).length;
  if (strongDisagreeing >= 2) score -= 10; else if (strongDisagreeing === 1) score -= 5;
  if (!skipConvergenceBonus) {
    const strongModerateAgreeing = activeSignals.filter(s => s.direction === bestDir && (s.strength === "strong" || s.strength === "moderate")).length;
    if (strongModerateAgreeing >= 3) score += 6; else if (strongModerateAgreeing >= 2) score += 3;
  }
  return { score: clamp(Math.round(score), 0, 100), direction: bestDir };
}

// ─── Run Single Backtest ─────────────────────────────────────────────────────

async function runSingle(
  config: BacktestConfig,
  allGames: GameRecord[],
  priorGames: GameRecord[],
  getRatings: (gameDate: Date) => Map<string, KenpomRating> | null,
): Promise<{ results: PickResult[]; summary: RunSummary }> {
  const tracker = new TeamStatsTracker();
  const results: PickResult[] = [];

  const gamesByDate = new Map<string, GameRecord[]>();
  for (const game of allGames) {
    const dateStr = game.gameDate.toISOString().split("T")[0];
    if (!gamesByDate.has(dateStr)) gamesByDate.set(dateStr, []);
    gamesByDate.get(dateStr)!.push(game);
  }

  const dates = [...gamesByDate.keys()].sort();
  const allHistoricalGames: GameRecord[] = [...priorGames];

  const minDate = new Date(dates[0]);
  minDate.setDate(minDate.getDate() + 14);
  const minDateStr = minDate.toISOString().split("T")[0];

  for (const dateStr of dates) {
    const dayGames = gamesByDate.get(dateStr)!;

    if (dateStr >= minDateStr) {
      const kenpomRatings = getRatings(dayGames[0].gameDate);

      for (const game of dayGames) {
        if (game.spread === null) continue;
        const home = game.homeTeam.name;
        const away = game.awayTeam.name;
        const homeStats = tracker.getStats(home);
        const awayStats = tracker.getStats(away);

        // Spread
        const spreadSignals: SignalResult[] = [
          computeKenPomSpreadSignal(kenpomRatings, home, away, game.spread, game.gameDate, config),
          signalSeasonATS(homeStats, awayStats),
          signalRecentForm(homeStats, awayStats),
          signalH2H(allHistoricalGames, home, away),
          signalRestDays(tracker, home, away, game.gameDate),
        ];

        // v6: Moneyline market edge signal
        if (config.marketEdge) {
          // Use stored FM win prob, or compute from KenPom AdjEM as proxy
          const hca = config.hcaMode === "context" ? 2.0 : 2.0; // Use 2.0 for WP calc (neutral)
          const kenpomWP = game.fmHomeWinProb ?? computeKenpomWP(kenpomRatings, home, away, hca);
          spreadSignals.push(signalMoneylineEdge(game.moneylineHome, game.moneylineAway, kenpomWP, config.mlEdgeThresh ?? 0.08));
        }
        const spreadResult = computeConvergenceScore(spreadSignals, SPREAD_WEIGHTS, true, 3);
        const spreadConf = spreadResult.score >= 85 ? 5 : spreadResult.score >= 70 ? 4 : 0;

        if (spreadConf > 0 && game.spreadResult) {
          let actualResult: "WIN" | "LOSS" | "PUSH";
          if (spreadResult.direction === "home") {
            actualResult = game.spreadResult === "COVERED" ? "WIN" : game.spreadResult === "LOST" ? "LOSS" : "PUSH";
          } else {
            actualResult = game.spreadResult === "COVERED" ? "LOSS" : game.spreadResult === "LOST" ? "WIN" : "PUSH";
          }
          results.push({ date: dateStr, pickType: "SPREAD", pickSide: spreadResult.direction, trendScore: spreadResult.score, confidence: spreadConf, actualResult });
        }

        // O/U
        if (game.overUnder !== null && game.ouResult) {
          const ouSignals: SignalResult[] = [
            computeKenPomOUSignal(kenpomRatings, home, away, game.overUnder, game.gameDate, config),
            signalSeasonOU(homeStats, awayStats),
            signalRecentFormOU(homeStats, awayStats),
            signalH2HOU(allHistoricalGames, home, away, game.overUnder),
            signalTempoDiff(kenpomRatings, home, away),
          ];
          const ouResult = computeConvergenceScore(ouSignals, OU_WEIGHTS, true, 3);
          const ouConf = ouResult.score >= 85 ? 5 : ouResult.score >= 70 ? 4 : 0;

          if (ouConf > 0) {
            let actualOUResult: "WIN" | "LOSS" | "PUSH";
            if (ouResult.direction === "over") {
              actualOUResult = game.ouResult === "OVER" ? "WIN" : game.ouResult === "UNDER" ? "LOSS" : "PUSH";
            } else {
              actualOUResult = game.ouResult === "UNDER" ? "WIN" : game.ouResult === "OVER" ? "LOSS" : "PUSH";
            }
            results.push({ date: dateStr, pickType: "OVER_UNDER", pickSide: ouResult.direction, trendScore: ouResult.score, confidence: ouConf, actualResult: actualOUResult });
          }
        }
      }
    }

    for (const game of dayGames) { tracker.addGame(game); allHistoricalGames.push(game); }
  }

  // Summarize
  const spread = results.filter(r => r.pickType === "SPREAD");
  const ou = results.filter(r => r.pickType === "OVER_UNDER");
  const s4s = spread.filter(r => r.confidence === 4);
  const s5s = spread.filter(r => r.confidence === 5);
  const o4s = ou.filter(r => r.confidence === 4);
  const o5s = ou.filter(r => r.confidence === 5);

  const wlp = (arr: PickResult[]) => ({
    w: arr.filter(r => r.actualResult === "WIN").length,
    l: arr.filter(r => r.actualResult === "LOSS").length,
    p: arr.filter(r => r.actualResult === "PUSH").length,
  });

  const summary: RunSummary = {
    configName: config.name,
    total: results.length,
    spreadWins: wlp(spread).w, spreadLosses: wlp(spread).l, spreadPushes: wlp(spread).p,
    ouWins: wlp(ou).w, ouLosses: wlp(ou).l, ouPushes: wlp(ou).p,
    star4Spread: wlp(s4s), star5Spread: wlp(s5s),
    star4OU: wlp(o4s), star5OU: wlp(o5s),
  };

  return { results, summary };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtRecord(w: number, l: number, p: number): string {
  const d = w + l;
  const pct = d > 0 ? ((w / d) * 100).toFixed(1) : "N/A";
  const roi = d > 0 ? (((w * 100 / 110) - l) / d * 100).toFixed(1) : "N/A";
  return `${w}-${l}-${p}  (${pct}%, ROI: ${roi}%)`;
}

function printComparison(v5: RunSummary, v6: RunSummary) {
  const W = 45;
  const line = "─".repeat(W * 2 + 20);
  console.log(`\n${line}`);
  console.log(`${"".padEnd(18)} ${"v5".padStart(W)} ${"v6".padStart(W)}`);
  console.log(line);

  const rows: [string, string, string][] = [
    ["Total Picks", String(v5.total), String(v6.total)],
    ["", "", ""],
    ["SPREAD (all)", fmtRecord(v5.spreadWins, v5.spreadLosses, v5.spreadPushes), fmtRecord(v6.spreadWins, v6.spreadLosses, v6.spreadPushes)],
    ["  4★ SPREAD", fmtRecord(v5.star4Spread.w, v5.star4Spread.l, v5.star4Spread.p), fmtRecord(v6.star4Spread.w, v6.star4Spread.l, v6.star4Spread.p)],
    ["  5★ SPREAD", fmtRecord(v5.star5Spread.w, v5.star5Spread.l, v5.star5Spread.p), fmtRecord(v6.star5Spread.w, v6.star5Spread.l, v6.star5Spread.p)],
    ["", "", ""],
    ["O/U (all)", fmtRecord(v5.ouWins, v5.ouLosses, v5.ouPushes), fmtRecord(v6.ouWins, v6.ouLosses, v6.ouPushes)],
    ["  4★ O/U", fmtRecord(v5.star4OU.w, v5.star4OU.l, v5.star4OU.p), fmtRecord(v6.star4OU.w, v6.star4OU.l, v6.star4OU.p)],
    ["  5★ O/U", fmtRecord(v5.star5OU.w, v5.star5OU.l, v5.star5OU.p), fmtRecord(v6.star5OU.w, v6.star5OU.l, v6.star5OU.p)],
  ];

  for (const [label, v5Val, v6Val] of rows) {
    if (label === "") { console.log(""); continue; }
    console.log(`${label.padEnd(18)} ${v5Val.padStart(W)} ${v6Val.padStart(W)}`);
  }
  console.log(line);
}

// ─── Sensitivity Analysis ─────────────────────────────────────────────────────

function buildSensitivityConfigs(): BacktestConfig[] {
  const configs: BacktestConfig[] = [];

  // HCA sensitivity: test ±0.5 on each context value
  for (const [label, conf, nonConf, nov, mar] of [
    ["HCA tight", 2.0, 1.0, 0.5, 0.0],
    ["HCA default", 2.5, 1.5, 1.0, 0.5],
    ["HCA wide", 3.0, 2.0, 1.5, 1.0],
  ] as [string, number, number, number, number][]) {
    configs.push({
      name: label,
      hcaMode: "context", adjOEModifier: true, marketEdge: true,
      hcaConf: conf, hcaNonConf: nonConf, hcaNov: nov, hcaMar: mar,
    });
  }

  // AdjOE threshold sensitivity
  for (const [label, over, under] of [
    ["AdjOE 215/200", 215, 200],
    ["AdjOE 220/195", 220, 195],
    ["AdjOE 225/190", 225, 190],
  ] as [string, number, number][]) {
    configs.push({
      name: label,
      hcaMode: "context", adjOEModifier: true, marketEdge: true,
      adjOEOverThresh: over, adjOEUnderThresh: under,
    });
  }

  // Market edge threshold sensitivity
  for (const [label, thresh] of [
    ["ML edge 5%", 0.05],
    ["ML edge 8%", 0.08],
    ["ML edge 10%", 0.10],
    ["ML edge 12%", 0.12],
    ["ML edge 15%", 0.15],
  ] as [string, number][]) {
    configs.push({
      name: label,
      hcaMode: "context", adjOEModifier: true, marketEdge: true,
      mlEdgeThresh: thresh,
    });
  }

  return configs;
}

function printSensitivityTable(results: { config: BacktestConfig; summary: RunSummary }[]) {
  console.log("\n=== SENSITIVITY ANALYSIS ===\n");

  const header = [
    "Config".padEnd(20),
    "Spread".padEnd(22),
    "4★ Spread".padEnd(22),
    "5★ Spread".padEnd(22),
    "O/U".padEnd(22),
    "4★ O/U".padEnd(22),
  ].join(" | ");
  console.log(header);
  console.log("─".repeat(header.length));

  for (const { config, summary: s } of results) {
    const sD = s.spreadWins + s.spreadLosses;
    const sPct = sD > 0 ? `${(s.spreadWins / sD * 100).toFixed(1)}%` : "N/A";
    const sRec = `${s.spreadWins}-${s.spreadLosses} (${sPct})`;

    const s4D = s.star4Spread.w + s.star4Spread.l;
    const s4Pct = s4D > 0 ? `${(s.star4Spread.w / s4D * 100).toFixed(1)}%` : "N/A";
    const s4Rec = `${s.star4Spread.w}-${s.star4Spread.l} (${s4Pct})`;

    const s5D = s.star5Spread.w + s.star5Spread.l;
    const s5Pct = s5D > 0 ? `${(s.star5Spread.w / s5D * 100).toFixed(1)}%` : "N/A";
    const s5Rec = `${s.star5Spread.w}-${s.star5Spread.l} (${s5Pct})`;

    const oD = s.ouWins + s.ouLosses;
    const oPct = oD > 0 ? `${(s.ouWins / oD * 100).toFixed(1)}%` : "N/A";
    const oRec = `${s.ouWins}-${s.ouLosses} (${oPct})`;

    const o4D = s.star4OU.w + s.star4OU.l;
    const o4Pct = o4D > 0 ? `${(s.star4OU.w / o4D * 100).toFixed(1)}%` : "N/A";
    const o4Rec = `${s.star4OU.w}-${s.star4OU.l} (${o4Pct})`;

    console.log([
      config.name.padEnd(20),
      sRec.padEnd(22),
      s4Rec.padEnd(22),
      s5Rec.padEnd(22),
      oRec.padEnd(22),
      o4Rec.padEnd(22),
    ].join(" | "));
  }

  console.log("");
  console.log("Break-even at -110 = 52.4%");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const seasonIdx = args.indexOf("--season");
  const season = seasonIdx !== -1 && args[seasonIdx + 1] ? parseInt(args[seasonIdx + 1], 10) : 2026;
  const runSensitivity = args.includes("--sensitivity");

  console.log("=== Pick Engine v5 vs v6 Comparison Backtest ===");
  console.log(`Season: ${season}${runSensitivity ? " (with sensitivity analysis)" : ""}\n`);

  // Load games
  console.log("Loading games...");
  const allGames = await prisma.nCAAMBGame.findMany({
    where: { season, spread: { not: null } },
    orderBy: { gameDate: "asc" },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  }) as unknown as GameRecord[];
  console.log(`  ${allGames.length} games with spreads`);

  const priorGames = await prisma.nCAAMBGame.findMany({
    where: { season: { lt: season } },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  }) as unknown as GameRecord[];
  console.log(`  ${priorGames.length} prior season games for H2H`);

  // Load PIT ratings
  const pitPath = path.resolve(__dirname, "../data/pit-kenpom-ratings.json");
  let getRatings: (gameDate: Date) => Map<string, KenpomRating> | null;

  if (fs.existsSync(pitPath)) {
    console.log("  Using PIT ratings (no look-ahead bias)");
    getRatings = loadPITRatings(pitPath);
  } else {
    console.log("  PIT ratings not found, using static end-of-season ratings");
    console.log("  WARNING: Static ratings have look-ahead bias");
    const staticRatings = await getKenpomRatings();
    getRatings = () => staticRatings;
  }

  // Run v5 vs v6 comparison
  console.log("\nRunning v5 backtest...");
  const v5 = await runSingle(V5_CONFIG, allGames, priorGames, getRatings);
  console.log(`  v5: ${v5.results.length} picks generated`);

  console.log("Running v6 backtest...");
  const v6 = await runSingle(V6_CONFIG, allGames, priorGames, getRatings);
  console.log(`  v6: ${v6.results.length} picks generated`);

  // Print comparison
  printComparison(v5.summary, v6.summary);

  // Summary
  const v5SpreadDecided = v5.summary.spreadWins + v5.summary.spreadLosses;
  const v6SpreadDecided = v6.summary.spreadWins + v6.summary.spreadLosses;
  const v5SpreadPct = v5SpreadDecided > 0 ? (v5.summary.spreadWins / v5SpreadDecided * 100) : 0;
  const v6SpreadPct = v6SpreadDecided > 0 ? (v6.summary.spreadWins / v6SpreadDecided * 100) : 0;
  const spreadDelta = v6SpreadPct - v5SpreadPct;

  const v5OUDecided = v5.summary.ouWins + v5.summary.ouLosses;
  const v6OUDecided = v6.summary.ouWins + v6.summary.ouLosses;
  const v5OUPct = v5OUDecided > 0 ? (v5.summary.ouWins / v5OUDecided * 100) : 0;
  const v6OUPct = v6OUDecided > 0 ? (v6.summary.ouWins / v6OUDecided * 100) : 0;
  const ouDelta = v6OUPct - v5OUPct;

  console.log("\n=== VERDICT ===");
  console.log(`Spread: v6 is ${spreadDelta >= 0 ? "+" : ""}${spreadDelta.toFixed(1)}% vs v5`);
  console.log(`O/U:    v6 is ${ouDelta >= 0 ? "+" : ""}${ouDelta.toFixed(1)}% vs v5`);

  if (spreadDelta > 0 && ouDelta > 0) {
    console.log("\nv6 improvements are ADDITIVE — both HCA and AdjOE help.");
  } else if (spreadDelta < -1 || ouDelta < -1) {
    console.log("\nWARNING: v6 regresses. Consider reverting affected signals.");
  } else {
    console.log("\nv6 changes are roughly neutral. Consider keeping for theoretical correctness.");
  }

  // Sensitivity analysis
  if (runSensitivity) {
    const sensitivityConfigs = buildSensitivityConfigs();
    const sensitivityResults: { config: BacktestConfig; summary: RunSummary }[] = [];

    console.log(`\nRunning sensitivity analysis (${sensitivityConfigs.length} configs)...`);
    for (const config of sensitivityConfigs) {
      const result = await runSingle(config, allGames, priorGames, getRatings);
      sensitivityResults.push({ config, summary: result.summary });
      process.stdout.write(".");
    }
    console.log(" done");

    printSensitivityTable(sensitivityResults);
  }

  console.log("\nNOTES:");
  console.log("• v6 tested: context-aware HCA (conf=2.5/non-conf=1.5/Nov=1.0/Mar=0.5)");
  console.log("• v6 tested: AdjOE modifier (sumAdjOE >220 boost OVER, <195 boost UNDER)");
  console.log("• v6 tested: moneyline market edge (KenPom WP vs market implied probability)");
  console.log("• Games without moneyline data: market edge signal returns neutral (no impact)");
  console.log("• Break-even at -110 = 52.4%");
  if (runSensitivity) {
    console.log("• Use sensitivity results to identify optimal thresholds per signal");
    console.log("• Apply winning thresholds to src/lib/pick-engine.ts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Fatal:", err); process.exit(1); });
