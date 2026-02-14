import "server-only";

/**
 * KenPom API client with in-memory caching.
 *
 * Fetches team efficiency ratings and FanMatch game predictions
 * from the official KenPom API (https://kenpom.com).
 *
 * Cache TTL: 6 hours for ratings, 2 hours for FanMatch.
 */

const KENPOM_BASE = "https://kenpom.com/api.php";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KenpomRating {
  TeamName: string;
  Season: number;
  RankAdjEM: number;
  AdjEM: number;
  AdjOE: number;
  RankAdjOE: number;
  AdjDE: number;
  RankAdjDE: number;
  AdjTempo: number;
  RankAdjTempo: number;
  Wins: number;
  Losses: number;
  ConfShort: string;
}

export interface KenpomArchiveRating {
  ArchiveDate: string;
  Season: number;
  TeamName: string;
  ConfShort: string;
  AdjEM: number;
  RankAdjEM: number;
  AdjOE: number;
  RankAdjOE: number;
  AdjDE: number;
  RankAdjDE: number;
  AdjTempo: number;
  RankAdjTempo: number;
}

export interface KenpomFanMatch {
  GameID: number;
  DateOfGame: string;
  Visitor: string;
  Home: string;
  HomeRank: number;
  VisitorRank: number;
  HomePred: number;
  VisitorPred: number;
  HomeWP: number;
  PredTempo: number;
  ThrillScore: number;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const RATINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FANMATCH_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const ratingsCacheByseason = new Map<number, CacheEntry<Map<string, KenpomRating>>>();
const fanMatchCache = new Map<string, CacheEntry<KenpomFanMatch[]>>();

export function clearKenpomCache(): void {
  ratingsCacheByseason.clear();
  fanMatchCache.clear();
}

// ─── API Helpers ────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.KENPOM_API_KEY;
  if (!key) throw new Error("KENPOM_API_KEY not configured");
  return key;
}

async function fetchKenpom<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(KENPOM_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KenPom API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all team ratings for the given season.
 * Returns a Map keyed by KenPom TeamName (e.g. "Michigan St.").
 * Cached for 6 hours.
 */
export async function getKenpomRatings(
  season?: number,
): Promise<Map<string, KenpomRating>> {
  const y = season ?? getCurrentKenpomSeason();
  const now = Date.now();

  const cached = ratingsCacheByseason.get(y);
  if (cached && now - cached.fetchedAt < RATINGS_TTL_MS) {
    return cached.data;
  }

  const raw = await fetchKenpom<KenpomRating[]>({
    endpoint: "ratings",
    y: String(y),
  });

  const map = new Map<string, KenpomRating>();
  for (const team of raw) {
    map.set(team.TeamName, team);
  }

  ratingsCacheByseason.set(y, { data: map, fetchedAt: now });
  console.log(`[kenpom] Fetched ${map.size} team ratings for ${y}`);
  return map;
}

/**
 * Fetch FanMatch predictions for a given date (YYYY-MM-DD).
 * Cached for 2 hours.
 */
export async function getKenpomFanMatch(
  date: string,
): Promise<KenpomFanMatch[]> {
  const now = Date.now();
  const cached = fanMatchCache.get(date);

  if (cached && now - cached.fetchedAt < FANMATCH_TTL_MS) {
    return cached.data;
  }

  const raw = await fetchKenpom<KenpomFanMatch[]>({
    endpoint: "fanmatch",
    d: date,
  });

  fanMatchCache.set(date, { data: raw, fetchedAt: now });
  console.log(`[kenpom] Fetched ${raw.length} FanMatch games for ${date}`);
  return raw;
}

/**
 * Fetch archive (point-in-time) ratings for a specific date.
 * Returns ratings as they were on that date, not end-of-season.
 * Uses the undocumented `endpoint=archive&d=YYYY-MM-DD` API.
 */
export async function getKenpomArchiveRatings(
  date: string,
): Promise<KenpomArchiveRating[]> {
  return fetchKenpom<KenpomArchiveRating[]>({
    endpoint: "archive",
    d: date,
  });
}

/**
 * Look up a team's ratings by name. Handles fuzzy matching between
 * your DB canonical names and KenPom's naming convention.
 */
export function lookupRating(
  ratings: Map<string, KenpomRating>,
  teamName: string,
): KenpomRating | undefined {
  // Direct match
  const direct = ratings.get(teamName);
  if (direct) return direct;

  // Try common transformations
  const normalized = normalizeToKenpom(teamName);
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
  console.warn(`[kenpom] Unmatched team name: "${teamName}" (normalized: "${normalized}")`);
  return undefined;
}

// ─── Name Normalization ─────────────────────────────────────────────────────

/**
 * Map DB canonical names → KenPom names.
 * Only needed for names that differ between ESPN/DB and KenPom.
 */
const DB_TO_KENPOM: Record<string, string> = {
  // "St." vs "State" and other ESPN quirks
  "N.C. State": "NC State",
  "NC State": "NC State",
  "UConn": "Connecticut",
  "UCONN": "Connecticut",
  "UMass": "Massachusetts",
  "Ole Miss": "Mississippi",
  "Pitt": "Pittsburgh",
  "PITT": "Pittsburgh",
  "UCF": "Central Florida",
  "USC": "Southern California",
  "UNC": "North Carolina",
  "UNLV": "UNLV",
  "SMU": "SMU",
  "LSU": "LSU",
  "VCU": "VCU",
  "UAB": "UAB",
  "UTEP": "UTEP",
  "UTSA": "UT San Antonio",
  "UT Arlington": "UT Arlington",
  "UT Martin": "Tennessee Martin",
  "FIU": "FIU",
  "LIU": "LIU",
  "NIU": "Northern Illinois",
  "SIU": "Southern Illinois",
  "SIU Edwardsville": "SIU Edwardsville",
  "UIC": "Illinois Chicago",
  "IUPUI": "IUPUI",
  "Miami (FL)": "Miami FL",
  "Miami (OH)": "Miami OH",
  "Saint Mary's": "Saint Mary's",
  "St. Mary's": "Saint Mary's",
  "St. John's": "St. John's",
  "Saint Joseph's": "Saint Joseph's",
  "St. Joseph's": "Saint Joseph's",
  "Saint Peter's": "Saint Peter's",
  "St. Peter's": "Saint Peter's",
  "St. Bonaventure": "St. Bonaventure",
  "Saint Bonaventure": "St. Bonaventure",
  "Loyola Chicago": "Loyola Chicago",
  "Loyola (MD)": "Loyola MD",
  "Loyola Marymount": "Loyola Marymount",
  "Cal St. Bakersfield": "Cal St. Bakersfield",
  "Cal St. Fullerton": "Cal St. Fullerton",
  "Cal St. Northridge": "CSUN",
  "Seattle": "Seattle",
  "Hawai'i": "Hawaii",
  "Hawaii": "Hawaii",
  // Additional ESPN→KenPom mappings
  "UNI": "Northern Iowa",
  "ETSU": "East Tennessee St.",
  "FGCU": "Florida Gulf Coast",
  "UMBC": "UMBC",
  "SIUE": "SIU Edwardsville",
  "App State": "Appalachian St.",
  "Appalachian State": "Appalachian St.",
  "BYU": "BYU",
  "TCU": "TCU",
  "UNF": "North Florida",
  "UNCG": "UNC Greensboro",
  "UNCW": "UNC Wilmington",
  "UNCA": "UNC Asheville",
  "Central Connecticut": "Central Connecticut",
  "Central Connecticut State": "Central Connecticut",
  "Cal Poly": "Cal Poly",
  "Iona": "Iona",
  "Gonzaga": "Gonzaga",
  "Saint Louis": "Saint Louis",
  "St. Louis": "Saint Louis",
  "UNC Greensboro": "UNC Greensboro",
  "UNC Wilmington": "UNC Wilmington",
  "UNC Asheville": "UNC Asheville",
  "NJIT": "NJIT",
  "FAU": "Florida Atlantic",
  "WKU": "Western Kentucky",
  "Middle Tennessee": "Middle Tennessee",
  "MTSU": "Middle Tennessee",
  "South Florida": "South Florida",
  "USF": "South Florida",
  "North Texas": "North Texas",
  "Louisiana": "Louisiana",
  "Louisiana-Lafayette": "Louisiana",
  "Louisiana-Monroe": "Louisiana Monroe",
  "Little Rock": "Little Rock",
  "UALR": "Little Rock",
  "Omaha": "Omaha",
  "Detroit Mercy": "Detroit Mercy",
  "Detroit": "Detroit Mercy",
  "Green Bay": "Green Bay",
  "Milwaukee": "Milwaukee",
};

function normalizeToKenpom(dbName: string): string {
  if (DB_TO_KENPOM[dbName]) return DB_TO_KENPOM[dbName];

  // ESPN often uses "State" — KenPom uses "St."
  // But some names like "Saint Joseph's" stay as-is in KenPom
  let name = dbName;

  // "Appalachian State" → "Appalachian St."
  if (name.endsWith(" State") && !name.startsWith("Saint")) {
    name = name.replace(/ State$/, " St.");
  }

  return name;
}

// ─── Season Helper ──────────────────────────────────────────────────────────

function getCurrentKenpomSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();
  // KenPom season = ending year (Nov 2025 → 2026 season)
  return month >= 10 ? year + 1 : year;
}
