import "server-only";
import { prisma } from "./db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NBATeamAdvanced {
  teamName: string;
  wins: number;
  losses: number;
  netRating: number;
  offRating: number;
  defRating: number;
  pace: number;
  efgPct: number;
  tovPct: number;
  orbPct: number;
  ftRate: number;
  oppEfgPct: number;
  oppTovPct: number;
  oppOrbPct: number;
  oppFtRate: number;
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;
  confidence: number;
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const statsCacheBySeason = new Map<string, CacheEntry<Map<string, NBATeamAdvanced>>>();

export function clearNBACache(): void {
  statsCacheBySeason.clear();
}

// ─── NBA.com API Helpers ────────────────────────────────────────────────────

const NBA_HEADERS: Record<string, string> = {
  Referer: "https://www.nba.com/",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

interface NBAResponse {
  resultSets: Array<{
    name: string;
    headers: string[];
    rowSet: unknown[][];
  }>;
}

async function fetchNBAStats(
  season: string,
  measureType: "Advanced" | "Four Factors",
): Promise<NBAResponse> {
  const url = new URL("https://stats.nba.com/stats/leaguedashteamstats");
  url.searchParams.set("Season", season);
  url.searchParams.set("SeasonType", "Regular Season");
  url.searchParams.set("MeasureType", measureType);

  const res = await fetch(url.toString(), {
    headers: NBA_HEADERS,
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NBA API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<NBAResponse>;
}

function parseRows(response: NBAResponse): Map<string, Record<string, unknown>> {
  const rs = response.resultSets[0];
  if (!rs) throw new Error("No resultSet in NBA response");
  const { headers, rowSet } = rs;
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rowSet) {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i];
    }
    const teamName = obj["TEAM_NAME"] as string;
    if (teamName) map.set(teamName, obj);
  }
  return map;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── NBA Team Name → Canonical DB Name ──────────────────────────────────────

const NBA_TO_CANONICAL: Record<string, string> = {
  "Atlanta Hawks": "Atlanta Hawks",
  "Boston Celtics": "Boston Celtics",
  "Brooklyn Nets": "Brooklyn Nets",
  "Charlotte Hornets": "Charlotte Hornets",
  "Chicago Bulls": "Chicago Bulls",
  "Cleveland Cavaliers": "Cleveland Cavaliers",
  "Dallas Mavericks": "Dallas Mavericks",
  "Denver Nuggets": "Denver Nuggets",
  "Detroit Pistons": "Detroit Pistons",
  "Golden State Warriors": "Golden State Warriors",
  "Houston Rockets": "Houston Rockets",
  "Indiana Pacers": "Indiana Pacers",
  "LA Clippers": "LA Clippers",
  "Los Angeles Clippers": "LA Clippers",
  "Los Angeles Lakers": "Los Angeles Lakers",
  "Memphis Grizzlies": "Memphis Grizzlies",
  "Miami Heat": "Miami Heat",
  "Milwaukee Bucks": "Milwaukee Bucks",
  "Minnesota Timberwolves": "Minnesota Timberwolves",
  "New Orleans Pelicans": "New Orleans Pelicans",
  "New York Knicks": "New York Knicks",
  "Oklahoma City Thunder": "Oklahoma City Thunder",
  "Orlando Magic": "Orlando Magic",
  "Philadelphia 76ers": "Philadelphia 76ers",
  "Phoenix Suns": "Phoenix Suns",
  "Portland Trail Blazers": "Portland Trail Blazers",
  "Sacramento Kings": "Sacramento Kings",
  "San Antonio Spurs": "San Antonio Spurs",
  "Toronto Raptors": "Toronto Raptors",
  "Utah Jazz": "Utah Jazz",
  "Washington Wizards": "Washington Wizards",
};

function canonicalName(nbaName: string): string {
  return NBA_TO_CANONICAL[nbaName] ?? nbaName;
}

// ─── Public API ─────────────────────────────────────────────────────────────

function getCurrentNBASeason(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // NBA season spans Oct-Jun; "2025-26" means the season starting Oct 2025
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

/**
 * Fetch NBA team advanced stats + four factors for the given season.
 * Returns a Map keyed by canonical team name.
 * Cached for 6 hours.
 */
export async function getNBATeamStats(
  season?: string,
): Promise<Map<string, NBATeamAdvanced>> {
  const s = season ?? getCurrentNBASeason();
  const now = Date.now();

  const cached = statsCacheBySeason.get(s);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fetch advanced stats
  const advancedResp = await fetchNBAStats(s, "Advanced");
  const advancedRows = parseRows(advancedResp);

  await delay(1000);

  // Fetch four factors
  const ffResp = await fetchNBAStats(s, "Four Factors");
  const ffRows = parseRows(ffResp);

  const result = new Map<string, NBATeamAdvanced>();

  for (const [nbaName, adv] of Array.from(advancedRows)) {
    const ff = ffRows.get(nbaName);
    const canonical = canonicalName(nbaName);

    const stats: NBATeamAdvanced = {
      teamName: canonical,
      wins: (adv["W"] as number) ?? 0,
      losses: (adv["L"] as number) ?? 0,
      netRating: (adv["NET_RATING"] as number) ?? 0,
      offRating: (adv["OFF_RATING"] as number) ?? 0,
      defRating: (adv["DEF_RATING"] as number) ?? 0,
      pace: (adv["PACE"] as number) ?? 0,
      // Four factors from the FF endpoint, fallback to advanced
      efgPct: (ff?.["EFG_PCT"] as number) ?? (adv["EFG_PCT"] as number) ?? 0,
      tovPct: (ff?.["TM_TOV_PCT"] as number) ?? (adv["TM_TOV_PCT"] as number) ?? 0,
      orbPct: (ff?.["OREB_PCT"] as number) ?? (adv["OREB_PCT"] as number) ?? 0,
      ftRate: (ff?.["FTA_RATE"] as number) ?? (adv["FTA_RATE"] as number) ?? 0,
      oppEfgPct: (ff?.["OPP_EFG_PCT"] as number) ?? 0,
      oppTovPct: (ff?.["OPP_TOV_PCT"] as number) ?? 0,
      oppOrbPct: (ff?.["OPP_OREB_PCT"] as number) ?? 0,
      oppFtRate: (ff?.["OPP_FTA_RATE"] as number) ?? 0,
    };

    result.set(canonical, stats);
  }

  statsCacheBySeason.set(s, { data: result, fetchedAt: now });
  console.log(`[nba-stats] Fetched ${result.size} teams for ${s}`);
  return result;
}

/**
 * Sync NBA team stats to the NBATeamStats database table.
 */
export async function syncNBATeamStats(): Promise<void> {
  const stats = await getNBATeamStats();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const [, s] of Array.from(stats)) {
    // Look up team by name
    const team = await prisma.team.findFirst({
      where: { name: s.teamName },
    });
    if (!team) {
      console.warn(`[nba-stats] No DB team found for "${s.teamName}"`);
      continue;
    }

    await prisma.nBATeamStats.upsert({
      where: { teamId_date: { teamId: team.id, date: today } },
      update: {
        netRating: s.netRating,
        offRating: s.offRating,
        defRating: s.defRating,
        pace: s.pace,
        efgPct: s.efgPct,
        tovPct: s.tovPct,
        orbPct: s.orbPct,
        ftRate: s.ftRate,
        oppEfgPct: s.oppEfgPct,
        oppTovPct: s.oppTovPct,
        oppOrbPct: s.oppOrbPct,
        oppFtRate: s.oppFtRate,
        wins: s.wins,
        losses: s.losses,
      },
      create: {
        teamId: team.id,
        date: today,
        netRating: s.netRating,
        offRating: s.offRating,
        defRating: s.defRating,
        pace: s.pace,
        efgPct: s.efgPct,
        tovPct: s.tovPct,
        orbPct: s.orbPct,
        ftRate: s.ftRate,
        oppEfgPct: s.oppEfgPct,
        oppTovPct: s.oppTovPct,
        oppOrbPct: s.oppOrbPct,
        oppFtRate: s.oppFtRate,
        wins: s.wins,
        losses: s.losses,
      },
    });
  }

  console.log(`[nba-stats] Synced ${stats.size} teams to DB`);
}

// ─── Signal Logic ───────────────────────────────────────────────────────────

function strengthFromMagnitude(mag: number): "strong" | "moderate" | "weak" | "noise" {
  if (mag >= 7) return "strong";
  if (mag >= 4) return "moderate";
  if (mag >= 2) return "weak";
  return "noise";
}

/**
 * Four Factors edge: compare each team's offensive four factors vs opponent's
 * defensive four factors. Weights: eFG% 40%, TOV% 25%, ORB% 20%, FT rate 15%.
 */
function fourFactorsEdge(home: NBATeamAdvanced, away: NBATeamAdvanced): number {
  // Home offensive edge = home offense vs away defense
  const homeOffEdge =
    0.4 * (home.efgPct - away.oppEfgPct) +
    0.25 * (away.oppTovPct - home.tovPct) + // higher opp TOV% is good for defense
    0.2 * (home.orbPct - away.oppOrbPct) +
    0.15 * (home.ftRate - away.oppFtRate);

  // Away offensive edge = away offense vs home defense
  const awayOffEdge =
    0.4 * (away.efgPct - home.oppEfgPct) +
    0.25 * (home.oppTovPct - away.tovPct) +
    0.2 * (away.orbPct - home.oppOrbPct) +
    0.15 * (away.ftRate - home.oppFtRate);

  // Positive = home advantage. Scale to approximate point impact.
  // Four factor percentages are 0-1 scale, multiply by ~100 to get a points-ish edge
  return (homeOffEdge - awayOffEdge) * 100;
}

/**
 * Generate spread and O/U signals from NBA Four Factors data.
 */
export function signalNBAFourFactors(
  homeStats: NBATeamAdvanced,
  awayStats: NBATeamAdvanced,
  spread: number,
  overUnder: number,
): { spreadSignal: SignalResult; ouSignal: SignalResult } {
  const HCA = 2.5; // NBA home court advantage in points

  // ── Spread Signal ──
  // Net Rating predicted margin
  const netRatingMargin = (homeStats.netRating - awayStats.netRating) / 2.5 + HCA;

  // Four factors edge (already scaled to approximate points)
  const ffEdge = fourFactorsEdge(homeStats, awayStats) + HCA;

  // Blend: 60% net rating, 40% four factors
  const predictedMargin = 0.6 * netRatingMargin + 0.4 * ffEdge;

  // Edge vs spread (negative spread = home favored)
  const spreadEdge = predictedMargin - -spread; // spread is typically negative for home favorite
  const absSpreadEdge = Math.abs(spreadEdge);

  // Map to magnitude (0-10). ~3 point edge = strong signal
  const spreadMag = Math.min(10, (absSpreadEdge / 3) * 7);
  const spreadDir: "home" | "away" = spreadEdge > 0 ? "home" : "away";

  const spreadSignal: SignalResult = {
    category: "NBA Four Factors",
    direction: absSpreadEdge < 0.5 ? "neutral" : spreadDir,
    magnitude: Math.round(spreadMag * 10) / 10,
    confidence: Math.min(0.9, 0.3 + absSpreadEdge * 0.1),
    label:
      absSpreadEdge < 0.5
        ? "Four Factors neutral"
        : `Four Factors favor ${spreadDir} by ${absSpreadEdge.toFixed(1)}pts (pred margin ${predictedMargin > 0 ? "+" : ""}${predictedMargin.toFixed(1)})`,
    strength: strengthFromMagnitude(spreadMag),
  };

  // ── O/U Signal ──
  const avgPace = (homeStats.pace + awayStats.pace) / 2;
  const paceAdjTotal = (avgPace * (homeStats.offRating + awayStats.offRating)) / 100;
  const ouEdge = paceAdjTotal - overUnder;
  const absOuEdge = Math.abs(ouEdge);

  const ouMag = Math.min(10, (absOuEdge / 5) * 7);
  const ouDir: "over" | "under" = ouEdge > 0 ? "over" : "under";

  const ouSignal: SignalResult = {
    category: "NBA Four Factors",
    direction: absOuEdge < 1 ? "neutral" : ouDir,
    magnitude: Math.round(ouMag * 10) / 10,
    confidence: Math.min(0.85, 0.25 + absOuEdge * 0.08),
    label:
      absOuEdge < 1
        ? "Pace-adjusted total near line"
        : `Pace-adjusted total ${paceAdjTotal.toFixed(1)} vs line ${overUnder} (${ouDir} ${absOuEdge.toFixed(1)})`,
    strength: strengthFromMagnitude(ouMag),
  };

  return { spreadSignal, ouSignal };
}
