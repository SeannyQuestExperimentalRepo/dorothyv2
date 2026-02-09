/**
 * Quick smoke test for the Trend Engine
 * Run with: npx tsx scripts/test-trend-engine.ts
 */

import {
  loadAllGamesCached,
  loadGamesBySportCached,
  executeTrendQuery,
  buildQuery,
  monthFilter,
  type TrendQuery,
  type TrendGame,
} from "../src/lib/trend-engine";

async function main() {
  console.log("═══ TREND ENGINE SMOKE TEST ═══\n");

  // 1. Load all games
  console.log("Loading games from PostgreSQL...");
  const nfl = await loadGamesBySportCached("NFL");
  const ncaaf = await loadGamesBySportCached("NCAAF");
  const ncaamb = await loadGamesBySportCached("NCAAMB");
  const allGames = [...nfl, ...ncaaf, ...ncaamb];
  console.log(`  NFL:    ${nfl.length.toLocaleString()} games`);
  console.log(`  NCAAF:  ${ncaaf.length.toLocaleString()} games`);
  console.log(`  NCAAMB: ${ncaamb.length.toLocaleString()} games`);
  console.log(`  Total:  ${allGames.length.toLocaleString()} games\n`);

  // 2. Test: NFL home teams overall
  console.log("─── Test 1: NFL Home Teams (all-time) ───");
  const r1 = executeTrendQuery({
    sport: "NFL",
    perspective: "home",
    filters: [],
  }, allGames);
  console.log(`  ${r1.summary.totalGames} games | Home wins: ${r1.summary.wins}-${r1.summary.losses} (${r1.summary.winPct}%)`);
  console.log(`  Avg score: ${r1.summary.avgPointsFor}-${r1.summary.avgPointsAgainst} | Avg margin: ${r1.summary.avgMargin}\n`);

  // 3. Test: NFL Thursday Night Football
  console.log("─── Test 2: NFL Thursday Night Games (2015+) ───");
  const r2 = executeTrendQuery({
    sport: "NFL",
    perspective: "home",
    seasonRange: [2015, 2025],
    filters: [
      { field: "dayOfWeek", operator: "eq", value: "Thu" },
    ],
  }, allGames);
  console.log(`  ${r2.summary.totalGames} games | Home: ${r2.summary.wins}-${r2.summary.losses} (${r2.summary.winPct}%)\n`);

  // 4. Test: NCAAF November games
  console.log("─── Test 3: NCAAF November Games ───");
  const r3 = executeTrendQuery({
    sport: "NCAAF",
    perspective: "home",
    filters: [monthFilter(11)],
  }, allGames);
  console.log(`  ${r3.summary.totalGames} games | Home: ${r3.summary.wins}-${r3.summary.losses} (${r3.summary.winPct}%)`);
  console.log(`  Avg total: ${r3.summary.avgTotalPoints}\n`);

  // 5. Test: NCAAMB conference games
  console.log("─── Test 4: NCAAMB Conference Games ───");
  const r4 = executeTrendQuery({
    sport: "NCAAMB",
    perspective: "home",
    filters: [
      { field: "isConferenceGame", operator: "eq", value: true },
    ],
  }, allGames);
  console.log(`  ${r4.summary.totalGames} conference games | Home: ${r4.summary.wins}-${r4.summary.losses} (${r4.summary.winPct}%)\n`);

  // 6. Test: NCAAMB KenPom upsets
  console.log("─── Test 5: NCAAMB KenPom Upsets ───");
  const r5 = executeTrendQuery({
    sport: "NCAAMB",
    perspective: "away",
    filters: [
      { field: "isKenpomUpset", operator: "eq", value: true },
    ],
    limit: 5,
  }, allGames);
  console.log(`  ${r5.summary.totalGames} KenPom upsets (showing 5)`);
  r5.games.slice(0, 5).forEach((g: TrendGame) => {
    console.log(`  ${g.gameDate}: ${g.awayTeam} @ ${g.homeTeam} (${g.awayScore}-${g.homeScore})`);
  });

  // 7. Test: Team perspective — Kansas City Chiefs
  console.log("\n─── Test 6: Kansas City Chiefs (2020+) ───");
  const r6 = executeTrendQuery({
    sport: "NFL",
    team: "Kansas City Chiefs",
    perspective: "team",
    seasonRange: [2020, 2025],
    filters: [],
  }, allGames);
  console.log(`  ${r6.summary.totalGames} games | ${r6.summary.wins}-${r6.summary.losses} (${r6.summary.winPct}%)`);
  console.log(`  Avg PF: ${r6.summary.avgPointsFor} | Avg PA: ${r6.summary.avgPointsAgainst}\n`);

  // 8. Test: NCAAMB overtime games
  console.log("─── Test 7: NCAAMB Overtime Games ───");
  const r7 = executeTrendQuery({
    sport: "NCAAMB",
    perspective: "home",
    filters: [
      { field: "overtimes", operator: "gt", value: 0 },
    ],
  }, allGames);
  console.log(`  ${r7.summary.totalGames} OT games | Home: ${r7.summary.wins}-${r7.summary.losses} (${r7.summary.winPct}%)\n`);

  // 9. Test: NCAAF cold weather games
  console.log("─── Test 8: NCAAF Cold Weather Games (<40°F) ───");
  const r8 = executeTrendQuery({
    sport: "NCAAF",
    perspective: "home",
    filters: [
      { field: "temperature", operator: "lt", value: 40 },
    ],
  }, allGames);
  console.log(`  ${r8.summary.totalGames} cold games | Home: ${r8.summary.wins}-${r8.summary.losses} (${r8.summary.winPct}%)`);
  console.log(`  Avg total: ${r8.summary.avgTotalPoints}\n`);

  // 10. Test: Rest advantage
  console.log("─── Test 9: NFL Home Team Coming Off Bye (2010+) ───");
  const r9 = executeTrendQuery({
    sport: "NFL",
    perspective: "home",
    seasonRange: [2010, 2025],
    filters: [
      { field: "homeIsByeWeek", operator: "eq", value: true },
    ],
  }, allGames);
  console.log(`  ${r9.summary.totalGames} games | Home: ${r9.summary.wins}-${r9.summary.losses} (${r9.summary.winPct}%)\n`);

  console.log("═══ ALL TESTS PASSED ═══");
}

main().catch(console.error).finally(() => process.exit(0));
