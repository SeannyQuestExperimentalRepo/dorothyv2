import "server-only";

/**
 * Barttorvik T-Rank scraper with in-memory caching.
 *
 * Scrapes team efficiency ratings from barttorvik.com for NCAAMB
 * ensemble modeling (blended with KenPom).
 *
 * Cache TTL: 6 hours.
 */

import * as cheerio from "cheerio";
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

  const url = `https://barttorvik.com/trank.php?year=${y}&sort=&lastx=0&hession=All&shots=0&conyes=0&venue=All&type=All&mingames=0`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Barttorvik ${res.status}: ${await res.text().catch(() => "").then((t) => t.slice(0, 200))}`);
  }

  const html = await res.text();
  const map = parseBarttovikHTML(html);

  ratingsCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[barttorvik] Fetched ${map.size} T-Rank ratings for ${y}`);
  return map;
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

// ─── HTML Parser ────────────────────────────────────────────────────────────

function parseBarttovikHTML(html: string): Map<string, BarttovikRating> {
  const $ = cheerio.load(html);
  const map = new Map<string, BarttovikRating>();

  // The main table typically has id "trank-table" or is the first large table
  const rows = $("table#trank-table tbody tr, table.pointed tbody tr, table tbody tr");

  rows.each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;

    const rankText = $(cells[0]).text().trim();
    const rank = parseInt(rankText, 10);
    if (isNaN(rank)) return;

    const teamName = $(cells[1]).text().trim().replace(/\s+\d+$/, ""); // strip seed numbers
    const conference = $(cells[2]).text().trim();

    // Parse record (e.g. "25-8")
    const recordText = $(cells[3]).text().trim();
    const recordMatch = recordText.match(/(\d+)-(\d+)/);
    const wins = recordMatch ? parseInt(recordMatch[1], 10) : 0;
    const losses = recordMatch ? parseInt(recordMatch[2], 10) : 0;

    const adjOE = parseFloat($(cells[4]).text().trim()) || 0;
    const adjDE = parseFloat($(cells[5]).text().trim()) || 0;
    const barthag = parseFloat($(cells[6]).text().trim()) || 0;
    const adjTempo = parseFloat($(cells[7]).text().trim()) || 0;
    const luck = parseFloat($(cells[8]).text().trim()) || 0;
    const sos = parseFloat($(cells[9]).text().trim()) || 0;
    const rating = adjOE - adjDE; // T-Rank rating is efficiency margin

    if (teamName) {
      map.set(teamName, {
        rank,
        teamName,
        conference,
        rating,
        adjOE,
        adjDE,
        barthag,
        adjTempo,
        luck,
        sos,
        wins,
        losses,
      });
    }
  });

  return map;
}

// ─── Season Helper ──────────────────────────────────────────────────────────

function getCurrentBarttovikSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // Same as KenPom: season = ending year (Nov 2025 → 2026 season)
  return month >= 10 ? year + 1 : year;
}
