/**
 * Export NCAAMB Final Dataset
 *
 * Takes the validated staging data and produces final CSV and JSON files.
 * Generates comprehensive summary statistics.
 *
 * Input:  data/ncaamb-games-staging.json
 * Output: data/ncaamb-games-final.json, data/ncaamb-games-final.csv
 */

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "../data/ncaamb-games-staging.json");
if (!fs.existsSync(dataPath)) {
  console.error("No staging data found. Run normalize-ncaamb.js first.");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

console.log(`Loaded ${data.length} NCAAMB games\n`);

// ─── Define CSV columns ─────────────────────────────────────────────────

const csvColumns = [
  "season",
  "gameDate",
  "homeTeam",
  "awayTeam",
  "homeScore",
  "awayScore",
  "scoreDifference",
  "winnerCanonical",
  "overtimes",
  "homeRank",
  "awayRank",
  "homeConference",
  "awayConference",
  "isConferenceGame",
  "isNCAAT",
  "isNIT",
  "isConfTourney",
  "isNeutralSite",
  "homeKenpomRank",
  "awayKenpomRank",
  "homeAdjEM",
  "awayAdjEM",
  "homeAdjOE",
  "awayAdjOE",
  "homeAdjDE",
  "awayAdjDE",
  "homeAdjTempo",
  "awayAdjTempo",
  "fmHomePred",
  "fmAwayPred",
  "fmHomeWinProb",
  "fmThrillScore",
  "spread",
  "overUnder",
  "spreadResult",
  "ouResult",
];

// ─── Build CSV ──────────────────────────────────────────────────────────

function escapeCSV(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvHeader = csvColumns.join(",");
const csvRows = data.map((g) =>
  csvColumns.map((col) => escapeCSV(g[col])).join(",")
);
const csv = [csvHeader, ...csvRows].join("\n");

// ─── Save files ─────────────────────────────────────────────────────────

const jsonPath = path.join(__dirname, "../data/ncaamb-games-final.json");
const csvPath = path.join(__dirname, "../data/ncaamb-games-final.csv");

fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
fs.writeFileSync(csvPath, csv);

console.log(`Saved JSON: ${jsonPath}`);
console.log(`Saved CSV:  ${csvPath} (${csvColumns.length} columns)`);

// ─── Summary Statistics ─────────────────────────────────────────────────

console.log("\n═══ NCAAMB DATASET SUMMARY ═══\n");

// Overall
console.log(`Total games: ${data.length.toLocaleString()}`);
const seasons = [...new Set(data.map((g) => g.season))].sort();
console.log(`Seasons: ${seasons[0]}-${seasons[seasons.length - 1]} (${seasons.length} seasons)`);

// Per-season
console.log("\n─── Games per Season ───");
const bySeason = {};
for (const g of data) {
  bySeason[g.season] = (bySeason[g.season] || 0) + 1;
}
Object.entries(bySeason)
  .sort(([a], [b]) => a - b)
  .forEach(([s, c]) => console.log(`  ${s}: ${c.toLocaleString()}`));

// Tournament
const ncaat = data.filter((g) => g.isNCAAT);
const nit = data.filter((g) => g.isNIT);
const confTourney = data.filter((g) => g.isConfTourney);
console.log(`\n─── Postseason ───`);
console.log(`NCAA Tournament: ${ncaat.length.toLocaleString()}`);
console.log(`NIT: ${nit.length.toLocaleString()}`);
console.log(`Conference Tournament: ${confTourney.length.toLocaleString()}`);

// Rankings
const ranked = data.filter((g) => g.homeRank || g.awayRank);
const bothRanked = data.filter((g) => g.homeRank && g.awayRank);
console.log(`\n─── Rankings ───`);
console.log(`Games with ranked team: ${ranked.length.toLocaleString()}`);
console.log(`Ranked vs ranked: ${bothRanked.length.toLocaleString()}`);

// Overtime
const ot = data.filter((g) => g.overtimes > 0);
const multiOT = data.filter((g) => g.overtimes > 1);
console.log(`\n─── Overtime ───`);
console.log(`Overtime games: ${ot.length.toLocaleString()}`);
console.log(`Multiple OT: ${multiOT.length.toLocaleString()}`);

// Conference games
const confGames = data.filter((g) => g.isConferenceGame);
console.log(`\n─── Conference Games ───`);
console.log(`Conference games: ${confGames.length.toLocaleString()} (${((confGames.length / data.length) * 100).toFixed(1)}%)`);

// Conference breakdown
const confCount = {};
for (const g of confGames) {
  if (g.homeConference) {
    confCount[g.homeConference] = (confCount[g.homeConference] || 0) + 1;
  }
}
Object.entries(confCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([c, n]) => console.log(`  ${c}: ${n.toLocaleString()}`));

// KenPom coverage
const withKP = data.filter((g) => g.homeAdjOE !== null || g.awayAdjOE !== null);
const withFM = data.filter((g) => g.fmHomePred !== null);
console.log(`\n─── KenPom Coverage ───`);
console.log(`With KenPom ratings: ${withKP.length.toLocaleString()} (${((withKP.length / data.length) * 100).toFixed(1)}%)`);
console.log(`With FanMatch predictions: ${withFM.length.toLocaleString()} (${((withFM.length / data.length) * 100).toFixed(1)}%)`);

// Spread coverage
const withSpread = data.filter((g) => g.spread !== null);
console.log(`\n─── Betting Data ───`);
console.log(`With spreads: ${withSpread.length.toLocaleString()} (${((withSpread.length / data.length) * 100).toFixed(1)}%)`);

// Biggest upsets (ranked team losing by most)
const upsets = data
  .filter((g) => {
    if (!g.homeRank && !g.awayRank) return false;
    const rankedTeam = g.homeRank ? "home" : "away";
    const rankedLost = rankedTeam === "home"
      ? g.homeScore < g.awayScore
      : g.awayScore < g.homeScore;
    return rankedLost;
  })
  .map((g) => ({
    ...g,
    margin: Math.abs(g.scoreDifference),
    rankedTeamRank: g.homeRank || g.awayRank,
    rankedTeam: g.homeRank ? g.homeTeam : g.awayTeam,
    winner: g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam,
  }))
  .sort((a, b) => {
    // Sort by rank (higher ranked = bigger upset) then by margin
    return a.rankedTeamRank - b.rankedTeamRank || b.margin - a.margin;
  });

console.log(`\n─── Notable Upsets (Top 10 by Rank) ───`);
upsets.slice(0, 10).forEach((g) =>
  console.log(
    `  ${g.gameDate}: #${g.rankedTeamRank} ${g.rankedTeam} lost to ${g.winner} (${g.homeScore}-${g.awayScore})`
  )
);

// File sizes
const jsonSize = (fs.statSync(jsonPath).size / 1024 / 1024).toFixed(1);
const csvSize = (fs.statSync(csvPath).size / 1024 / 1024).toFixed(1);
console.log(`\n─── File Sizes ───`);
console.log(`JSON: ${jsonSize} MB`);
console.log(`CSV:  ${csvSize} MB`);

console.log("\n═══ EXPORT COMPLETE ═══");
