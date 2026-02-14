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
    return { ...g, actualTotal: g.homeScore + g.awayScore, avgTempo,
      sumDE: g.homeAdjDE + g.awayAdjDE, sumOE: g.homeAdjOE + g.awayAdjOE,
      tempoDiff: Math.abs(g.homeAdjTempo - g.awayAdjTempo),
      isConf: g.isConferenceGame ? 1 : 0, tempoSq: avgTempo * avgTempo };
  });

  const topModels = [
    { name: "E: Quadratic tempo", features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoSq, g.tempoDiff, g.isConf] },
    { name: "A: Minimal (3 features)", features: g => [1, g.sumDE, g.sumOE, g.avgTempo] },
  ];

  // Hand-crafted tier configs based on edge distributions
  const tierConfigs = [
    {
      name: "T1: O≥20=5★, O≥15|U≥12=4★, edge≥10=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 20) return 5;
        if (p.ouDir === "over" && p.absEdge >= 15) return 4;
        if (p.ouDir === "under" && p.absEdge >= 12) return 4;
        if (p.absEdge >= 10) return 3;
        return 0;
      },
    },
    {
      name: "T2: O≥18=5★, O≥12|U≥12=4★, edge≥8=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 18) return 5;
        if (p.ouDir === "over" && p.absEdge >= 12) return 4;
        if (p.ouDir === "under" && p.absEdge >= 12) return 4;
        if (p.absEdge >= 8) return 3;
        return 0;
      },
    },
    {
      name: "T3: O≥18|U≥15=5★, O≥12|U≥10=4★, edge≥8=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 18) return 5;
        if (p.ouDir === "under" && p.absEdge >= 15) return 5;
        if (p.ouDir === "over" && p.absEdge >= 12) return 4;
        if (p.ouDir === "under" && p.absEdge >= 10) return 4;
        if (p.absEdge >= 8) return 3;
        return 0;
      },
    },
    {
      name: "T4: O≥20|U≥15=5★, O≥15|U≥10=4★, edge≥8=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 20) return 5;
        if (p.ouDir === "under" && p.absEdge >= 15) return 5;
        if (p.ouDir === "over" && p.absEdge >= 15) return 4;
        if (p.ouDir === "under" && p.absEdge >= 10) return 4;
        if (p.absEdge >= 8) return 3;
        return 0;
      },
    },
    {
      name: "T5: edge≥20=5★, O≥12|U≥12=4★, edge≥7=3★",
      fn: (p) => {
        if (p.absEdge >= 20) return 5;
        if (p.ouDir === "over" && p.absEdge >= 12) return 4;
        if (p.ouDir === "under" && p.absEdge >= 12) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
    {
      name: "T6: edge≥18=5★, edge≥12=4★, edge≥7=3★",
      fn: (p) => {
        if (p.absEdge >= 18) return 5;
        if (p.absEdge >= 12) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
    {
      name: "T7: O≥18|U≥15=5★, edge≥12=4★, edge≥7=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 18) return 5;
        if (p.ouDir === "under" && p.absEdge >= 15) return 5;
        if (p.absEdge >= 12) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
    {
      name: "T8: O≥15|U≥15=5★, O≥10|U≥10=4★, edge≥7=3★",
      fn: (p) => {
        if (p.absEdge >= 15) return 5;
        if (p.absEdge >= 10) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
    {
      name: "T9: O≥20=5★, O≥12|U≥10=4★, edge≥7=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 20) return 5;
        if (p.ouDir === "over" && p.absEdge >= 12) return 4;
        if (p.ouDir === "under" && p.absEdge >= 10) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
    {
      name: "T10: O≥18=5★, O≥10|U≥10=4★, edge≥7=3★",
      fn: (p) => {
        if (p.ouDir === "over" && p.absEdge >= 18) return 5;
        if (p.ouDir === "over" && p.absEdge >= 10) return 4;
        if (p.ouDir === "under" && p.absEdge >= 10) return 4;
        if (p.absEdge >= 7) return 3;
        return 0;
      },
    },
  ];

  for (const model of topModels) {
    const train = all.filter(g => g.season <= 2024);
    const test = all.filter(g => g.season >= 2025);
    const beta = ridge(train.map(g => model.features(g)), train.map(g => g.actualTotal), 1000);

    const enrich = (dataset) => dataset.map(g => {
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
      return { ...g, predicted, edge, absEdge, ouDir, result };
    }).filter(p => p.ouDir !== null);

    const testPreds = enrich(test);
    const allPreds = enrich(all);
    const testWeeks = 30;
    const allWeeks = 17 * 20;

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  ${model.name}`);
    console.log(`  β = [${beta.map(b => b.toFixed(4)).join(", ")}]`);
    console.log(`${"═".repeat(70)}`);

    for (const tier of tierConfigs) {
      // Evaluate on test and full datasets
      function evalSet(preds, weeks) {
        const buckets = {};
        for (const p of preds) {
          const star = tier.fn(p);
          if (star === 0) continue;
          if (!buckets[star]) buckets[star] = { win: 0, loss: 0, push: 0, count: 0 };
          buckets[star][p.result.toLowerCase()]++;
          buckets[star].count++;
        }
        return buckets;
      }

      const testBuckets = evalSet(testPreds, testWeeks);
      const allBuckets = evalSet(allPreds, allWeeks);

      // Quick check: do all 3 tiers exist?
      if (!testBuckets[3] || !testBuckets[4] || !testBuckets[5]) continue;
      const t5 = testBuckets[5], t4 = testBuckets[4], t3 = testBuckets[3];
      const p5 = t5.win / (t5.win + t5.loss) * 100;
      const p4 = t4.win / (t4.win + t4.loss) * 100;
      const p3 = t3.win / (t3.win + t3.loss) * 100;
      const pw5 = (t5.count / testWeeks).toFixed(1);
      const pw4 = (t4.count / testWeeks).toFixed(1);
      const pw3 = (t3.count / testWeeks).toFixed(1);
      const mono = p5 > p4 && p4 > p3;

      // Full dataset numbers
      const a5 = allBuckets[5], a4 = allBuckets[4], a3 = allBuckets[3];
      const ap5 = a5 ? (a5.win / (a5.win + a5.loss) * 100).toFixed(1) : "N/A";
      const ap4 = a4 ? (a4.win / (a4.win + a4.loss) * 100).toFixed(1) : "N/A";
      const ap3 = a3 ? (a3.win / (a3.win + a3.loss) * 100).toFixed(1) : "N/A";
      const apw5 = a5 ? (a5.count / allWeeks).toFixed(1) : "0";
      const apw4 = a4 ? (a4.count / allWeeks).toFixed(1) : "0";
      const apw3 = a3 ? (a3.count / allWeeks).toFixed(1) : "0";

      console.log(`\n  ${tier.name}  ${mono ? "✓ MONO" : "✗"}`);
      console.log(`         TEST (2025-26)                    ALL (2010-26)`);
      console.log(`  5★: ${String(t5.win).padStart(4)}W-${String(t5.loss).padStart(4)}L  ${p5.toFixed(1).padStart(5)}%  ${pw5.padStart(4)}/wk     ${String(a5?.win||0).padStart(5)}W-${String(a5?.loss||0).padStart(5)}L  ${ap5.padStart(5)}%  ${apw5.padStart(4)}/wk`);
      console.log(`  4★: ${String(t4.win).padStart(4)}W-${String(t4.loss).padStart(4)}L  ${p4.toFixed(1).padStart(5)}%  ${pw4.padStart(4)}/wk     ${String(a4?.win||0).padStart(5)}W-${String(a4?.loss||0).padStart(5)}L  ${ap4.padStart(5)}%  ${apw4.padStart(4)}/wk`);
      console.log(`  3★: ${String(t3.win).padStart(4)}W-${String(t3.loss).padStart(4)}L  ${p3.toFixed(1).padStart(5)}%  ${pw3.padStart(4)}/wk     ${String(a3?.win||0).padStart(5)}W-${String(a3?.loss||0).padStart(5)}L  ${ap3.padStart(5)}%  ${apw3.padStart(4)}/wk`);
      console.log(`  Daily: 5★≈${(t5.count/testWeeks/7).toFixed(1)}  4★≈${(t4.count/testWeeks/7).toFixed(1)}  3★≈${(t3.count/testWeeks/7).toFixed(1)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
