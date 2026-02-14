const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();

  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null },
      awayScore: { not: null },
      overUnder: { not: null },
      homeAdjEM: { not: null },
      homeAdjOE: { not: null },
      homeAdjDE: { not: null },
      homeAdjTempo: { not: null },
      awayAdjEM: { not: null },
      awayAdjOE: { not: null },
      awayAdjDE: { not: null },
      awayAdjTempo: { not: null },
    },
    select: {
      season: true, gameDate: true,
      homeScore: true, awayScore: true, overUnder: true,
      homeAdjEM: true, awayAdjEM: true,
      homeAdjOE: true, awayAdjOE: true,
      homeAdjDE: true, awayAdjDE: true,
      homeAdjTempo: true, awayAdjTempo: true,
      fmHomePred: true, fmAwayPred: true,
      isConferenceGame: true,
    },
    orderBy: { gameDate: "asc" },
  });

  // Ridge regression (v8, λ=1000)
  function predictTotal(g) {
    const sumAdjDE = g.homeAdjDE + g.awayAdjDE;
    const sumAdjOE = g.homeAdjOE + g.awayAdjOE;
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const tempoDiff = Math.abs(g.homeAdjTempo - g.awayAdjTempo);
    const emAbsDiff = Math.abs(g.homeAdjEM - g.awayAdjEM);
    const isConf = g.isConferenceGame ? 1 : 0;
    const fmTotal = (g.fmHomePred || 0) + (g.fmAwayPred || 0);
    return -407.6385 + 0.6685 * sumAdjDE + 0.6597 * sumAdjOE +
      3.9804 * avgTempo + -0.1391 * tempoDiff + 0.0064 * emAbsDiff +
      -0.6345 * isConf + 0.0100 * fmTotal;
  }

  // Enrich each game with prediction data
  const enriched = [];
  for (const g of games) {
    const predicted = predictTotal(g);
    const line = g.overUnder;
    const edge = predicted - line;
    const absEdge = Math.abs(edge);
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : null;
    if (!ouDir) continue;

    const actualTotal = g.homeScore + g.awayScore;
    let result;
    if (actualTotal > line) result = ouDir === "over" ? "WIN" : "LOSS";
    else if (actualTotal < line) result = ouDir === "under" ? "WIN" : "LOSS";
    else result = "PUSH";

    enriched.push({ ...g, predicted, edge, absEdge, avgTempo, ouDir, result, line });
  }

  // Count seasons to estimate picks/week
  // NCAAMB season is ~20 weeks (mid-Nov to mid-March + tournament)
  const seasonCounts = {};
  for (const g of enriched) {
    seasonCounts[g.season] = (seasonCounts[g.season] || 0) + 1;
  }
  const numSeasons = Object.keys(seasonCounts).length;
  const WEEKS_PER_SEASON = 20;
  const totalWeeks = numSeasons * WEEKS_PER_SEASON;

  console.log(`Enriched games: ${enriched.length} across ${numSeasons} seasons (~${totalWeeks} weeks)\n`);

  // ── 1. Show edge distribution ──
  console.log("═══ EDGE DISTRIBUTION (all qualifying games) ═══\n");
  const edgeBuckets = [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15];
  for (const minEdge of edgeBuckets) {
    const matching = enriched.filter(g => g.absEdge >= minEdge);
    const wins = matching.filter(g => g.result === "WIN").length;
    const losses = matching.filter(g => g.result === "LOSS").length;
    const total = wins + losses;
    const pct = total > 0 ? ((wins / total) * 100).toFixed(1) : "N/A";
    const perWeek = (matching.length / totalWeeks).toFixed(1);
    console.log(`  edge >= ${String(minEdge).padStart(4)}: ${String(total).padStart(6)} picks  ${pct}%  (~${perWeek}/week)`);
  }

  // ── 2. Show by direction + edge ──
  console.log("\n═══ BY DIRECTION + EDGE ═══\n");
  for (const dir of ["over", "under"]) {
    console.log(`  ${dir.toUpperCase()}:`);
    for (const minEdge of edgeBuckets) {
      const matching = enriched.filter(g => g.ouDir === dir && g.absEdge >= minEdge);
      const wins = matching.filter(g => g.result === "WIN").length;
      const losses = matching.filter(g => g.result === "LOSS").length;
      const total = wins + losses;
      if (total === 0) continue;
      const pct = ((wins / total) * 100).toFixed(1);
      const perWeek = (matching.length / totalWeeks).toFixed(1);
      console.log(`    edge >= ${String(minEdge).padStart(4)}: ${String(total).padStart(6)} picks  ${pct}%  (~${perWeek}/week)`);
    }
  }

  // ── 3. UNDER + tempo filter ──
  console.log("\n═══ UNDER + TEMPO FILTER ═══\n");
  for (const maxTempo of [64, 65, 66, 67, 68]) {
    console.log(`  Tempo <= ${maxTempo}:`);
    for (const minEdge of [2, 3, 4, 5, 7, 10]) {
      const matching = enriched.filter(g => g.ouDir === "under" && g.absEdge >= minEdge && g.avgTempo <= maxTempo);
      const wins = matching.filter(g => g.result === "WIN").length;
      const losses = matching.filter(g => g.result === "LOSS").length;
      const total = wins + losses;
      if (total === 0) continue;
      const pct = ((wins / total) * 100).toFixed(1);
      const perWeek = (matching.length / totalWeeks).toFixed(1);
      console.log(`    edge >= ${String(minEdge).padStart(2)}: ${String(total).padStart(5)} picks  ${pct}%  (~${perWeek}/week)`);
    }
  }

  // ── 4. OVER + line filter ──
  console.log("\n═══ OVER + LINE FILTER ═══\n");
  for (const maxLine of [130, 135, 140, 145, 999]) {
    const label = maxLine === 999 ? "any" : `<= ${maxLine}`;
    console.log(`  Line ${label}:`);
    for (const minEdge of [3, 5, 7, 8, 10, 12]) {
      const matching = enriched.filter(g => g.ouDir === "over" && g.absEdge >= minEdge && (maxLine === 999 || g.line <= maxLine));
      const wins = matching.filter(g => g.result === "WIN").length;
      const losses = matching.filter(g => g.result === "LOSS").length;
      const total = wins + losses;
      if (total === 0) continue;
      const pct = ((wins / total) * 100).toFixed(1);
      const perWeek = (matching.length / totalWeeks).toFixed(1);
      console.log(`    edge >= ${String(minEdge).padStart(2)}: ${String(total).padStart(5)} picks  ${pct}%  (~${perWeek}/week)`);
    }
  }

  // ── 5. Test candidate tier configs ──
  console.log("\n\n═══════════════════════════════════════════════════════");
  console.log("  CANDIDATE TIER CONFIGURATIONS");
  console.log("═══════════════════════════════════════════════════════\n");

  const configs = [
    {
      name: "Config A: Edge-only (simple)",
      tiers: (g) => {
        if (g.absEdge >= 10) return 5;
        if (g.absEdge >= 7) return 4;
        if (g.absEdge >= 4) return 3;
        return 0;
      },
    },
    {
      name: "Config B: Direction-aware",
      tiers: (g) => {
        // OVER is inherently more accurate, so give it lower thresholds for high stars
        if (g.ouDir === "over" && g.absEdge >= 8) return 5;
        if (g.ouDir === "under" && g.absEdge >= 10) return 5;
        if (g.ouDir === "over" && g.absEdge >= 5) return 4;
        if (g.ouDir === "under" && g.absEdge >= 7) return 4;
        if (g.absEdge >= 3) return 3;
        return 0;
      },
    },
    {
      name: "Config C: Direction-aware + tempo (tighter)",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 8) return 5;
        if (g.ouDir === "under" && g.absEdge >= 7 && g.avgTempo <= 65) return 5;
        if (g.ouDir === "over" && g.absEdge >= 5) return 4;
        if (g.ouDir === "under" && g.absEdge >= 5 && g.avgTempo <= 67) return 4;
        if (g.absEdge >= 3) return 3;
        return 0;
      },
    },
    {
      name: "Config D: Very selective 5★",
      tiers: (g) => {
        if (g.absEdge >= 12) return 5;
        if (g.ouDir === "over" && g.absEdge >= 7) return 4;
        if (g.ouDir === "under" && g.absEdge >= 7 && g.avgTempo <= 66) return 4;
        if (g.absEdge >= 4) return 3;
        return 0;
      },
    },
    {
      name: "Config E: Strict monotonic",
      tiers: (g) => {
        // 5★: OVER edge >= 10 OR edge >= 12 (any dir)
        if (g.ouDir === "over" && g.absEdge >= 10) return 5;
        if (g.absEdge >= 12) return 5;
        // 4★: OVER edge >= 7 OR UNDER edge >= 8 + slow tempo
        if (g.ouDir === "over" && g.absEdge >= 7) return 4;
        if (g.ouDir === "under" && g.absEdge >= 8 && g.avgTempo <= 66) return 4;
        // 3★: edge >= 4
        if (g.absEdge >= 4) return 3;
        return 0;
      },
    },
  ];

  for (const config of configs) {
    console.log(`\n── ${config.name} ──\n`);
    const buckets = {};
    let totalPicks = 0;

    for (const g of enriched) {
      const stars = config.tiers(g);
      if (stars === 0) continue;
      totalPicks++;
      if (!buckets[stars]) buckets[stars] = { win: 0, loss: 0, push: 0 };
      buckets[stars][g.result.toLowerCase()]++;
    }

    let prevPct = 0;
    let monotonic = true;
    for (let s = 3; s <= 5; s++) {
      const r = buckets[s] || { win: 0, loss: 0, push: 0 };
      const total = r.win + r.loss;
      const pct = total > 0 ? (r.win / total) * 100 : 0;
      const perWeek = ((r.win + r.loss + r.push) / totalWeeks).toFixed(1);
      if (s > 3 && pct < prevPct) monotonic = false;
      prevPct = pct;
      console.log(`  ${s}★: ${String(r.win).padStart(5)}W - ${String(r.loss).padStart(5)}L - ${String(r.push).padStart(3)}P  (${pct.toFixed(1)}%)  ~${perWeek}/week`);
    }

    const allW = Object.values(buckets).reduce((a, b) => a + b.win, 0);
    const allL = Object.values(buckets).reduce((a, b) => a + b.loss, 0);
    const allP = Object.values(buckets).reduce((a, b) => a + b.push, 0);
    const allTotal = allW + allL;
    console.log(`  ALL: ${allW}W - ${allL}L - ${allP}P  (${((allW / allTotal) * 100).toFixed(1)}%)  ~${(totalPicks / totalWeeks).toFixed(1)}/week`);
    console.log(`  Monotonic (3★ < 4★ < 5★): ${monotonic ? "YES ✓" : "NO ✗"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
