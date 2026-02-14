const { PrismaClient } = require("@prisma/client");

// ── Simple OLS solver ──
function ols(X, y) {
  // X is n×p, y is n×1. Returns coefficients β = (X'X)^-1 X'y
  const n = X.length, p = X[0].length;

  // X'X (p×p)
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = j; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  // Symmetrize
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];

  // X'y (p×1)
  const Xty = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
    }
  }

  // Solve via Cholesky decomposition
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = XtX[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = Math.sqrt(Math.max(sum, 1e-10));
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }

  // Forward substitution: L z = X'y
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let sum = Xty[i];
    for (let j = 0; j < i; j++) sum -= L[i][j] * z[j];
    z[i] = sum / L[i][i];
  }

  // Back substitution: L' β = z
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let sum = z[i];
    for (let j = i + 1; j < p; j++) sum -= L[j][i] * beta[j];
    beta[i] = sum / L[i][i];
  }

  return Array.from(beta);
}

// Ridge regression: β = (X'X + λI)^-1 X'y
function ridge(X, y, lambda) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = j; k < p; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];
  // Add ridge penalty (skip intercept at index 0)
  for (let j = 1; j < p; j++) XtX[j][j] += lambda;

  const Xty = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) Xty[j] += X[i][j] * y[i];
  }

  // Solve via Cholesky
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
    let sum = Xty[i];
    for (let j = 0; j < i; j++) sum -= L[i][j] * z[j];
    z[i] = sum / L[i][i];
  }
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let sum = z[i];
    for (let j = i + 1; j < p; j++) sum -= L[j][i] * beta[j];
    beta[i] = sum / L[i][i];
  }
  return Array.from(beta);
}

async function main() {
  const prisma = new PrismaClient();

  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null },
      overUnder: { not: null },
      homeAdjEM: { not: null }, homeAdjOE: { not: null },
      homeAdjDE: { not: null }, homeAdjTempo: { not: null },
      awayAdjEM: { not: null }, awayAdjOE: { not: null },
      awayAdjDE: { not: null }, awayAdjTempo: { not: null },
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

  console.log(`Total games: ${games.length}`);

  // Enrich
  const all = games.map(g => {
    const actualTotal = g.homeScore + g.awayScore;
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    return {
      ...g, actualTotal, avgTempo,
      sumDE: g.homeAdjDE + g.awayAdjDE,
      sumOE: g.homeAdjOE + g.awayAdjOE,
      tempoDiff: Math.abs(g.homeAdjTempo - g.awayAdjTempo),
      emDiff: Math.abs(g.homeAdjEM - g.awayAdjEM),
      isConf: g.isConferenceGame ? 1 : 0,
      fmTotal: (g.fmHomePred || 0) + (g.fmAwayPred || 0),
      // KenPom-theoretical features
      homeExpPts: (g.homeAdjOE / 100) * (g.awayAdjDE / 100) * 100 * (avgTempo / 100),
      awayExpPts: (g.awayAdjOE / 100) * (g.homeAdjDE / 100) * 100 * (avgTempo / 100),
      // Interaction/polynomial features
      tempoSq: avgTempo * avgTempo,
      oeDeInteraction: (g.homeAdjOE - g.awayAdjDE) + (g.awayAdjOE - g.homeAdjDE),
      sumEMabs: Math.abs(g.homeAdjEM) + Math.abs(g.awayAdjEM),
      avgDE: (g.homeAdjDE + g.awayAdjDE) / 2,
      avgOE: (g.homeAdjOE + g.awayAdjOE) / 2,
      deRatio: g.homeAdjDE / g.awayAdjDE,
      oeRatio: g.homeAdjOE / g.awayAdjOE,
      paceProduct: (g.homeAdjTempo * g.awayAdjTempo) / 68, // normalized
    };
  });

  const train = all.filter(g => g.season <= 2024);
  const test = all.filter(g => g.season >= 2025);
  console.log(`Train (<=2024): ${train.length}, Test (>=2025): ${test.length}\n`);

  // ── Define model variants ──
  const models = [
    {
      name: "v8 (current) — Ridge λ=1000, 7 features",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoDiff, g.emDiff, g.isConf, g.fmTotal],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoDiff", "emDiff", "isConf", "fmTotal"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "A: Minimal — 3 features (sumDE, sumOE, avgTempo)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "B: KenPom theoretical — expected points per team",
      features: g => [1, g.homeExpPts + g.awayExpPts],
      labels: ["intercept", "kenpomExpTotal"],
      method: "ols",
    },
    {
      name: "C: KenPom theoretical + tempo correction",
      features: g => [1, g.homeExpPts + g.awayExpPts, g.avgTempo, g.tempoDiff],
      labels: ["intercept", "kenpomExpTotal", "avgTempo", "tempoDiff"],
      method: "ols",
    },
    {
      name: "D: OE-DE interaction model",
      features: g => [1, g.oeDeInteraction, g.avgTempo, g.tempoDiff, g.isConf],
      labels: ["intercept", "oeDeInteraction", "avgTempo", "tempoDiff", "isConf"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "E: Quadratic tempo",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoSq, g.tempoDiff, g.isConf],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoSq", "tempoDiff", "isConf"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "F: Pace-product model",
      features: g => [1, g.sumDE, g.sumOE, g.paceProduct, g.tempoDiff, g.emDiff, g.isConf],
      labels: ["intercept", "sumDE", "sumOE", "paceProduct", "tempoDiff", "emDiff", "isConf"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "G: Kitchen sink (all features)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoDiff, g.emDiff, g.isConf, g.fmTotal,
                       g.tempoSq, g.oeDeInteraction, g.sumEMabs, g.homeExpPts + g.awayExpPts],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoDiff", "emDiff", "isConf", "fmTotal",
               "tempoSq", "oeDeInteraction", "sumEMabs", "kenpomExpTotal"],
      method: "ridge",
      lambda: 1000,
    },
    {
      name: "H: v8 features, OLS (no regularization)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoDiff, g.emDiff, g.isConf, g.fmTotal],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoDiff", "emDiff", "isConf", "fmTotal"],
      method: "ols",
    },
    {
      name: "I: v8 features, Ridge λ=100 (lighter reg)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoDiff, g.emDiff, g.isConf, g.fmTotal],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoDiff", "emDiff", "isConf", "fmTotal"],
      method: "ridge",
      lambda: 100,
    },
    {
      name: "J: v8 features, Ridge λ=5000 (heavier reg)",
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoDiff, g.emDiff, g.isConf, g.fmTotal],
      labels: ["intercept", "sumDE", "sumOE", "avgTempo", "tempoDiff", "emDiff", "isConf", "fmTotal"],
      method: "ridge",
      lambda: 5000,
    },
    {
      name: "K: Per-side efficiency (4 separate OE/DE)",
      features: g => [1, g.homeAdjOE, g.awayAdjOE, g.homeAdjDE, g.awayAdjDE, g.avgTempo, g.tempoDiff, g.isConf],
      labels: ["intercept", "homeOE", "awayOE", "homeDE", "awayDE", "avgTempo", "tempoDiff", "isConf"],
      method: "ridge",
      lambda: 1000,
    },
  ];

  // Config H star tiers (OVER edge>=12 = 5★, OVER edge>=8 = 4★, edge>=5 = 3★)
  function getTier(absEdge, ouDir) {
    if (ouDir === "over" && absEdge >= 12) return 5;
    if (ouDir === "over" && absEdge >= 8) return 4;
    if (ouDir === "under" && absEdge >= 12) return 4;
    if (absEdge >= 5) return 3;
    return 0;
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  MODEL EXPLORATION — Train <=2024, Test >=2025");
  console.log("  Star tiers: 5★=OVER edge>=12, 4★=OVER>=8|UNDER>=12, 3★=edge>=5");
  console.log("══════════════════════════════════════════════════════════════");

  for (const model of models) {
    const Xtrain = train.map(g => model.features(g));
    const ytrain = train.map(g => g.actualTotal);
    const Xtest = test.map(g => model.features(g));

    let beta;
    if (model.method === "ridge") {
      beta = ridge(Xtrain, ytrain, model.lambda);
    } else {
      beta = ols(Xtrain, ytrain);
    }

    // Evaluate on test set
    const testResults = { total: { win: 0, loss: 0, push: 0 }, byTier: {} };
    const trainResults = { total: { win: 0, loss: 0, push: 0 }, byTier: {} };

    function evaluate(dataset, Xdata, results) {
      for (let i = 0; i < dataset.length; i++) {
        const g = dataset[i];
        const predicted = Xdata[i].reduce((sum, x, j) => sum + x * beta[j], 0);
        const edge = predicted - g.overUnder;
        const absEdge = Math.abs(edge);
        const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : null;
        if (!ouDir) continue;

        const tier = getTier(absEdge, ouDir);
        if (tier === 0) continue;

        let result;
        if (g.actualTotal > g.overUnder) result = ouDir === "over" ? "WIN" : "LOSS";
        else if (g.actualTotal < g.overUnder) result = ouDir === "under" ? "WIN" : "LOSS";
        else result = "PUSH";

        results.total[result.toLowerCase()]++;
        if (!results.byTier[tier]) results.byTier[tier] = { win: 0, loss: 0, push: 0 };
        results.byTier[tier][result.toLowerCase()]++;
      }
    }

    evaluate(train, Xtrain, trainResults);
    evaluate(test, Xtest, testResults);

    // Compute RMSE on test
    let sse = 0;
    for (let i = 0; i < test.length; i++) {
      const predicted = Xtest[i].reduce((sum, x, j) => sum + x * beta[j], 0);
      const err = predicted - test[i].actualTotal;
      sse += err * err;
    }
    const rmse = Math.sqrt(sse / test.length);

    // Print
    console.log(`\n── ${model.name} ──`);
    console.log(`  RMSE (test): ${rmse.toFixed(2)}`);

    // Coefficients
    const coefStr = model.labels.map((l, i) => `${l}=${beta[i].toFixed(4)}`).join(", ");
    console.log(`  Coefficients: ${coefStr}`);

    // Train accuracy (all qualifying)
    const trW = trainResults.total.win, trL = trainResults.total.loss;
    const trPct = trW + trL > 0 ? ((trW / (trW + trL)) * 100).toFixed(1) : "N/A";
    console.log(`  Train: ${trW}W-${trL}L (${trPct}%) [n=${trW + trL}]`);

    // Test accuracy by tier
    const teW = testResults.total.win, teL = testResults.total.loss;
    const tePct = teW + teL > 0 ? ((teW / (teW + teL)) * 100).toFixed(1) : "N/A";
    console.log(`  Test:  ${teW}W-${teL}L (${tePct}%) [n=${teW + teL}]`);

    let monotonic = true, prevP = 0;
    for (let s = 3; s <= 5; s++) {
      const r = testResults.byTier[s] || { win: 0, loss: 0, push: 0 };
      const total = r.win + r.loss;
      const pct = total > 0 ? (r.win / total) * 100 : 0;
      if (s > 3 && pct <= prevP && total > 0) monotonic = false;
      prevP = pct;
      // ~weeks in test: 2025 = 20wk + 2026 partial ~10wk = 30wk
      const perWeek = total > 0 ? ((r.win + r.loss + r.push) / 30).toFixed(1) : "0";
      console.log(`    ${s}★: ${r.win}W-${r.loss}L (${pct.toFixed(1)}%) ~${perWeek}/wk`);
    }
    console.log(`  Monotonic: ${monotonic ? "YES ✓" : "NO ✗"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
