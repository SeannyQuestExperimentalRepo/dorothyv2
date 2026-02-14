const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();

  // Query all completed NCAAMB games with KenPom data and closing lines
  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null },
      awayScore: { not: null },
      overUnder: { not: null },
      spread: { not: null },
      homeAdjEM: { not: null },
      awayAdjEM: { not: null },
      homeAdjOE: { not: null },
      awayAdjOE: { not: null },
      homeAdjDE: { not: null },
      awayAdjDE: { not: null },
      homeAdjTempo: { not: null },
      awayAdjTempo: { not: null },
    },
    select: {
      season: true,
      gameDate: true,
      homeScore: true,
      awayScore: true,
      spread: true,
      overUnder: true,
      homeAdjEM: true,
      awayAdjEM: true,
      homeAdjOE: true,
      awayAdjOE: true,
      homeAdjDE: true,
      awayAdjDE: true,
      homeAdjTempo: true,
      awayAdjTempo: true,
      fmHomePred: true,
      fmAwayPred: true,
      isConferenceGame: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: { gameDate: "asc" },
  });

  console.log(`Total games with KenPom data + lines: ${games.length}\n`);

  // ── Ridge regression coefficients (v8, λ=1000) ──
  function predictTotal(g) {
    const homeDE = g.homeAdjDE;
    const awayDE = g.awayAdjDE;
    const sumAdjDE = homeDE + awayDE;
    const sumAdjOE = g.homeAdjOE + g.awayAdjOE;
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const tempoDiff = Math.abs(g.homeAdjTempo - g.awayAdjTempo);
    const emAbsDiff = Math.abs(g.homeAdjEM - g.awayAdjEM);
    const isConf = g.isConferenceGame ? 1 : 0;
    const fmTotal = (g.fmHomePred || 0) + (g.fmAwayPred || 0);

    return (
      -407.6385 +
      0.6685 * sumAdjDE +
      0.6597 * sumAdjOE +
      3.9804 * avgTempo +
      -0.1391 * tempoDiff +
      0.0064 * emAbsDiff +
      -0.6345 * isConf +
      0.0100 * fmTotal
    );
  }

  // ── Star tier logic (v8.1) ──
  function getStarTier(absEdge, avgTempo, ouDir, line) {
    if (ouDir === "under" && absEdge >= 2.0 && avgTempo <= 67) {
      return 5; // 75.7% OOS
    } else if (
      (ouDir === "under" && absEdge >= 2.0) ||
      (ouDir === "over" && line < 140 && absEdge >= 5.0)
    ) {
      return 4; // 70.7% OOS
    } else if (absEdge >= 1.5) {
      return 3; // 63.3% OOS
    }
    return 0; // No pick
  }

  // ── Run backtest ──
  const results = { overall: {}, bySeason: {}, byEdgeBucket: {} };
  const seasonYears = new Set();

  for (const g of games) {
    const predicted = predictTotal(g);
    const line = g.overUnder;
    const edge = predicted - line;
    const absEdge = Math.abs(edge);
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : "neutral";

    if (ouDir === "neutral") continue;

    const stars = getStarTier(absEdge, avgTempo, ouDir, line);
    if (stars === 0) continue;

    // Actual result
    const actualTotal = g.homeScore + g.awayScore;
    let result;
    if (actualTotal > line) {
      result = ouDir === "over" ? "WIN" : "LOSS";
    } else if (actualTotal < line) {
      result = ouDir === "under" ? "WIN" : "LOSS";
    } else {
      result = "PUSH";
    }

    // Track overall
    const key = `${stars}`;
    if (!results.overall[key]) results.overall[key] = { win: 0, loss: 0, push: 0 };
    results.overall[key][result.toLowerCase()]++;

    // Track by season
    seasonYears.add(g.season);
    const sKey = `${g.season}|${stars}`;
    if (!results.bySeason[sKey]) results.bySeason[sKey] = { win: 0, loss: 0, push: 0 };
    results.bySeason[sKey][result.toLowerCase()]++;

    // Track by edge bucket
    const bucket = absEdge >= 10 ? "10+" : absEdge >= 7 ? "7-10" : absEdge >= 5 ? "5-7" : absEdge >= 3 ? "3-5" : absEdge >= 2 ? "2-3" : "1.5-2";
    const bKey = `${bucket}|${stars}`;
    if (!results.byEdgeBucket[bKey]) results.byEdgeBucket[bKey] = { win: 0, loss: 0, push: 0 };
    results.byEdgeBucket[bKey][result.toLowerCase()]++;
  }

  // ── Print results ──
  console.log("════════════════════════════════════════════════════");
  console.log("  NCAAMB O/U BACKTEST — Ridge v8.1 Star Tiers");
  console.log("════════════════════════════════════════════════════\n");

  // Overall
  console.log("┌─────────┬──────────────────────┬─────────┬────────┐");
  console.log("│ Stars   │ Record               │ Win %   │ Sample │");
  console.log("├─────────┼──────────────────────┼─────────┼────────┤");

  let totalW = 0, totalL = 0, totalP = 0;
  for (let s = 5; s >= 3; s--) {
    const r = results.overall[s] || { win: 0, loss: 0, push: 0 };
    const total = r.win + r.loss;
    const pct = total > 0 ? ((r.win / total) * 100).toFixed(1) : "N/A";
    totalW += r.win; totalL += r.loss; totalP += r.push;
    console.log(`│ ${s}★      │ ${String(r.win).padStart(4)}W - ${String(r.loss).padStart(4)}L - ${String(r.push).padStart(3)}P │ ${String(pct).padStart(5)}%  │ ${String(total).padStart(5)}  │`);
  }
  const allTotal = totalW + totalL;
  const allPct = allTotal > 0 ? ((totalW / allTotal) * 100).toFixed(1) : "N/A";
  console.log("├─────────┼──────────────────────┼─────────┼────────┤");
  console.log(`│ ALL     │ ${String(totalW).padStart(4)}W - ${String(totalL).padStart(4)}L - ${String(totalP).padStart(3)}P │ ${String(allPct).padStart(5)}%  │ ${String(allTotal).padStart(5)}  │`);
  console.log("└─────────┴──────────────────────┴─────────┴────────┘");

  // By season
  const sortedSeasons = [...seasonYears].sort();
  console.log(`\n── BY SEASON ──\n`);

  for (const season of sortedSeasons) {
    console.log(`  ${season} season:`);
    for (let s = 5; s >= 3; s--) {
      const r = results.bySeason[`${season}|${s}`] || { win: 0, loss: 0, push: 0 };
      const total = r.win + r.loss;
      if (total === 0) continue;
      const pct = ((r.win / total) * 100).toFixed(1);
      console.log(`    ${s}★: ${r.win}W - ${r.loss}L - ${r.push}P  (${pct}%)  [n=${total}]`);
    }
  }

  // By direction
  console.log(`\n── OVER vs UNDER ──\n`);
  const byDir = { over: { win: 0, loss: 0, push: 0 }, under: { win: 0, loss: 0, push: 0 } };
  const byDirStars = {};
  for (const g of games) {
    const predicted = predictTotal(g);
    const line = g.overUnder;
    const edge = predicted - line;
    const absEdge = Math.abs(edge);
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : "neutral";
    if (ouDir === "neutral") continue;
    const stars = getStarTier(absEdge, avgTempo, ouDir, line);
    if (stars === 0) continue;
    const actualTotal = g.homeScore + g.awayScore;
    let result;
    if (actualTotal > line) result = ouDir === "over" ? "WIN" : "LOSS";
    else if (actualTotal < line) result = ouDir === "under" ? "WIN" : "LOSS";
    else result = "PUSH";
    byDir[ouDir][result.toLowerCase()]++;
    const dKey = `${ouDir}|${stars}`;
    if (!byDirStars[dKey]) byDirStars[dKey] = { win: 0, loss: 0, push: 0 };
    byDirStars[dKey][result.toLowerCase()]++;
  }

  for (const dir of ["over", "under"]) {
    const r = byDir[dir];
    const total = r.win + r.loss;
    const pct = total > 0 ? ((r.win / total) * 100).toFixed(1) : "N/A";
    console.log(`  ${dir.toUpperCase().padEnd(6)}: ${r.win}W - ${r.loss}L - ${r.push}P  (${pct}%)  [n=${total}]`);
    for (let s = 5; s >= 3; s--) {
      const sr = byDirStars[`${dir}|${s}`] || { win: 0, loss: 0, push: 0 };
      const st = sr.win + sr.loss;
      if (st === 0) continue;
      const sp = ((sr.win / st) * 100).toFixed(1);
      console.log(`    ${s}★: ${sr.win}W - ${sr.loss}L - ${sr.push}P  (${sp}%)  [n=${st}]`);
    }
  }

  // Spread backtest (simple: EM-diff vs spread)
  console.log(`\n════════════════════════════════════════════════════`);
  console.log(`  NCAAMB SPREAD — KenPom EM-Diff`);
  console.log(`════════════════════════════════════════════════════\n`);

  let spreadW = 0, spreadL = 0, spreadP = 0;
  const spreadByEdge = {};
  for (const g of games) {
    if (g.spread === null) continue;
    const homeEM = g.homeAdjEM;
    const awayEM = g.awayAdjEM;
    const emDiff = homeEM - awayEM; // positive = home better
    const predictedSpread = -(emDiff); // negative = home favored (same convention as spread)
    // Actually spread convention: negative = home favored
    // emDiff positive = home better, so predicted spread = -emDiff (home favored)
    // Edge = how much the model disagrees with the line
    const spreadEdge = g.spread - predictedSpread; // if positive, model thinks home is better than line suggests
    const absSpreadEdge = Math.abs(spreadEdge);

    if (absSpreadEdge < 2) continue; // Skip tiny edges

    const pickHome = spreadEdge > 0; // model favors home more than line
    const actualMargin = g.homeScore - g.awayScore;
    // Did our pick cover?
    let result;
    const coverMargin = actualMargin + g.spread; // positive = home covered
    if (pickHome) {
      result = coverMargin > 0 ? "WIN" : coverMargin < 0 ? "LOSS" : "PUSH";
    } else {
      result = coverMargin < 0 ? "WIN" : coverMargin > 0 ? "LOSS" : "PUSH";
    }

    if (result === "WIN") spreadW++;
    else if (result === "LOSS") spreadL++;
    else spreadP++;

    const bucket = absSpreadEdge >= 7 ? "7+" : absSpreadEdge >= 5 ? "5-7" : absSpreadEdge >= 3 ? "3-5" : "2-3";
    if (!spreadByEdge[bucket]) spreadByEdge[bucket] = { win: 0, loss: 0, push: 0 };
    spreadByEdge[bucket][result.toLowerCase()]++;
  }

  const spreadTotal = spreadW + spreadL;
  const spreadPct = spreadTotal > 0 ? ((spreadW / spreadTotal) * 100).toFixed(1) : "N/A";
  console.log(`  Overall (edge >= 2): ${spreadW}W - ${spreadL}L - ${spreadP}P  (${spreadPct}%)  [n=${spreadTotal}]`);

  for (const bucket of ["2-3", "3-5", "5-7", "7+"]) {
    const r = spreadByEdge[bucket] || { win: 0, loss: 0, push: 0 };
    const t = r.win + r.loss;
    if (t === 0) continue;
    const p = ((r.win / t) * 100).toFixed(1);
    console.log(`    Edge ${bucket}: ${r.win}W - ${r.loss}L - ${r.push}P  (${p}%)  [n=${t}]`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
