/**
 * The Odds API client — fetches live odds from multiple sportsbooks.
 *
 * Endpoints used:
 *   GET /v4/sports/{sport}/odds — Live odds for upcoming games
 *
 * Pricing:
 *   - 10 credits per market per region per request
 *   - markets=spreads,totals → 20 credits/request
 *   - Free tier: 500 credits/month ≈ 25 requests/month
 */

import { config } from "./config";

const BASE_URL = "https://api.the-odds-api.com/v4";

// Sport key mapping: our enum → The Odds API sport keys
const SPORT_KEY_MAP: Record<string, string> = {
  NFL: "americanfootball_nfl",
  NCAAF: "americanfootball_ncaaf",
  NCAAMB: "basketball_ncaab",
};

// Preferred sportsbook order for "best line" extraction
const BOOK_PRIORITY = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "espnbet",
  "pointsbetus",
  "bovada",
];

// ─── Types ────────────────────────────────────────────────────────────────

export interface OddsOutcome {
  name: string;
  price: number;   // American odds (e.g., -110, +150)
  point?: number;   // Spread or total value
}

export interface OddsMarket {
  key: string;       // "spreads" | "totals" | "h2h"
  outcomes: OddsOutcome[];
}

export interface BookmakerOdds {
  key: string;       // e.g., "draftkings"
  title: string;     // e.g., "DraftKings"
  markets: OddsMarket[];
}

export interface OddsGame {
  id: string;
  sportKey: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: BookmakerOdds[];
}

export interface ParsedOdds {
  book: string;
  bookTitle: string;
  spread: number | null;
  spreadOdds: number | null;
  total: number | null;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  homeML: number | null;
  awayML: number | null;
}

export interface GameOddsSnapshot {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  books: ParsedOdds[];
  bestSpread: { value: number; book: string; odds: number } | null;
  bestTotal: { value: number; book: string } | null;
}

// ─── API Functions ────────────────────────────────────────────────────────

/**
 * Fetch live odds for a sport. Returns raw API response transformed to our types.
 * Costs ~20 credits per call (spreads + totals, US region).
 */
export async function fetchLiveOdds(sport: string): Promise<OddsGame[]> {
  const apiKey = config.oddsApiKey;
  if (!apiKey) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const sportKey = SPORT_KEY_MAP[sport];
  if (!sportKey) {
    throw new Error(`Unknown sport: ${sport}`);
  }

  const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odds API error ${res.status}: ${text}`);
  }

  // Log remaining credits from response headers
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  if (remaining) {
    console.log(`[OddsAPI] Credits remaining: ${remaining}, used: ${used}`);
  }

  const data = await res.json();

  return (data as Array<Record<string, unknown>>).map((g) => ({
    id: g.id as string,
    sportKey: g.sport_key as string,
    commenceTime: g.commence_time as string,
    homeTeam: g.home_team as string,
    awayTeam: g.away_team as string,
    bookmakers: (g.bookmakers as Array<Record<string, unknown>>).map((b) => ({
      key: b.key as string,
      title: b.title as string,
      markets: (b.markets as Array<Record<string, unknown>>).map((m) => ({
        key: m.key as string,
        outcomes: m.outcomes as OddsOutcome[],
      })),
    })),
  }));
}

/**
 * Parse a single game's odds from all bookmakers into a structured snapshot.
 */
export function parseGameOdds(game: OddsGame): GameOddsSnapshot {
  const books: ParsedOdds[] = [];

  for (const bm of game.bookmakers) {
    const parsed: ParsedOdds = {
      book: bm.key,
      bookTitle: bm.title,
      spread: null,
      spreadOdds: null,
      total: null,
      totalOverOdds: null,
      totalUnderOdds: null,
      homeML: null,
      awayML: null,
    };

    for (const market of bm.markets) {
      if (market.key === "spreads") {
        const homeOutcome = market.outcomes.find(
          (o) => o.name === game.homeTeam,
        );
        if (homeOutcome) {
          parsed.spread = homeOutcome.point ?? null;
          parsed.spreadOdds = homeOutcome.price;
        }
      } else if (market.key === "totals") {
        const over = market.outcomes.find((o) => o.name === "Over");
        const under = market.outcomes.find((o) => o.name === "Under");
        if (over) {
          parsed.total = over.point ?? null;
          parsed.totalOverOdds = over.price;
        }
        if (under) {
          parsed.totalUnderOdds = under.price;
        }
      } else if (market.key === "h2h") {
        const home = market.outcomes.find((o) => o.name === game.homeTeam);
        const away = market.outcomes.find((o) => o.name === game.awayTeam);
        if (home) parsed.homeML = home.price;
        if (away) parsed.awayML = away.price;
      }
    }

    books.push(parsed);
  }

  // Sort by book priority
  books.sort((a, b) => {
    const ai = BOOK_PRIORITY.indexOf(a.book);
    const bi = BOOK_PRIORITY.indexOf(b.book);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Find best spread (most favorable for home, i.e., highest number)
  let bestSpread: GameOddsSnapshot["bestSpread"] = null;
  for (const b of books) {
    if (b.spread !== null && b.spreadOdds !== null) {
      if (!bestSpread || b.spread > bestSpread.value) {
        bestSpread = { value: b.spread, book: b.bookTitle, odds: b.spreadOdds };
      }
    }
  }

  // Find best total (consensus — most common value)
  const totalCounts = new Map<number, string>();
  for (const b of books) {
    if (b.total !== null && !totalCounts.has(b.total)) {
      totalCounts.set(b.total, b.bookTitle);
    }
  }
  const bestTotal = totalCounts.size > 0
    ? { value: Array.from(totalCounts.keys())[0], book: Array.from(totalCounts.values())[0] }
    : null;

  return {
    gameId: game.id,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: game.commenceTime,
    books,
    bestSpread,
    bestTotal,
  };
}

/**
 * Fetch and parse all odds for a sport. Returns structured snapshots per game.
 */
export async function getOddsSnapshots(
  sport: string,
): Promise<GameOddsSnapshot[]> {
  const games = await fetchLiveOdds(sport);
  return games.map(parseGameOdds);
}
