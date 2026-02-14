const { PrismaClient } = require("@prisma/client");

function ridge(X, y, lambda) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < p; j++)
      for (let k = j; k < p; k++)
        XtX[j][k] += X[i][j] * X[i][k];
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];
  for (let j = 1; j < p; j++) XtX[j][j] += lambda;
  const Xty = new Float64Array(p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xty[j] += X[i][j] * y[i];
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = XtX[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(sum, 1e-10)) : sum / L[j][j];
    }
  }
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let sum = Xty[i]; for (let j = 0; j < i; j++) sum -= L[i][j] * z[j]; z[i] = sum / L[i][i];
  }
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let sum = z[i]; for (let j = i + 1; j < p; j++) sum -= L[j][i] * beta[j]; beta[i] = sum / L[i][i];
  }
  return Array.from(beta);
}

async function main() {
  const prisma = new PrismaClient();
  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null },
      homeAdjEM: { not: null }, homeAdjOE: { not: null }, homeAdjDE: { not: null },
      homeAdjTempo: { not: null }, awayAdjEM: { not: null }, awayAdjOE: { not: null },
      awayAdjDE: { not: null }, awayAdjTempo: { not: null },
    },
    select: {
      season: true, gameDate: true, homeScore: true, awayScore: true, overUnder: true,
      homeAdjEM: true, awayAdjEM: true, homeAdjOE: true, awayAdjOE: true,
      homeAdjDE: true, awayAdjDE: true, homeAdjTempo: true, awayAdjTempo: true,
      fmHomePred: true, fmAwayPred: true, isConferenceGame: true,
    },
    orderBy: { gameDate: "asc" },
  });

  const all = games.map(g => {
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    return {
      ...g,
      actualTotal: g.homeScore + g.awayScore,
      avgTempo,
      sumDE: g.homeAdjDE + g.awayAdjDE,
      sumOE: g.homeAdjOE + g.awayAdjOE,
      tempoDiff: Math.abs(g.homeAdjTempo - g.awayAdjTempo),
      emDiff: Math.abs(g.homeAdjEM - g.awayAdjEM),
      isConf: g.isConferenceGame ? 1 : 0,
      tempoSq: avgTempo * avgTempo,
    };
  });

  const train = all.filter(g => g.season <= 2024);
  const test = all.filter(g => g.season >= 2025);

  // Top 2 models
  const topModels = [
    {
      name: "E: Quadratic tempo (6 features)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoSq, g.tempoDiff, g.isConf],
    },
    {
      name: "A: Minimal (3 features)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo],
    },
  ];

  for (const model of topModels) {
    const Xtrain = train.map(g => model.features(g));
    const ytrain = train.map(g => g.actualTotal);
    const beta = ridge(Xtrain, ytrain, 1000);

    // Compute predictions for all games
    const predictions = all.map(g => {
      const x = model.features(g);
      const predicted = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = predicted - g.overUnder;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : null;
      let result = null;
      if (ouDir) {
        if (g.actualTotal > g.overUnder) result = ouDir === "over" ? "WIN" : "LOSS";
        else if (g.actualTotal < g.overUnder) result = ouDir === "under" ? "WIN" : "LOSS";
        else result = "PUSH";
      }
      return { ...g, predicted, edge, absEdge, avgTempo: g.avgTempo, ouDir, result, line: g.overUnder };
    }).filter(p => p.ouDir !== null);

    const testPreds = predictions.filter(p => p.season >= 2025);
    // ~30 weeks in test (20 weeks 2025 + ~10 weeks 2026 partial)
    const testWeeks = 30;
    const allWeeks = 17 * 20; // 17 seasons * 20 weeks

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${model.name}`);
    console.log(`  Coefficients: ${beta.map(b => b.toFixed(4)).join(", ")}`);
    console.log(`${"═".repeat(70)}`);

    // Edge distribution on TEST set
    console.log(`\n  ── TEST SET (2025-2026) edge distribution ──\n`);
    console.log(`  ${"Dir".padEnd(7)} ${"Edge≥".padEnd(7)} ${"Picks".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)}`);
    console.log(`  ${"-".repeat(38)}`);

    for (const dir of ["over", "under", "any"]) {
      for (const minEdge of [3, 5, 7, 8, 10, 12, 15, 18, 20]) {
        const matching = testPreds.filter(p =>
          p.absEdge >= minEdge && (dir === "any" || p.ouDir === dir)
        );
        const wins = matching.filter(p => p.result === "WIN").length;
        const losses = matching.filter(p => p.result === "LOSS").length;
        const total = wins + losses;
        if (total < 5) continue;
        const pct = ((wins / total) * 100).toFixed(1);
        const perWeek = (matching.length / testWeeks).toFixed(1);
        console.log(`  ${dir.padEnd(7)} ${String(minEdge).padStart(5)}   ${String(total).padStart(5)}  ${pct.padStart(5)}% ${perWeek.padStart(5)}`);
      }
      if (dir !== "any") console.log();
    }

    // Now sweep tier configs targeting ~2/wk for 5★
    console.log(`\n  ── TIER SWEEPS (test set, targeting 5★ ~2/wk) ──\n`);

    // Generate candidate tier configs
    const tierConfigs = [];
    // Sweep over 5★ thresholds for OVER
    for (const fiveOverEdge of [15, 18, 20]) {
      for (const fiveUnderEdge of [18, 20, 25, 999]) {
        for (const fourOverEdge of [8, 10, 12]) {
          for (const fourUnderEdge of [10, 12, 15]) {
            for (const threeEdge of [3, 4, 5]) {
              if (fourOverEdge >= fiveOverEdge) continue;
              if (fourUnderEdge >= fiveUnderEdge) continue;
              if (threeEdge >= fourOverEdge && threeEdge >= fourUnderEdge) continue;

              tierConfigs.push({
                label: `5★:O≥${fiveOverEdge}${fiveUnderEdge < 999 ? `/U≥${fiveUnderEdge}` : ""} 4★:O≥${fourOverEdge}/U≥${fourUnderEdge} 3★:≥${threeEdge}`,
                fn: (p) => {
                  if (p.ouDir === "over" && p.absEdge >= fiveOverEdge) return 5;
                  if (p.ouDir === "under" && p.absEdge >= fiveUnderEdge) return 5;
                  if (p.ouDir === "over" && p.absEdge >= fourOverEdge) return 4;
                  if (p.ouDir === "under" && p.absEdge >= fourUnderEdge) return 4;
                  if (p.absEdge >= threeEdge) return 3;
                  return 0;
                },
              });
            }
          }
        }
      }
    }

    // Evaluate each config on test set
    const results = [];
    for (const config of tierConfigs) {
      const buckets = {};
      for (const p of testPreds) {
        const tier = config.fn(p);
        if (tier === 0) continue;
        if (!buckets[tier]) buckets[tier] = { win: 0, loss: 0, push: 0, count: 0 };
        buckets[tier][p.result.toLowerCase()]++;
        buckets[tier].count++;
      }

      const five = buckets[5] || { win: 0, loss: 0, push: 0, count: 0 };
      const four = buckets[4] || { win: 0, loss: 0, push: 0, count: 0 };
      const three = buckets[3] || { win: 0, loss: 0, push: 0, count: 0 };

      const fiveTotal = five.win + five.loss;
      const fourTotal = four.win + four.loss;
      const threeTotal = three.win + three.loss;

      if (fiveTotal < 5 || fourTotal < 5 || threeTotal < 5) continue;

      const fivePct = five.win / fiveTotal * 100;
      const fourPct = four.win / fourTotal * 100;
      const threePct = three.win / threeTotal * 100;
      const fivePerWk = five.count / testWeeks;
      const fourPerWk = four.count / testWeeks;

      // Filter: 5★ 2-4/wk, 4★ 7-21/wk (1-3/day), 3★ ~35-63/wk (~5-9/day), monotonic, 5★ > 70%
      const threePerWk = three.count / testWeeks;
      if (fivePerWk < 1.5 || fivePerWk > 5) continue;
      if (fourPerWk < 7 || fourPerWk > 25) continue;
      if (threePerWk < 30 || threePerWk > 70) continue;
      if (fivePct <= fourPct || fourPct <= threePct) continue;
      if (fivePct < 70) continue;

      results.push({
        label: config.label,
        fivePct, fourPct, threePct,
        fivePerWk, fourPerWk,
        fiveN: fiveTotal, fourN: fourTotal, threeN: threeTotal,
        fiveW: five.win, fiveL: five.loss,
        fourW: four.win, fourL: four.loss,
        threeW: three.win, threeL: three.loss,
        score: fivePct * 2 + fourPct + threePct, // weighted score
      });
    }

    // Sort by 5★ win rate
    results.sort((a, b) => b.fivePct - a.fivePct || a.fivePerWk - b.fivePerWk);

    // Show top 15
    const top = results.slice(0, 15);
    console.log(`  Found ${results.length} valid configs. Top 15:\n`);
    for (const r of top) {
      console.log(`  ${r.label}`);
      console.log(`    5★: ${r.fiveW}W-${r.fiveL}L (${r.fivePct.toFixed(1)}%) ~${r.fivePerWk.toFixed(1)}/wk`);
      console.log(`    4★: ${r.fourW}W-${r.fourL}L (${r.fourPct.toFixed(1)}%) ~${r.fourPerWk.toFixed(1)}/wk`);
      console.log(`    3★: ${r.threeW}W-${r.threeL}L (${r.threePct.toFixed(1)}%)`);
      console.log();
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
