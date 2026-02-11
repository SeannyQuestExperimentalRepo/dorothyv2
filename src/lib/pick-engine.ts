/**
 * Daily Pick Engine v2
 *
 * Generates explicit betting picks by scoring games against historical
 * trend data using:
 *   - Auto-discovery via executeTeamReverseLookup (50+ angle templates)
 *   - KenPom efficiency/tempo for NCAAMB
 *   - Wilson confidence intervals for conservative estimates
 *   - Effect-size–weighted scoring instead of flat weights
 *   - Prop splits (home/away, fav/dog) and opponent-specific analysis
 *
 * Also grades past picks after games complete.
 */

import { prisma } from "./db";
import { loadGamesBySportCached, type TrendGame } from "./trend-engine";
import { wilsonInterval } from "./trend-stats";
import { executeTeamReverseLookup } from "./reverse-lookup-engine";
import { executePlayerPropQueryFromDB } from "./prop-trend-engine";
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
}

interface SideScore {
  home: number;
  away: number;
  homeReasons: ReasoningEntry[];
  awayReasons: ReasoningEntry[];
}

interface OUSideScore {
  over: number;
  under: number;
  overReasons: ReasoningEntry[];
  underReasons: ReasoningEntry[];
}

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
 * Weight based on Wilson lower bound instead of raw percentage.
 * This is more conservative for small samples — a 70% rate in 10 games
 * gets less credit than 70% in 50 games.
 */
function wilsonWeight(successes: number, trials: number, baseline: number = 0.5): number {
  if (trials < 5) return 0;
  const [lower] = wilsonInterval(successes, trials);
  const edge = lower - baseline;
  if (edge <= 0) return 0;
  // Scale: 0.05 edge → ~3, 0.10 edge → ~6, 0.15+ edge → ~9+
  return Math.round(edge * 60);
}

/**
 * Convert a DiscoveredAngle's interestScore to a pick weight.
 * interestScore typically ranges 20-90 for significant angles.
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

// ─── KenPom Analysis (NCAAMB) ───────────────────────────────────────────────

interface KenPomSignal {
  label: string;
  weight: number;
  strength: ReasoningEntry["strength"];
  favorsSpread?: "home" | "away";
  favorsOU?: "over" | "under";
}

function analyzeKenPom(
  allGames: TrendGame[],
  homeTeam: string,
  awayTeam: string,
  sport: string,
  currentSeason: number,
): KenPomSignal[] {
  if (sport !== "NCAAMB") return [];

  const signals: KenPomSignal[] = [];

  // Find most recent game for each team to get their latest KenPom ratings
  const homeRecent = allGames
    .filter((g) => g.sport === sport && g.season === currentSeason &&
      (g.homeTeam === homeTeam || g.awayTeam === homeTeam) &&
      ((g.homeTeam === homeTeam && g.homeAdjEM !== null) ||
        (g.awayTeam === homeTeam && g.awayAdjEM !== null)))
    .sort((a, b) => (b.gameDate || "").localeCompare(a.gameDate || ""));

  const awayRecent = allGames
    .filter((g) => g.sport === sport && g.season === currentSeason &&
      (g.homeTeam === awayTeam || g.awayTeam === awayTeam) &&
      ((g.homeTeam === awayTeam && g.homeAdjEM !== null) ||
        (g.awayTeam === awayTeam && g.awayAdjEM !== null)))
    .sort((a, b) => (b.gameDate || "").localeCompare(a.gameDate || ""));

  if (homeRecent.length === 0 || awayRecent.length === 0) return signals;

  const hGame = homeRecent[0];
  const aGame = awayRecent[0];

  const homeEM = hGame.homeTeam === homeTeam ? hGame.homeAdjEM : hGame.awayAdjEM;
  const awayEM = aGame.homeTeam === awayTeam ? aGame.homeAdjEM : aGame.awayAdjEM;
  const homeTempo = hGame.homeTeam === homeTeam ? hGame.homeAdjTempo : hGame.awayAdjTempo;
  const awayTempo = aGame.homeTeam === awayTeam ? aGame.homeAdjTempo : aGame.awayAdjTempo;
  const homeOE = hGame.homeTeam === homeTeam ? hGame.homeAdjOE : hGame.awayAdjOE;
  const awayOE = aGame.homeTeam === awayTeam ? aGame.homeAdjOE : aGame.awayAdjOE;
  const homeDE = hGame.homeTeam === homeTeam ? hGame.homeAdjDE : hGame.awayAdjDE;
  const awayDE = aGame.homeTeam === awayTeam ? aGame.homeAdjDE : aGame.awayAdjDE;

  // 1. Efficiency margin gap
  if (homeEM !== null && awayEM !== null) {
    const emGap = homeEM - awayEM;
    const absGap = Math.abs(emGap);

    if (absGap >= 5) {
      const favors = emGap > 0 ? "home" : "away";
      const strength: ReasoningEntry["strength"] = absGap >= 15 ? "strong" : absGap >= 10 ? "moderate" : "weak";
      const weight = absGap >= 15 ? 10 : absGap >= 10 ? 7 : 4;

      signals.push({
        label: `KenPom efficiency: ${homeTeam} ${homeEM > 0 ? "+" : ""}${homeEM.toFixed(1)} vs ${awayTeam} ${awayEM > 0 ? "+" : ""}${awayEM.toFixed(1)} (gap: ${emGap > 0 ? "+" : ""}${emGap.toFixed(1)})`,
        weight,
        strength,
        favorsSpread: favors,
      });
    }
  }

  // 2. Tempo mismatch → affects O/U
  if (homeTempo !== null && awayTempo !== null) {
    const avgTempo = (homeTempo + awayTempo) / 2;
    // High combined tempo → higher-scoring game
    if (avgTempo >= 72) {
      signals.push({
        label: `Fast-paced matchup: ${homeTeam} ${homeTempo.toFixed(1)} + ${awayTeam} ${awayTempo.toFixed(1)} tempo`,
        weight: avgTempo >= 76 ? 6 : 4,
        strength: avgTempo >= 76 ? "moderate" : "weak",
        favorsOU: "over",
      });
    } else if (avgTempo <= 64) {
      signals.push({
        label: `Slow-paced matchup: ${homeTeam} ${homeTempo.toFixed(1)} + ${awayTeam} ${awayTempo.toFixed(1)} tempo`,
        weight: avgTempo <= 62 ? 6 : 4,
        strength: avgTempo <= 62 ? "moderate" : "weak",
        favorsOU: "under",
      });
    }
  }

  // 3. Offensive vs Defensive matchup
  if (homeOE !== null && awayDE !== null && awayOE !== null && homeDE !== null) {
    // Home offense vs away defense
    const homeOffEdge = homeOE - awayDE; // positive = home offense dominates
    const awayOffEdge = awayOE - homeDE;

    if (homeOffEdge > 8 && awayOffEdge < -3) {
      signals.push({
        label: `${homeTeam} offense (${homeOE.toFixed(1)}) vs ${awayTeam} defense (${awayDE.toFixed(1)}): +${homeOffEdge.toFixed(1)} edge`,
        weight: 5,
        strength: "moderate",
        favorsSpread: "home",
      });
    } else if (awayOffEdge > 8 && homeOffEdge < -3) {
      signals.push({
        label: `${awayTeam} offense (${awayOE.toFixed(1)}) vs ${homeTeam} defense (${homeDE.toFixed(1)}): +${awayOffEdge.toFixed(1)} edge`,
        weight: 5,
        strength: "moderate",
        favorsSpread: "away",
      });
    }
  }

  // 4. KenPom model predictions (check historical accuracy for these teams)
  const kenpomGames = allGames.filter(
    (g) =>
      g.sport === sport &&
      g.season === currentSeason &&
      g.fmHomeWinProb !== null &&
      ((g.homeTeam === homeTeam || g.awayTeam === homeTeam) ||
        (g.homeTeam === awayTeam || g.awayTeam === awayTeam)),
  );

  if (kenpomGames.length >= 10) {
    let modelCorrect = 0;
    for (const g of kenpomGames) {
      const predicted = (g.fmHomeWinProb || 0) >= 0.5 ? "home" : "away";
      const actual = g.scoreDifference > 0 ? "home" : g.scoreDifference < 0 ? "away" : null;
      if (actual && predicted === actual) modelCorrect++;
    }
    const accuracy = Math.round((modelCorrect / kenpomGames.length) * 100);
    if (accuracy >= 65) {
      signals.push({
        label: `KenPom model ${accuracy}% accurate for these teams this season (${modelCorrect}/${kenpomGames.length})`,
        weight: accuracy >= 75 ? 4 : 2,
        strength: accuracy >= 75 ? "moderate" : "weak",
      });
    }
  }

  return signals;
}

// ─── Auto-Discovered Angle Signals ──────────────────────────────────────────

interface AngleSignal {
  label: string;
  record: string;
  rate: number;
  weight: number;
  favors: "home" | "away";
  strength: ReasoningEntry["strength"];
  isATS: boolean; // true = ATS angle, false = SU angle
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
          weight: Math.round(weight * 0.7), // O/U angles slightly less weight
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

// ─── Spread Scoring (v2) ────────────────────────────────────────────────────

function scoreSpread(
  homeStats: TeamStats,
  awayStats: TeamStats,
  h2h: H2HStats,
  homeAngles: AngleSignal[],
  awayAngles: AngleSignal[],
  kenpomSignals: KenPomSignal[],
): SideScore {
  let home = 50, away = 50;
  const homeReasons: ReasoningEntry[] = [];
  const awayReasons: ReasoningEntry[] = [];

  // Source 1: Season ATS (Wilson-weighted)
  const homeW = wilsonWeight(homeStats.atsCovered, homeStats.atsCovered + homeStats.atsLost);
  if (homeW > 0) {
    home += homeW;
    const [lower] = wilsonInterval(homeStats.atsCovered, homeStats.atsCovered + homeStats.atsLost);
    homeReasons.push({
      angle: `${homeStats.atsCovered}-${homeStats.atsLost} ATS (${homeStats.atsPct}%, floor ${(lower * 100).toFixed(0)}%)`,
      weight: homeW,
      strength: homeW >= 7 ? "strong" : homeW >= 4 ? "moderate" : "weak",
      record: `${homeStats.atsCovered}-${homeStats.atsLost}`,
    });
  } else if (homeStats.atsCovered + homeStats.atsLost >= 10 && homeStats.atsPct < 45) {
    const penalty = wilsonWeight(homeStats.atsLost, homeStats.atsCovered + homeStats.atsLost);
    if (penalty > 0) {
      away += penalty;
      awayReasons.push({
        angle: `Opponent ${homeStats.atsCovered}-${homeStats.atsLost} ATS (${homeStats.atsPct}%)`,
        weight: penalty,
        strength: penalty >= 7 ? "strong" : penalty >= 4 ? "moderate" : "weak",
      });
    }
  }

  const awayW = wilsonWeight(awayStats.atsCovered, awayStats.atsCovered + awayStats.atsLost);
  if (awayW > 0) {
    away += awayW;
    const [lower] = wilsonInterval(awayStats.atsCovered, awayStats.atsCovered + awayStats.atsLost);
    awayReasons.push({
      angle: `${awayStats.atsCovered}-${awayStats.atsLost} ATS (${awayStats.atsPct}%, floor ${(lower * 100).toFixed(0)}%)`,
      weight: awayW,
      strength: awayW >= 7 ? "strong" : awayW >= 4 ? "moderate" : "weak",
      record: `${awayStats.atsCovered}-${awayStats.atsLost}`,
    });
  } else if (awayStats.atsCovered + awayStats.atsLost >= 10 && awayStats.atsPct < 45) {
    const penalty = wilsonWeight(awayStats.atsLost, awayStats.atsCovered + awayStats.atsLost);
    if (penalty > 0) {
      home += penalty;
      homeReasons.push({
        angle: `Opponent ${awayStats.atsCovered}-${awayStats.atsLost} ATS (${awayStats.atsPct}%)`,
        weight: penalty,
        strength: penalty >= 7 ? "strong" : penalty >= 4 ? "moderate" : "weak",
      });
    }
  }

  // Source 2: H2H ATS (Wilson-weighted)
  if (h2h.totalGames >= 3) {
    const h2hTotal = h2h.homeAtsCov + h2h.homeAtsLost;
    if (h2hTotal >= 3) {
      const homeH2HW = wilsonWeight(h2h.homeAtsCov, h2hTotal);
      const awayH2HW = wilsonWeight(h2h.homeAtsLost, h2hTotal);
      const h2hPct = Math.round((h2h.homeAtsCov / h2hTotal) * 1000) / 10;

      if (homeH2HW > 0) {
        home += homeH2HW;
        homeReasons.push({
          angle: `H2H ATS: ${h2h.homeAtsCov}-${h2h.homeAtsLost} (${h2hPct}%)`,
          weight: homeH2HW,
          strength: homeH2HW >= 7 ? "strong" : homeH2HW >= 4 ? "moderate" : "weak",
          record: `${h2h.homeAtsCov}-${h2h.homeAtsLost}`,
        });
      } else if (awayH2HW > 0) {
        away += awayH2HW;
        awayReasons.push({
          angle: `H2H ATS: ${h2h.homeAtsLost}-${h2h.homeAtsCov} (${(100 - h2hPct).toFixed(1)}%)`,
          weight: awayH2HW,
          strength: awayH2HW >= 7 ? "strong" : awayH2HW >= 4 ? "moderate" : "weak",
          record: `${h2h.homeAtsLost}-${h2h.homeAtsCov}`,
        });
      }
    }
  }

  // Source 3: Auto-discovered angles (from reverse lookup)
  const allAngles = [...homeAngles, ...awayAngles]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8); // Cap at best 8 angles to avoid over-weighting

  for (const signal of allAngles) {
    const reason: ReasoningEntry = {
      angle: `${signal.label}: ${signal.record} (${signal.rate}%)`,
      weight: signal.weight,
      strength: signal.strength,
      record: signal.record,
    };
    if (signal.favors === "home") {
      home += signal.weight;
      homeReasons.push(reason);
    } else {
      away += signal.weight;
      awayReasons.push(reason);
    }
  }

  // Source 4: KenPom (NCAAMB)
  for (const kp of kenpomSignals) {
    if (!kp.favorsSpread) continue;
    const reason: ReasoningEntry = {
      angle: kp.label,
      weight: kp.weight,
      strength: kp.strength,
    };
    if (kp.favorsSpread === "home") {
      home += kp.weight;
      homeReasons.push(reason);
    } else {
      away += kp.weight;
      awayReasons.push(reason);
    }
  }

  // Source 5: Recent form (last 5 ATS)
  const homeLast5Total = homeStats.last5AtsCov + homeStats.last5AtsLost;
  if (homeLast5Total >= 4) {
    if (homeStats.last5AtsCov >= 4) {
      home += 4;
      homeReasons.push({ angle: `Hot streak: ${homeStats.last5AtsCov}-${homeStats.last5AtsLost} ATS last 5`, weight: 4, strength: "weak" });
    } else if (homeStats.last5AtsLost >= 4) {
      away += 4;
      awayReasons.push({ angle: `Opponent cold: ${homeStats.last5AtsCov}-${homeStats.last5AtsLost} ATS last 5`, weight: 4, strength: "weak" });
    }
  }

  const awayLast5Total = awayStats.last5AtsCov + awayStats.last5AtsLost;
  if (awayLast5Total >= 4) {
    if (awayStats.last5AtsCov >= 4) {
      away += 4;
      awayReasons.push({ angle: `Hot streak: ${awayStats.last5AtsCov}-${awayStats.last5AtsLost} ATS last 5`, weight: 4, strength: "weak" });
    } else if (awayStats.last5AtsLost >= 4) {
      home += 4;
      homeReasons.push({ angle: `Opponent cold: ${awayStats.last5AtsCov}-${awayStats.last5AtsLost} ATS last 5`, weight: 4, strength: "weak" });
    }
  }

  return {
    home: clamp(home, 0, 100),
    away: clamp(away, 0, 100),
    homeReasons: homeReasons.sort((a, b) => b.weight - a.weight),
    awayReasons: awayReasons.sort((a, b) => b.weight - a.weight),
  };
}

// ─── O/U Scoring (v2) ───────────────────────────────────────────────────────

function scoreOverUnder(
  homeStats: TeamStats,
  awayStats: TeamStats,
  h2h: H2HStats,
  currentOU: number | null,
  homeOUAngles: OUAngleSignal[],
  awayOUAngles: OUAngleSignal[],
  kenpomSignals: KenPomSignal[],
): OUSideScore {
  let over = 50, under = 50;
  const overReasons: ReasoningEntry[] = [];
  const underReasons: ReasoningEntry[] = [];

  // Source 1: Season O/U (Wilson-weighted)
  const homeOUTotal = homeStats.overs + homeStats.unders;
  if (homeOUTotal >= 8) {
    const overW = wilsonWeight(homeStats.overs, homeOUTotal);
    const underW = wilsonWeight(homeStats.unders, homeOUTotal);
    if (overW > 0) {
      over += overW;
      overReasons.push({
        angle: `Home team O/U: ${homeStats.overs}-${homeStats.unders} (${homeStats.overPct}% over)`,
        weight: overW,
        strength: overW >= 7 ? "strong" : overW >= 4 ? "moderate" : "weak",
      });
    } else if (underW > 0) {
      under += underW;
      underReasons.push({
        angle: `Home team O/U: ${homeStats.unders}-${homeStats.overs} (${(100 - homeStats.overPct).toFixed(1)}% under)`,
        weight: underW,
        strength: underW >= 7 ? "strong" : underW >= 4 ? "moderate" : "weak",
      });
    }
  }

  const awayOUTotal = awayStats.overs + awayStats.unders;
  if (awayOUTotal >= 8) {
    const overW = wilsonWeight(awayStats.overs, awayOUTotal);
    const underW = wilsonWeight(awayStats.unders, awayOUTotal);
    if (overW > 0) {
      over += overW;
      overReasons.push({
        angle: `Away team O/U: ${awayStats.overs}-${awayStats.unders} (${awayStats.overPct}% over)`,
        weight: overW,
        strength: overW >= 7 ? "strong" : overW >= 4 ? "moderate" : "weak",
      });
    } else if (underW > 0) {
      under += underW;
      underReasons.push({
        angle: `Away team O/U: ${awayStats.unders}-${awayStats.overs} (${(100 - awayStats.overPct).toFixed(1)}% under)`,
        weight: underW,
        strength: underW >= 7 ? "strong" : underW >= 4 ? "moderate" : "weak",
      });
    }
  }

  // Source 2: H2H totals vs current line
  if (h2h.totalGames >= 3 && currentOU !== null && h2h.avgTotalPoints > 0) {
    const diff = h2h.avgTotalPoints - currentOU;
    if (Math.abs(diff) >= 3) {
      const w = Math.abs(diff) >= 7 ? 6 : 4;
      if (diff > 0) {
        over += w;
        overReasons.push({
          angle: `H2H avg total ${h2h.avgTotalPoints} vs line ${currentOU} (+${diff.toFixed(1)})`,
          weight: w,
          strength: Math.abs(diff) >= 7 ? "moderate" : "weak",
        });
      } else {
        under += w;
        underReasons.push({
          angle: `H2H avg total ${h2h.avgTotalPoints} vs line ${currentOU} (${diff.toFixed(1)})`,
          weight: w,
          strength: Math.abs(diff) >= 7 ? "moderate" : "weak",
        });
      }
    }

    // H2H O/U trend (Wilson-weighted)
    const h2hOUTotal = h2h.overs + h2h.unders;
    if (h2hOUTotal >= 5) {
      const h2hOverW = wilsonWeight(h2h.overs, h2hOUTotal);
      const h2hUnderW = wilsonWeight(h2h.unders, h2hOUTotal);
      const overPct = Math.round((h2h.overs / h2hOUTotal) * 1000) / 10;
      if (h2hOverW > 0) {
        over += h2hOverW;
        overReasons.push({ angle: `H2H O/U: ${h2h.overs}-${h2h.unders} (${overPct}% over)`, weight: h2hOverW, strength: h2hOverW >= 5 ? "moderate" : "weak" });
      } else if (h2hUnderW > 0) {
        under += h2hUnderW;
        underReasons.push({ angle: `H2H O/U: ${h2h.unders}-${h2h.overs} (${(100 - overPct).toFixed(1)}% under)`, weight: h2hUnderW, strength: h2hUnderW >= 5 ? "moderate" : "weak" });
      }
    }
  }

  // Source 3: Auto-discovered O/U angles
  const allOUAngles = [...homeOUAngles, ...awayOUAngles]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  for (const signal of allOUAngles) {
    const reason: ReasoningEntry = {
      angle: `${signal.label} (${signal.rate}%)`,
      weight: signal.weight,
      strength: signal.strength,
      record: signal.record,
    };
    if (signal.favors === "over") {
      over += signal.weight;
      overReasons.push(reason);
    } else {
      under += signal.weight;
      underReasons.push(reason);
    }
  }

  // Source 4: KenPom tempo signals
  for (const kp of kenpomSignals) {
    if (!kp.favorsOU) continue;
    const reason: ReasoningEntry = {
      angle: kp.label,
      weight: kp.weight,
      strength: kp.strength,
    };
    if (kp.favorsOU === "over") {
      over += kp.weight;
      overReasons.push(reason);
    } else {
      under += kp.weight;
      underReasons.push(reason);
    }
  }

  // Source 5: Recent form
  if (homeStats.last5OUOvers + homeStats.last5OUUnders >= 4) {
    if (homeStats.last5OUOvers >= 4) {
      over += 3;
      overReasons.push({ angle: `Home team: ${homeStats.last5OUOvers} overs in last 5`, weight: 3, strength: "weak" });
    } else if (homeStats.last5OUUnders >= 4) {
      under += 3;
      underReasons.push({ angle: `Home team: ${homeStats.last5OUUnders} unders in last 5`, weight: 3, strength: "weak" });
    }
  }
  if (awayStats.last5OUOvers + awayStats.last5OUUnders >= 4) {
    if (awayStats.last5OUOvers >= 4) {
      over += 3;
      overReasons.push({ angle: `Away team: ${awayStats.last5OUOvers} overs in last 5`, weight: 3, strength: "weak" });
    } else if (awayStats.last5OUUnders >= 4) {
      under += 3;
      underReasons.push({ angle: `Away team: ${awayStats.last5OUUnders} unders in last 5`, weight: 3, strength: "weak" });
    }
  }

  return {
    over: clamp(over, 0, 100),
    under: clamp(under, 0, 100),
    overReasons: overReasons.sort((a, b) => b.weight - a.weight),
    underReasons: underReasons.sort((a, b) => b.weight - a.weight),
  };
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
          // Get season average + median for prop line
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
          // Use median for line (more robust to outliers), rounded to 0.5
          const propLine = Math.round(median * 2) / 2;
          if (propLine <= 0) continue;

          const opponent = isHome ? awayTeam : homeTeam;

          // Run full prop analysis with home/away context
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

          // Score using Wilson lower bound as the base
          const [wilsonLower] = wilsonInterval(result.overall.hits, result.overall.total);
          let score = 50;

          // Core: Wilson-adjusted hit rate contribution
          const wilsonEdge = wilsonLower - 0.5;
          if (wilsonEdge > 0) {
            score += Math.round(wilsonEdge * 80); // 0.10 edge → +8
          }

          // Significance bonus
          score += result.overall.significance.strength === "strong" ? 12
            : result.overall.significance.strength === "moderate" ? 8 : 3;

          // Splits bonus: check if the relevant split (home/away) is strong
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

          // Median vs line: if median well above line, stronger signal
          if (median > propLine * 1.10) score += 5;
          else if (median > propLine * 1.05) score += 3;

          // Recent bonus
          if (result.recentTrend.last5.total >= 4 && result.recentTrend.last5.hitRate >= 80) score += 8;
          else if (result.recentTrend.last5.total >= 4 && result.recentTrend.last5.hitRate >= 60) score += 4;

          // Streak bonus
          if (result.currentStreak >= 4) score += 5;
          else if (result.currentStreak >= 2) score += 2;

          score = clamp(Math.round(score), 0, 100);
          const confidence = score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : 0;
          if (confidence === 0) continue;

          const label = PROP_LABELS[stat] || stat.replace(/_/g, " ");

          // Build reasoning with splits data
          const reasoning: ReasoningEntry[] = [
            {
              angle: `Overall: ${result.overall.hits}/${result.overall.total} (${result.overall.hitRate}%, floor ${(wilsonLower * 100).toFixed(0)}%)`,
              weight: 10,
              strength: result.overall.significance.strength as ReasoningEntry["strength"],
              record: `${result.overall.hits}-${result.overall.total - result.overall.hits}`,
            },
          ];

          // Add relevant split
          if (relevantSplit && relevantSplit.total >= 3) {
            reasoning.push({
              angle: `${relevantSplit.label}: ${relevantSplit.hits}/${relevantSplit.total} (${relevantSplit.hitRate}%)`,
              weight: 7,
              strength: relevantSplit.significance.strength as ReasoningEntry["strength"],
              record: `${relevantSplit.hits}-${relevantSplit.total - relevantSplit.hits}`,
            });
          }

          // Add fav/dog split if meaningful
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
          });
        } catch {
          // skip individual prop failures
        }
      }
    }
  }

  return picks.sort((a, b) => b.trendScore - a.trendScore).slice(0, 5);
}

// ─── Headline Generation ────────────────────────────────────────────────────

function buildHeadline(
  teamName: string,
  spreadVal: number,
  reasons: ReasoningEntry[],
): string {
  // Lead with strongest angle
  const top = reasons[0];
  if (top && top.strength === "strong" && top.record) {
    return `${top.record} — ${top.angle.split(":")[0]}`;
  }

  const strongCount = reasons.filter((r) => r.strength === "strong").length;
  const modCount = reasons.filter((r) => r.strength === "moderate").length;

  if (strongCount >= 2) {
    return `${strongCount} strong signals favor ${teamName} ${spreadVal > 0 ? "+" : ""}${spreadVal}`;
  }
  if (strongCount >= 1 && modCount >= 1) {
    return `${strongCount + modCount} converging trends on ${teamName} ${spreadVal > 0 ? "+" : ""}${spreadVal}`;
  }
  return `${reasons.length} trend${reasons.length !== 1 ? "s" : ""} favor ${teamName} ${spreadVal > 0 ? "+" : ""}${spreadVal}`;
}

function buildOUHeadline(
  side: string,
  lineVal: number,
  reasons: ReasoningEntry[],
): string {
  const top = reasons[0];
  if (top && top.strength === "strong") {
    const prefix = top.angle.split(":")[0];
    return `${prefix} — ${side} ${lineVal}`;
  }

  const strongCount = reasons.filter((r) => r.strength === "strong" || r.strength === "moderate").length;
  if (strongCount >= 2) {
    return `${strongCount} signals favor the ${side.toLowerCase()} (${lineVal})`;
  }
  return `${reasons.length} trend${reasons.length !== 1 ? "s" : ""} favor the ${side.toLowerCase()}`;
}

// ─── Main: Generate Daily Picks ──────────────────────────────────────────────

export async function generateDailyPicks(
  dateStr: string,
  sport: Sport,
): Promise<GeneratedPick[]> {
  const dateStart = new Date(dateStr + "T00:00:00Z");
  const dateEnd = new Date(dateStr + "T23:59:59Z");

  const upcomingGames = await prisma.upcomingGame.findMany({
    where: {
      sport,
      gameDate: { gte: dateStart, lte: dateEnd },
    },
    orderBy: { gameDate: "asc" },
  });

  if (upcomingGames.length === 0) return [];

  const allGames = await loadGamesBySportCached(sport);
  const currentSeason = getCurrentSeason(sport, dateStart);

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

          // KenPom analysis for NCAAMB
          const kenpomSignals = analyzeKenPom(allGames, canonHome, canonAway, sport, currentSeason);

          // Score spread
          if (game.spread !== null) {
            const spreadScore = scoreSpread(
              homeStats, awayStats, h2h,
              homeDiscovery.ats, awayDiscovery.ats,
              kenpomSignals,
            );
            const bestSide = spreadScore.home >= spreadScore.away ? "home" : "away";
            const bestScore = Math.max(spreadScore.home, spreadScore.away);
            const confidence = bestScore >= 85 ? 5 : bestScore >= 70 ? 4 : bestScore >= 55 ? 3 : 0;

            if (confidence > 0) {
              const reasons = bestSide === "home" ? spreadScore.homeReasons : spreadScore.awayReasons;
              const teamName = bestSide === "home" ? canonHome : canonAway;
              const spreadVal = bestSide === "home" ? game.spread : -(game.spread);

              picks.push({
                sport,
                pickType: "SPREAD",
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDate: game.gameDate,
                pickSide: bestSide,
                line: game.spread,
                pickLabel: `${teamName} ${spreadVal > 0 ? "+" : ""}${spreadVal}`,
                playerName: null,
                propStat: null,
                propLine: null,
                trendScore: bestScore,
                confidence,
                headline: buildHeadline(teamName, spreadVal, reasons),
                reasoning: reasons,
              });
            }
          }

          // Score O/U
          if (game.overUnder !== null) {
            const ouScore = scoreOverUnder(
              homeStats, awayStats, h2h, game.overUnder,
              homeDiscovery.ou, awayDiscovery.ou,
              kenpomSignals,
            );
            const bestSide = ouScore.over >= ouScore.under ? "over" : "under";
            const bestScore = Math.max(ouScore.over, ouScore.under);
            const confidence = bestScore >= 85 ? 5 : bestScore >= 70 ? 4 : bestScore >= 55 ? 3 : 0;

            if (confidence > 0) {
              const reasons = bestSide === "over" ? ouScore.overReasons : ouScore.underReasons;
              const label = bestSide === "over" ? "Over" : "Under";

              picks.push({
                sport,
                pickType: "OVER_UNDER",
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDate: game.gameDate,
                pickSide: bestSide,
                line: game.overUnder,
                pickLabel: `${label} ${game.overUnder}`,
                playerName: null,
                propStat: null,
                propLine: null,
                trendScore: bestScore,
                confidence,
                headline: buildOUHeadline(label, game.overUnder, reasons),
                reasoning: reasons,
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
          picks.push(...propPicks);
        } catch (err) {
          console.error(`[pick-engine] Error processing ${game.homeTeam} vs ${game.awayTeam}:`, err);
        }

        return picks;
      }),
    );

    allPicks.push(...batchResults.flat());
  }

  return allPicks.sort((a, b) => b.trendScore - a.trendScore);
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

  const hit = actual > pick.propLine;

  return {
    result: hit ? "WIN" : "LOSS",
    actualValue: actual,
  };
}
