/**
 * Normalize NCAAMB Raw Data → Staging JSON
 *
 * Takes the raw scraped data from Sports Reference CBB and produces a clean,
 * normalized staging JSON with:
 * - Canonical team names (mapped to KenPom names)
 * - KenPom season ratings (AdjEM, AdjOE, AdjDE, AdjTempo)
 * - FanMatch predictions (predicted scores, win probability, thrill score)
 * - Conference game detection
 * - Tournament classification (NCAA, NIT, Conference)
 *
 * Input:  data/raw/ncaamb/ncaamb-scores-raw.json
 * Output: data/ncaamb-games-staging.json
 *
 * Usage: node scripts/processors/normalize-ncaamb.js
 */

const fs = require("fs");
const path = require("path");

// ─── Load raw scraped data ──────────────────────────────────────────────────

const rawPath = path.join(__dirname, "../../data/raw/ncaamb/ncaamb-scores-raw.json");
if (!fs.existsSync(rawPath)) {
  console.error("No raw NCAAMB data found. Run the scraper first.");
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
console.log(`Loaded ${raw.length} raw NCAAMB games\n`);

// ─── Load team name mapping ────────────────────────────────────────────────

const mappingPath = path.join(__dirname, "../../src/lib/ncaamb-team-name-mapping.ts");
let slugToCanonical = {};
let nameToCanonical = {};

if (fs.existsSync(mappingPath)) {
  const mappingContent = fs.readFileSync(mappingPath, "utf8");

  // Extract ncaambSlugToCanonical section
  const slugMapMatch = mappingContent.match(
    /ncaambSlugToCanonical[^{]*\{([^]*?)\n\s*\}/
  );
  if (slugMapMatch) {
    const entries = slugMapMatch[1].match(
      /(?:"([^"]+)"|(\w[\w-]*))\s*:\s*"([^"]+)"/g
    ) || [];
    for (const entry of entries) {
      const m = entry.match(/(?:"([^"]+)"|(\w[\w-]*))\s*:\s*"([^"]+)"/);
      if (m) slugToCanonical[m[1] || m[2]] = m[3];
    }
  }

  // Extract ncaambTeamNameMap section
  const nameMapMatch = mappingContent.match(
    /ncaambTeamNameMap[^{]*\{([^]*?)\n\s*\}[^{]/
  );
  if (nameMapMatch) {
    const entries = nameMapMatch[1].match(
      /(?:"([^"]+)"|(\w[\w-]*))\s*:\s*"([^"]+)"/g
    ) || [];
    for (const entry of entries) {
      const m = entry.match(/(?:"([^"]+)"|(\w[\w-]*))\s*:\s*"([^"]+)"/);
      if (m) nameToCanonical[(m[1] || m[2]).toLowerCase()] = m[3];
    }
  }

  console.log(`Loaded ${Object.keys(slugToCanonical).length} slug → canonical mappings`);
  console.log(`Loaded ${Object.keys(nameToCanonical).length} name → canonical mappings`);
} else {
  console.log("WARNING: No team name mapping file found. Using raw names.");
}

// ─── Resolve team name ─────────────────────────────────────────────────────

function resolveTeamName(slug, rawName) {
  // Try slug first
  if (slug && slugToCanonical[slug]) {
    return slugToCanonical[slug];
  }
  // Try name map (case-insensitive)
  if (rawName && nameToCanonical[rawName.toLowerCase()]) {
    return nameToCanonical[rawName.toLowerCase()];
  }
  // Return raw name as fallback
  return rawName || null;
}

// ─── Load KenPom data ──────────────────────────────────────────────────────

// Ratings: team-level season stats (AdjEM, AdjOE, AdjDE, AdjTempo)
const ratingsPath = path.join(__dirname, "../../data/raw/kenpom/kenpom-ratings.json");
const ratingsMap = new Map(); // "TeamName|Season" -> rating
if (fs.existsSync(ratingsPath)) {
  const ratings = JSON.parse(fs.readFileSync(ratingsPath));
  for (const r of ratings) {
    ratingsMap.set(`${r.TeamName}|${r.Season}`, r);
  }
  console.log(`Loaded ${ratings.length} KenPom ratings (${ratingsMap.size} unique)`);
}

// Four Factors: more granular team stats
const ffPath = path.join(__dirname, "../../data/raw/kenpom/kenpom-four-factors.json");
const ffMap = new Map(); // "TeamName|Season" -> four factors
if (fs.existsSync(ffPath)) {
  const ff = JSON.parse(fs.readFileSync(ffPath));
  for (const f of ff) {
    ffMap.set(`${f.TeamName}|${f.Season}`, f);
  }
  console.log(`Loaded ${ff.length} KenPom four-factors (${ffMap.size} unique)`);
}

// FanMatch: game-level predictions
const fmPath = path.join(__dirname, "../../data/raw/kenpom/kenpom-fanmatch.json");
const fmMap = new Map(); // "Home|Visitor|Date" -> prediction (fuzzy date match)
const fmByDate = new Map(); // "Date" -> [predictions]
if (fs.existsSync(fmPath)) {
  const fm = JSON.parse(fs.readFileSync(fmPath));
  for (const f of fm) {
    // Exact key: home + visitor + date
    const key = `${f.Home}|${f.Visitor}|${f.DateOfGame}`;
    fmMap.set(key, f);

    // Also index by date for fuzzy matching
    if (!fmByDate.has(f.DateOfGame)) fmByDate.set(f.DateOfGame, []);
    fmByDate.get(f.DateOfGame).push(f);
  }
  console.log(`Loaded ${fm.length} FanMatch predictions (${fmByDate.size} dates)`);
}

// Teams data: for conference info
const teamsPath = path.join(__dirname, "../../data/raw/kenpom/kenpom-teams.json");
const teamsMap = new Map(); // "TeamName|Season" -> team
if (fs.existsSync(teamsPath)) {
  const teams = JSON.parse(fs.readFileSync(teamsPath));
  for (const t of teams) {
    teamsMap.set(`${t.TeamName}|${t.Season}`, t);
  }
  console.log(`Loaded ${teams.length} KenPom team entries (${teamsMap.size} unique)`);
}

// Build NCAA Tournament seed lookup from KenPom ratings
// KenPom ratings have Seed (1-16) and Event ("NCAA") for tournament teams
const seedMap = new Map(); // "TeamName|Season" -> seed
if (fs.existsSync(ratingsPath)) {
  const ratings = JSON.parse(fs.readFileSync(ratingsPath));
  let seedCount = 0;
  for (const r of ratings) {
    if (r.Seed && r.Event === "NCAA") {
      seedMap.set(`${r.TeamName}|${r.Season}`, r.Seed);
      seedCount++;
    }
  }
  console.log(`Loaded ${seedCount} NCAA Tournament seeds from KenPom ratings`);
}

// For seasons without ratings (2005-2009), build seed lookup from four-factors
// (four-factors doesn't have Seed, but we can detect tournament games by date)

console.log("");

// ─── KenPom conference short code → full name mapping ──────────────────────

const confShortToFull = {
  ACC: "ACC",
  B10: "Big Ten",
  B12: "Big 12",
  SEC: "SEC",
  BE: "Big East",
  A10: "Atlantic 10",
  Amer: "AAC",
  MWC: "Mountain West",
  WCC: "WCC",
  MVC: "Missouri Valley",
  MAC: "MAC",
  CUSA: "Conference USA",
  SB: "Sun Belt",
  CAA: "CAA",
  Ivy: "Ivy League",
  BSky: "Big Sky",
  BW: "Big West",
  BSth: "Big South",
  OVC: "Ohio Valley",
  ASun: "ASUN",
  MAAC: "MAAC",
  Horz: "Horizon",
  Slnd: "Southland",
  SWAC: "SWAC",
  MEAC: "MEAC",
  NEC: "NEC",
  PL: "Patriot League",
  Sum: "Summit",
  SC: "Southern",
  WAC: "WAC",
  AE: "America East",
  Pat: "Patriot League",
  Pac: "Pac-12",
  P10: "Pac-10",
  GWST: "Great West",
  ind: "Independent",
};

// ─── Build conference lookup from KenPom teams ─────────────────────────────

function getTeamConference(teamName, season) {
  const team = teamsMap.get(`${teamName}|${season}`);
  if (!team) return null;
  return confShortToFull[team.ConfShort] || team.ConfShort;
}

// ─── Match FanMatch prediction to a game ───────────────────────────────────

function findFanMatch(homeCanonical, awayCanonical, gameDate) {
  if (!homeCanonical || !awayCanonical) return null;

  // Try exact match first
  const exactKey = `${homeCanonical}|${awayCanonical}|${gameDate}`;
  if (fmMap.has(exactKey)) return fmMap.get(exactKey);

  // Try date-based fuzzy match (team names may differ slightly)
  const dayPredictions = fmByDate.get(gameDate);
  if (!dayPredictions) return null;

  // Try matching by checking if either team name matches
  const homeLower = homeCanonical.toLowerCase();
  const awayLower = awayCanonical.toLowerCase();

  for (const pred of dayPredictions) {
    const predHomeLower = pred.Home.toLowerCase();
    const predVisLower = pred.Visitor.toLowerCase();

    if (
      (predHomeLower === homeLower || predHomeLower.includes(homeLower) || homeLower.includes(predHomeLower)) &&
      (predVisLower === awayLower || predVisLower.includes(awayLower) || awayLower.includes(predVisLower))
    ) {
      return pred;
    }
  }

  return null;
}

// ─── Normalize games ────────────────────────────────────────────────────────

const staged = [];
let stats = {
  resolved: 0,
  unresolved: 0,
  withRatings: 0,
  withFanMatch: 0,
  confGames: 0,
  ncaatGames: 0,
  nitGames: 0,
  confTourneyGames: 0,
  overtimeGames: 0,
  rankedGames: 0,
  bothRanked: 0,
};

for (const g of raw) {
  // Resolve canonical team names
  const homeCanonical = resolveTeamName(g.homeSlug, g.homeTeam);
  const awayCanonical = resolveTeamName(g.awaySlug, g.awayTeam);

  if (homeCanonical && awayCanonical) stats.resolved++;
  else stats.unresolved++;

  // Score calculations
  const scoreDifference = g.homeScore - g.awayScore;
  let winnerCanonical = null;
  if (g.homeScore > g.awayScore) winnerCanonical = homeCanonical;
  else if (g.awayScore > g.homeScore) winnerCanonical = awayCanonical;

  // Conference lookup from KenPom
  const homeConf = getTeamConference(homeCanonical, g.season);
  const awayConf = getTeamConference(awayCanonical, g.season);

  const isConferenceGame =
    homeConf !== null &&
    awayConf !== null &&
    homeConf === awayConf &&
    homeConf !== "Independent";

  if (isConferenceGame) stats.confGames++;

  // KenPom ratings for each team (season-level)
  const homeRating = ratingsMap.get(`${homeCanonical}|${g.season}`);
  const awayRating = ratingsMap.get(`${awayCanonical}|${g.season}`);

  // Four factors
  const homeFF = ffMap.get(`${homeCanonical}|${g.season}`);
  const awayFF = ffMap.get(`${awayCanonical}|${g.season}`);

  if (homeRating || awayRating || homeFF || awayFF) stats.withRatings++;

  // FanMatch prediction
  const fanMatch = findFanMatch(homeCanonical, awayCanonical, g.gameDate);
  if (fanMatch) stats.withFanMatch++;

  // NCAA Tournament detection:
  // 1. Use scraper's isNCAAT flag if available
  // 2. For games in mid-March to early April, check if both teams have NCAA seeds
  let isNCAAT = g.isNCAAT || false;
  let isNIT = g.isNIT || false;
  let homeSeed = null;
  let awaySeed = null;

  // Look up seeds from KenPom
  if (homeCanonical) homeSeed = seedMap.get(`${homeCanonical}|${g.season}`) || null;
  if (awayCanonical) awaySeed = seedMap.get(`${awayCanonical}|${g.season}`) || null;

  // Date-based NCAAT detection: NCAA Tourney runs ~Mar 15 to ~Apr 7
  if (!isNCAAT && g.gameDate) {
    const month = parseInt(g.gameDate.split("-")[1]);
    const day = parseInt(g.gameDate.split("-")[2]);
    const isLateMarEarlyApr = (month === 3 && day >= 14) || (month === 4 && day <= 8);

    if (isLateMarEarlyApr && homeSeed && awaySeed) {
      isNCAAT = true;
    }
  }

  if (isNCAAT) stats.ncaatGames++;
  if (isNIT) stats.nitGames++;
  if (g.isConfTourney) stats.confTourneyGames++;
  if (g.overtimes > 0) stats.overtimeGames++;
  if (g.homeRank || g.awayRank) stats.rankedGames++;
  if (g.homeRank && g.awayRank) stats.bothRanked++;

  staged.push({
    // Game info
    season: g.season,
    gameDate: g.gameDate,
    homeTeam: homeCanonical || g.homeTeam,
    awayTeam: awayCanonical || g.awayTeam,
    homeTeamRaw: g.homeTeam,
    awayTeamRaw: g.awayTeam,
    homeSlug: g.homeSlug,
    awaySlug: g.awaySlug,

    // Scores
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    scoreDifference,
    winnerCanonical,
    overtimes: g.overtimes,

    // Rankings (AP poll)
    homeRank: g.homeRank,
    awayRank: g.awayRank,

    // Conference
    homeConference: homeConf,
    awayConference: awayConf,
    isConferenceGame,

    // Tournament
    isNCAAT,
    isNIT,
    homeSeed,
    awaySeed,
    isConfTourney: g.isConfTourney || false,
    isNeutralSite: g.isNeutralSite || false,
    notes: g.notes || null,

    // KenPom ratings (season-level for each team)
    homeKenpomRank: homeRating ? homeRating.RankAdjEM : (homeFF ? homeFF.RankAdjOE : null),
    awayKenpomRank: awayRating ? awayRating.RankAdjEM : (awayFF ? awayFF.RankAdjOE : null),
    homeAdjEM: homeRating ? homeRating.AdjEM : null,
    awayAdjEM: awayRating ? awayRating.AdjEM : null,
    homeAdjOE: homeRating ? homeRating.AdjOE : (homeFF ? homeFF.AdjOE : null),
    awayAdjOE: awayRating ? awayRating.AdjOE : (awayFF ? awayFF.AdjOE : null),
    homeAdjDE: homeRating ? homeRating.AdjDE : (homeFF ? homeFF.AdjDE : null),
    awayAdjDE: awayRating ? awayRating.AdjDE : (awayFF ? awayFF.AdjDE : null),
    homeAdjTempo: homeRating ? homeRating.AdjTempo : (homeFF ? homeFF.AdjTempo : null),
    awayAdjTempo: awayRating ? awayRating.AdjTempo : (awayFF ? awayFF.AdjTempo : null),

    // FanMatch predictions (game-level)
    fmHomePred: fanMatch ? fanMatch.HomePred : null,
    fmAwayPred: fanMatch ? fanMatch.VisitorPred : null,
    fmHomeWinProb: fanMatch ? fanMatch.HomeWP : null,
    fmPredTempo: fanMatch ? fanMatch.PredTempo : null,
    fmThrillScore: fanMatch ? fanMatch.ThrillScore : null,

    // Betting (to be filled later)
    spread: null,
    overUnder: null,
    spreadResult: null,
    ouResult: null,

    source: "sports-reference.com",
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────

const outputPath = path.join(__dirname, "../../data/ncaamb-games-staging.json");
fs.writeFileSync(outputPath, JSON.stringify(staged, null, 2));

console.log("═══ NCAAMB NORMALIZATION COMPLETE ═══");
console.log(`Total games: ${staged.length}`);
console.log(`Teams resolved: ${stats.resolved} (${stats.unresolved} unresolved)`);
console.log(`With KenPom ratings: ${stats.withRatings}`);
console.log(`With FanMatch predictions: ${stats.withFanMatch}`);
console.log(`Conference games: ${stats.confGames}`);
console.log(`NCAA Tournament: ${stats.ncaatGames}`);
console.log(`NIT: ${stats.nitGames}`);
console.log(`Conference Tournament: ${stats.confTourneyGames}`);
console.log(`Overtime: ${stats.overtimeGames}`);
console.log(`Ranked games: ${stats.rankedGames}`);
console.log(`Ranked vs ranked: ${stats.bothRanked}`);

// Per-season stats
console.log("\n─── Games per Season ───");
const bySeason = {};
for (const g of staged) {
  bySeason[g.season] = (bySeason[g.season] || 0) + 1;
}
Object.entries(bySeason)
  .sort(([a], [b]) => a - b)
  .forEach(([s, c]) => console.log(`  ${s}: ${c}`));

// FanMatch coverage by season
console.log("\n─── FanMatch Coverage by Season ───");
const fmBySeason = {};
for (const g of staged) {
  if (!fmBySeason[g.season]) fmBySeason[g.season] = { total: 0, fm: 0 };
  fmBySeason[g.season].total++;
  if (g.fmHomePred !== null) fmBySeason[g.season].fm++;
}
Object.entries(fmBySeason)
  .sort(([a], [b]) => a - b)
  .forEach(([s, d]) =>
    console.log(`  ${s}: ${d.fm}/${d.total} (${((d.fm / d.total) * 100).toFixed(0)}%)`)
  );

// KenPom ratings coverage by season
console.log("\n─── KenPom Ratings Coverage by Season ───");
const kpBySeason = {};
for (const g of staged) {
  if (!kpBySeason[g.season]) kpBySeason[g.season] = { total: 0, kp: 0 };
  kpBySeason[g.season].total++;
  if (g.homeAdjOE !== null || g.awayAdjOE !== null) kpBySeason[g.season].kp++;
}
Object.entries(kpBySeason)
  .sort(([a], [b]) => a - b)
  .forEach(([s, d]) =>
    console.log(`  ${s}: ${d.kp}/${d.total} (${((d.kp / d.total) * 100).toFixed(0)}%)`)
  );

console.log(`\nSaved: ${outputPath}`);
