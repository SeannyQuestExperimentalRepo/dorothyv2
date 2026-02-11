/**
 * Daily Pick Engine v3
 *
 * Signal Convergence Scoring Model — generates daily betting picks by
 * evaluating 6 independent signal categories and measuring convergence:
 *
 *   1. Model Edge — KenPom predictions (NCAAMB) or power ratings (NFL/NCAAF)
 *   2. Season ATS — Wilson-adjusted ATS performance
 *   3. Trend Angles — auto-discovered via reverse lookup (50+ templates)
 *   4. Recent Form — last 5 game ATS momentum
 *   5. Head-to-Head — historical H2H ATS with Wilson intervals
 *   6. Situational — weather, rest advantages
 *
 * Key innovation: convergence bonus when signals agree, contradiction
 * penalty when strong signals disagree. Produces real variance:
 *   - 3★ (55-69): mixed signals, modest edges
 *   - 4★ (70-84): clear model edge + confirming angles
 *   - 5★ (85+): rare full convergence across 4+ categories
 *
 * Also grades past picks after games complete.
 */

import { prisma } from "./db";
import { loadGamesBySportCached, type TrendGame } from "./trend-engine";
import { wilsonInterval } from "./trend-stats";
import { executeTeamReverseLookup } from "./reverse-lookup-engine";
import { executePlayerPropQueryFromDB } from "./prop-trend-engine";
import { getKenpomRatings, lookupRating, type KenpomRating } from "./kenpom";
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
    recentForm: 0.15,
    h2h: 0.10,
    situational: 0.05,
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
    modelEdge: 0.20,
    seasonATS: 0.15,
    trendAngles: 0.25,
    recentForm: 0.20,
    h2h: 0.10,
    situational: 0.10,
  },
};

const OU_WEIGHTS: Record<string, Record<string, number>> = {
  NCAAMB: {
    modelEdge: 0.40, // sum_AdjDE is strongest O/U predictor (r=0.345, LOSO 65.1%)
    seasonOU: 0.15,
    trendAngles: 0.20,
    recentForm: 0.10,
    h2hWeather: 0.15,
  },
  NFL: {
    modelEdge: 0.20,
    seasonOU: 0.20,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2hWeather: 0.25,
  },
  NCAAF: {
    modelEdge: 0.20,
    seasonOU: 0.20,
    trendAngles: 0.20,
    recentForm: 0.15,
    h2hWeather: 0.25,
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
// O/U: sum_AdjDE = home_AdjDE + away_AdjDE (r=0.345, LOSO 65.1%)
//   - Higher AdjDE = worse defense = more points = OVER.
//   - Thresholds: >210 → 67% OVER, >205 → 63%, <190 → 81% UNDER, <185 → 86%.
//   - Both top-50: 22% OVER (78% UNDER) — overrides DE signal.
//   - Both power conf (BE/B12/B10/SEC/ACC/P12): 70% UNDER.
//   - Both 200+: 69% OVER.
//   - Amplifiers: tempo×DE interaction, March UNDER, high line >155.

function computeKenPomEdge(
  ratings: Map<string, KenpomRating> | null,
  homeTeam: string,
  awayTeam: string,
  sport: string,
  spread: number | null,
  overUnder: number | null,
  gameDate: Date,
): { spread: SignalResult; ou: SignalResult } {
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

  // ── Spread: kenpom_edge with season-half awareness ──
  let spreadSignal: SignalResult = neutral;
  if (spread !== null) {
    // HCA = 2.0 (optimal from 93k games; 2018-25 era)
    // Context-specific: conf=2.5, non-conf=1.5, Nov=1.0, March=0.5
    const predictedMargin = homeEM - awayEM + 2.0;
    const spreadEdge = predictedMargin + spread; // spread negative when home favored
    let absMag = clamp(Math.abs(spreadEdge) / 0.7, 0, 10);
    let conf = 0.8;

    // Season-half adjustment: home-side kenpom_edge (spreadEdge > 0)
    // only profitable Nov-Dec (60.2%). Jan-Apr drops to 52% (not significant).
    // Away-side (spreadEdge < 0) is stable year-round (57-58%).
    const isEarlySeason = gameMonth >= 11; // Nov, Dec
    if (spreadEdge > 0.5 && !isEarlySeason) {
      absMag *= 0.4;
      conf = 0.45;
    }

    // March top-25 home regression: 43.8% cover (fade home favorites)
    let marchNote = "";
    if (gameMonth === 3 && spreadEdge > 0.5 && homeRating.RankAdjEM <= 25) {
      absMag *= 0.3;
      conf = 0.40;
      marchNote = " [March top-25 home fade: 43.8% hist.]";
    }

    const seasonNote = spreadEdge > 0.5 && !isEarlySeason && !marchNote ? " [home edge weak Jan+]" : "";
    spreadSignal = {
      category: "modelEdge",
      direction: spreadEdge > 0.5 ? "home" : spreadEdge < -0.5 ? "away" : "neutral",
      magnitude: absMag,
      confidence: conf,
      label: `KenPom: #${homeRating.RankAdjEM} (${homeEM > 0 ? "+" : ""}${homeEM.toFixed(1)}) vs #${awayRating.RankAdjEM} (${awayEM > 0 ? "+" : ""}${awayEM.toFixed(1)}), edge ${spreadEdge > 0 ? "+" : ""}${spreadEdge.toFixed(1)}${seasonNote}${marchNote}`,
      strength: absMag >= 7 ? "strong" : absMag >= 4 ? "moderate" : absMag >= 1.5 ? "weak" : "noise",
    };
  }

  // ── O/U: sum_AdjDE efficiency-based model ──
  // sum_AdjDE (r=0.345) replaces predicted-total approach (r=0.003).
  // Higher AdjDE = worse defense = more points expected = OVER.
  // Thresholds validated via LOSO CV across 16 seasons (65.1% accuracy).
  let ouSignal: SignalResult = { ...neutral };
  if (overUnder !== null) {
    const sumAdjDE = homeDE + awayDE;
    const avgTempo = (homeTempo + awayTempo) / 2;
    let ouDir: "over" | "under" | "neutral" = "neutral";
    let ouMag = 0;
    let ouConf = 0;
    const labelParts: string[] = [];

    // Primary signal: sum_AdjDE thresholds
    if (sumAdjDE > 210) {
      ouDir = "over"; ouMag = 8; ouConf = 0.92;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (strong OVER, 67% hist.)`);
    } else if (sumAdjDE > 205) {
      ouDir = "over"; ouMag = 6; ouConf = 0.85;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (OVER zone, 63% hist.)`);
    } else if (sumAdjDE > 200) {
      ouDir = "over"; ouMag = 4; ouConf = 0.75;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (mod. OVER, 59% hist.)`);
    } else if (sumAdjDE < 185) {
      ouDir = "under"; ouMag = 10; ouConf = 0.95;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (elite UNDER, 86% hist.)`);
    } else if (sumAdjDE < 190) {
      ouDir = "under"; ouMag = 8; ouConf = 0.92;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (strong UNDER, 81% hist.)`);
    } else if (sumAdjDE < 195) {
      ouDir = "under"; ouMag = 5; ouConf = 0.80;
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (UNDER zone, ~65% hist.)`);
    } else {
      labelParts.push(`sum_AdjDE=${sumAdjDE.toFixed(1)} (neutral 195-200)`);
    }

    // Tempo x DE interaction amplifier
    if (ouDir === "over" && avgTempo > 70 && sumAdjDE > 205) {
      ouMag = Math.min(ouMag + 2, 10);
      ouConf = Math.min(ouConf + 0.05, 1.0);
      labelParts.push(`fast tempo ${avgTempo.toFixed(1)} amplifies OVER (82% combined)`);
    } else if (ouDir === "over" && avgTempo > 68 && sumAdjDE > 200) {
      ouMag = Math.min(ouMag + 1, 10);
      labelParts.push(`tempo ${avgTempo.toFixed(1)} supports OVER`);
    } else if (ouDir === "under" && avgTempo < 64 && sumAdjDE < 195) {
      ouMag = Math.min(ouMag + 2, 10);
      ouConf = Math.min(ouConf + 0.05, 1.0);
      labelParts.push(`slow tempo ${avgTempo.toFixed(1)} amplifies UNDER`);
    }

    // Both top-50 matchup: 22.2% OVER (77.8% UNDER!) — stable 18-34% every season
    // This is the strongest UNDER signal discovered — overrides even sum_AdjDE
    if (homeRating.RankAdjEM <= 50 && awayRating.RankAdjEM <= 50) {
      ouDir = "under";
      ouMag = 10;
      ouConf = 0.95;
      labelParts.push(`BOTH TOP-50 (#${homeRating.RankAdjEM} vs #${awayRating.RankAdjEM}, 78% UNDER hist.)`);
    }

    // Both power conference: 70.3% UNDER (+0.0066 LOSO improvement)
    const powerConfs = ["BE", "B12", "B10", "SEC", "ACC", "P12"];
    const homeIsPower = powerConfs.includes(homeRating.ConfShort ?? "");
    const awayIsPower = powerConfs.includes(awayRating.ConfShort ?? "");
    if (homeIsPower && awayIsPower &&
        !(homeRating.RankAdjEM <= 50 && awayRating.RankAdjEM <= 50)) {
      // Don't double-count with top-50 modifier
      if (ouDir === "under") {
        ouMag = Math.min(ouMag + 2, 10);
        labelParts.push("both power conf (70% UNDER)");
      } else if (ouDir === "neutral" || ouDir === "over") {
        ouDir = "under";
        ouMag = Math.max(ouMag, 6);
        ouConf = Math.max(ouConf, 0.82);
        labelParts.push("POWER CONF OVERRIDE (70% UNDER hist.)");
      }
    }

    // Both 200+: 69.3% OVER — weak teams produce high-scoring games
    if (homeRating.RankAdjEM > 200 && awayRating.RankAdjEM > 200) {
      if (ouDir === "over") {
        ouMag = Math.min(ouMag + 1, 10);
        labelParts.push("both 200+ (69% OVER)");
      } else if (ouDir === "neutral") {
        ouDir = "over";
        ouMag = Math.max(ouMag, 5);
        ouConf = Math.max(ouConf, 0.78);
        labelParts.push("both 200+ lean OVER (69% hist.)");
      }
    }

    // March UNDER modifier (56.9% UNDER overall, tourney 63%)
    if (gameMonth === 3) {
      if (ouDir === "under") {
        ouMag = Math.min(ouMag + 1, 10);
        labelParts.push("March UNDER bias");
      } else if (ouDir === "neutral") {
        ouDir = "under"; ouMag = 3;
        ouConf = Math.max(ouConf, 0.60);
        labelParts.push("March UNDER lean (57% hist.)");
      }
    }

    // High line bias (overUnder > 155 -> 60.4% UNDER)
    if (overUnder > 155) {
      if (ouDir === "under") {
        ouMag = Math.min(ouMag + 1, 10);
        labelParts.push(`high line ${overUnder}`);
      } else if (ouDir === "neutral") {
        ouDir = "under"; ouMag = 3;
        ouConf = Math.max(ouConf, 0.65);
        labelParts.push(`high line ${overUnder} (60% UNDER hist.)`);
      }
    }

    const finalMag = clamp(ouMag, 0, 10);
    ouSignal = {
      category: "modelEdge",
      direction: ouDir,
      magnitude: finalMag,
      confidence: ouConf,
      label: `KenPom O/U: ${labelParts.join(" | ")}`,
      strength: finalMag >= 6 ? "strong" : finalMag >= 3 ? "moderate" : finalMag >= 1 ? "weak" : "noise",
    };
  }

  return { spread: spreadSignal, ou: ouSignal };
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

function signalSeasonATS(homeStats: TeamStats, awayStats: TeamStats): SignalResult {
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
  const netEdge = homeEdge - awayEdge;
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

  return {
    category: "seasonATS",
    direction: favorsSide,
    magnitude: absMag,
    confidence: conf,
    label: `Season ATS: ${favStats.atsCovered}-${favStats.atsLost} (${favStats.atsPct}%) vs opponent ${oppStats.atsCovered}-${oppStats.atsLost} (${oppStats.atsPct}%)`,
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
): {
  score: number;
  direction: "home" | "away" | "over" | "under";
  reasons: ReasoningEntry[];
} {
  const activeSignals = signals.filter((s) => s.direction !== "neutral" && s.magnitude > 0);

  if (activeSignals.length === 0) {
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
  const nonNeutralCount = activeSignals.length;
  const agreeingCount = activeSignals.filter((s) => s.direction === bestDir).length;
  const agreeRatio = nonNeutralCount > 0 ? agreeingCount / nonNeutralCount : 0;

  if (agreeRatio >= 0.8 && nonNeutralCount >= 3) score += 8;
  else if (agreeRatio >= 0.6 && nonNeutralCount >= 3) score += 4;

  // ── Contradiction penalty: strong opposing signals ──
  const strongDisagreeing = activeSignals.filter(
    (s) => s.direction !== bestDir && (s.strength === "strong" || s.strength === "moderate"),
  ).length;
  if (strongDisagreeing >= 2) score -= 10;
  else if (strongDisagreeing === 1) score -= 5;

  // ── Statistical evidence bonus: multiple strong/moderate signals agreeing ──
  const strongModerateAgreeing = activeSignals.filter(
    (s) => s.direction === bestDir && (s.strength === "strong" || s.strength === "moderate"),
  ).length;
  if (strongModerateAgreeing >= 3) score += 6;
  else if (strongModerateAgreeing >= 2) score += 3;

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
): string {
  const confidence = score >= 85 ? 5 : score >= 70 ? 4 : 3;

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
          });
        } catch {
          // skip individual prop failures
        }
      }
    }
  }

  return picks.sort((a, b) => b.trendScore - a.trendScore).slice(0, 5);
}

// ─── Main: Generate Daily Picks ──────────────────────────────────────────────

export async function generateDailyPicks(
  dateStr: string,
  sport: Sport,
): Promise<GeneratedPick[]> {
  const dateStart = new Date(dateStr + "T00:00:00Z");
  const dateEnd = new Date(dateStr + "T23:59:59Z");

  // For today's picks, only score games that haven't started yet
  const now = new Date();
  const effectiveStart = now > dateStart ? now : dateStart;

  const upcomingGames = await prisma.upcomingGame.findMany({
    where: {
      sport,
      gameDate: { gte: effectiveStart, lte: dateEnd },
    },
    orderBy: { gameDate: "asc" },
  });

  if (upcomingGames.length === 0) return [];

  const allGames = await loadGamesBySportCached(sport);
  const currentSeason = getCurrentSeason(sport, dateStart);
  const sportWeightsSpread = SPREAD_WEIGHTS[sport] || SPREAD_WEIGHTS.NFL;
  const sportWeightsOU = OU_WEIGHTS[sport] || OU_WEIGHTS.NFL;

  // Fetch live KenPom ratings for NCAAMB (cached for 6h)
  let kenpomRatings: Map<string, KenpomRating> | null = null;
  if (sport === "NCAAMB") {
    try {
      kenpomRatings = await getKenpomRatings();
    } catch (err) {
      console.error("[pick-engine] KenPom fetch failed, continuing without:", err);
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

          // Compute model edge (KenPom for NCAAMB, power rating for NFL/NCAAF)
          // KenPom lookup uses UpcomingGame names (which match KenPom naming)
          const modelPrediction = sport === "NCAAMB"
            ? computeKenPomEdge(kenpomRatings, game.homeTeam, game.awayTeam, sport, game.spread, game.overUnder, game.gameDate)
            : computePowerRatingEdge(allGames, canonHome, canonAway, sport, currentSeason, game.spread, game.overUnder);

          // ── Score Spread ──
          if (game.spread !== null) {
            const spreadSignals: SignalResult[] = [
              modelPrediction.spread,
              signalSeasonATS(homeStats, awayStats),
              signalTrendAnglesSpread(homeDiscovery.ats, awayDiscovery.ats),
              signalRecentForm(homeStats, awayStats),
              signalH2HSpread(h2h),
              signalSituational(
                game.forecastWindMph, game.forecastTemp,
                game.forecastCategory, sport,
              ),
            ];

            const result = computeConvergenceScore(spreadSignals, sportWeightsSpread);
            const confidence = result.score >= 85 ? 5 : result.score >= 70 ? 4 : result.score >= 55 ? 3 : 0;

            if (confidence > 0) {
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

            const result = computeConvergenceScore(ouSignals, sportWeightsOU);
            const confidence = result.score >= 85 ? 5 : result.score >= 70 ? 4 : result.score >= 55 ? 3 : 0;

            if (confidence > 0) {
              const label = result.direction === "over" ? "Over" : "Under";

              picks.push({
                sport,
                pickType: "OVER_UNDER",
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDate: game.gameDate,
                pickSide: result.direction,
                line: game.overUnder,
                pickLabel: `${label} ${game.overUnder}`,
                playerName: null,
                propStat: null,
                propLine: null,
                trendScore: result.score,
                confidence,
                headline: buildOUHeadlineV3(label, game.overUnder, result.score, ouSignals, result.direction),
                reasoning: result.reasons,
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
