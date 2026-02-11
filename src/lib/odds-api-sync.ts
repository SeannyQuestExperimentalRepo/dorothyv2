/**
 * The Odds API ↔ Daily Cron Integration
 *
 * Two functions for the daily-sync pipeline:
 *
 * 1. supplementUpcomingGamesFromOddsApi() — called AFTER ESPN refresh, BEFORE
 *    syncCompletedGames(). Fills UpcomingGame table gaps so the completed-game
 *    sync finds odds for games ESPN didn't cover.
 *
 * 2. backfillYesterdayOdds() — called AFTER syncCompletedGames(). Patches
 *    NCAAMBGame rows from yesterday that still lack spreads, using the
 *    historical odds endpoint.
 */

import { prisma } from "./db";
import { fetchLiveOdds, type OddsGame } from "./odds-api";
import { resolveOddsApiName, normalize, matchOddsApiTeam } from "./odds-api-team-mapping";
import { calculateSpreadResult, calculateOUResult } from "./espn-sync";
import type { Sport } from "./espn-api";

// ─── Types ────────────────────────────────────────────────────────────────

export interface OddsApiSyncResult {
  sport: string;
  fetched: number;
  supplemented: number;
  enriched: number;
  skipped: number;
}

export interface BackfillResult {
  updated: number;
  notMatched: number;
  creditsRemaining: number | null;
}

// Historical API response types (snake_case from the API)
interface HistoricalOddsGame {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

// ─── Odds Extraction ────────────────────────────────────────────────────────

const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus", "bovada"];

/** Extract DraftKings-preferred spread and total from an OddsGame (live API, camelCase). */
function extractFromLiveGame(game: OddsGame): {
  spread: number | null;
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
} {
  let spread: number | null = null;
  let overUnder: number | null = null;
  let moneylineHome: number | null = null;
  let moneylineAway: number | null = null;

  for (const bookKey of PREFERRED_BOOKS) {
    const book = game.bookmakers.find((b) => b.key === bookKey);
    if (!book) continue;
    for (const market of book.markets) {
      if (market.key === "spreads" && spread === null) {
        const home = market.outcomes.find((o) => o.name === game.homeTeam);
        if (home?.point != null) spread = home.point;
      }
      if (market.key === "totals" && overUnder === null) {
        const over = market.outcomes.find((o) => o.name === "Over");
        if (over?.point != null) overUnder = over.point;
      }
      if (market.key === "h2h") {
        const home = market.outcomes.find((o) => o.name === game.homeTeam);
        const away = market.outcomes.find((o) => o.name === game.awayTeam);
        if (home && moneylineHome === null) moneylineHome = home.price;
        if (away && moneylineAway === null) moneylineAway = away.price;
      }
    }
    if (spread !== null && overUnder !== null) break;
  }

  // Fallback: any bookmaker
  if (spread === null || overUnder === null) {
    for (const book of game.bookmakers) {
      for (const market of book.markets) {
        if (market.key === "spreads" && spread === null) {
          const home = market.outcomes.find((o) => o.name === game.homeTeam);
          if (home?.point != null) spread = home.point;
        }
        if (market.key === "totals" && overUnder === null) {
          const over = market.outcomes.find((o) => o.name === "Over");
          if (over?.point != null) overUnder = over.point;
        }
      }
      if (spread !== null && overUnder !== null) break;
    }
  }

  return { spread, overUnder, moneylineHome, moneylineAway };
}

/** Extract DraftKings-preferred spread and total from a historical API game (snake_case). */
function extractFromHistoricalGame(game: HistoricalOddsGame): {
  spread: number | null;
  overUnder: number | null;
} {
  let spread: number | null = null;
  let overUnder: number | null = null;

  for (const bookKey of PREFERRED_BOOKS) {
    const book = game.bookmakers.find((b) => b.key === bookKey);
    if (!book) continue;
    for (const market of book.markets) {
      if (market.key === "spreads" && spread === null) {
        const home = market.outcomes.find(
          (o) => normalize(o.name) === normalize(game.home_team),
        );
        if (home?.point != null) spread = home.point;
      }
      if (market.key === "totals" && overUnder === null) {
        const over = market.outcomes.find((o) => o.name === "Over");
        if (over?.point != null) overUnder = over.point;
      }
    }
    if (spread !== null && overUnder !== null) break;
  }

  // Fallback: any bookmaker
  if (spread === null || overUnder === null) {
    for (const book of game.bookmakers) {
      for (const market of book.markets) {
        if (market.key === "spreads" && spread === null) {
          const home = market.outcomes.find(
            (o) => normalize(o.name) === normalize(game.home_team),
          );
          if (home?.point != null) spread = home.point;
        }
        if (market.key === "totals" && overUnder === null) {
          const over = market.outcomes.find((o) => o.name === "Over");
          if (over?.point != null) overUnder = over.point;
        }
      }
      if (spread !== null && overUnder !== null) break;
    }
  }

  return { spread, overUnder };
}

// ─── 1. Supplement Upcoming Games ───────────────────────────────────────────

/**
 * Supplement the UpcomingGame table with Odds API data for games ESPN missed.
 *
 * Called in the daily cron AFTER refreshUpcomingGames() and BEFORE
 * syncCompletedGames(). Never overwrites existing ESPN odds.
 */
export async function supplementUpcomingGamesFromOddsApi(
  sport: Sport = "NCAAMB",
): Promise<OddsApiSyncResult> {
  const result: OddsApiSyncResult = { sport, fetched: 0, supplemented: 0, enriched: 0, skipped: 0 };

  // Guard: skip if no API key
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    console.log("[OddsAPI Sync] THE_ODDS_API_KEY not configured, skipping");
    return result;
  }

  let oddsGames: OddsGame[];
  try {
    oddsGames = await fetchLiveOdds(sport);
  } catch (err) {
    console.error("[OddsAPI Sync] Failed to fetch live odds:", err);
    return result;
  }

  result.fetched = oddsGames.length;
  if (oddsGames.length === 0) return result;

  // Load existing UpcomingGame records for today + tomorrow
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const existing = await prisma.upcomingGame.findMany({
    where: {
      sport,
      gameDate: { gte: new Date(todayStr), lte: dayAfterTomorrow },
    },
  });

  // Index by homeTeam|awayTeam|date for fast lookup
  const existingMap = new Map<string, (typeof existing)[0]>();
  for (const g of existing) {
    const dateKey = g.gameDate.toISOString().split("T")[0];
    existingMap.set(`${g.homeTeam}|${g.awayTeam}|${dateKey}`, g);
  }

  for (const game of oddsGames) {
    // Resolve Odds API names → canonical
    const homeCanonical = resolveOddsApiName(game.homeTeam);
    const awayCanonical = resolveOddsApiName(game.awayTeam);

    const gameDate = new Date(game.commenceTime);
    const dateKey = gameDate.toISOString().split("T")[0];
    const lookupKey = `${homeCanonical}|${awayCanonical}|${dateKey}`;

    const odds = extractFromLiveGame(game);
    if (odds.spread === null && odds.overUnder === null) {
      result.skipped++;
      continue;
    }

    const existingGame = existingMap.get(lookupKey);

    if (!existingGame) {
      // ESPN missed this game — add it
      try {
        await prisma.upcomingGame.upsert({
          where: {
            sport_gameDate_homeTeam_awayTeam: {
              sport,
              gameDate,
              homeTeam: homeCanonical,
              awayTeam: awayCanonical,
            },
          },
          create: {
            sport,
            gameDate,
            homeTeam: homeCanonical,
            awayTeam: awayCanonical,
            spread: odds.spread,
            overUnder: odds.overUnder,
            moneylineHome: odds.moneylineHome,
            moneylineAway: odds.moneylineAway,
          },
          update: {
            spread: odds.spread,
            overUnder: odds.overUnder,
            moneylineHome: odds.moneylineHome,
            moneylineAway: odds.moneylineAway,
          },
        });
        result.supplemented++;
      } catch (err) {
        console.warn(`[OddsAPI Sync] Upsert failed for ${awayCanonical} @ ${homeCanonical}:`, err);
        result.skipped++;
      }
    } else if (existingGame.spread === null || existingGame.overUnder === null) {
      // ESPN has the game but missing odds — enrich
      try {
        await prisma.upcomingGame.update({
          where: { id: existingGame.id },
          data: {
            spread: existingGame.spread ?? odds.spread,
            overUnder: existingGame.overUnder ?? odds.overUnder,
            moneylineHome: existingGame.moneylineHome ?? odds.moneylineHome,
            moneylineAway: existingGame.moneylineAway ?? odds.moneylineAway,
          },
        });
        result.enriched++;
      } catch (err) {
        console.warn(`[OddsAPI Sync] Enrich failed for ${awayCanonical} @ ${homeCanonical}:`, err);
        result.skipped++;
      }
    }
    // else: ESPN already has odds, skip (ESPN DraftKings closing lines preferred)
  }

  console.log(
    `[OddsAPI Sync] ${sport}: fetched=${result.fetched}, supplemented=${result.supplemented}, enriched=${result.enriched}, skipped=${result.skipped}`,
  );

  return result;
}

// ─── 2. Backfill Yesterday's Completed Games ────────────────────────────────

/**
 * Backfill yesterday's NCAAMB games that completed without odds.
 * Uses The Odds API historical endpoint. Costs 20 credits per call.
 *
 * Only runs during the morning cron (before 10 AM ET) to avoid
 * double-spending credits on the midday run.
 */
export async function backfillYesterdayOdds(): Promise<BackfillResult> {
  const result: BackfillResult = { updated: 0, notMatched: 0, creditsRemaining: null };

  // Only run in morning window (before 10 AM ET)
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  if (etHour >= 10) {
    console.log("[OddsAPI Backfill] Skipping — only runs before 10 AM ET");
    return result;
  }

  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    console.log("[OddsAPI Backfill] THE_ODDS_API_KEY not configured, skipping");
    return result;
  }

  // Find yesterday's completed games missing spreads
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const startOfDay = new Date(yesterdayStr + "T00:00:00Z");
  const endOfDay = new Date(yesterdayStr + "T23:59:59Z");

  const gamesNeedingOdds = await prisma.nCAAMBGame.findMany({
    where: {
      gameDate: { gte: startOfDay, lte: endOfDay },
      spread: null,
      homeScore: { not: null },
    },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (gamesNeedingOdds.length === 0) {
    console.log("[OddsAPI Backfill] No games from yesterday need odds");
    return result;
  }

  console.log(`[OddsAPI Backfill] ${gamesNeedingOdds.length} games from ${yesterdayStr} need odds`);

  // Fetch historical odds for yesterday
  const sportKey = "basketball_ncaab";
  const url = `https://api.the-odds-api.com/v4/historical/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals&date=${yesterdayStr}T12:00:00Z`;

  let oddsGames: HistoricalOddsGame[];
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.error(`[OddsAPI Backfill] Historical fetch failed: ${res.status} ${text}`);
      return result;
    }

    const remaining = res.headers.get("x-requests-remaining");
    if (remaining) {
      result.creditsRemaining = parseInt(remaining, 10);
      console.log(`[OddsAPI Backfill] Credits remaining: ${remaining}`);
    }

    const data = await res.json();
    oddsGames = data.data ?? data ?? [];
  } catch (err) {
    console.error("[OddsAPI Backfill] Fetch error:", err);
    return result;
  }

  if (oddsGames.length === 0) {
    console.log("[OddsAPI Backfill] No historical odds available for this date");
    return result;
  }

  // Filter to only games whose commence_time matches yesterday
  // (historical endpoint returns a snapshot of ALL upcoming games at that timestamp)
  const filteredGames = oddsGames.filter(
    (g) => g.commence_time?.startsWith(yesterdayStr),
  );

  console.log(`[OddsAPI Backfill] API returned ${oddsGames.length} games, ${filteredGames.length} on ${yesterdayStr}`);

  if (filteredGames.length === 0) {
    console.log("[OddsAPI Backfill] No games matched yesterday's date in snapshot");
    return result;
  }

  // Match and update
  for (const dbGame of gamesNeedingOdds) {
    const home = dbGame.homeTeam.name;
    const away = dbGame.awayTeam.name;

    const match = filteredGames.find(
      (og) =>
        matchOddsApiTeam(og.home_team, home) &&
        matchOddsApiTeam(og.away_team, away),
    );

    if (!match) {
      result.notMatched++;
      continue;
    }

    const odds = extractFromHistoricalGame(match);
    if (odds.spread === null && odds.overUnder === null) {
      result.notMatched++;
      continue;
    }

    const spreadResult = calculateSpreadResult(dbGame.homeScore!, dbGame.awayScore!, odds.spread);
    const ouResult = calculateOUResult(dbGame.homeScore!, dbGame.awayScore!, odds.overUnder);

    try {
      await prisma.nCAAMBGame.update({
        where: { id: dbGame.id },
        data: {
          spread: odds.spread,
          overUnder: odds.overUnder,
          spreadResult,
          ouResult,
        },
      });
      result.updated++;
    } catch (err) {
      console.warn(`[OddsAPI Backfill] Update failed for ${away} @ ${home}:`, err);
      result.notMatched++;
    }
  }

  console.log(
    `[OddsAPI Backfill] Updated ${result.updated}/${gamesNeedingOdds.length} games, ${result.notMatched} not matched`,
  );

  return result;
}
