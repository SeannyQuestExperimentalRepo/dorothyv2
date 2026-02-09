/**
 * ESPN API Client
 *
 * Fetches game schedules, scores, and odds from ESPN's unofficial API.
 * Covers NFL, NCAAF, and NCAAMB.
 *
 * Two endpoints used:
 * 1. Scoreboard — game schedules + completed scores (good for daily sync)
 * 2. Odds — upcoming games WITH DraftKings spreads/ML/totals (primary for sidebar)
 *
 * Key insight: The scoreboard and odds endpoints return DIFFERENT event IDs.
 * When both are needed, we merge by team abbreviation + date, not by ID.
 * For the sidebar (upcoming games with lines), the odds endpoint alone suffices.
 *
 * ESPN API is unofficial (no key needed) but has been stable for years.
 */

import { nflTeamNameMap } from "./team-name-mapping";
import { ncaafTeamNameMap } from "./ncaaf-team-name-mapping";
import { ncaambTeamNameMap } from "./ncaamb-team-name-mapping";
import { espnOverrides } from "./espn-team-mapping";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Sport = "NFL" | "NCAAF" | "NCAAMB";

export interface ESPNGame {
  espnId: string;
  date: string; // ISO string
  status: "scheduled" | "in_progress" | "final";
  statusDetail: string; // e.g., "Scheduled", "Final", "2nd Quarter"
  homeTeam: ESPNTeam;
  awayTeam: ESPNTeam;
  neutralSite: boolean;
  conferenceGame: boolean;
  /** Inline odds from scoreboard (available for today/yesterday's games) */
  inlineOdds?: {
    spread: number | null;
    overUnder: number | null;
  };
}

export interface ESPNTeam {
  espnId: string;
  displayName: string; // "Kansas City Chiefs"
  shortName: string; // "Kansas City" or "KC"
  abbreviation: string; // "KC"
  score: number | null;
  rank: number | null; // AP ranking (null = unranked). ESPN uses 99 for unranked.
}

export interface ESPNOdds {
  spread: number | null; // home perspective: negative = home favored
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  provider: string; // "DraftKings"
}

export interface ParsedGame extends ESPNGame {
  odds: ESPNOdds | null;
  homeCanonical: string | null;
  awayCanonical: string | null;
}

/** Lighter type for games from the odds endpoint (no scoreboard data needed) */
export interface UpcomingGameWithOdds {
  espnId: string;
  date: string;
  status: "scheduled" | "in_progress" | "final";
  statusDetail: string;
  homeTeam: ESPNTeam;
  awayTeam: ESPNTeam;
  odds: ESPNOdds;
  homeCanonical: string | null;
  awayCanonical: string | null;
}

// ─── ESPN URL Config ────────────────────────────────────────────────────────

const SCOREBOARD_URLS: Record<Sport, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAMB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
};

const ODDS_URLS: Record<Sport, string> = {
  NFL: "https://site.web.api.espn.com/apis/v3/sports/football/nfl/odds",
  NCAAF: "https://site.web.api.espn.com/apis/v3/sports/football/college-football/odds",
  NCAAMB: "https://site.web.api.espn.com/apis/v3/sports/basketball/mens-college-basketball/odds",
};

const FETCH_TIMEOUT = 10_000; // 10 seconds
const MAX_RETRIES = 3;

// ─── Fetch Helpers ──────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, retries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "TrendLine/1.0" },
      });
      if (!res.ok) {
        // Don't retry 4xx client errors (except 429 rate limit)
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(`ESPN API ${res.status}: ${res.statusText}`);
        }
        throw new Error(`ESPN API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry 4xx client errors (except 429)
      if (lastError.message.includes("ESPN API 4") && !lastError.message.includes("429")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(
          `[ESPN] Fetch attempt ${attempt + 1}/${retries} failed, retrying in ${delay}ms:`,
          lastError.message,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("ESPN API fetch failed after retries");
}

// ─── Scoreboard ─────────────────────────────────────────────────────────────

interface ESPNScoreboardResponse {
  events?: ESPNRawEvent[];
}

interface ESPNRawEvent {
  id: string;
  date: string;
  competitions: ESPNRawCompetition[];
}

interface ESPNRawCompetition {
  id: string;
  date: string;
  neutralSite?: boolean;
  conferenceCompetition?: boolean;
  status: {
    type: {
      completed: boolean;
      description: string;
      state: string; // "pre" | "in" | "post"
    };
  };
  competitors: ESPNRawCompetitor[];
  odds?: ESPNRawOddsInline[];
}

interface ESPNRawCompetitor {
  homeAway: "home" | "away";
  winner?: boolean;
  score?: string;
  team: {
    id: string;
    displayName: string;
    shortDisplayName: string;
    abbreviation: string;
  };
  curatedRank?: { current?: number }; // AP ranking: 1-25 = ranked, 99 = unranked
  record?: string;
  records?: Array<{ type: string; summary: string }>;
}

interface ESPNRawOddsInline {
  provider?: { name: string };
  details?: string; // e.g., "KC -3.5"
  overUnder?: number;
  spread?: number;
}

/**
 * Fetch the scoreboard for a sport. Returns parsed game events.
 * @param date Optional YYYY-MM-DD string. If omitted, returns today's games.
 */
export async function fetchScoreboard(
  sport: Sport,
  date?: string,
): Promise<ESPNGame[]> {
  let url = SCOREBOARD_URLS[sport];
  if (date) {
    const dateParam = date.replace(/-/g, "");
    url += `?dates=${dateParam}&limit=200`;
  } else {
    url += "?limit=200";
  }

  try {
    const data = await fetchJSON<ESPNScoreboardResponse>(url);
    if (!data.events) return [];

    return data.events.map((event) => parseEvent(event)).filter(Boolean) as ESPNGame[];
  } catch (err) {
    console.error(`[ESPN] Scoreboard fetch failed for ${sport}:`, err);
    return [];
  }
}

/** Extract AP ranking from ESPN curatedRank. Returns null for unranked (99) or missing. */
function parseRank(comp: ESPNRawCompetitor): number | null {
  const rank = comp.curatedRank?.current;
  if (rank == null || rank >= 99) return null; // 99 = unranked in ESPN
  return rank;
}

function parseEvent(event: ESPNRawEvent): ESPNGame | null {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const homeComp = comp.competitors.find((c) => c.homeAway === "home");
  const awayComp = comp.competitors.find((c) => c.homeAway === "away");
  if (!homeComp || !awayComp) return null;

  const stateMap: Record<string, ESPNGame["status"]> = {
    pre: "scheduled",
    in: "in_progress",
    post: "final",
  };

  return {
    espnId: event.id,
    date: event.date,
    status: stateMap[comp.status.type.state] ?? "scheduled",
    statusDetail: comp.status.type.description,
    neutralSite: comp.neutralSite ?? false,
    conferenceGame: comp.conferenceCompetition ?? false,
    homeTeam: {
      espnId: homeComp.team.id,
      displayName: homeComp.team.displayName,
      shortName: homeComp.team.shortDisplayName,
      abbreviation: homeComp.team.abbreviation,
      score: homeComp.score != null ? parseInt(homeComp.score, 10) : null,
      rank: parseRank(homeComp),
    },
    awayTeam: {
      espnId: awayComp.team.id,
      displayName: awayComp.team.displayName,
      shortName: awayComp.team.shortDisplayName,
      abbreviation: awayComp.team.abbreviation,
      score: awayComp.score != null ? parseInt(awayComp.score, 10) : null,
      rank: parseRank(awayComp),
    },
    // Extract inline odds from scoreboard (available for recent/today's games)
    inlineOdds: comp.odds?.[0]
      ? {
          spread: comp.odds[0].spread ?? null,
          overUnder: comp.odds[0].overUnder ?? null,
        }
      : undefined,
  };
}

// ─── Odds Endpoint (Primary source for sidebar) ────────────────────────────

interface ESPNOddsResponse {
  lines?: Array<{
    displayValue?: string;
    events?: ESPNOddsEvent[];
  }>;
}

interface ESPNOddsEvent {
  name?: string;
  shortName?: string;
  competitions: ESPNOddsCompetition[];
}

interface ESPNOddsCompetition {
  id: string;
  date: string;
  status: {
    type: {
      state: string;
      completed: boolean;
      description: string;
    };
  };
  competitors: ESPNRawCompetitor[];
  odds?: ESPNRawOddsDetailed[];
}

interface ESPNRawOddsDetailed {
  provider: { name: string };
  pointSpread?: {
    home?: { close?: { line?: string } };
    away?: { close?: { line?: string } };
  };
  total?: {
    over?: { close?: { line?: string } };
  };
  moneyline?: {
    home?: { close?: { odds?: string } };
    away?: { close?: { odds?: string } };
  };
}

/**
 * Fetch upcoming games with odds from ESPN's dedicated odds endpoint.
 *
 * This is the primary source for the sidebar — returns games with DraftKings
 * spreads, O/U, and moneylines. The odds endpoint includes team info, dates,
 * and status, so no scoreboard merge is needed.
 *
 * @param sport Sport to fetch
 * @param date Optional YYYYMMDD string (defaults to ESPN's default: today + upcoming)
 */
export async function fetchUpcomingWithOdds(
  sport: Sport,
  date?: string,
): Promise<UpcomingGameWithOdds[]> {
  let url = ODDS_URLS[sport];
  if (date) {
    const dateParam = date.replace(/-/g, "");
    url += `?dates=${dateParam}`;
  }

  try {
    const data = await fetchJSON<ESPNOddsResponse>(url);
    const events = data.lines?.[0]?.events ?? [];
    const results: UpcomingGameWithOdds[] = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeComp = comp.competitors.find((c) => c.homeAway === "home");
      const awayComp = comp.competitors.find((c) => c.homeAway === "away");
      if (!homeComp || !awayComp) continue;

      const rawOdds = comp.odds?.[0];
      if (!rawOdds) continue;

      const odds = parseDetailedOdds(rawOdds);
      if (!odds) continue;

      const stateMap: Record<string, ESPNGame["status"]> = {
        pre: "scheduled",
        in: "in_progress",
        post: "final",
      };

      const homeTeam: ESPNTeam = {
        espnId: homeComp.team.id,
        displayName: homeComp.team.displayName,
        shortName: homeComp.team.shortDisplayName,
        abbreviation: homeComp.team.abbreviation,
        score: homeComp.score != null ? parseInt(homeComp.score, 10) : null,
        rank: parseRank(homeComp), // odds endpoint often empty, but try anyway
      };

      const awayTeam: ESPNTeam = {
        espnId: awayComp.team.id,
        displayName: awayComp.team.displayName,
        shortName: awayComp.team.shortDisplayName,
        abbreviation: awayComp.team.abbreviation,
        score: awayComp.score != null ? parseInt(awayComp.score, 10) : null,
        rank: parseRank(awayComp),
      };

      results.push({
        espnId: comp.id,
        date: comp.date,
        status: stateMap[comp.status.type.state] ?? "scheduled",
        statusDetail: comp.status.type.description,
        homeTeam,
        awayTeam,
        odds,
        homeCanonical: mapTeamToCanonical(homeTeam, sport),
        awayCanonical: mapTeamToCanonical(awayTeam, sport),
      });
    }

    return results;
  } catch (err) {
    console.error(`[ESPN] Odds fetch failed for ${sport}:`, err);
    return [];
  }
}

function parseDetailedOdds(raw: ESPNRawOddsDetailed): ESPNOdds | null {
  // Spread: home perspective, e.g., "-3.5" or "+7.5"
  const spreadStr = raw.pointSpread?.home?.close?.line;
  const spread = spreadStr ? parseFloat(spreadStr) : null;

  // Over/Under: strip "o" prefix, e.g., "o145.5" → 145.5
  const totalStr = raw.total?.over?.close?.line;
  const overUnder = totalStr ? parseFloat(totalStr.replace(/^[ou]/i, "")) : null;

  // Moneylines: can be "OFF" or a number like "-180"
  const mlHomeStr = raw.moneyline?.home?.close?.odds;
  const mlAwayStr = raw.moneyline?.away?.close?.odds;
  const moneylineHome =
    mlHomeStr && mlHomeStr !== "OFF" ? parseInt(mlHomeStr, 10) : null;
  const moneylineAway =
    mlAwayStr && mlAwayStr !== "OFF" ? parseInt(mlAwayStr, 10) : null;

  return {
    spread: spread != null && !isNaN(spread) ? spread : null,
    overUnder: overUnder != null && !isNaN(overUnder) ? overUnder : null,
    moneylineHome:
      moneylineHome != null && !isNaN(moneylineHome) ? moneylineHome : null,
    moneylineAway:
      moneylineAway != null && !isNaN(moneylineAway) ? moneylineAway : null,
    provider: raw.provider?.name ?? "Unknown",
  };
}

// ─── Combined Fetch (scoreboard + odds merged by team) ─────────────────────

/**
 * Fetch scoreboard + odds for a sport, merging them by team abbreviation.
 *
 * Used for daily sync where we need scores (from scoreboard) and may also
 * want odds. For the sidebar, prefer `fetchUpcomingWithOdds()` instead.
 */
export async function fetchGamesWithOdds(
  sport: Sport,
  date?: string,
): Promise<ParsedGame[]> {
  // Fetch scoreboard and odds in parallel
  const dateParam = date?.replace(/-/g, "");
  const [games, oddsGames] = await Promise.all([
    fetchScoreboard(sport, date),
    fetchUpcomingWithOdds(sport, dateParam),
  ]);

  // Build a lookup from team matchup key → odds
  const oddsLookup = new Map<string, ESPNOdds>();
  for (const og of oddsGames) {
    const key = `${og.awayTeam.abbreviation}@${og.homeTeam.abbreviation}`;
    oddsLookup.set(key, og.odds);
  }

  return games.map((game) => {
    const key = `${game.awayTeam.abbreviation}@${game.homeTeam.abbreviation}`;
    return {
      ...game,
      odds: oddsLookup.get(key) ?? null,
      homeCanonical: mapTeamToCanonical(game.homeTeam, sport),
      awayCanonical: mapTeamToCanonical(game.awayTeam, sport),
    };
  });
}

// ─── Team Name Resolution ───────────────────────────────────────────────────

const TEAM_MAPS: Record<Sport, Record<string, string>> = {
  NFL: nflTeamNameMap,
  NCAAF: ncaafTeamNameMap,
  NCAAMB: ncaambTeamNameMap,
};

/**
 * Map an ESPN team name to a TrendLine canonical name.
 * Tries: ESPN overrides → displayName → shortName → abbreviation → without mascot
 */
export function mapTeamToCanonical(
  team: ESPNTeam,
  sport: Sport,
): string | null {
  const overrides = espnOverrides[sport] ?? {};
  const mapping = TEAM_MAPS[sport];

  // 1. Check ESPN-specific overrides first
  if (overrides[team.displayName]) return overrides[team.displayName];
  if (overrides[team.shortName]) return overrides[team.shortName];
  if (overrides[team.abbreviation]) return overrides[team.abbreviation];

  // 2. Try the main mapping (lowercase lookup)
  const candidates = [
    team.displayName,
    team.shortName,
    team.abbreviation,
    // Try without mascot: "Ohio State Buckeyes" → "Ohio State"
    team.displayName.replace(
      /\s+(Buckeyes|Wolverines|Tigers|Bulldogs|Eagles|Bears|Lions|Panthers|Rams|49ers|Giants|Jets|Cowboys|Saints|Falcons|Broncos|Chiefs|Colts|Texans|Jaguars|Titans|Ravens|Bengals|Browns|Steelers|Bills|Dolphins|Patriots|Commanders|Packers|Vikings|Seahawks|Cardinals|Chargers|Raiders|Buccaneers|Huskies|Wildcats|Warriors|Mountaineers|Spartans|Hoosiers|Hawkeyes|Cyclones|Jayhawks|Sooners|Longhorns|Aggies|Razorbacks|Volunteers|Commodores|Gators|Seminoles|Hurricanes|Cavaliers|Hokies|Tar Heels|Wolfpack|Blue Devils|Demon Deacons|Yellow Jackets|Crimson Tide|War Eagle|Rebels|Gamecocks|Boilermakers|Badgers|Cornhuskers|Golden Gophers|Fighting Illini|Nittany Lions|Terrapins|Scarlet Knights|Red Storm|Musketeers|Friars|Bluejays|Hoyas|Pirates|Golden Eagles|Gaels|Bonnies|Ramblers|Explorers|Billikens|Flyers|Hawks|Dukes|Rams|Owls|Cougars|Miners|Roadrunners|Blazers|Panthers|Salukis|Sycamores|Redbirds|Braves|Penguins|Leathernecks|Jaguars|Bison|Midshipmen|Red Flash|Golden Lions)$/i,
      "",
    ),
  ];

  for (const name of candidates) {
    const key = name.toLowerCase().trim();
    if (mapping[key]) return mapping[key];
  }

  // 3. Log unresolved for debugging
  console.warn(
    `[ESPN] Unresolved team: "${team.displayName}" (${team.abbreviation}) for ${sport}`,
  );
  return null;
}
