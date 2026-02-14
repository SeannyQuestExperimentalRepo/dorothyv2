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
  DataThrough: string;
  Season: number;
  TeamName: string;
  Seed: number;
  ConfShort: string;
  Coach: string;
  Wins: number;
  Losses: number;
  // Core efficiency
  AdjEM: number;
  RankAdjEM: number;
  Pythag: number;
  RankPythag: number;
  // Offense
  AdjOE: number;
  RankAdjOE: number;
  OE: number; // Raw (unadjusted)
  RankOE: number;
  // Defense
  AdjDE: number;
  RankAdjDE: number;
  DE: number; // Raw (unadjusted)
  RankDE: number;
  // Tempo
  Tempo: number; // Raw
  RankTempo: number;
  AdjTempo: number;
  RankAdjTempo: number;
  // Luck
  Luck: number;
  RankLuck: number;
  // Strength of schedule
  SOS: number;
  RankSOS: number;
  SOSO: number; // Offensive SOS
  RankSOSO: number;
  SOSD: number; // Defensive SOS
  RankSOSD: number;
  NCSOS: number; // Non-conference SOS
  RankNCSOS: number;
  // Tournament / event
  Event: string | null;
  // Average possession length
  APL_Off: number;
  RankAPL_Off: number;
  APL_Def: number;
  RankAPL_Def: number;
  ConfAPL_Off: number;
  RankConfAPL_Off: number;
  ConfAPL_Def: number;
  RankConfAPL_Def: number;
}

export interface KenpomArchiveRating {
  ArchiveDate: string;
  Season: number;
  Preseason: string;
  TeamName: string;
  Seed: number;
  Event: string | null;
  ConfShort: string;
  AdjEM: number;
  RankAdjEM: number;
  AdjOE: number;
  RankAdjOE: number;
  AdjDE: number;
  RankAdjDE: number;
  AdjTempo: number;
  RankAdjTempo: number;
  AdjEMFinal: number;
  RankAdjEMFinal: number;
  AdjOEFinal: number;
  RankAdjOEFinal: number;
  AdjDEFinal: number;
  RankAdjDEFinal: number;
  AdjTempoFinal: number;
  RankAdjTempoFinal: number;
  RankChg: number;
  AdjEMChg: number;
  AdjTChg: number;
}

export interface KenpomPointDist {
  DataThrough: string;
  ConfOnly: string;
  Season: number;
  TeamName: string;
  ConfShort: string;
  OffFt: number;
  RankOffFt: number;
  OffFg2: number;
  RankOffFg2: number;
  OffFg3: number;
  RankOffFg3: number;
  DefFt: number;
  RankDefFt: number;
  DefFg2: number;
  RankDefFg2: number;
  DefFg3: number;
  RankDefFg3: number;
}

export interface KenpomHeight {
  DataThrough: string;
  Season: number;
  TeamName: string;
  ConfShort: string;
  AvgHgt: number;
  AvgHgtRank: number;
  HgtEff: number;
  HgtEffRank: number;
  Hgt5: number;
  Hgt5Rank: number;
  Hgt4: number;
  Hgt4Rank: number;
  Hgt3: number;
  Hgt3Rank: number;
  Hgt2: number;
  Hgt2Rank: number;
  Hgt1: number;
  Hgt1Rank: number;
  Exp: number;
  ExpRank: number;
  Bench: number;
  BenchRank: number;
  Continuity: number;
  RankContinuity: number;
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
const SUPPLEMENTAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const ratingsCacheByseason = new Map<number, CacheEntry<Map<string, KenpomRating>>>();
const fanMatchCache = new Map<string, CacheEntry<KenpomFanMatch[]>>();
const pointDistCache = new Map<number, CacheEntry<KenpomPointDist[]>>();
const heightCache = new Map<number, CacheEntry<KenpomHeight[]>>();

export function clearKenpomCache(): void {
  ratingsCacheByseason.clear();
  fanMatchCache.clear();
  pointDistCache.clear();
  heightCache.clear();
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
 * Fetch point distribution data for the given season.
 * Shows % of points from FT, 2P, 3P (offense and defense).
 * Cached for 24 hours.
 */
export async function getKenpomPointDist(
  season?: number,
): Promise<KenpomPointDist[]> {
  const y = season ?? getCurrentKenpomSeason();
  const now = Date.now();

  const cached = pointDistCache.get(y);
  if (cached && now - cached.fetchedAt < SUPPLEMENTAL_TTL_MS) {
    return cached.data;
  }

  const raw = await fetchKenpom<KenpomPointDist[]>({
    endpoint: "pointdist",
    y: String(y),
  });

  pointDistCache.set(y, { data: raw, fetchedAt: now });
  console.log(`[kenpom] Fetched ${raw.length} point dist records for ${y}`);
  return raw;
}

/**
 * Fetch height/experience data for the given season.
 * Includes avg height by position, experience, bench usage, continuity.
 * Cached for 24 hours.
 */
export async function getKenpomHeight(
  season?: number,
): Promise<KenpomHeight[]> {
  const y = season ?? getCurrentKenpomSeason();
  const now = Date.now();

  const cached = heightCache.get(y);
  if (cached && now - cached.fetchedAt < SUPPLEMENTAL_TTL_MS) {
    return cached.data;
  }

  const raw = await fetchKenpom<KenpomHeight[]>({
    endpoint: "height",
    y: String(y),
  });

  heightCache.set(y, { data: raw, fetchedAt: now });
  console.log(`[kenpom] Fetched ${raw.length} height records for ${y}`);
  return raw;
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
  "LIU": "LIU Brooklyn",
  "NIU": "Northern Illinois",
  "SIU": "Southern Illinois",
  "SIU Edwardsville": "SIUE",
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
  // Orphaned KenPom names (school rebrands, abbreviation differences)
  "CSUN": "Cal St. Northridge",
  "Indianapolis": "IUPUI", // rebranded from IUPUI → Indianapolis in 2024
  "McNeese": "McNeese St.",
  "Nicholls": "Nicholls St.",
  "Kansas City": "UMKC",
  "Saint Francis": "St. Francis PA",
  "Houston Christian": "Houston Baptist", // rebranded 2022
  "Charleston": "College of Charleston",
  "Purdue Fort Wayne": "Fort Wayne", // also was IPFW
  "UT Rio Grande Valley": "Texas Pan American", // merged 2015
  "Queens (NC)": "Queens",
  "East Texas A&M": "Texas A&M Commerce", // rebranded 2024
  "Utah Tech": "Dixie St.", // rebranded 2022
  "Southeast Missouri St.": "Southeast Missouri",
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
