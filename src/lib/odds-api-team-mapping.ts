/**
 * The Odds API → TrendLine canonical team name mapping.
 *
 * The Odds API uses full names with mascots (e.g., "Gonzaga Bulldogs",
 * "Connecticut Huskies"). This module resolves them to canonical DB names.
 *
 * Shared between:
 *   - src/lib/odds-api-sync.ts (daily cron pipeline)
 *   - scripts/backfill-odds-api.ts (historical backfill)
 */

// ─── Explicit Mappings ──────────────────────────────────────────────────────

export const ODDS_API_NAME_MAP: Record<string, string> = {
  // ── Completely different names ──
  UConn: "Connecticut",
  "Ole Miss": "Mississippi",
  UMass: "Massachusetts",
  UIC: "Illinois Chicago",
  FDU: "Fairleigh Dickinson",
  "Florida International": "FIU",
  IUPUI: "IUPUI",
  Charleston: "Charleston",
  "College of Charleston": "Charleston",

  // ── Abbreviation / format differences ──
  "Cal State Northridge": "CSUN",
  "CSU Fullerton": "Cal St. Fullerton",
  "CSU Bakersfield": "Cal St. Bakersfield",
  "California Baptist": "Cal Baptist",
  "San José State": "San Jose St.",
  "San José St": "San Jose St.",
  "North Carolina State": "N.C. State",
  "NC State": "N.C. State",
  Omaha: "Nebraska Omaha",
  "Nebraska Omaha": "Nebraska Omaha",
  "Southern University": "Southern",
  "Loyola Maryland": "Loyola MD",
  "Loyola Marymount": "Loyola Marymount",
  "Queens University": "Queens (NC)",
  "Sam Houston": "Sam Houston St.",
  "Sam Houston State": "Sam Houston St.",
  "Nicholls State": "Nicholls",
  Nicholls: "Nicholls",
  "University at Albany": "Albany",
  UAlbany: "Albany",
  "SIU Edwardsville": "SIU Edwardsville",
  "Tarleton State": "Tarleton St.",
  "Loyola Chicago": "Loyola Chicago",

  // ── "St." vs "Saint" prefix ──
  "St. Bonaventure": "Saint Bonaventure",
  "Saint Bonaventure": "Saint Bonaventure",
  "St. Francis (PA)": "Saint Francis",
  "Saint Francis": "Saint Francis",

  // ── Hyphenated / compound names ──
  "Arkansas-Pine Bluff": "Arkansas Pine Bluff",
  "Arkansas Pine Bluff": "Arkansas Pine Bluff",
  "Bethune-Cookman": "Bethune Cookman",
  "Bethune Cookman": "Bethune Cookman",
  "Gardner-Webb": "Gardner Webb",
  "Gardner Webb": "Gardner Webb",
  "Louisiana-Monroe": "Louisiana Monroe",
  "Louisiana Monroe": "Louisiana Monroe",
  "Maryland-Eastern Shore": "Maryland Eastern Shore",
  "Maryland Eastern Shore": "Maryland Eastern Shore",
  "Tennessee-Martin": "Tennessee Martin",
  "Tennessee Martin": "Tennessee Martin",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris",
  "Texas A&M Corpus Christi": "Texas A&M Corpus Chris",
  "Winston-Salem State": "Winston Salem St.",

  // ── "Cal State" vs "Cal St." ──
  "Cal State Bakersfield": "Cal St. Bakersfield",
  "Cal State Fullerton": "Cal St. Fullerton",

  // ── Hawaiian ──
  "Hawai\u2019i": "Hawaii",
  Hawaii: "Hawaii",

  // ── "X State" → "X St." ──
  "Alabama State": "Alabama St.",
  "Alcorn State": "Alcorn St.",
  "Appalachian State": "Appalachian St.",
  "Arizona State": "Arizona St.",
  "Arkansas State": "Arkansas St.",
  "Ball State": "Ball St.",
  "Boise State": "Boise St.",
  "Chicago State": "Chicago St.",
  "Cleveland State": "Cleveland St.",
  "Colorado State": "Colorado St.",
  "Coppin State": "Coppin St.",
  "Delaware State": "Delaware St.",
  "East Tennessee State": "East Tennessee St.",
  "Florida State": "Florida St.",
  "Fresno State": "Fresno St.",
  "Georgia State": "Georgia St.",
  "Grambling State": "Grambling St.",
  "Idaho State": "Idaho St.",
  "Illinois State": "Illinois St.",
  "Indiana State": "Indiana St.",
  "Iowa State": "Iowa St.",
  "Jackson State": "Jackson St.",
  "Jacksonville State": "Jacksonville St.",
  "Kansas State": "Kansas St.",
  "Kennesaw State": "Kennesaw St.",
  "Kent State": "Kent St.",
  "Long Beach State": "Long Beach St.",
  "Michigan State": "Michigan St.",
  "Mississippi State": "Mississippi St.",
  "Mississippi Valley State": "Mississippi Valley St.",
  "Missouri State": "Missouri St.",
  "Montana State": "Montana St.",
  "Morehead State": "Morehead St.",
  "Morgan State": "Morgan St.",
  "Murray State": "Murray St.",
  "New Mexico State": "New Mexico St.",
  "Norfolk State": "Norfolk St.",
  "North Dakota State": "North Dakota St.",
  "Northwestern State": "Northwestern St.",
  "Ohio State": "Ohio St.",
  "Oklahoma State": "Oklahoma St.",
  "Oregon State": "Oregon St.",
  "Penn State": "Penn St.",
  "Portland State": "Portland St.",
  "Sacramento State": "Sacramento St.",
  "San Diego State": "San Diego St.",
  "San Jose State": "San Jose St.",
  "South Carolina State": "South Carolina St.",
  "South Dakota State": "South Dakota St.",
  "Southeast Missouri State": "Southeast Missouri St.",
  "Tennessee State": "Tennessee St.",
  "Texas State": "Texas St.",
  "Utah State": "Utah St.",
  "Washington State": "Washington St.",
  "Weber State": "Weber St.",
  "Wichita State": "Wichita St.",
  "Wright State": "Wright St.",
  "Youngstown State": "Youngstown St.",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize a name for fuzzy comparison: lowercase, strip punctuation. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'\u2019'()\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve an Odds API team name to the TrendLine canonical DB name.
 *
 * Tries: direct map → strip mascot (last word) → strip last 2 words → fallback.
 */
export function resolveOddsApiName(apiName: string): string {
  if (ODDS_API_NAME_MAP[apiName]) return ODDS_API_NAME_MAP[apiName];

  const words = apiName.split(" ");
  if (words.length >= 2) {
    const noMascot = words.slice(0, -1).join(" ");
    if (ODDS_API_NAME_MAP[noMascot]) return ODDS_API_NAME_MAP[noMascot];

    if (words.length >= 3) {
      const noMascot2 = words.slice(0, -2).join(" ");
      if (ODDS_API_NAME_MAP[noMascot2]) return ODDS_API_NAME_MAP[noMascot2];
    }
  }

  // Return without mascot as default
  return words.length >= 2 ? words.slice(0, -1).join(" ") : apiName;
}

/** Check if a normalized resolved name matches a normalized DB name. */
function matchNormalized(resolved: string, db: string): boolean {
  if (resolved === db) return true;

  // "st" ↔ "state" at end of string
  if (resolved.replace(/ st$/, " state") === db.replace(/ st$/, " state"))
    return true;

  // "st" ↔ "state" mid-string
  if (
    resolved.replace(/ st /g, " state ") ===
    db.replace(/ st /g, " state ")
  )
    return true;

  // "saint" ↔ "st" prefix
  if (
    resolved.replace(/^st /, "saint ") === db.replace(/^st /, "saint ")
  )
    return true;

  // Spaces removed
  if (resolved.replace(/ /g, "") === db.replace(/ /g, "")) return true;

  return false;
}

/**
 * Match an Odds API team name against a DB canonical name.
 * Handles multi-word mascots (e.g., "Purple Aces", "Tar Heels"),
 * st/state equivalence, saint/st prefix, and spacing variations.
 */
export function matchOddsApiTeam(apiName: string, dbName: string): boolean {
  const db = normalize(dbName);

  // Primary: resolve API name via map + single-word mascot strip
  const resolved = normalize(resolveOddsApiName(apiName));
  if (matchNormalized(resolved, db)) return true;

  // Handle 2-word mascots: "Evansville Purple Aces" → "Evansville"
  const words = apiName.split(" ");
  if (words.length >= 3) {
    const stripped2 = normalize(words.slice(0, -2).join(" "));
    if (stripped2 !== resolved && matchNormalized(stripped2, db)) return true;
  }

  // Handle 3-word mascots (rare): "North Carolina A&T Aggies" etc.
  if (words.length >= 4) {
    const stripped3 = normalize(words.slice(0, -3).join(" "));
    if (stripped3 !== resolved && matchNormalized(stripped3, db)) return true;
  }

  return false;
}
