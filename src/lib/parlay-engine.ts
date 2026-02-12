/**
 * Parlay & Teaser Analysis Engine
 *
 * Key findings from KenPom analysis:
 *   - ATS-O/U independence: r = 0.0049 → SGP legs are truly independent
 *   - Teasers: +6 points when |kenpom_edge| > 7 = 79.4% cover, ROI = +45.5%
 *   - Combined spread+O/U plays: avg ROI +32.9% when signals agree
 *
 * This engine calculates:
 *   1. True joint probability for parlay legs (accounting for independence)
 *   2. Expected value and Kelly criterion sizing
 *   3. Teaser point adjustment analysis
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParlayLeg {
  id: string;
  type: "SPREAD" | "OVER_UNDER" | "MONEYLINE";
  homeTeam: string;
  awayTeam: string;
  pickSide: string;
  line: number | null;
  odds: number;          // American odds (e.g., -110)
  impliedProb: number;   // Bookmaker implied probability
  modelProb: number;     // Our estimated true probability
  gameId?: string;       // For SGP detection
}

export interface ParlayAnalysis {
  legs: ParlayLeg[];
  legCount: number;
  isSameGame: boolean;
  trueJointProb: number;
  bookImpliedProb: number;
  parlayOdds: number;     // Combined American odds
  expectedValue: number;  // EV per $1 wagered
  kellyFraction: number;  // Optimal bet fraction
  suggestedStake: number; // Based on $1000 bankroll
  teaserAnalysis: TeaserAnalysis | null;
}

export interface TeaserAnalysis {
  teaserPoints: number;
  adjustedLegs: Array<{
    originalLine: number;
    teasedLine: number;
    originalProb: number;
    teasedProb: number;
  }>;
  teasedJointProb: number;
  teaserOdds: number;     // Standard teaser payout
  teaserEV: number;
  recommendation: "strong" | "moderate" | "avoid";
}

// ─── Odds Conversion ─────────────────────────────────────────────────────

/** American odds to implied probability */
export function oddsToImpliedProb(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  if (odds <= -100) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 0.5;
}

/** American odds to decimal multiplier */
export function oddsToDecimal(odds: number): number {
  if (odds >= 100) return 1 + odds / 100;
  if (odds <= -100) return 1 + 100 / Math.abs(odds);
  return 2;
}

/** Decimal odds to American */
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  if (decimal <= 1) return 0; // Guard: decimal=1 → division by zero, ≤1 is invalid
  return Math.round(-100 / (decimal - 1));
}

/** Calculate parlay decimal odds from individual leg decimals */
export function parlayDecimalOdds(legs: number[]): number {
  return legs.reduce((acc, d) => acc * d, 1);
}

// ─── Analysis Functions ──────────────────────────────────────────────────

/**
 * Analyze a parlay. Joint probability accounts for SGP independence (r=0.0049).
 */
export function analyzeParlay(legs: ParlayLeg[], bankroll = 1000): ParlayAnalysis {
  if (legs.length < 2) {
    throw new Error("Parlay requires at least 2 legs");
  }

  // Detect same-game parlay
  const gameIds = legs.map((l) => l.gameId).filter(Boolean);
  const uniqueGames = new Set(gameIds);
  const isSameGame = gameIds.length >= 2 && uniqueGames.size === 1;

  // Calculate joint probability
  // For SGP legs (same game, ATS + O/U): legs are independent (r=0.0049)
  // For cross-game legs: always independent
  // Either way, joint prob = product of individual probs
  const trueJointProb = legs.reduce((acc, l) => acc * l.modelProb, 1);
  const bookImpliedProb = legs.reduce((acc, l) => acc * l.impliedProb, 1);

  // Combined parlay odds
  const decimalOdds = parlayDecimalOdds(legs.map((l) => oddsToDecimal(l.odds)));
  const parlayOdds = decimalToAmerican(decimalOdds);

  // Expected value: (prob * payout) - (1 - prob) * 1
  const expectedValue = trueJointProb * (decimalOdds - 1) - (1 - trueJointProb);

  // Kelly criterion: f* = (bp - q) / b where b = decimal-1, p = prob, q = 1-p
  const b = decimalOdds - 1;
  const kellyFraction = Math.max(0, (b * trueJointProb - (1 - trueJointProb)) / b);

  // Quarter-Kelly for safer sizing
  const suggestedStake = Math.round(bankroll * kellyFraction * 0.25 * 100) / 100;

  // Teaser analysis (only for 2-leg spread parlays)
  let teaserAnalysis: TeaserAnalysis | null = null;
  const spreadLegs = legs.filter((l) => l.type === "SPREAD");
  if (spreadLegs.length === 2) {
    teaserAnalysis = analyzeTeaser(spreadLegs);
  }

  return {
    legs,
    legCount: legs.length,
    isSameGame,
    trueJointProb,
    bookImpliedProb,
    parlayOdds,
    expectedValue,
    kellyFraction,
    suggestedStake,
    teaserAnalysis,
  };
}

/**
 * Analyze a 2-leg teaser. Based on KenPom finding:
 * +6 points when |edge| > 7 → 79.4% cover rate
 */
function analyzeTeaser(spreadLegs: ParlayLeg[]): TeaserAnalysis {
  const teaserPoints = 6; // Standard college teaser
  const TEASER_BOOST = 0.15; // ~15% probability boost per leg for 6 points

  const adjustedLegs = spreadLegs.map((leg) => {
    const originalLine = leg.line ?? 0;
    // For favorites (negative line): teaser makes line less negative (easier)
    // For dogs (positive line): teaser makes line more positive (easier)
    const teasedLine = originalLine + teaserPoints;
    const teasedProb = Math.min(0.95, leg.modelProb + TEASER_BOOST);

    return {
      originalLine,
      teasedLine,
      originalProb: leg.modelProb,
      teasedProb,
    };
  });

  const teasedJointProb = adjustedLegs.reduce(
    (acc, l) => acc * l.teasedProb,
    1,
  );

  // Standard 2-team 6-point teaser pays -110
  const teaserOdds = -110;
  const teaserDecimal = oddsToDecimal(teaserOdds);
  const teaserEV = teasedJointProb * (teaserDecimal - 1) - (1 - teasedJointProb);

  const recommendation: TeaserAnalysis["recommendation"] =
    teaserEV > 0.1
      ? "strong"
      : teaserEV > 0
        ? "moderate"
        : "avoid";

  return {
    teaserPoints,
    adjustedLegs,
    teasedJointProb,
    teaserOdds,
    teaserEV,
    recommendation,
  };
}

/**
 * Quick check: should we suggest an SGP for this game?
 * Returns true when both ATS and O/U signals are strong.
 */
export function shouldSuggestSGP(
  spreadModelProb: number,
  ouModelProb: number,
): boolean {
  // Both legs need >55% model probability for a viable SGP
  return spreadModelProb > 0.55 && ouModelProb > 0.55;
}

/**
 * Quick check: should we suggest a teaser for this game?
 * Returns true when kenpom_edge is large (|edge| > 7).
 */
export function shouldSuggestTeaser(kenpomEdge: number): boolean {
  return Math.abs(kenpomEdge) > 7;
}
