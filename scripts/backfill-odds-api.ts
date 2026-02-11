/**
 * Backfill NCAAMB spread & O/U data using The Odds API.
 *
 * The Odds API pricing:
 *   - Free tier: 500 credits/month
 *   - Historical odds endpoint: 10 credits per market per region
 *   - With markets=spreads,totals (2) and regions=us (1) → 20 credits/request
 *   - One request returns ALL games for that sport on the given date snapshot
 *   - Empty responses don't cost credits
 *
 * Credit budget:
 *   - Free tier: 500 ÷ 20 = 25 date lookups/month
 *   - $30/month plan: 20,000 ÷ 20 = 1,000 date lookups/month
 *
 * This script:
 *   1. Finds NCAAMB 2026 games with scores but NO spread/O-U data
 *   2. Groups by date and prioritizes dates with the MOST unmatched games
 *   3. Queries The Odds API historical endpoint for each date
 *   4. Matches games by team name and updates the DB with closing odds
 *
 * Usage:
 *   npx tsx scripts/backfill-odds-api.ts [--limit N] [--dry-run]
 *
 * Sign up: https://the-odds-api.com (free tier, 500 credits/month)
 */

import { PrismaClient, SpreadResult, OUResult } from "@prisma/client";
import {
  normalize,
  matchOddsApiTeam,
} from "../src/lib/odds-api-team-mapping";

const prisma = new PrismaClient();

function calculateSpreadResult(
  homeScore: number,
  awayScore: number,
  spread: number | null,
): SpreadResult | null {
  if (spread == null) return null;
  const margin = homeScore - awayScore + spread;
  if (margin > 0) return SpreadResult.COVERED;
  if (margin < 0) return SpreadResult.LOST;
  return SpreadResult.PUSH;
}

function calculateOUResult(
  homeScore: number,
  awayScore: number,
  overUnder: number | null,
): OUResult | null {
  if (overUnder == null) return null;
  const total = homeScore + awayScore;
  if (total > overUnder) return OUResult.OVER;
  if (total < overUnder) return OUResult.UNDER;
  return OUResult.PUSH;
}

const API_KEY = process.env.THE_ODDS_API_KEY ?? process.env.ODDS_API_KEY;
if (!API_KEY) {
  console.error("Error: THE_ODDS_API_KEY environment variable required");
  console.error("Sign up at https://the-odds-api.com (free tier available)");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = (() => {
  const idx = args.indexOf("--limit");
  return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1], 10) : 25; // Default: max for free tier
})();

const BASE_URL = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "basketball_ncaab";
const REGIONS = "us";
const MARKETS = "spreads,totals";

// ─── Types ─────────────────────────────────────────────────────────────────

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

// Team name matching imported from shared module
const matchSingleTeam = matchOddsApiTeam;

// ─── Odds API ──────────────────────────────────────────────────────────────

/**
 * Fetch historical odds for a specific date from The Odds API.
 * One request returns all NCAAMB games for that date.
 *
 * Cost: 10 credits per market per region per request.
 * With markets=spreads,totals and regions=us → 20 credits/request.
 */
async function fetchHistoricalOdds(
  dateISO: string,
): Promise<{
  games: OddsAPIGame[];
  creditsUsed: number;
  creditsRemaining: number;
}> {
  const url = `${BASE_URL}/historical/sports/${SPORT_KEY}/odds/?apiKey=${API_KEY}&regions=${REGIONS}&markets=${MARKETS}&date=${dateISO}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API error ${res.status}: ${body}`);
  }

  const creditsUsed = parseInt(
    res.headers.get("x-requests-used") ?? "0",
    10,
  );
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
 * Extract the consensus spread and total from bookmakers.
 * Prefers DraftKings, then FanDuel, then BetMGM, then any book.
 */
function extractOdds(
  game: OddsAPIGame,
): { spread: number | null; overUnder: number | null } {
  const preferredBooks = [
    "draftkings",
    "fanduel",
    "betmgm",
    "pointsbetus",
    "bovada",
  ];
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
          const overOutcome = market.outcomes.find(
            (o) => o.name === "Over",
          );
          if (overOutcome?.point != null) overUnder = overOutcome.point;
        }
      }
      if (spread !== null && overUnder !== null) break;
    }
  }

  return { spread, overUnder };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Backfill NCAAMB Odds (The Odds API) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT} API requests (${LIMIT * 20} credits)\n`);

  // 1. Find games needing odds, grouped by date
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
  });

  console.log(`Found ${gamesNeedingOdds.length} games needing spread/O-U data`);

  if (gamesNeedingOdds.length === 0) {
    console.log("Nothing to backfill!");
    return;
  }

  // 2. Group by date and sort by count DESC (most games first = best ROI per credit)
  const byDate = new Map<string, typeof gamesNeedingOdds>();
  for (const game of gamesNeedingOdds) {
    if (!game.gameDate) continue;
    const dateKey = game.gameDate.toISOString().split("T")[0];
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(game);
  }

  const sortedDates = [...byDate.entries()]
    .sort((a, b) => b[1].length - a[1].length) // Most unmatched games first
    .map(([date]) => date);

  console.log(`Grouped into ${sortedDates.length} unique dates`);
  console.log(
    `Top 5 dates: ${sortedDates
      .slice(0, 5)
      .map((d) => `${d} (${byDate.get(d)!.length} games)`)
      .join(", ")}`,
  );
  console.log(`Will process up to ${LIMIT} dates\n`);

  // 3. Process dates
  let requestsMade = 0;
  let gamesUpdated = 0;
  let gamesNotMatched = 0;
  let creditsRemaining = 0;

  for (const dateStr of sortedDates) {
    if (requestsMade >= LIMIT) {
      console.log(`\nReached limit of ${LIMIT} API requests. Stopping.`);
      break;
    }

    const dbGames = byDate.get(dateStr)!;
    console.log(`\n--- ${dateStr} (${dbGames.length} games needing odds) ---`);

    // Snapshot at noon UTC (7 AM ET) — before most games start, maximizes coverage
    const apiDate = `${dateStr}T12:00:00Z`;

    try {
      const {
        games: oddsGames,
        creditsUsed,
        creditsRemaining: remaining,
      } = await fetchHistoricalOdds(apiDate);
      requestsMade++;
      creditsRemaining = remaining;

      console.log(
        `  API returned ${oddsGames.length} games | Credits used: ${creditsUsed}, remaining: ${remaining}`,
      );

      // Filter to only games whose commence_time matches the target date
      // (historical endpoint returns a snapshot of ALL upcoming games at that timestamp)
      const filteredGames = oddsGames.filter(
        (g) => g.commence_time?.startsWith(dateStr),
      );

      console.log(
        `  Filtered to ${filteredGames.length}/${oddsGames.length} games on ${dateStr}`,
      );

      if (filteredGames.length === 0) {
        console.log(`  (no NCAAB games on this date in snapshot)`);
        for (const _ of dbGames) gamesNotMatched++;
        await sleep(500);
        continue;
      }

      // Log sample team names from API for debugging
      if (requestsMade === 1) {
        console.log(
          `  Sample API names: ${filteredGames
            .slice(0, 3)
            .map((g) => `"${g.home_team}" vs "${g.away_team}"`)
            .join(", ")}`,
        );
      }

      // 4. Match and update
      let dayMatched = 0;
      for (const dbGame of dbGames) {
        const home = dbGame.homeTeam.name;
        const away = dbGame.awayTeam.name;

        // Find matching odds game — both teams must match
        const match = filteredGames.find(
          (og) =>
            matchSingleTeam(og.home_team, home) &&
            matchSingleTeam(og.away_team, away),
        );

        if (!match) {
          gamesNotMatched++;
          continue;
        }

        const odds = extractOdds(match);
        if (odds.spread === null && odds.overUnder === null) {
          gamesNotMatched++;
          continue;
        }

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
        dayMatched++;
      }

      console.log(
        `  → Matched ${dayMatched}/${dbGames.length} games on this date`,
      );

      // Rate limit: ~1 request per second
      await sleep(1200);
    } catch (err) {
      console.error(`  ERROR for ${dateStr}:`, err);
      if (
        String(err).includes("401") ||
        String(err).includes("403") ||
        String(err).includes("429")
      ) {
        console.error(
          "  API key invalid, insufficient credits, or rate limited. Stopping.",
        );
        break;
      }
      // For other errors, continue to next date
      await sleep(2000);
    }
  }

  console.log(`\n=== Complete ===`);
  console.log(`API requests made: ${requestsMade} (${requestsMade * 20} credits used)`);
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
