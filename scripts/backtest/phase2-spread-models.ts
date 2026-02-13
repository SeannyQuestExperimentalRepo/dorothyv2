/**
 * Phase 2: Alternative Spread Model Exploration
 *
 * Models tested:
 * 1. KenPom Line Value (predict scoreDiff from KenPom, compare to spread)
 * 2. Core-3 Spread OLS (sumAdjDE, sumAdjOE, avgTempo → predict scoreDiff)
 * 3. Ridge Spread (various λ)
 * 4. Market-Relative Spread (predict deviation from spread)
 * 5. EM-diff only (simplest possible model)
 * 6. Various edge thresholds
 */

import { PrismaClient, type NCAAMBGame } from "@prisma/client";

const prisma = new PrismaClient();

function fitOLS(
  X: number[][],
  y: number[],
  lambda: number = 0,
): { coefficients: number[]; intercept: number } {
  const n = X.length;
  const p = X[0].length;
  const Xa = X.map((row) => [1, ...row]);
  const pp = p + 1;

  const XtX: number[][] = Array.from({ length: pp }, () => Array(pp).fill(0));
  for (let i = 0; i < pp; i++) {
    for (let j = 0; j < pp; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += Xa[k][i] * Xa[k][j];
      XtX[i][j] = sum;
    }
  }
  for (let i = 1; i < pp; i++) XtX[i][i] += lambda;

  const Xty: number[] = Array(pp).fill(0);
  for (let i = 0; i < pp; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += Xa[k][i] * y[k];
    Xty[i] = sum;
  }

  const augmented = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < pp; col++) {
    let maxRow = col;
    for (let row = col + 1; row < pp; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) maxRow = row;
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= pp; j++) augmented[col][j] /= pivot;
    for (let row = 0; row < pp; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= pp; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  const beta = augmented.map((row) => row[pp]);
  return { intercept: beta[0], coefficients: beta.slice(1) };
}

interface GameData {
  game: NCAAMBGame;
  scoreDiff: number; // homeScore - awayScore
  spread: number;
  features: Record<string, number>;
}

function prepareGame(g: NCAAMBGame): GameData | null {
  if (
    g.homeScore == null || g.awayScore == null ||
    g.spread == null || g.spreadResult == null ||
    g.homeAdjOE == null || g.awayAdjOE == null ||
    g.homeAdjDE == null || g.awayAdjDE == null ||
    g.homeAdjTempo == null || g.awayAdjTempo == null ||
    g.homeAdjEM == null || g.awayAdjEM == null
  ) return null;

  return {
    game: g,
    scoreDiff: g.homeScore - g.awayScore,
    spread: g.spread,
    features: {
      emDiff: g.homeAdjEM - g.awayAdjEM,
      sumAdjDE: g.homeAdjDE + g.awayAdjDE,
      sumAdjOE: g.homeAdjOE + g.awayAdjOE,
      avgTempo: (g.homeAdjTempo + g.awayAdjTempo) / 2,
      tempoDiff: Math.abs(g.homeAdjTempo - g.awayAdjTempo),
      isConf: g.isConferenceGame ? 1 : 0,
      isNeutral: g.isNeutralSite ? 1 : 0,
      homeOE: g.homeAdjOE,
      awayOE: g.awayAdjOE,
      homeDE: g.homeAdjDE,
      awayDE: g.awayAdjDE,
      homeRank: g.homeKenpomRank ?? 200,
      awayRank: g.awayKenpomRank ?? 200,
      spread: g.spread,
    },
  };
}

function evaluateSpread(
  trainData: GameData[],
  test2025: GameData[],
  test2026: GameData[],
  featureNames: string[],
  minEdge: number,
  lambda: number = 0,
  predictTarget: "scoreDiff" | "deviation" = "scoreDiff",
): { acc2025: number; n2025: number; acc2026: number; n2026: number; roi2025: number; roi2026: number } {
  const X = trainData.map((d) => featureNames.map((f) => d.features[f]));
  const y = trainData.map((d) =>
    predictTarget === "deviation" ? d.scoreDiff + d.spread : d.scoreDiff,
  ); // scoreDiff + spread = margin (positive = home covered)
  const model = fitOLS(X, y, lambda);

  const evaluate = (data: GameData[]) => {
    let correct = 0, total = 0, units = 0;
    for (const d of data) {
      if (d.game.spreadResult == null || d.game.spreadResult === "PUSH") continue;
      const feats = featureNames.map((f) => d.features[f]);
      let pred = model.intercept;
      for (let i = 0; i < feats.length; i++) pred += model.coefficients[i] * feats[i];

      let edge: number;
      if (predictTarget === "deviation") {
        edge = pred; // positive = model says home covers
      } else {
        // pred = predicted scoreDiff
        // spread is negative when home is favored
        // spreadMargin = scoreDiff + spread (positive = home covered)
        // predictedMargin = pred + spread
        edge = pred + d.spread; // positive = model predicts home covers
      }

      if (Math.abs(edge) < minEdge) continue;

      const pick = edge > 0 ? "COVERED" : "LOST"; // COVERED = home covers
      const isCorrect = pick === d.game.spreadResult;
      if (isCorrect) { correct++; units += 1; }
      else units -= 1.1; // -110 odds
      total++;
    }
    return {
      correct,
      total,
      pct: total > 0 ? (correct / total) * 100 : 0,
      roi: total > 0 ? (units / total) * 100 : 0,
    };
  };

  const r25 = evaluate(test2025);
  const r26 = evaluate(test2026);

  return {
    acc2025: r25.pct,
    n2025: r25.total,
    acc2026: r26.pct,
    n2026: r26.total,
    roi2025: r25.roi,
    roi2026: r26.roi,
  };
}

async function main() {
  console.log("=== Phase 2: Alternative Spread Model Exploration ===");
  console.log(`Date: ${new Date().toISOString()}\n`);

  const rawGames2025 = await prisma.nCAAMBGame.findMany({
    where: { season: 2025, homeScore: { not: null }, spread: { not: null }, homeAdjEM: { not: null } },
    orderBy: { gameDate: "asc" },
  });
  const rawGames2026 = await prisma.nCAAMBGame.findMany({
    where: { season: 2026, homeScore: { not: null }, spread: { not: null }, homeAdjEM: { not: null } },
    orderBy: { gameDate: "asc" },
  });

  const data2025 = rawGames2025.map(prepareGame).filter(Boolean) as GameData[];
  const data2026 = rawGames2026.map(prepareGame).filter(Boolean) as GameData[];

  console.log(`2025 spread games: ${data2025.length}`);
  console.log(`2026 spread games: ${data2026.length}\n`);

  interface Result {
    name: string;
    acc2025: number;
    n2025: number;
    acc2026: number;
    n2026: number;
    roi2025: number;
    roi2026: number;
    gap: number;
  }

  const results: Result[] = [];

  // Feature sets to test
  const configs: {
    name: string;
    features: string[];
    minEdge: number;
    lambda: number;
    target: "scoreDiff" | "deviation";
  }[] = [
    // Line Value: predict scoreDiff, compare to spread
    { name: "EM-diff only (edge>=1)", features: ["emDiff"], minEdge: 1, lambda: 0, target: "scoreDiff" },
    { name: "EM-diff only (edge>=2)", features: ["emDiff"], minEdge: 2, lambda: 0, target: "scoreDiff" },
    { name: "EM-diff only (edge>=3)", features: ["emDiff"], minEdge: 3, lambda: 0, target: "scoreDiff" },
    { name: "EM-diff + isNeutral", features: ["emDiff", "isNeutral"], minEdge: 1, lambda: 0, target: "scoreDiff" },
    { name: "KenPom 4-feat", features: ["emDiff", "avgTempo", "isNeutral", "isConf"], minEdge: 1, lambda: 0, target: "scoreDiff" },
    { name: "KenPom 4-feat (edge>=2)", features: ["emDiff", "avgTempo", "isNeutral", "isConf"], minEdge: 2, lambda: 0, target: "scoreDiff" },
    { name: "KenPom 4-feat (edge>=3)", features: ["emDiff", "avgTempo", "isNeutral", "isConf"], minEdge: 3, lambda: 0, target: "scoreDiff" },
    { name: "Full 6-feat", features: ["emDiff", "avgTempo", "tempoDiff", "isNeutral", "isConf", "sumAdjOE"], minEdge: 1, lambda: 0, target: "scoreDiff" },
    { name: "Full 6-feat Ridge λ=100", features: ["emDiff", "avgTempo", "tempoDiff", "isNeutral", "isConf", "sumAdjOE"], minEdge: 1, lambda: 100, target: "scoreDiff" },
    { name: "Full 6-feat Ridge λ=1000", features: ["emDiff", "avgTempo", "tempoDiff", "isNeutral", "isConf", "sumAdjOE"], minEdge: 1, lambda: 1000, target: "scoreDiff" },
    // Market-relative: predict deviation from spread
    { name: "Market-Rel (EM+tempo)", features: ["emDiff", "avgTempo", "isNeutral"], minEdge: 1, lambda: 0, target: "deviation" },
    { name: "Market-Rel (EM+tempo) e>=2", features: ["emDiff", "avgTempo", "isNeutral"], minEdge: 2, lambda: 0, target: "deviation" },
    // Individual OE/DE features
    { name: "4-way (hOE,aOE,hDE,aDE)", features: ["homeOE", "awayOE", "homeDE", "awayDE"], minEdge: 1, lambda: 0, target: "scoreDiff" },
    { name: "4-way Ridge λ=100", features: ["homeOE", "awayOE", "homeDE", "awayDE"], minEdge: 1, lambda: 100, target: "scoreDiff" },
  ];

  for (const c of configs) {
    const r = evaluateSpread(data2025, data2025, data2026, c.features, c.minEdge, c.lambda, c.target);
    results.push({
      name: c.name,
      ...r,
      gap: r.acc2025 - r.acc2026,
    });
  }

  // Print results
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("SPREAD MODEL COMPARISON");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════\n");

  console.log(
    "Model                          | 2025 Acc (n)       | 2026 Acc (n)       | Gap    | 2025 ROI | 2026 ROI | Meets?",
  );
  console.log(
    "───────────────────────────────|────────────────────|────────────────────|────────|──────────|──────────|───────",
  );
  for (const r of results) {
    const meets = r.acc2026 >= 55 && r.gap < 5 ? "YES ✓" : r.acc2026 >= 55 ? "GAP>5" : "NO";
    console.log(
      `${r.name.padEnd(30)} | ${r.acc2025.toFixed(1).padStart(5)}% (${String(r.n2025).padStart(4)}) | ${r.acc2026.toFixed(1).padStart(5)}% (${String(r.n2026).padStart(4)}) | ${r.gap.toFixed(1).padStart(5)}pp | ${(r.roi2025 >= 0 ? "+" : "") + r.roi2025.toFixed(1).padStart(4)}%   | ${(r.roi2026 >= 0 ? "+" : "") + r.roi2026.toFixed(1).padStart(4)}%   | ${meets}`,
    );
  }

  // ── Ensemble: O/U + Spread combined picks ─────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("COMBINED ANALYSIS: Regression Spread vs v7 Signal Convergence");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════\n");

  // How does regression spread compare to v7's 54.3% on 2026?
  // v7 spread uses signal convergence (9 weighted signals) and gets 54.3% on 2026
  // Our best regression approach needs to beat that

  // Also check: ATS fade rule (strong in v5 backtest)
  console.log("--- ATS Fade Rules ---");
  // Games where spread is "wrong" direction based on KenPom
  // If KenPom says home is much better but spread favors away, take home
  let atsFadeCorrect = 0, atsFadeTotal = 0;
  let atsFadeCorrect26 = 0, atsFadeTotal26 = 0;

  for (const d of data2025) {
    if (d.game.spreadResult == null || d.game.spreadResult === "PUSH") continue;
    // emDiff > 0 means home is better by KenPom
    // spread < 0 means home is favored
    // If emDiff and spread disagree strongly (KenPom says home much better but spread says close, or vice versa)
    const kenpomSpread = -d.features.emDiff; // Convert to spread convention
    const lineDiff = d.spread - kenpomSpread;
    if (Math.abs(lineDiff) < 3) continue; // Need meaningful disagreement

    // Bet the KenPom side
    const betHome = kenpomSpread < d.spread; // KenPom says home is better than line suggests
    const homeCovered = d.game.spreadResult === "COVERED";
    if ((betHome && homeCovered) || (!betHome && !homeCovered)) atsFadeCorrect++;
    atsFadeTotal++;
  }

  for (const d of data2026) {
    if (d.game.spreadResult == null || d.game.spreadResult === "PUSH") continue;
    const kenpomSpread = -d.features.emDiff;
    const lineDiff = d.spread - kenpomSpread;
    if (Math.abs(lineDiff) < 3) continue;
    const betHome = kenpomSpread < d.spread;
    const homeCovered = d.game.spreadResult === "COVERED";
    if ((betHome && homeCovered) || (!betHome && !homeCovered)) atsFadeCorrect26++;
    atsFadeTotal26++;
  }

  console.log(`KenPom vs Line (diff >= 3pt):`);
  console.log(`  2025: ${atsFadeCorrect}/${atsFadeTotal} (${((atsFadeCorrect / atsFadeTotal) * 100).toFixed(1)}%)`);
  console.log(`  2026: ${atsFadeCorrect26}/${atsFadeTotal26} (${((atsFadeCorrect26 / atsFadeTotal26) * 100).toFixed(1)}%)`);
  console.log(`  Gap: ${(((atsFadeCorrect / atsFadeTotal) - (atsFadeCorrect26 / atsFadeTotal26)) * 100).toFixed(1)}pp`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
