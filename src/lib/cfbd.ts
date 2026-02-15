import "server-only";

/**
 * CollegeFootballData.com API client with in-memory caching.
 *
 * Fetches SP+ team efficiency ratings for NCAAF games.
 * Pattern mirrors kenpom.ts for consistency.
 *
 * API docs: https://api.collegefootballdata.com/
 * Free tier: 1,000 calls/month
 */

const CFBD_BASE = "https://api.collegefootballdata.com";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CFBDRating {
  team: string;
  conference: string;
  year: number;
  rating: number; // spOverall
  ranking: number;
  offense: { rating: number; ranking: number };
  defense: { rating: number; ranking: number };
  specialTeams: { rating: number } | null;
}

export interface CFBDPPAData {
  team: string;
  overall: number;
  passing: number;
  rushing: number;
  defense: number;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const RATINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const ratingsCacheBySeason = new Map<number, CacheEntry<Map<string, CFBDRating>>>();
const eloCacheBySeason = new Map<number, CacheEntry<Map<string, number>>>();
const talentCacheBySeason = new Map<number, CacheEntry<Map<string, number>>>();
const ppaCacheBySeason = new Map<number, CacheEntry<Map<string, CFBDPPAData>>>();
const srsCacheBySeason = new Map<number, CacheEntry<Map<string, number>>>();

export function clearCFBDCache(): void {
  ratingsCacheBySeason.clear();
  eloCacheBySeason.clear();
  talentCacheBySeason.clear();
  ppaCacheBySeason.clear();
  srsCacheBySeason.clear();
}

// ─── API Helpers ────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY not configured");
  return key;
}

async function fetchCFBD<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, CFBD_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CFBD API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all SP+ team ratings for the given season.
 * Returns a Map keyed by team name (e.g. "Alabama").
 * Cached for 6 hours.
 */
export async function getCFBDRatings(
  season?: number,
): Promise<Map<string, CFBDRating>> {
  const y = season ?? getCurrentCFBDSeason();
  const now = Date.now();

  const cached = ratingsCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) {
    return cached.data;
  }

  const raw = await fetchCFBD<CFBDRating[]>("/ratings/sp", {
    year: String(y),
  });

  const map = new Map<string, CFBDRating>();
  for (const team of raw) {
    map.set(team.team, team);
  }

  ratingsCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[cfbd] Fetched ${map.size} SP+ ratings for ${y}`);
  return map;
}

/**
 * Look up a team's SP+ rating by name. Handles fuzzy matching between
 * ESPN/DB canonical names and CFBD naming conventions.
 */
export function lookupCFBDRating(
  ratings: Map<string, CFBDRating>,
  teamName: string,
): CFBDRating | undefined {
  // Direct match
  const direct = ratings.get(teamName);
  if (direct) return direct;

  // Try common transformations
  const normalized = normalizeToCFBD(teamName);
  if (normalized !== teamName) {
    const match = ratings.get(normalized);
    if (match) return match;
  }

  // Fallback: case-insensitive match
  const lower = teamName.toLowerCase();
  for (const entry of Array.from(ratings.entries())) {
    if (entry[0].toLowerCase() === lower) return entry[1];
  }

  // Log unmatched name for incremental improvement of mappings
  console.warn(`[cfbd] Unmatched team name: "${teamName}" (normalized: "${normalized}")`);
  return undefined;
}

// ─── Name Normalization ─────────────────────────────────────────────────────

/**
 * Map ESPN/DB canonical names → CFBD names.
 * CFBD generally uses full school names.
 */
const ESPN_TO_CFBD: Record<string, string> = {
  "UConn": "Connecticut",
  "UCONN": "Connecticut",
  "Pitt": "Pittsburgh",
  "PITT": "Pittsburgh",
  "Ole Miss": "Mississippi",
  "UCF": "UCF",
  "USC": "USC",
  "UNC": "North Carolina",
  "LSU": "LSU",
  "SMU": "SMU",
  "UNLV": "UNLV",
  "UTEP": "UTEP",
  "UTSA": "UTSA",
  "NIU": "Northern Illinois",
  "Miami (FL)": "Miami",
  "Miami (OH)": "Miami (OH)",
  "Hawai'i": "Hawai'i",
  "Hawaii": "Hawai'i",
  "App State": "Appalachian State",
  "UMass": "Massachusetts",
  "FIU": "FIU",
  "FAU": "Florida Atlantic",
  "UAB": "UAB",
  "ECU": "East Carolina",
  "WKU": "Western Kentucky",
  "MTSU": "Middle Tennessee",
  "BGSU": "Bowling Green",
  // Additional ESPN→CFBD mappings
  "N.C. State": "NC State",
  "NC State": "NC State",
  "BYU": "BYU",
  "TCU": "TCU",
  "USF": "South Florida",
  "South Florida": "South Florida",
  "North Texas": "North Texas",
  "Louisiana": "Louisiana",
  "Louisiana-Lafayette": "Louisiana",
  "Louisiana-Monroe": "Louisiana Monroe",
  "Middle Tennessee": "Middle Tennessee",
  "ETSU": "East Tennessee",
  "Central Michigan": "Central Michigan",
  "Eastern Michigan": "Eastern Michigan",
  "Western Michigan": "Western Michigan",
  "Southern Miss": "Southern Mississippi",
  "Southern Mississippi": "Southern Mississippi",
  "Sam Houston": "Sam Houston State",
  "Sam Houston State": "Sam Houston State",
  "Jacksonville State": "Jacksonville State",
  "Kennesaw State": "Kennesaw State",
};

function normalizeToCFBD(espnName: string): string {
  if (ESPN_TO_CFBD[espnName]) return ESPN_TO_CFBD[espnName];
  return espnName;
}

// ─── Elo Ratings ────────────────────────────────────────────────────────────

export async function getCFBDElo(
  season?: number,
): Promise<Map<string, number>> {
  const y = season ?? getCurrentCFBDSeason();
  const now = Date.now();

  const cached = eloCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) return cached.data;

  const raw = await fetchCFBD<Array<{ team: string; elo: number }>>(
    "/ratings/elo",
    { year: String(y) },
  );

  const map = new Map<string, number>();
  for (const r of raw) map.set(r.team, r.elo);

  eloCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[cfbd] Fetched ${map.size} Elo ratings for ${y}`);
  return map;
}

// ─── Talent Composite ───────────────────────────────────────────────────────

export async function getCFBDTalent(
  season?: number,
): Promise<Map<string, number>> {
  const y = season ?? getCurrentCFBDSeason();
  const now = Date.now();

  const cached = talentCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) return cached.data;

  const raw = await fetchCFBD<Array<{ school: string; talent: number }>>(
    "/talent",
    { year: String(y) },
  );

  const map = new Map<string, number>();
  for (const r of raw) map.set(r.school, r.talent);

  talentCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[cfbd] Fetched ${map.size} talent composites for ${y}`);
  return map;
}

// ─── PPA (Predicted Points Added) ───────────────────────────────────────────

export async function getCFBDPPA(
  season?: number,
): Promise<Map<string, CFBDPPAData>> {
  const y = season ?? getCurrentCFBDSeason();
  const now = Date.now();

  const cached = ppaCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) return cached.data;

  const raw = await fetchCFBD<
    Array<{
      team: string;
      offense: { overall: number; passing: number; rushing: number };
      defense: { overall: number };
    }>
  >("/ppa/teams", { year: String(y) });

  const map = new Map<string, CFBDPPAData>();
  for (const r of raw) {
    map.set(r.team, {
      team: r.team,
      overall: r.offense?.overall ?? 0,
      passing: r.offense?.passing ?? 0,
      rushing: r.offense?.rushing ?? 0,
      defense: r.defense?.overall ?? 0,
    });
  }

  ppaCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[cfbd] Fetched ${map.size} PPA records for ${y}`);
  return map;
}

// ─── SRS (Simple Rating System) ─────────────────────────────────────────────

export async function getCFBDSRS(
  season?: number,
): Promise<Map<string, number>> {
  const y = season ?? getCurrentCFBDSeason();
  const now = Date.now();

  const cached = srsCacheBySeason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) return cached.data;

  const raw = await fetchCFBD<Array<{ team: string; rating: number }>>(
    "/ratings/srs",
    { year: String(y) },
  );

  const map = new Map<string, number>();
  for (const r of raw) map.set(r.team, r.rating);

  srsCacheBySeason.set(y, { data: map, fetchedAt: now });
  console.log(`[cfbd] Fetched ${map.size} SRS ratings for ${y}`);
  return map;
}

// ─── Advanced Season Stats ──────────────────────────────────────────────────

export async function getCFBDAdvancedStats(
  season?: number,
): Promise<
  Array<{
    team: string;
    offense: Record<string, number>;
    defense: Record<string, number>;
  }>
> {
  const y = season ?? getCurrentCFBDSeason();
  return fetchCFBD("/stats/season/advanced", { year: String(y) });
}

// ─── Sync All Advanced Stats to DB ──────────────────────────────────────────

import { prisma } from "./db";

export async function syncCFBDAdvancedStats(): Promise<void> {
  const season = getCurrentCFBDSeason();

  const [spRatings, elo, talent, ppa, srs] = await Promise.all([
    getCFBDRatings(season),
    getCFBDElo(season),
    getCFBDTalent(season),
    getCFBDPPA(season),
    getCFBDSRS(season),
  ]);

  // Collect all team names across datasets
  const allTeams = new Set<string>();
  Array.from(spRatings.keys()).forEach((n) => allTeams.add(n));
  Array.from(elo.keys()).forEach((n) => allTeams.add(n));
  Array.from(talent.keys()).forEach((n) => allTeams.add(n));
  Array.from(ppa.keys()).forEach((n) => allTeams.add(n));
  Array.from(srs.keys()).forEach((n) => allTeams.add(n));

  let upserted = 0;
  for (const teamName of Array.from(allTeams)) {
    // Find team in DB
    const dbTeam = await prisma.team.findFirst({
      where: { name: { equals: teamName, mode: "insensitive" } },
    });
    if (!dbTeam) continue;

    const sp = spRatings.get(teamName);
    const ppaData = ppa.get(teamName);

    await prisma.nCAAFAdvancedStats.upsert({
      where: { teamId_season: { teamId: dbTeam.id, season } },
      create: {
        teamId: dbTeam.id,
        season,
        spOverall: sp?.rating ?? null,
        spOffense: sp?.offense?.rating ?? null,
        spDefense: sp?.defense?.rating ?? null,
        elo: elo.get(teamName) ?? null,
        srs: srs.get(teamName) ?? null,
        talentComposite: talent.get(teamName) ?? null,
        ppaOverall: ppaData?.overall ?? null,
        ppaPass: ppaData?.passing ?? null,
        ppaRush: ppaData?.rushing ?? null,
        ppaDef: ppaData?.defense ?? null,
      },
      update: {
        spOverall: sp?.rating ?? null,
        spOffense: sp?.offense?.rating ?? null,
        spDefense: sp?.defense?.rating ?? null,
        elo: elo.get(teamName) ?? null,
        srs: srs.get(teamName) ?? null,
        talentComposite: talent.get(teamName) ?? null,
        ppaOverall: ppaData?.overall ?? null,
        ppaPass: ppaData?.passing ?? null,
        ppaRush: ppaData?.rushing ?? null,
        ppaDef: ppaData?.defense ?? null,
      },
    });
    upserted++;
  }

  console.log(`[cfbd] Synced ${upserted} NCAAFAdvancedStats rows for ${season}`);
}

// ─── Season Helper ──────────────────────────────────────────────────────────

function getCurrentCFBDSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // NCAAF season = calendar year (Aug 2025 → 2025 season)
  // After January, previous year's season is most relevant until August
  return month >= 7 ? year : year - 1;
}
