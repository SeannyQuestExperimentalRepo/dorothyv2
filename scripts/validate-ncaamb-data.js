/**
 * NCAAMB Data Validation Suite — Phase 3
 *
 * Comprehensive integrity and consistency checks on the NCAAMB staging data.
 * Validates scores, team names, KenPom data, tournament flags, etc.
 */

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "../data/ncaamb-games-staging.json");
if (!fs.existsSync(dataPath)) {
  console.error("No staging data found. Run normalize-ncaamb.js first.");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const results = [];

function check(name, passed, details, failures) {
  results.push({ name, passed, details, failures: failures || [] });
  const icon = passed ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}: ${details}`);
  if (failures && failures.length > 0 && failures.length <= 5) {
    failures.forEach((f) => console.log(`       ${f}`));
  } else if (failures && failures.length > 5) {
    failures.slice(0, 5).forEach((f) => console.log(`       ${f}`));
    console.log(`       ... and ${failures.length - 5} more`);
  }
}

console.log(`Validating ${data.length} NCAAMB games...\n`);

// ─── 1. No duplicate games ────────────────────────────────────────────────

const seen = new Set();
const dupes = [];
for (const g of data) {
  const key = `${g.gameDate}|${g.homeTeam}|${g.awayTeam}`;
  if (seen.has(key)) {
    dupes.push(key);
  }
  seen.add(key);
}
check(
  "No duplicate games",
  dupes.length === 0,
  `${dupes.length} duplicates found`,
  dupes.slice(0, 10)
);

// ─── 2. Scores are non-negative ──────────────────────────────────────────

const negScores = data.filter((g) => g.homeScore < 0 || g.awayScore < 0);
check(
  "Scores are non-negative",
  negScores.length === 0,
  `${negScores.length} games with negative scores`
);

// ─── 3. Scores are reasonable (basketball: 30-200 range) ─────────────────

const badScores = data.filter(
  (g) =>
    g.homeScore < 20 || g.homeScore > 200 ||
    g.awayScore < 20 || g.awayScore > 200
);
check(
  "Scores in reasonable range (20-200)",
  badScores.length === 0,
  `${badScores.length} games with unusual scores`,
  badScores.slice(0, 5).map(
    (g) => `${g.gameDate}: ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}`
  )
);

// ─── 4. Score difference = homeScore - awayScore ─────────────────────────

const badDiff = data.filter(
  (g) => g.scoreDifference !== g.homeScore - g.awayScore
);
check(
  "Score difference is correct",
  badDiff.length === 0,
  `${badDiff.length} mismatches`
);

// ─── 5. Winner matches higher score (no ties in basketball) ──────────────

const ties = data.filter((g) => g.homeScore === g.awayScore);
check(
  "No tied games (basketball has OT)",
  ties.length === 0,
  `${ties.length} tied games`,
  ties.slice(0, 5).map(
    (g) => `${g.gameDate}: ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}`
  )
);

const badWinner = data.filter((g) => {
  if (g.homeScore === g.awayScore) return false;
  const expectedWinner =
    g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam;
  return g.winnerCanonical !== expectedWinner;
});
check(
  "Winner matches higher score",
  badWinner.length === 0,
  `${badWinner.length} mismatches`,
  badWinner.slice(0, 5).map(
    (g) =>
      `${g.gameDate}: ${g.homeTeam} ${g.homeScore}-${g.awayScore} ${g.awayTeam}, winner=${g.winnerCanonical}`
  )
);

// ─── 6. Team not playing itself ──────────────────────────────────────────

const selfPlay = data.filter((g) => g.homeTeam === g.awayTeam);
check(
  "No team playing itself",
  selfPlay.length === 0,
  `${selfPlay.length} self-play games`,
  selfPlay.slice(0, 5).map((g) => `${g.gameDate}: ${g.homeTeam} vs ${g.awayTeam}`)
);

// ─── 7. Rankings are 1-25 when present ───────────────────────────────────

const badRank = data.filter(
  (g) =>
    (g.homeRank !== null && (g.homeRank < 1 || g.homeRank > 25)) ||
    (g.awayRank !== null && (g.awayRank < 1 || g.awayRank > 25))
);
check(
  "Rankings are 1-25",
  badRank.length === 0,
  `${badRank.length} out-of-range rankings`,
  badRank.slice(0, 5).map(
    (g) => `${g.gameDate}: ${g.homeTeam}(#${g.homeRank}) vs ${g.awayTeam}(#${g.awayRank})`
  )
);

// ─── 8. Seasons are valid ────────────────────────────────────────────────

const badSeason = data.filter((g) => g.season < 2005 || g.season > 2025);
check(
  "Seasons in valid range (2005-2025)",
  badSeason.length === 0,
  `${badSeason.length} out-of-range seasons`
);

// ─── 9. Game dates are valid ─────────────────────────────────────────────

const badDate = data.filter((g) => {
  const d = new Date(g.gameDate);
  return isNaN(d.getTime());
});
check(
  "All game dates are valid",
  badDate.length === 0,
  `${badDate.length} invalid dates`
);

// ─── 10. Conference game consistency ─────────────────────────────────────

const confGames = data.filter((g) => g.isConferenceGame);
const confNoConf = confGames.filter(
  (g) => g.homeConference === null || g.awayConference === null
);
check(
  "Conference games have conferences",
  confNoConf.length === 0,
  `${confNoConf.length} conference games missing conference info`
);

const confMismatch = confGames.filter(
  (g) => g.homeConference !== g.awayConference
);
check(
  "Conference games = same conference",
  confMismatch.length === 0,
  `${confMismatch.length} conference games with different conferences`
);

// ─── 11. Conference game ratio (~40-65% typical for CBB) ─────────────────

const confRatio = confGames.length / data.length;
check(
  "Conference game ratio 30-70%",
  confRatio >= 0.3 && confRatio <= 0.7,
  `${(confRatio * 100).toFixed(1)}% (${confGames.length}/${data.length})`
);

// ─── 12. Overtimes are non-negative ──────────────────────────────────────

const badOT = data.filter((g) => g.overtimes < 0);
check(
  "Overtimes are non-negative",
  badOT.length === 0,
  `${badOT.length} negative overtime values`
);

// ─── 13. NCAA Tournament games present ──────────────────────────────────

const ncaatGames = data.filter((g) => g.isNCAAT);
const ncaatSeasons = new Set(ncaatGames.map((g) => g.season));
// Expect ~67 games per tournament (except 2020 cancellation)
check(
  "NCAA Tournament games detected",
  ncaatGames.length > 50,
  `${ncaatGames.length} NCAAT games across ${ncaatSeasons.size} seasons`
);

// ─── 14. 2020/2021 COVID season anomaly ──────────────────────────────────

const games2021 = data.filter((g) => g.season === 2021);
const games2020 = data.filter((g) => g.season === 2020);
const ncaat2020 = games2020.filter((g) => g.isNCAAT);
check(
  "2020 COVID season: fewer games or no NCAAT",
  games2020.length < 5000 || ncaat2020.length === 0,
  `2020: ${games2020.length} games, ${ncaat2020.length} NCAAT; 2021: ${games2021.length} games`
);

// ─── 15. KenPom ratings coverage ────────────────────────────────────────

const withKP = data.filter((g) => g.homeAdjOE !== null || g.awayAdjOE !== null);
check(
  "KenPom ratings coverage > 50%",
  withKP.length / data.length > 0.5,
  `${withKP.length}/${data.length} (${((withKP.length / data.length) * 100).toFixed(1)}%)`
);

// ─── 16. KenPom AdjEM reasonable range ──────────────────────────────────

const badAdjEM = data.filter(
  (g) =>
    (g.homeAdjEM !== null && (g.homeAdjEM < -40 || g.homeAdjEM > 45)) ||
    (g.awayAdjEM !== null && (g.awayAdjEM < -40 || g.awayAdjEM > 45))
);
check(
  "KenPom AdjEM in reasonable range (-40 to 45)",
  badAdjEM.length === 0,
  `${badAdjEM.length} out-of-range AdjEM values`
);

// ─── 17. FanMatch predictions coverage (2014+) ─────────────────────────

const post2014 = data.filter((g) => g.season >= 2014);
const withFM = post2014.filter((g) => g.fmHomePred !== null);
const fmCoverage = post2014.length > 0 ? withFM.length / post2014.length : 0;
check(
  "FanMatch coverage > 30% (2014+)",
  fmCoverage > 0.3 || post2014.length === 0,
  `${withFM.length}/${post2014.length} (${(fmCoverage * 100).toFixed(1)}%)`
);

// ─── 18. FanMatch predicted scores reasonable ───────────────────────────

const badFM = data.filter(
  (g) =>
    (g.fmHomePred !== null && (g.fmHomePred < 20 || g.fmHomePred > 150)) ||
    (g.fmAwayPred !== null && (g.fmAwayPred < 20 || g.fmAwayPred > 150))
);
check(
  "FanMatch predictions in range (20-150)",
  badFM.length === 0,
  `${badFM.length} out-of-range predictions`
);

// ─── 19. Spread result verification (where spreads exist) ───────────────

const withSpread = data.filter((g) => g.spread !== null);
const badSpread = withSpread.filter((g) => {
  const margin = g.scoreDifference + g.spread;
  let expected;
  if (margin > 0) expected = "COVERED";
  else if (margin < 0) expected = "LOST";
  else expected = "PUSH";
  return g.spreadResult !== expected;
});
check(
  "Spread results correct (where present)",
  badSpread.length === 0 || withSpread.length === 0,
  `${badSpread.length}/${withSpread.length} mismatches`
);

// ─── 20. Games per season reasonable (4,000-6,500) ──────────────────────

const bySeason = {};
for (const g of data) {
  bySeason[g.season] = (bySeason[g.season] || 0) + 1;
}
const seasonIssues = Object.entries(bySeason)
  .filter(([s, c]) => {
    if (parseInt(s) === 2020) return c < 3000; // COVID season less
    if (parseInt(s) === 2021) return c < 2000; // COVID reduced
    return c < 4000 || c > 7000;
  })
  .map(([s, c]) => `${s}: ${c}`);
check(
  "Games per season in expected range",
  seasonIssues.length === 0,
  `${Object.keys(bySeason).length} seasons${seasonIssues.length > 0 ? ", issues: " + seasonIssues.join(", ") : ""}`,
  seasonIssues
);

// ─── 21. Neutral site only for tournament games ─────────────────────────

const neutralNonTourney = data.filter(
  (g) => g.isNeutralSite && !g.isNCAAT && !g.isNIT && !g.isConfTourney
);
// Some early season neutral site games exist (like Maui Invitational), so just log
const neutralRatio = neutralNonTourney.length / data.length;
check(
  "Neutral site games mostly tournaments",
  neutralNonTourney.length < data.length * 0.05,
  `${neutralNonTourney.length} non-tournament neutral games (${(neutralRatio * 100).toFixed(1)}%)`
);

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log("\n═══════════════════════════════════════");
console.log(`VALIDATION SUMMARY: ${passed} passed, ${failed} failed out of ${results.length} checks`);
console.log("═══════════════════════════════════════");

if (failed > 0) {
  console.log("\nFailed checks:");
  results
    .filter((r) => !r.passed)
    .forEach((r) => console.log(`  ✗ ${r.name}: ${r.details}`));
}

process.exit(failed > 0 ? 1 : 0);
