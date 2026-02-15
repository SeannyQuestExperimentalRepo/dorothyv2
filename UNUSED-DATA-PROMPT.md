# Implementation Prompt: Wire Up All Unused Data Into the Pick Engine

> **Use this prompt with a coding agent pointed at the dorothyv2 repo.**
> **Prerequisite:** Complete TEAM-NAME-FIX-PROMPT.md first (team name resolution must work reliably).

---

## Context

A full audit of dorothyv2 reveals that **massive amounts of data are being fetched, stored, and completely ignored by the pick engine**. This data costs API calls, storage, and processing — but contributes zero value to picks. This prompt wires ALL of it into the scoring system.

### Current Pick Engine Architecture

The pick engine (`src/lib/pick-engine.ts`, 2,450 lines) scores games using weighted signals per sport:

```typescript
// Example: NCAAMB spread weights
NCAAMB: {
  modelEdge: 0.30,     // KenPom AdjEM differential
  seasonATS: 0.15,     // Historical ATS record
  trendAngles: 0.25,   // Reverse lookup trend angles
  recentForm: 0.10,    // Last 5-10 game form
  h2h: 0.05,           // Head-to-head history
  situational: 0.00,   // (unused)
  restDays: 0.05,      // Back-to-back detection
  marketEdge: 0.10,    // KenPom WP vs moneyline implied prob
}
```

Each signal returns a `SignalResult`:
```typescript
interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;    // 0-10
  confidence: number;   // 0-1
  label: string;        // Human-readable explanation
  strength: "strong" | "moderate" | "weak" | "noise";
}
```

---

## What's Being Wasted (The Audit)

### Tier 1: Data in DB, Never Touched by Picks

| Data | Table | Records | Predictive Value |
|---|---|---|---|
| KenPom PointDist (3PT/2PT/FT scoring %) | `KenpomPointDist` | 8,679 | **HIGH** — shooting matchup profiles predict O/U and spread |
| KenPom Height (experience, continuity, bench depth) | `KenpomHeight` | 7,035 | **HIGH** — continuity is a 2-3pt early season predictor |
| ESPN Injuries | Live API | Live | **CRITICAL** — injuries not factored into any pick score |
| Line Movement | `line-movement.ts` computed | Live | **HIGH** — reverse line movement = sharp money signal |
| UpcomingGame weather fields | `UpcomingGame` | 420 games, ALL NULL | **HIGH** for football — fields exist but are never populated |
| TeamNameMapping | `TeamNameMapping` | 22 rows | Built but never queried |
| OddsSnapshot bookmaker array | `OddsSnapshot.bookmakers` JSON | 679 | **MEDIUM** — per-book line comparison detects steam moves |

### Tier 2: Fetched Live, Fields Ignored

| Data | Source | What's Used | What's Wasted |
|---|---|---|---|
| KenPom Ratings | API `/ratings` | AdjEM, AdjOE, AdjDE, AdjTempo, RankAdjEM, ConfShort | **Pythag, Luck, SOS, SOSO, SOSD, NCSOS, raw OE/DE, Tempo, APL (off/def/conf), Seed, all other rankings** |
| KenPom FanMatch | API `/fanmatch` | HomePred, VisitorPred, HomeWP | **ThrillScore, PredTempo** |
| CFBD SP+ | API `/ratings/sp` | rating, offense, defense, ranking | **specialTeams, conference** |

### Tier 3: Zero Data (Schema Exists, Nothing Populated)

| Table | Records | Issue |
|---|---|---|
| `NBAGame` | **0** | NBA picks have zero historical game data |
| `OddsSnapshot` (NFL/NCAAF/NBA) | **0** | Only NCAAMB has odds snapshots |

---

## Implementation Tasks

---

### Task 1: KenPom Shooting Profile Signal (`signalShootingProfile`)

**Data source:** `KenpomPointDist` table (8,679 records, refreshed daily)

**What it contains per team:**
- `offFt` / `offFg2` / `offFg3` — % of offensive points from FT, 2PT, 3PT
- `defFt` / `defFg2` / `defFg3` — % of opponent's points from FT, 2PT, 3PT
- Rankings for all 6 metrics

**Why it matters:** Two teams can both have 110 AdjOE but score completely differently — one lives by the 3, one dominates inside. When a 3PT-heavy offense faces elite 3PT defense, they underperform their average. This is invisible to the current model that only looks at aggregate efficiency.

**Add to `pick-engine.ts`:**

```typescript
import { prisma } from "./db";

interface PointDistData {
  offFt: number; offFg2: number; offFg3: number;
  defFt: number; defFg2: number; defFg3: number;
  rankOffFg3: number; rankDefFg3: number;
}

async function loadPointDist(season: number): Promise<Map<string, PointDistData>> {
  const rows = await prisma.kenpomPointDist.findMany({ where: { season } });
  const map = new Map<string, PointDistData>();
  for (const r of rows) {
    map.set(r.teamName, {
      offFt: r.offFt, offFg2: r.offFg2, offFg3: r.offFg3,
      defFt: r.defFt, defFg2: r.defFg2, defFg3: r.defFg3,
      rankOffFg3: r.rankOffFg3, rankDefFg3: r.rankDefFg3,
    });
  }
  return map;
}

function signalShootingProfile(
  homePD: PointDistData | null,
  awayPD: PointDistData | null,
  spread: number,
  overUnder: number,
): { spreadSignal: SignalResult; ouSignal: SignalResult } {
  if (!homePD || !awayPD) return { spreadSignal: neutral, ouSignal: neutral };

  // ── O/U Signal (primary value) ──
  //
  // 3PT matchup: Team's OffFg3% vs opponent's DefFg3%
  // If offense relies on 3s AND defense allows few 3s → under lean
  // If offense relies on 3s AND defense allows many 3s → over lean
  //
  // The differential tells us if scoring will be EASIER or HARDER than average
  
  const home3ptEdge = homePD.offFg3 - awayPD.defFg3;  // + = home 3PT advantage
  const away3ptEdge = awayPD.offFg3 - homePD.defFg3;
  
  const home2ptEdge = homePD.offFg2 - awayPD.defFg2;
  const away2ptEdge = awayPD.offFg2 - homePD.defFg2;
  
  const homeFtEdge = homePD.offFt - awayPD.defFt;
  const awayFtEdge = awayPD.offFt - homePD.defFt;
  
  // Composite: positive = more scoring expected than typical
  // 3PT has highest variance (worth 3 pts, make-or-miss)
  // 2PT has most volume (most possessions end here)
  // FT is supplementary
  const scoringEnvironment = (
    (home3ptEdge + away3ptEdge) * 0.40 +
    (home2ptEdge + away2ptEdge) * 0.35 +
    (homeFtEdge + awayFtEdge) * 0.25
  );
  
  // Map to O/U signal
  // Typical point dist values: offFg3 ranges ~20-40%, so edges of ±5+ are significant
  const ouMagnitude = clamp(Math.abs(scoringEnvironment) * 1.5, 0, 10);
  const ouDirection = scoringEnvironment > 1.0 ? "over" : scoringEnvironment < -1.0 ? "under" : "neutral";
  
  const ouSignal: SignalResult = {
    category: "shootingProfile",
    direction: ouDirection as SignalResult["direction"],
    magnitude: ouMagnitude,
    confidence: clamp(ouMagnitude / 10, 0, 1),
    label: `3PT matchup: Home Off3 ${homePD.offFg3.toFixed(1)}% vs Away Def3 ${awayPD.defFg3.toFixed(1)}% | Away Off3 ${awayPD.offFg3.toFixed(1)}% vs Home Def3 ${homePD.defFg3.toFixed(1)}%`,
    strength: ouMagnitude >= 6 ? "strong" : ouMagnitude >= 3.5 ? "moderate" : ouMagnitude >= 1.5 ? "weak" : "noise",
  };
  
  // ── Spread Signal ──
  // Which team has the shooting style advantage in this matchup?
  const homeProfileEdge = home3ptEdge * 0.40 + home2ptEdge * 0.35 + homeFtEdge * 0.25;
  const awayProfileEdge = away3ptEdge * 0.40 + away2ptEdge * 0.35 + awayFtEdge * 0.25;
  const profileDiff = homeProfileEdge - awayProfileEdge;
  
  const spreadMagnitude = clamp(Math.abs(profileDiff) * 1.2, 0, 10);
  const spreadDirection = profileDiff > 1.0 ? "home" : profileDiff < -1.0 ? "away" : "neutral";
  
  const spreadSignal: SignalResult = {
    category: "shootingProfile",
    direction: spreadDirection as SignalResult["direction"],
    magnitude: spreadMagnitude,
    confidence: clamp(spreadMagnitude / 10, 0, 1),
    label: `Shooting profile edge: ${spreadDirection === "home" ? "Home" : "Away"} +${Math.abs(profileDiff).toFixed(1)} (3PT/2PT/FT matchup advantage)`,
    strength: spreadMagnitude >= 6 ? "strong" : spreadMagnitude >= 3.5 ? "moderate" : spreadMagnitude >= 1.5 ? "weak" : "noise",
  };
  
  return { spreadSignal, ouSignal };
}
```

**Weight allocation:** Add `shootingProfile` to NCAAMB weights:

```typescript
// NCAAMB spread weights
NCAAMB: {
  modelEdge: 0.25,        // DOWN from 0.30 to make room
  seasonATS: 0.12,        // DOWN from 0.15
  trendAngles: 0.20,      // DOWN from 0.25
  recentForm: 0.08,       // DOWN from 0.10
  h2h: 0.05,
  situational: 0.00,
  restDays: 0.05,
  marketEdge: 0.10,
  shootingProfile: 0.08,  // NEW
  experience: 0.07,       // NEW (Task 2)
}

// NCAAMB O/U weights
NCAAMB: {
  modelEdge: 0.28,        // DOWN from 0.35
  seasonOU: 0.10,         // DOWN from 0.12
  trendAngles: 0.15,      // DOWN from 0.18
  recentForm: 0.07,       // DOWN from 0.08
  h2hWeather: 0.10,       // DOWN from 0.12
  tempoDiff: 0.12,        // DOWN from 0.15
  shootingProfile: 0.12,  // NEW — big weight, this is a strong O/U signal
  luckRegression: 0.06,   // NEW (Task 3)
}
```

---

### Task 2: KenPom Experience & Continuity Signal (`signalExperienceContinuity`)

**Data source:** `KenpomHeight` table (7,035 records, refreshed daily)

**What it contains per team:**
- `exp` / `expRank` — Average experience (years of college ball)
- `continuity` / `continuityRank` — % of minutes returning from last season
- `bench` / `benchRank` — Bench minutes share (team depth)
- `hgtEff` / `hgtEffRank` — How effectively team uses its height
- `avgHgt` — Average height, plus height by position (PG through C)

**Why it matters:**
- **Continuity** is one of the most documented edges in CBB analytics. Teams with high continuity (returning players) significantly outperform early season (Nov-Dec) because chemistry > talent early. Bart Torvik has documented this as a 2-3 point effect.
- **Experience** matters most in pressure situations — March Madness, close games, hostile environments. Freshman-heavy teams fold under pressure at a measurably higher rate.
- **Bench depth** matters in foul trouble situations, back-to-back tournament games, and high-tempo matchups.
- **Height efficiency** — not just how tall you are, but how effectively you use your height advantage.

```typescript
interface HeightData {
  exp: number; expRank: number;
  continuity: number; continuityRank: number;
  bench: number; benchRank: number;
  hgtEff: number; hgtEffRank: number;
  avgHgt: number;
}

async function loadHeightData(season: number): Promise<Map<string, HeightData>> {
  const rows = await prisma.kenpomHeight.findMany({ where: { season } });
  const map = new Map<string, HeightData>();
  for (const r of rows) {
    map.set(r.teamName, {
      exp: r.exp, expRank: r.expRank,
      continuity: r.continuity, continuityRank: r.continuityRank,
      bench: r.bench, benchRank: r.benchRank,
      hgtEff: r.hgtEff, hgtEffRank: r.hgtEffRank,
      avgHgt: r.avgHgt,
    });
  }
  return map;
}

function signalExperienceContinuity(
  homeHt: HeightData | null,
  awayHt: HeightData | null,
  gameDate: Date,
  isTournament: boolean,
  isConferenceTourney: boolean,
): SignalResult {
  if (!homeHt || !awayHt) return neutral;

  const month = gameDate.getMonth(); // 0-indexed
  const isEarlySeason = month === 10 || month === 11 || (month === 0 && gameDate.getDate() <= 15);
  // Nov, Dec, early Jan
  const isPostseason = isTournament || isConferenceTourney || month === 2; // March

  // ── Continuity (strongest Nov-Jan, fades after) ──
  // Typical range: 0.20 (all new roster) to 0.85 (everyone returns)
  const contDiff = homeHt.continuity - awayHt.continuity;
  const contWeight = isEarlySeason ? 1.0 : isPostseason ? 0.2 : 0.5;
  
  // ── Experience (strongest in March) ──
  // Typical range: 1.0 (all freshmen) to 3.5 (all seniors/grad transfers)
  const expDiff = homeHt.exp - awayHt.exp;
  const expWeight = isPostseason ? 1.0 : isEarlySeason ? 0.3 : 0.5;
  
  // ── Bench depth ──
  // Matters more in tournament (2 games in 3 days) and high-tempo games
  const benchDiff = homeHt.bench - awayHt.bench;
  const benchWeight = (isTournament || isConferenceTourney) ? 0.8 : 0.3;
  
  // ── Height efficiency ──
  // Size advantage matters in specific matchups
  const hgtEffDiff = homeHt.hgtEff - awayHt.hgtEff;
  
  // Composite score
  // Continuity diff of 0.30 is huge (~15% difference in returning minutes)
  // Experience diff of 0.5 is meaningful (~half a year average)
  const edge = (
    contDiff * contWeight * 8.0 +    // Scale: 0.30 cont diff → ~2.4 points of edge
    expDiff * expWeight * 3.0 +       // Scale: 0.5 exp diff → ~1.5 points of edge
    benchDiff * benchWeight * 2.0 +   // Scale: modest impact
    hgtEffDiff * 0.5                  // Scale: tiebreaker
  );
  
  const magnitude = clamp(Math.abs(edge), 0, 10);
  const direction = edge > 0.5 ? "home" : edge < -0.5 ? "away" : "neutral";
  
  // Build descriptive label
  const parts: string[] = [];
  if (Math.abs(contDiff) > 0.10) {
    const better = contDiff > 0 ? "Home" : "Away";
    parts.push(`${better} continuity ${Math.abs(contDiff * 100).toFixed(0)}% higher${isEarlySeason ? " (early season boost)" : ""}`);
  }
  if (Math.abs(expDiff) > 0.3) {
    const better = expDiff > 0 ? "Home" : "Away";
    parts.push(`${better} +${Math.abs(expDiff).toFixed(1)} yrs experience${isPostseason ? " (postseason boost)" : ""}`);
  }
  if (Math.abs(benchDiff) > 5 && (isTournament || isConferenceTourney)) {
    const better = benchDiff > 0 ? "Home" : "Away";
    parts.push(`${better} deeper bench (tournament advantage)`);
  }
  
  return {
    category: "experience",
    direction: direction as SignalResult["direction"],
    magnitude,
    confidence: clamp(magnitude / 10, 0, 1),
    label: parts.length > 0 ? parts.join(" | ") : "Experience/continuity neutral",
    strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}
```

---

### Task 3: KenPom Luck Regression Signal (`signalLuckRegression`)

**Data source:** `Luck` field from KenPom ratings API (already fetched, never used)

**What it is:** KenPom's Luck rating measures how much a team's actual record deviates from what their efficiency metrics predict. A team with high positive Luck has won more close games than expected — they're due for regression. A team with high negative Luck has lost close games they "should have" won — they're likely better than their record.

**Why it matters:** Luck is mean-reverting. A team at +0.08 Luck has been winning close games at an unsustainable rate. The market often prices in the record, not the underlying efficiency. This creates value.

```typescript
function signalLuckRegression(
  homeRating: KenpomRating | null,
  awayRating: KenpomRating | null,
): SignalResult {
  if (!homeRating || !awayRating) return neutral;
  
  const homeLuck = homeRating.Luck;
  const awayLuck = awayRating.Luck;
  
  // Luck ranges roughly -0.15 to +0.15
  // Positive luck = winning more than expected → regression candidate (fade)
  // Negative luck = losing more than expected → bounce-back candidate (back)
  
  // The SPREAD signal: fade the lucky team, back the unlucky team
  // If home is very lucky and away is unlucky, the market overvalues home
  const luckDiff = homeLuck - awayLuck;
  
  // luckDiff > 0 means home has been luckier → fade home (lean away)
  // luckDiff < 0 means away has been luckier → fade away (lean home)
  const direction = luckDiff > 0.03 ? "away" : luckDiff < -0.03 ? "home" : "neutral";
  
  // Magnitude: |luckDiff| of 0.10 is massive, 0.05 is significant
  const magnitude = clamp(Math.abs(luckDiff) * 50, 0, 10);
  
  // ── O/U Signal ──
  // Lucky teams with inflated records may have inflated totals expectations
  // But luck itself doesn't strongly predict O/U — this is primarily a spread signal
  
  return {
    category: "luckRegression",
    direction: direction as SignalResult["direction"],
    magnitude,
    confidence: clamp(magnitude / 10, 0, 1),
    label: `Luck regression: Home ${homeLuck > 0 ? "+" : ""}${homeLuck.toFixed(3)} (${homeRating.RankLuck}) vs Away ${awayLuck > 0 ? "+" : ""}${awayLuck.toFixed(3)} (${awayRating.RankLuck})`,
    strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}
```

**Weight:** Add `luckRegression: 0.05` to NCAAMB spread weights (take from `seasonATS` or `trendAngles`).

---

### Task 4: KenPom SOS-Adjusted Model Edge

**Data source:** `SOS`, `SOSO`, `SOSD`, `NCSOS` from KenPom ratings (already fetched)

**Why it matters:** Two teams with the same AdjEM but very different SOS tell different stories. A team that built their record against weak non-conference opponents (`NCSOS` ranking is poor) may be overvalued. More importantly, the SOS components (offensive vs defensive SOS) tell you if a team has been tested by good offenses vs good defenses.

**Implementation:** Don't create a separate signal — instead enhance the existing `signalModelEdge` for NCAAMB:

```typescript
// Inside the NCAAMB modelEdge calculation, add SOS context:

// If both teams have similar AdjEM but very different SOS, trust the one with harder schedule
const sosDiff = homeRating.SOS - awayRating.SOS; // Higher SOS = harder schedule
const ncsosWarning = (
  (homeRating.RankNCSOS > 200 && awayRating.RankNCSOS < 100) ||
  (awayRating.RankNCSOS > 200 && homeRating.RankNCSOS < 100)
);

// Adjust model edge magnitude based on SOS differential
// If the team we're favoring also has the harder SOS → more confident
// If the team we're favoring has a weaker SOS → less confident
if (spreadEdge > 0 && sosDiff > 0) {
  // We favor home AND home has harder SOS → boost confidence
  spreadMagnitude *= 1.1;
} else if (spreadEdge > 0 && sosDiff < -2) {
  // We favor home BUT home has weaker SOS → reduce confidence
  spreadMagnitude *= 0.85;
}

// Add to label
if (ncsosWarning) {
  label += ` | ⚠️ SOS mismatch: NCSOS ranks ${homeRating.RankNCSOS} vs ${awayRating.RankNCSOS}`;
}
```

---

### Task 5: KenPom Possession Length Signal (APL)

**Data source:** `APL_Off`, `APL_Def`, `ConfAPL_Off`, `ConfAPL_Def` from ratings (already fetched)

**What it is:** Average Possession Length — how long each team's offensive and defensive possessions last. This is distinct from tempo (possessions per game). APL tells you play style: quick-strike teams vs methodical half-court teams.

**Why it matters for O/U:** APL difference predicts game pace more granularly than tempo alone. When a quick-strike offense faces a team that forces long defensive possessions, the resulting tempo is harder to predict — and the model should widen its uncertainty band.

```typescript
function signalPossessionLength(
  homeRating: KenpomRating | null,
  awayRating: KenpomRating | null,
): SignalResult {
  if (!homeRating || !awayRating) return neutral;
  
  // APL is in seconds per possession. Lower = faster offense.
  // Typical range: ~15-19 seconds
  
  const homeOffAPL = homeRating.APL_Off;
  const awayOffAPL = awayRating.APL_Off;
  const homeDefAPL = homeRating.APL_Def; // How long opponents take against this team
  const awayDefAPL = awayRating.APL_Def;
  
  // Expected game pace: average of (home offense vs away defense) and (away offense vs home defense)
  const homeVsAwayAPL = (homeOffAPL + awayDefAPL) / 2;
  const awayVsHomeAPL = (awayOffAPL + homeDefAPL) / 2;
  const expectedGameAPL = (homeVsAwayAPL + awayVsHomeAPL) / 2;
  
  // League average APL is ~17 seconds
  const leagueAvg = 17.0;
  
  // Faster possessions = more possessions = more points = over
  // Slower possessions = fewer possessions = fewer points = under
  const aplDiff = leagueAvg - expectedGameAPL; // Positive = faster than average
  
  const magnitude = clamp(Math.abs(aplDiff) * 3, 0, 10);
  const direction = aplDiff > 0.3 ? "over" : aplDiff < -0.3 ? "under" : "neutral";
  
  return {
    category: "possessionLength",
    direction: direction as SignalResult["direction"],
    magnitude,
    confidence: clamp(magnitude / 10, 0, 1),
    label: `Possession length: Expected ${expectedGameAPL.toFixed(1)}s/poss (avg ${leagueAvg.toFixed(1)}s) — Home Off ${homeOffAPL.toFixed(1)}s, Away Off ${awayOffAPL.toFixed(1)}s`,
    strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}
```

**Integration:** Merge this into the existing `tempoDiff` O/U signal or add as a sub-signal. APL provides finer-grained pace info than tempo alone. Consider replacing `tempoDiff` with a combined `paceProfile` signal that uses both AdjTempo AND APL.

---

### Task 6: Wire ESPN Injuries Into Pick Scoring

**Data source:** `src/lib/espn-injuries.ts` — already fetches injury data, only displayed in UI via `/api/games/injuries`

**Current state:** Injuries are fetched and shown to users but **never factor into any pick score**. A team missing its best player gets the same model edge as if that player were healthy.

**Implementation:**

```typescript
import { getAllInjuries, getInjuriesForTeam, type Injury } from "./espn-injuries";

function signalInjuryImpact(
  homeInjuries: Injury[],
  awayInjuries: Injury[],
  sport: string,
): SignalResult {
  // Count significant injuries (Out or Doubtful only — Questionable/Probable are noise)
  const significantStatuses = ["Out", "Doubtful", "Injured Reserve"];
  
  const homeOut = homeInjuries.filter(i => significantStatuses.includes(i.status));
  const awayOut = awayInjuries.filter(i => significantStatuses.includes(i.status));
  
  // Weight by position importance (sport-specific)
  const positionWeight: Record<string, Record<string, number>> = {
    NFL: { QB: 10, RB: 4, WR: 3, TE: 2, OL: 3, DL: 2, LB: 2, CB: 3, S: 2, K: 1, P: 0.5 },
    NCAAF: { QB: 10, RB: 4, WR: 3, TE: 2, OL: 3, DL: 2, LB: 2, CB: 3, S: 2, K: 1, P: 0.5 },
    NCAAMB: { G: 5, F: 4, C: 4 }, // CBB positions are vague — ESPN uses G/F/C
    NBA: { PG: 6, SG: 5, SF: 5, PF: 5, C: 5, G: 5, F: 5 },
  };
  
  const weights = positionWeight[sport] || {};
  
  const homeImpact = homeOut.reduce((sum, inj) => {
    const w = weights[inj.position] || weights[inj.position?.charAt(0)] || 1;
    return sum + w;
  }, 0);
  
  const awayImpact = awayOut.reduce((sum, inj) => {
    const w = weights[inj.position] || weights[inj.position?.charAt(0)] || 1;
    return sum + w;
  }, 0);
  
  const impactDiff = awayImpact - homeImpact; // Positive = away more hurt → lean home
  
  const magnitude = clamp(Math.abs(impactDiff) * 0.8, 0, 10);
  const direction = impactDiff > 2 ? "home" : impactDiff < -2 ? "away" : "neutral";
  
  // Build label listing key injuries
  const homeOutNames = homeOut.slice(0, 3).map(i => `${i.playerName} (${i.position}, ${i.status})`);
  const awayOutNames = awayOut.slice(0, 3).map(i => `${i.playerName} (${i.position}, ${i.status})`);
  
  const parts: string[] = [];
  if (homeOut.length > 0) parts.push(`Home OUT: ${homeOutNames.join(", ")}${homeOut.length > 3 ? ` +${homeOut.length - 3} more` : ""}`);
  if (awayOut.length > 0) parts.push(`Away OUT: ${awayOutNames.join(", ")}${awayOut.length > 3 ? ` +${awayOut.length - 3} more` : ""}`);
  
  return {
    category: "injuries",
    direction: direction as SignalResult["direction"],
    magnitude,
    confidence: clamp(magnitude / 10, 0, 1),
    label: parts.length > 0 ? parts.join(" | ") : "No significant injuries",
    strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
  };
}
```

**Load injuries in `generateDailyPicks`:**

```typescript
// At the top of generateDailyPicks, fetch injuries once for the sport
const allInjuries = await getAllInjuries(sport as Sport);

// Per game:
const homeInj = getInjuriesForTeam(allInjuries, canonHome);
const awayInj = getInjuriesForTeam(allInjuries, canonAway);
const injurySignal = signalInjuryImpact(homeInj, awayInj, sport);
```

**Weight:** Add `injuries: 0.08` to ALL sport spread weight configs. Injuries are sport-universal. Take weight from `trendAngles` and `recentForm`.

---

### Task 7: Line Movement as Pick Signal

**Data source:** `src/lib/line-movement.ts` exports `detectSignificantMoves()`. Currently only served via `/api/odds/significant-moves`.

**What it does:** Compares consecutive `OddsSnapshot` entries to detect significant line moves (>1 point spread moves, >1 point total moves).

**Why it matters:** Reverse line movement (line moves AGAINST the public side) is one of the strongest sharp money indicators. If 75% of bets are on Team A but the line moves toward Team B, sharps are loading up on Team B.

**Implementation:**

```typescript
import { detectSignificantMoves, type SignificantMove } from "./line-movement";

function signalLineMovement(
  moves: SignificantMove[],
  homeTeam: string,
  awayTeam: string,
): { spreadSignal: SignalResult; ouSignal: SignalResult } {
  // Find moves for this specific game
  const gameMoves = moves.filter(m => 
    (m.homeTeam === homeTeam && m.awayTeam === awayTeam)
  );
  
  if (gameMoves.length === 0) return { spreadSignal: neutral, ouSignal: neutral };
  
  // Analyze spread movement direction and magnitude
  const spreadMoves = gameMoves.filter(m => m.market === "spread");
  const totalMoves = gameMoves.filter(m => m.market === "total");
  
  // Spread: if line moved toward home (more negative), sharps may like home
  // If line moved toward away (less negative / more positive), sharps may like away
  let spreadSignal = neutral;
  if (spreadMoves.length > 0) {
    const totalShift = spreadMoves.reduce((sum, m) => sum + m.change, 0);
    // Negative shift = line moved toward home (home getting more points = sharps on away)
    // Wait — spread convention: if spread goes from -3 to -5, home is MORE favored
    // totalShift would be -2 (moved -2 points), meaning sharps on home
    
    const magnitude = clamp(Math.abs(totalShift) * 2, 0, 10);
    const direction = totalShift < -0.5 ? "home" : totalShift > 0.5 ? "away" : "neutral";
    
    spreadSignal = {
      category: "lineMovement",
      direction: direction as SignalResult["direction"],
      magnitude,
      confidence: clamp(magnitude / 10, 0, 1),
      label: `Line moved ${Math.abs(totalShift).toFixed(1)} pts toward ${direction === "home" ? "home" : "away"} (${spreadMoves.length} move${spreadMoves.length > 1 ? "s" : ""})`,
      strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
    };
  }
  
  // Total: if line moved up, sharps on over; if down, sharps on under
  let ouSignal = neutral;
  if (totalMoves.length > 0) {
    const totalShift = totalMoves.reduce((sum, m) => sum + m.change, 0);
    const magnitude = clamp(Math.abs(totalShift) * 2, 0, 10);
    const direction = totalShift > 0.3 ? "over" : totalShift < -0.3 ? "under" : "neutral";
    
    ouSignal = {
      category: "lineMovement",
      direction: direction as SignalResult["direction"],
      magnitude,
      confidence: clamp(magnitude / 10, 0, 1),
      label: `Total moved ${Math.abs(totalShift).toFixed(1)} pts ${direction === "over" ? "up" : "down"} (sharps ${direction === "over" ? "over" : "under"})`,
      strength: magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : magnitude >= 1.5 ? "weak" : "noise",
    };
  }
  
  return { spreadSignal, ouSignal };
}
```

**Note:** This only works for NCAAMB currently (only sport with OddsSnapshot data). When you add odds snapshots for other sports, this signal automatically works for them too.

**Weight:** Add `lineMovement: 0.07` to spread and O/U weights for sports that have OddsSnapshot data.

---

### Task 8: Populate UpcomingGame Weather Fields

**Current state:** The `UpcomingGame` model has `forecastTemp`, `forecastWindMph`, `forecastCategory` fields — all NULL across all 420 records.

**Fix:** The weather integration from `IMPLEMENTATION-PROMPT.md` (Open-Meteo) should populate these fields. But even before that, add weather awareness to the pick engine for outdoor football games.

**Quick fix for now (before Open-Meteo integration):**

In `src/app/api/cron/daily-sync/route.ts`, after refreshing upcoming games, add a step that fetches weather for outdoor NFL/NCAAF games and updates the `UpcomingGame` rows. Use the UpcomingGame's `forecastTemp`, `forecastWindMph`, `forecastCategory` fields that are already in the schema.

Once weather data is populated, the existing `signalH2HWeather` in the pick engine should be updated to actually READ these fields and factor them into scoring.

---

### Task 9: CFBD Special Teams Integration

**Data source:** `specialTeams: { rating: number } | null` in CFBD SP+ data (already fetched, ignored)

**Why it matters:** Special teams is the "hidden third phase" — field position, punt returns, kick returns, and field goal range all affect scoring. A team with elite special teams (+5 SP+) facing terrible special teams (-5 SP+) has a meaningful edge that the current model ignores.

**Implementation:** Fold into the existing NCAAF `signalModelEdge`:

```typescript
// Inside NCAAF model edge calculation:

// Add special teams edge
const homeSTRating = homeR.specialTeams?.rating ?? 0;
const awaySTRating = awayR.specialTeams?.rating ?? 0;
const stEdge = homeSTRating - awaySTRating;

// Special teams contributes ~15% of total team rating
// Adjust predicted margin by special teams differential
predictedMargin += stEdge * 0.15;

// Add to label
if (Math.abs(stEdge) > 3) {
  label += ` | ST edge: ${stEdge > 0 ? "Home" : "Away"} +${Math.abs(stEdge).toFixed(1)} SP+ special teams`;
}
```

---

### Task 10: FanMatch ThrillScore & PredTempo Usage

**Data source:** `ThrillScore` and `PredTempo` from KenPom FanMatch (already fetched)

**ThrillScore:** KenPom's metric for how exciting/competitive a game is expected to be. Higher thrill = closer game = more variance. This is useful for spread confidence calibration.

**PredTempo:** FanMatch's game-specific predicted tempo. More specific than team-level AdjTempo because it accounts for the specific matchup.

```typescript
// In NCAAMB pick generation, when FanMatch data is available:

// ThrillScore: high thrill = close game = reduce spread confidence
// Low thrill = blowout expected = increase spread confidence (for the favored side)
if (gameFM) {
  const thrillScore = gameFM.ThrillScore;
  // Thrill ranges roughly 50-100. Higher = more exciting = closer expected
  
  if (thrillScore > 85) {
    // Very close game expected — reduce spread confidence
    spreadMagnitude *= 0.75;
    // But O/U confidence is unaffected
  } else if (thrillScore < 50) {
    // Blowout expected — increase spread confidence
    spreadMagnitude *= 1.15;
  }
  
  // PredTempo: use this instead of team-level AdjTempo average for O/U
  // It's a game-specific prediction that factors in both teams
  const predTempo = gameFM.PredTempo;
  // Use predTempo to refine the O/U model prediction
  // predTempo > 70 = fast game = lean over
  // predTempo < 64 = slow game = lean under
}
```

---

### Task 11: KenPom Seed for Tournament Games

**Data source:** `Seed` from KenPom ratings (already fetched)

**When to use:** Only during March Madness. Seed matchup data provides powerful historical signals:
- 12 seeds beat 5 seeds ~35% of the time
- 1 seeds are 0-1 against 16 seeds historically (now 1-1 with UMBC)
- 8v9 and 7v10 matchups are near coin flips

```typescript
function signalSeedMatchup(
  homeRating: KenpomRating | null,
  awayRating: KenpomRating | null,
  isTournament: boolean,
): SignalResult {
  if (!isTournament || !homeRating || !awayRating) return neutral;
  if (!homeRating.Seed || !awayRating.Seed) return neutral;
  
  const highSeed = Math.min(homeRating.Seed, awayRating.Seed);
  const lowSeed = Math.max(homeRating.Seed, awayRating.Seed);
  
  // Historical upset rates by seed matchup (NCAA tournament data)
  const upsetRates: Record<string, number> = {
    "1v16": 0.01, "2v15": 0.06, "3v14": 0.15, "4v13": 0.20,
    "5v12": 0.35, "6v11": 0.37, "7v10": 0.39, "8v9": 0.49,
  };
  
  const matchupKey = `${highSeed}v${lowSeed}`;
  const historicalUpsetRate = upsetRates[matchupKey];
  
  if (!historicalUpsetRate) return neutral;
  
  // If KenPom suggests the upset is MORE likely than historical rate → lean underdog
  // If KenPom suggests the upset is LESS likely → lean favorite
  // (This is more of a context signal than a directional one)
  
  return {
    category: "seedMatchup",
    direction: "neutral",
    magnitude: 3,
    confidence: 0.5,
    label: `Tournament ${matchupKey}: Historical upset rate ${(historicalUpsetRate * 100).toFixed(0)}%`,
    strength: "moderate",
  };
}
```

---

### Task 12: KenPom Pythag for Cross-Validation

**Data source:** `Pythag` from KenPom ratings (already fetched)

**What it is:** Pythagorean win expectation based on points scored and allowed. When a team's actual win% significantly differs from their Pythag, they're due for regression (similar to Luck but calculated differently).

**Implementation:** Use Pythag to cross-validate model edge. If KenPom AdjEM says Team A is better but their Pythag win% is significantly lower than actual, reduce confidence:

```typescript
// Inside NCAAMB model edge, add Pythag cross-check:
const homePythag = homeRating.Pythag;
const awayPythag = awayRating.Pythag;
const homeActualWinPct = homeRating.Wins / (homeRating.Wins + homeRating.Losses);
const awayActualWinPct = awayRating.Wins / (awayRating.Wins + awayRating.Losses);

// Large gap between Pythag and actual = instability
const homeDeviation = Math.abs(homeActualWinPct - homePythag);
const awayDeviation = Math.abs(awayActualWinPct - awayPythag);

// If both teams have stable Pythag (low deviation), model is more reliable
// If either team has unstable Pythag, reduce confidence
if (homeDeviation > 0.10 || awayDeviation > 0.10) {
  spreadMagnitude *= 0.85; // Reduce confidence — this team is unpredictable
  label += ` | ⚠️ Pythag instability: Home ${(homeDeviation * 100).toFixed(0)}%, Away ${(awayDeviation * 100).toFixed(0)}% deviation`;
}
```

---

## Updated Weight Configs (All Changes Combined)

### NCAAMB Spread
```typescript
NCAAMB: {
  modelEdge: 0.22,        // DOWN from 0.30 (now enhanced with SOS, Pythag, APL)
  seasonATS: 0.10,        // DOWN from 0.15
  trendAngles: 0.18,      // DOWN from 0.25
  recentForm: 0.07,       // DOWN from 0.10
  h2h: 0.03,              // DOWN from 0.05
  restDays: 0.05,
  marketEdge: 0.08,       // DOWN from 0.10
  shootingProfile: 0.07,  // NEW (Task 1)
  experience: 0.07,       // NEW (Task 2)
  luckRegression: 0.05,   // NEW (Task 3)
  injuries: 0.05,         // NEW (Task 6)
  lineMovement: 0.03,     // NEW (Task 7) — low weight until more odds data
}
```

### NCAAMB O/U
```typescript
NCAAMB: {
  modelEdge: 0.25,        // DOWN from 0.35 (enhanced with APL)
  seasonOU: 0.08,         // DOWN from 0.12
  trendAngles: 0.13,      // DOWN from 0.18
  recentForm: 0.06,       // DOWN from 0.08
  h2hWeather: 0.08,       // DOWN from 0.12
  tempoDiff: 0.10,        // DOWN from 0.15 (now complemented by APL)
  shootingProfile: 0.12,  // NEW (Task 1) — strong O/U signal
  possessionLength: 0.08, // NEW (Task 5)
  luckRegression: 0.04,   // NEW (Task 3)
  lineMovement: 0.03,     // NEW (Task 7)
  injuries: 0.03,         // NEW (Task 6) — lower weight for O/U
}
```

### NFL Spread
```typescript
NFL: {
  modelEdge: 0.20,
  seasonATS: 0.10,        // DOWN from 0.15
  trendAngles: 0.20,      // DOWN from 0.25
  recentForm: 0.15,       // DOWN from 0.20
  h2h: 0.05,              // DOWN from 0.10
  situational: 0.08,      // DOWN from 0.10
  injuries: 0.10,         // NEW — huge for NFL (QB injuries = 5+ point swings)
  lineMovement: 0.05,     // NEW (when odds data available)
  weather: 0.07,          // NEW (Task 8, when populated)
}
```

### NCAAF Spread
```typescript
NCAAF: {
  modelEdge: 0.30,        // Same (now includes special teams)
  seasonATS: 0.10,        // DOWN from 0.15
  trendAngles: 0.15,      // DOWN from 0.20
  recentForm: 0.12,       // DOWN from 0.15
  h2h: 0.05,              // DOWN from 0.10
  situational: 0.08,      // DOWN from 0.10
  injuries: 0.08,         // NEW
  lineMovement: 0.05,     // NEW (when odds data available)
  weather: 0.07,          // NEW (Task 8)
}
```

### NBA Spread
```typescript
NBA: {
  modelEdge: 0.25,
  seasonATS: 0.10,        // DOWN from 0.15
  trendAngles: 0.18,      // DOWN from 0.25
  recentForm: 0.12,       // DOWN from 0.15
  h2h: 0.05,
  situational: 0.05,
  restDays: 0.10,
  injuries: 0.10,         // NEW — critical for NBA (star-driven league)
  lineMovement: 0.05,     // NEW (when odds data available)
}
```

---

## Integration into `generateDailyPicks`

At the top of the main pick generation function, load all new data sources once:

```typescript
// Existing loads
const kenpomRatings = sport === "NCAAMB" ? await getKenpomRatings() : null;
const cfbdRatings = sport === "NCAAF" ? await getCFBDRatings() : null;

// NEW: Load supplemental KenPom data
const pointDistData = sport === "NCAAMB" ? await loadPointDist(currentSeason) : null;
const heightData = sport === "NCAAMB" ? await loadHeightData(currentSeason) : null;

// NEW: Load injuries
const allInjuries = await getAllInjuries(sport as Sport).catch(() => []);

// NEW: Load line movement
const significantMoves = sport === "NCAAMB" ? await detectSignificantMoves(sport).catch(() => []) : [];
```

Then in the per-game loop, compute all new signals and add them to the weighted score.

---

## File Summary

| File | Action | Changes |
|---|---|---|
| `src/lib/pick-engine.ts` | **Modify** | Add 8 new signal functions, update all weight configs, load new data in generateDailyPicks |
| `src/lib/espn-injuries.ts` | **No change** | Already exports what we need |
| `src/lib/line-movement.ts` | **No change** | Already exports what we need |
| `src/app/api/cron/daily-sync/route.ts` | **Modify** | Add weather population step for UpcomingGame |

**This is entirely pick-engine work.** No new modules, no schema changes, no new API integrations. Just wiring up data that's already flowing through the system.

---

## Expected Impact

| Signal Added | Expected ATS Improvement | Sport |
|---|---|---|
| Shooting Profile (PointDist) | +1-3% O/U, +0.5-1% spread | NCAAMB |
| Experience/Continuity | +1-2% spread (early season: +3-4%) | NCAAMB |
| Luck Regression | +0.5-1.5% spread | NCAAMB |
| SOS-Adjusted Model | +0.5-1% spread | NCAAMB |
| Possession Length (APL) | +0.5-1% O/U | NCAAMB |
| Injuries | +1-3% spread (all sports) | ALL |
| Line Movement | +1-2% spread (when data available) | NCAAMB |
| CFBD Special Teams | +0.5-1% spread | NCAAF |
| Pythag Cross-Validation | Reduces false confidence | NCAAMB |
| Seed Matchup Context | +1% tournament games | NCAAMB |

**Cumulative estimated improvement: +3-7% across all picks** — and this is pure signal from data you're already paying for and storing.
