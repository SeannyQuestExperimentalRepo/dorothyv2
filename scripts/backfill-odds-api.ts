/**
 * Backfill NCAAMB spread & O/U data using The Odds API (free tier).
 *
 * The Odds API free tier: 500 credits/month
 *   - Historical odds endpoint: 10 credits per region per market
 *   - 3 markets (spreads, totals, h2h) × 1 region (US) = 30 credits per request
 *   - 500 credits ÷ 30 = ~16 game lookups per month on free tier
 *
 * This script:
 *   1. Finds NCAAMB 2026 games that have scores but NO spread/O-U data
 *   2. Queries The Odds API historical endpoint for each game date
 *   3. Matches games by team name and updates the DB with closing odds
 *
 * Usage:
 *   ODDS_API_KEY=xxx npx tsx scripts/backfill-odds-api.ts [--limit N] [--dry-run]
 *
 * Sign up: https://the-odds-api.com (free tier, 500 credits/month)
 */

import { prisma } from "../src/lib/db";
import {
  calculateSpreadResult,
  calculateOUResult,
} from "../src/lib/espn-sync";

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) {
  console.error("Error: ODDS_API_KEY environment variable required");
  console.error("Sign up at https://the-odds-api.com (free tier available)");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = (() => {
  const idx = args.indexOf("--limit");
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 16; // Conservative default for free tier
})();

const BASE_URL = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "basketball_ncaab";
const REGIONS = "us";
const MARKETS = "spreads,totals";

interface OddsAPIGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string; // "spreads" | "totals" | "h2h"
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch historical odds for a specific date from The Odds API.
 * Returns odds data as of just before the game time.
 *
 * Cost: 10 credits per market per region per request.
 * With markets=spreads,totals and regions=us → 20 credits/request.
 */
async function fetchHistoricalOdds(
  dateISO: string,
): Promise<{ games: OddsAPIGame[]; creditsUsed: number; creditsRemaining: number }> {
  const url = `${BASE_URL}/historical/sports/${SPORT_KEY}/odds/?apiKey=${API_KEY}&regions=${REGIONS}&markets=${MARKETS}&date=${dateISO}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API error ${res.status}: ${body}`);
  }

  const creditsUsed = parseInt(res.headers.get("x-requests-used") ?? "0", 10);
  const creditsRemaining = parseInt(
    res.headers.get("x-requests-remaining") ?? "0",
    10,
  );

  const data = await res.json();
  // Historical endpoint wraps in { data: [...], timestamp: ... }
  const games: OddsAPIGame[] = data.data ?? data ?? [];

  return { games, creditsUsed, creditsRemaining };
}

/**
 * Normalize team names for fuzzy matching between The Odds API and our DB.
 * The Odds API uses full names like "North Carolina State Wolfpack" or "NC State Wolfpack".
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Try to match an Odds API team name to our canonical team name */
function matchTeamName(oddsName: string, dbHome: string, dbAway: string): boolean {
  const n = normalize(oddsName);
  const h = normalize(dbHome);
  const a = normalize(dbAway);

  // Direct match
  if (n === h || n === a) return true;

  // Partial match — Odds API names often include mascots
  if (n.includes(h) || h.includes(n)) return true;
  if (n.includes(a) || a.includes(n)) return true;

  return false;
}

/**
 * Extract the consensus spread and total from bookmakers.
 * Prefers DraftKings, then FanDuel, then any US book.
 */
function extractOdds(
  game: OddsAPIGame,
): { spread: number | null; overUnder: number | null } {
  const preferredBooks = ["draftkings", "fanduel", "betmgm", "pointsbetus"];
  let spread: number | null = null;
  let overUnder: number | null = null;

  // Try preferred books in order
  for (const bookKey of preferredBooks) {
    const book = game.bookmakers.find((b) => b.key === bookKey);
    if (!book) continue;

    for (const market of book.markets) {
      if (market.key === "spreads" && spread === null) {
        // Find home team spread
        const homeOutcome = market.outcomes.find(
          (o) => normalize(o.name) === normalize(game.home_team),
        );
        if (homeOutcome?.point != null) {
          spread = homeOutcome.point;
        }
      }
      if (market.key === "totals" && overUnder === null) {
        const overOutcome = market.outcomes.find((o) => o.name === "Over");
        if (overOutcome?.point != null) {
          overUnder = overOutcome.point;
        }
      }
    }

    if (spread !== null && overUnder !== null) break;
  }

  // Fallback to first available book
  if (spread === null || overUnder === null) {
    for (const book of game.bookmakers) {
      for (const market of book.markets) {
        if (market.key === "spreads" && spread === null) {
          const homeOutcome = market.outcomes.find(
            (o) => normalize(o.name) === normalize(game.home_team),
          );
          if (homeOutcome?.point != null) spread = homeOutcome.point;
        }
        if (market.key === "totals" && overUnder === null) {
          const overOutcome = market.outcomes.find((o) => o.name === "Over");
          if (overOutcome?.point != null) overUnder = overOutcome.point;
        }
      }
      if (spread !== null && overUnder !== null) break;
    }
  }

  return { spread, overUnder };
}

async function main() {
  console.log(`\n=== Backfill NCAAMB Odds (The Odds API) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT} API requests\n`);

  // 1. Find NCAAMB 2026 games missing spread data, grouped by date
  const gamesNeedingOdds = await prisma.nCAAMBGame.findMany({
    where: {
      season: 2026,
      spread: null,
      homeScore: { not: null },
      awayScore: { not: null },
    },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: { gameDate: "desc" }, // Most recent first
  });

  console.log(
    `Found ${gamesNeedingOdds.length} games needing spread/O-U data\n`,
  );

  if (gamesNeedingOdds.length === 0) {
    console.log("Nothing to backfill!");
    return;
  }

  // Group by date for batch API requests
  const byDate = new Map<string, typeof gamesNeedingOdds>();
  for (const game of gamesNeedingOdds) {
    if (!game.gameDate) continue;
    const dateKey = game.gameDate.toISOString().split("T")[0];
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(game);
  }

  console.log(`Grouped into ${byDate.size} unique dates`);
  console.log(`Will process up to ${LIMIT} dates\n`);

  // 2. Process dates
  let requestsMade = 0;
  let gamesUpdated = 0;
  let gamesNotMatched = 0;
  let creditsRemaining = 0;

  const sortedDates = [...byDate.keys()].sort().reverse(); // Most recent first

  for (const dateStr of sortedDates) {
    if (requestsMade >= LIMIT) {
      console.log(`\nReached limit of ${LIMIT} API requests. Stopping.`);
      break;
    }

    const dbGames = byDate.get(dateStr)!;
    console.log(`\n--- ${dateStr} (${dbGames.length} games) ---`);

    // Format date for API: ISO 8601 at noon UTC
    const apiDate = `${dateStr}T12:00:00Z`;

    try {
      const { games: oddsGames, creditsUsed, creditsRemaining: remaining } =
        await fetchHistoricalOdds(apiDate);
      requestsMade++;
      creditsRemaining = remaining;

      console.log(
        `  API: ${oddsGames.length} games returned | Credits used: ${creditsUsed}, remaining: ${remaining}`,
      );

      // 3. Match and update
      for (const dbGame of dbGames) {
        const home = dbGame.homeTeam.name;
        const away = dbGame.awayTeam.name;

        // Find matching odds game
        const match = oddsGames.find((og) => {
          const homeMatch =
            matchTeamName(og.home_team, home, "") &&
            matchTeamName(og.away_team, away, "");
          const awayMatch =
            matchTeamName(og.away_team, away, "") &&
            matchTeamName(og.home_team, home, "");
          return homeMatch || awayMatch;
        });

        if (!match) {
          gamesNotMatched++;
          continue;
        }

        const odds = extractOdds(match);
        if (odds.spread === null && odds.overUnder === null) {
          gamesNotMatched++;
          continue;
        }

        // Calculate results
        const spreadResult = calculateSpreadResult(
          dbGame.homeScore!,
          dbGame.awayScore!,
          odds.spread,
        );
        const ouResult = calculateOUResult(
          dbGame.homeScore!,
          dbGame.awayScore!,
          odds.overUnder,
        );

        if (DRY_RUN) {
          console.log(
            `  [DRY] ${away} @ ${home}: spread=${odds.spread}, O/U=${odds.overUnder} → ${spreadResult}/${ouResult}`,
          );
        } else {
          await prisma.nCAAMBGame.update({
            where: { id: dbGame.id },
            data: {
              spread: odds.spread,
              overUnder: odds.overUnder,
              spreadResult,
              ouResult,
            },
          });
          console.log(
            `  [OK] ${away} @ ${home}: spread=${odds.spread}, O/U=${odds.overUnder}`,
          );
        }
        gamesUpdated++;
      }

      // Rate limit: 1 request per second
      await sleep(1200);
    } catch (err) {
      console.error(`  ERROR for ${dateStr}:`, err);
      // Check if we're out of credits
      if (String(err).includes("401") || String(err).includes("429")) {
        console.error("  API key invalid or rate limited. Stopping.");
        break;
      }
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`API requests made: ${requestsMade}`);
  console.log(`Games updated: ${gamesUpdated}`);
  console.log(`Games not matched: ${gamesNotMatched}`);
  console.log(`Credits remaining: ${creditsRemaining}`);
  console.log(
    `Games still needing data: ${gamesNeedingOdds.length - gamesUpdated}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
