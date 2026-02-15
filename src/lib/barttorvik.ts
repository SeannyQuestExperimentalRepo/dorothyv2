import "server-only";

/**
 * Barttorvik T-Rank scraper with in-memory caching.
 *
 * Uses Puppeteer headless browser to bypass Barttorvik's JS verification gate.
 * Scrapes team efficiency ratings for NCAAMB ensemble modeling (blended with KenPom).
 *
 * Cache TTL: 6 hours.
 */

import puppeteer from "puppeteer";
import { prisma } from "./db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BarttovikRating {
  rank: number;
  teamName: string;
  conference: string;
  rating: number;
  adjOE: number;
  adjDE: number;
  barthag: number;
  adjTempo: number;
  luck: number;
  sos: number;
  wins: number;
  losses: number;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const RATINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ratingsCacheBySeason = new Map<number, CacheEntry<Map<string, BarttovikRating>>>();

export function clearBarttovikCache(): void {
  ratingsCacheBySeason.clear();
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all T-Rank team ratings for the given season.
 * Returns a Map keyed by team name.
 * Cached for 6 hours.
 */
export async function getBarttovikRatings(
  season?: number,
): Promise<Map<string, BarttovikRating>> {
  const y = season ?? getCurrentBarttovikSeason();
  const now = Date.now();

  const cached = ratingsCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) {
    return cached.data;
  }

  const url = `https://barttorvik.com/trank.php?year=${y}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("table tbody tr", { timeout: 15000 });

    // Scroll to bottom to trigger lazy-load of remaining rows
    let prevCount = 0;
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((r) => setTimeout(r, 1500));
      const count = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
      if (count === prevCount) break;
      prevCount = count;
    }

    const ratings = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      const data: Array<{
        rank: number;
        team: string;
        conf: string;
        record: string;
        adjOE: number;
        adjDE: number;
        barthag: number;
        adjT: number;
      }> = [];

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 10) return;

        const rank = parseInt(cells[0]?.textContent?.trim() ?? "", 10);
        if (isNaN(rank)) return;

        // Team name: get <a> link text, strip the lowrow span (contains last game info)
        const teamLink = cells[1]?.querySelector("a");
        let team = "";
        if (teamLink) {
          const clone = teamLink.cloneNode(true) as HTMLElement;
          clone.querySelectorAll(".lowrow").forEach((s) => s.remove());
          team = clone.textContent?.trim() ?? "";
        }
        if (!team) return;

        const conf =
          cells[2]?.querySelector("a")?.textContent?.trim() ??
          cells[2]?.textContent?.trim() ??
          "";

        // Record: also strip lowrow spans
        const recordEl = cells[4]?.querySelector("a");
        let record = "";
        if (recordEl) {
          const rc = recordEl.cloneNode(true) as HTMLElement;
          rc.querySelectorAll(".lowrow").forEach((s) => s.remove());
          record = rc.textContent?.trim() ?? "";
        }

        // Stat values: main number is before <br>/<span class="lowrow">
        function getStatValue(cell: Element | null): number {
          const html = cell?.innerHTML ?? "";
          const match = html.match(/^([\d.+-]+)/);
          return match ? parseFloat(match[1]) : NaN;
        }

        const adjOE = getStatValue(cells[5]);
        const adjDE = getStatValue(cells[6]);
        const barthag = getStatValue(cells[7]);
        const adjT = getStatValue(cells[8]);

        data.push({ rank, team, conf, record, adjOE, adjDE, barthag, adjT });
      });

      return data;
    });

    const map = new Map<string, BarttovikRating>();

    for (const r of ratings) {
      const recordMatch = r.record.match(/(\d+)-(\d+)/);
      const wins = recordMatch ? parseInt(recordMatch[1], 10) : 0;
      const losses = recordMatch ? parseInt(recordMatch[2], 10) : 0;
      const rating = r.adjOE - r.adjDE;

      map.set(r.team, {
        rank: r.rank,
        teamName: r.team,
        conference: r.conf,
        rating,
        adjOE: r.adjOE,
        adjDE: r.adjDE,
        barthag: r.barthag,
        adjTempo: r.adjT,
        luck: 0, // Not reliably parsed from this table layout
        sos: 0, // Not reliably parsed from this table layout
        wins,
        losses,
      });
    }

    ratingsCacheBySeason.set(y, { data: map, fetchedAt: now });
    console.log(`[barttorvik] Scraped ${map.size} T-Rank ratings for ${y}`);
    return map;
  } catch (err) {
    console.error(`[barttorvik] Scrape failed:`, err);
    // Return cached data if available (even if stale)
    const stale = ratingsCacheBySeason.get(y);
    if (stale) {
      console.warn(`[barttorvik] Returning stale cache from ${new Date(stale.fetchedAt).toISOString()}`);
      return stale.data;
    }
    return new Map();
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Look up a team's Barttorvik rating by name.
 * Tries exact match, then case-insensitive.
 */
export function lookupBarttovikRating(
  ratings: Map<string, BarttovikRating>,
  teamName: string,
): BarttovikRating | undefined {
  const direct = ratings.get(teamName);
  if (direct) return direct;

  // Case-insensitive fallback
  const lower = teamName.toLowerCase();
  for (const entry of Array.from(ratings.entries())) {
    if (entry[0].toLowerCase() === lower) return entry[1];
  }

  console.warn(`[barttorvik] Unmatched team name: "${teamName}"`);
  return undefined;
}

/**
 * Sync current Barttorvik ratings to the BarttovikSnapshot table.
 */
export async function syncBarttovikRatings(): Promise<void> {
  const season = getCurrentBarttovikSeason();
  const ratings = await getBarttovikRatings(season);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let upserted = 0;
  for (const [, rating] of Array.from(ratings.entries())) {
    const dbTeam = await prisma.team.findFirst({
      where: { name: { equals: rating.teamName, mode: "insensitive" } },
    });
    if (!dbTeam) continue;

    await prisma.barttovikSnapshot.upsert({
      where: { teamId_date: { teamId: dbTeam.id, date: today } },
      create: {
        teamId: dbTeam.id,
        date: today,
        season,
        tRank: rating.rank,
        tRankRating: rating.rating,
        adjOE: rating.adjOE,
        adjDE: rating.adjDE,
        barthag: rating.barthag,
        adjTempo: rating.adjTempo,
        luck: rating.luck,
        sos: rating.sos,
        wins: rating.wins,
        losses: rating.losses,
      },
      update: {
        tRank: rating.rank,
        tRankRating: rating.rating,
        adjOE: rating.adjOE,
        adjDE: rating.adjDE,
        barthag: rating.barthag,
        adjTempo: rating.adjTempo,
        luck: rating.luck,
        sos: rating.sos,
        wins: rating.wins,
        losses: rating.losses,
      },
    });
    upserted++;
  }

  console.log(`[barttorvik] Synced ${upserted} BarttovikSnapshot rows for ${season}`);
}

/**
 * Blend KenPom and Barttorvik edges for ensemble signal.
 * 60% KenPom + 40% Barttorvik.
 */
export function signalBarttovikEnsemble(
  kenpomEdge: number,
  barttovikEdge: number,
): {
  blendedEdge: number;
  direction: "home" | "away" | "neutral";
  magnitude: number;
  confidence: number;
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
} {
  const blendedEdge = 0.6 * kenpomEdge + 0.4 * barttovikEdge;
  const absEdge = Math.abs(blendedEdge);

  const direction: "home" | "away" | "neutral" =
    blendedEdge > 0.5 ? "home" : blendedEdge < -0.5 ? "away" : "neutral";

  const magnitude = Math.min(10, absEdge * 1.5);
  const confidence = Math.min(1, absEdge / 10);

  const strength: "strong" | "moderate" | "weak" | "noise" =
    absEdge >= 6 ? "strong" : absEdge >= 3 ? "moderate" : absEdge >= 1 ? "weak" : "noise";

  const label = `Ensemble edge ${blendedEdge > 0 ? "+" : ""}${blendedEdge.toFixed(1)} (KP ${kenpomEdge.toFixed(1)} / BT ${barttovikEdge.toFixed(1)})`;

  return { blendedEdge, direction, magnitude, confidence, label, strength };
}

// ─── Season Helper ──────────────────────────────────────────────────────────

function getCurrentBarttovikSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // Same as KenPom: season = ending year (Nov 2025 → 2026 season)
  return month >= 10 ? year + 1 : year;
}
