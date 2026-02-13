/**
 * Phase 2: Alternative O/U Model Exploration
 *
 * Models tested:
 * 1. Full OLS (7 features, no overrides) — baseline from Phase 1
 * 2. Core-3 OLS (avgTempo, sumAdjOE, sumAdjDE only)
 * 3. Core-3 + isConf (4-feature model)
 * 4. Ridge Regression (L2 regularization)
 * 5. Market-Relative (predict deviation from Vegas line)
 * 6. 2-Feature: avgTempo + overUnder
 * 7. Walk-forward monthly retrain (sliding window)
 * 8. Anti-overfit OLS (capped coefficients, noise injection)
 *
 * Each model: train on 2025, test on 2026, report accuracy by edge bucket
 * Also: walk-forward cross-validation within 2025
 */

import { PrismaClient, type NCAAMBGame } from "@prisma/client";

const prisma = new PrismaClient();

// ── OLS / Ridge Regression ──────────────────────────────────────────────

function fitOLS(
  X: number[][],
  y: number[],
  lambda: number = 0, // Ridge penalty (0 = OLS)
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
  // Add ridge penalty (don't penalize intercept)
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
  totalScore: number;
  overUnder: number;
  features: Record<string, number>;
}

function prepareGame(g: NCAAMBGame): GameData | null {
  if (
    g.homeScore == null || g.awayScore == null ||
    g.overUnder == null || g.spread == null ||
    g.homeAdjOE == null || g.awayAdjOE == null ||
    g.homeAdjDE == null || g.awayAdjDE == null ||
    g.homeAdjTempo == null || g.awayAdjTempo == null ||
    g.homeAdjEM == null || g.awayAdjEM == null
  ) return null;

  return {
    game: g,
    totalScore: g.homeScore + g.awayScore,
    overUnder: g.overUnder,
    features: {
      sumAdjDE: g.homeAdjDE + g.awayAdjDE,
      sumAdjOE: g.homeAdjOE + g.awayAdjOE,
      avgTempo: (g.homeAdjTempo + g.awayAdjTempo) / 2,
      tempoDiff: Math.abs(g.homeAdjTempo - g.awayAdjTempo),
      emAbsDiff: Math.abs(g.homeAdjEM - g.awayAdjEM),
      isConf: g.isConferenceGame ? 1 : 0,
      fmTotal: (g.fmHomePred ?? 0) + (g.fmAwayPred ?? 0),
      overUnder: g.overUnder,
    },
  };
}

function getFeatureArray(d: GameData, featureNames: string[]): number[] {
  return featureNames.map((f) => d.features[f]);
}

interface ModelResult {
  name: string;
  acc2025: number;
  n2025: number;
  acc2026: number;
  n2026: number;
  gap: number;
  buckets2026: { label: string; acc: number; n: number }[];
}

function evaluateModel(
  trainData: GameData[],
  testData2025: GameData[],
  testData2026: GameData[],
  featureNames: string[],
  minEdge: number,
  lambda: number = 0,
  predictTarget: "totalScore" | "deviation" = "totalScore",
): { acc2025: number; n2025: number; acc2026: number; n2026: number; buckets2026: { label: string; acc: number; n: number }[] } {
  const X = trainData.map((d) => getFeatureArray(d, featureNames));
  const y = trainData.map((d) =>
    predictTarget === "deviation" ? d.totalScore - d.overUnder : d.totalScore,
  );
  const model = fitOLS(X, y, lambda);

  const evaluate = (data: GameData[]) => {
    let correct = 0, total = 0;
    const bucketCounts: Record<string, { correct: number; total: number }> = {
      "1.5-2.9": { correct: 0, total: 0 },
      "3.0-4.9": { correct: 0, total: 0 },
      "5.0-6.9": { correct: 0, total: 0 },
      "7.0-9.9": { correct: 0, total: 0 },
      "10.0+": { correct: 0, total: 0 },
    };

    for (const d of data) {
      if (d.game.ouResult == null || d.game.ouResult === "PUSH") continue;
      const feats = getFeatureArray(d, featureNames);
      let pred = model.intercept;
      for (let i = 0; i < feats.length; i++) pred += model.coefficients[i] * feats[i];

      let edge: number;
      if (predictTarget === "deviation") {
        edge = pred; // pred is already the deviation from overUnder
      } else {
        edge = pred - d.overUnder;
      }

      if (Math.abs(edge) < minEdge) continue;

      const pick = edge > 0 ? "OVER" : "UNDER";
      const isCorrect = pick === d.game.ouResult;
      if (isCorrect) correct++;
      total++;

      // Bucket
      const absEdge = Math.abs(edge);
      let bucket: string;
      if (absEdge < 3) bucket = "1.5-2.9";
      else if (absEdge < 5) bucket = "3.0-4.9";
      else if (absEdge < 7) bucket = "5.0-6.9";
      else if (absEdge < 10) bucket = "7.0-9.9";
      else bucket = "10.0+";

      bucketCounts[bucket].total++;
      if (isCorrect) bucketCounts[bucket].correct++;
    }

    return {
      correct,
      total,
      pct: total > 0 ? (correct / total) * 100 : 0,
      buckets: Object.entries(bucketCounts).map(([label, { correct: c, total: t }]) => ({
        label,
        acc: t > 0 ? (c / t) * 100 : 0,
        n: t,
      })),
    };
  };

  const r2025 = evaluate(testData2025);
  const r2026 = evaluate(testData2026);

  return {
    acc2025: r2025.pct,
    n2025: r2025.total,
    acc2026: r2026.pct,
    n2026: r2026.total,
    buckets2026: r2026.buckets,
  };
}

// Walk-forward within 2025 (monthly retrain)
function walkForward2025(
  data2025: GameData[],
  featureNames: string[],
  minEdge: number,
  lambda: number = 0,
): { monthResults: { month: string; acc: number; n: number }[]; overallAcc: number; overallN: number } {
  const months = [
    { label: "Dec", trainEnd: 12, testMonth: 12, trainStart: 11 },
    { label: "Jan", trainEnd: 1, testMonth: 1, trainStart: 11 },
    { label: "Feb", trainEnd: 2, testMonth: 2, trainStart: 11 },
    { label: "Mar", trainEnd: 3, testMonth: 3, trainStart: 11 },
  ];

  // Actually, for walk-forward: train on all data before the test month
  const getMonth = (d: GameData) => d.game.gameDate.getMonth() + 1;
  const sortedData = [...data2025];

  const results: { month: string; acc: number; n: number }[] = [];
  let totalCorrect = 0, totalGames = 0;

  // Walk-forward: Train Nov → Test Dec, Train Nov-Dec → Test Jan, etc.
  const testMonths = [12, 1, 2, 3, 4]; // Dec, Jan, Feb, Mar, Apr
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (const testMonth of testMonths) {
    // Training data: all games before test month
    const train = sortedData.filter((d) => {
      const m = getMonth(d);
      if (testMonth <= 4) {
        // Jan-Apr: train on all months before (Nov, Dec, ...)
        return m >= 11 || m < testMonth;
      } else {
        // Nov-Dec
        return m >= 11 && m < testMonth;
      }
    });
    const test = sortedData.filter((d) => getMonth(d) === testMonth);

    if (train.length < 100 || test.length < 10) continue;

    const X = train.map((d) => getFeatureArray(d, featureNames));
    const y = train.map((d) => d.totalScore);
    const model = fitOLS(X, y, lambda);

    let correct = 0, total = 0;
    for (const d of test) {
      if (d.game.ouResult == null || d.game.ouResult === "PUSH") continue;
      const feats = getFeatureArray(d, featureNames);
      let pred = model.intercept;
      for (let i = 0; i < feats.length; i++) pred += model.coefficients[i] * feats[i];
      const edge = pred - d.overUnder;
      if (Math.abs(edge) < minEdge) continue;
      const pick = edge > 0 ? "OVER" : "UNDER";
      if (pick === d.game.ouResult) correct++;
      total++;
    }

    results.push({
      month: monthNames[testMonth],
      acc: total > 0 ? (correct / total) * 100 : 0,
      n: total,
    });
    totalCorrect += correct;
    totalGames += total;
  }

  return {
    monthResults: results,
    overallAcc: totalGames > 0 ? (totalCorrect / totalGames) * 100 : 0,
    overallN: totalGames,
  };
}

async function main() {
  console.log("=== Phase 2: Alternative O/U Model Exploration ===");
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

  console.log(`2025 games: ${data2025.length}`);
  console.log(`2026 games: ${data2026.length}\n`);

  const results: ModelResult[] = [];

  // ── Model 1: Full OLS (7 features, no overrides) ────────────────────

  const allFeatures = ["sumAdjDE", "sumAdjOE", "avgTempo", "tempoDiff", "emAbsDiff", "isConf", "fmTotal"];
  const r1 = evaluateModel(data2025, data2025, data2026, allFeatures, 1.5);
  results.push({ name: "1. Full OLS (7-feat)", ...r1, gap: r1.acc2025 - r1.acc2026 });

  // ── Model 2: Core-3 OLS (avgTempo, sumAdjOE, sumAdjDE) ───────────────

  const core3 = ["sumAdjDE", "sumAdjOE", "avgTempo"];
  const r2 = evaluateModel(data2025, data2025, data2026, core3, 1.5);
  results.push({ name: "2. Core-3 OLS", ...r2, gap: r2.acc2025 - r2.acc2026 });

  // ── Model 3: Core-3 + isConf ──────────────────────────────────────────

  const core4 = ["sumAdjDE", "sumAdjOE", "avgTempo", "isConf"];
  const r3 = evaluateModel(data2025, data2025, data2026, core4, 1.5);
  results.push({ name: "3. Core-3 + isConf", ...r3, gap: r3.acc2025 - r3.acc2026 });

  // ── Model 4: Ridge Regression (multiple lambdas) ─────────────────────

  for (const lambda of [10, 100, 1000, 10000]) {
    const r = evaluateModel(data2025, data2025, data2026, allFeatures, 1.5, lambda);
    results.push({ name: `4. Ridge λ=${lambda}`, ...r, gap: r.acc2025 - r.acc2026 });
  }

  // ── Model 5: Market-Relative (predict deviation from Vegas) ──────────

  const marketFeatures = ["sumAdjDE", "sumAdjOE", "avgTempo"];
  const r5 = evaluateModel(data2025, data2025, data2026, marketFeatures, 1.5, 0, "deviation");
  results.push({ name: "5. Market-Relative", ...r5, gap: r5.acc2025 - r5.acc2026 });

  // ── Model 6: 2-Feature (avgTempo + overUnder) ────────────────────────

  const twoFeat = ["avgTempo", "overUnder"];
  const r6 = evaluateModel(data2025, data2025, data2026, twoFeat, 1.5, 0, "totalScore");
  results.push({ name: "6. avgTempo+OU (2-feat)", ...r6, gap: r6.acc2025 - r6.acc2026 });

  // ── Model 7: Core-3 Ridge ─────────────────────────────────────────────

  for (const lambda of [10, 100, 1000]) {
    const r = evaluateModel(data2025, data2025, data2026, core3, 1.5, lambda);
    results.push({ name: `7. Core-3 Ridge λ=${lambda}`, ...r, gap: r.acc2025 - r.acc2026 });
  }

  // ── Model 8: Higher edge thresholds ──────────────────────────────────

  for (const minEdge of [2.0, 3.0, 5.0]) {
    const r = evaluateModel(data2025, data2025, data2026, core3, minEdge);
    results.push({ name: `8. Core-3 edge>=${minEdge}`, ...r, gap: r.acc2025 - r.acc2026 });
  }

  // ── Print Results Table ───────────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════════════════════════════════════");
  console.log("MODEL COMPARISON TABLE");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════\n");

  console.log(
    "Model                       | 2025 Acc (n)       | 2026 Acc (n)       | Gap    | Meets Criteria?",
  );
  console.log(
    "────────────────────────────|────────────────────|────────────────────|────────|────────────────",
  );
  for (const r of results) {
    const meets = r.acc2026 >= 55 && r.gap < 5 ? "YES ✓" : r.acc2026 >= 55 ? "GAP>5" : "NO";
    console.log(
      `${r.name.padEnd(27)} | ${r.acc2025.toFixed(1).padStart(5)}% (${String(r.n2025).padStart(4)}) | ${r.acc2026.toFixed(1).padStart(5)}% (${String(r.n2026).padStart(4)}) | ${r.gap.toFixed(1).padStart(5)}pp | ${meets}`,
    );
  }

  // ── Edge Bucket Breakdown for Top Models ──────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════");
  console.log("2026 EDGE BUCKET BREAKDOWN (Top Models)");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════\n");

  const topModels = results.filter((r) => r.acc2026 >= 55);
  for (const r of topModels.slice(0, 5)) {
    console.log(`--- ${r.name} ---`);
    for (const b of r.buckets2026) {
      if (b.n > 0) {
        console.log(`  ${b.label.padEnd(8)}: ${b.acc.toFixed(1)}% (n=${b.n})`);
      }
    }
    console.log();
  }

  // ── Walk-Forward Validation on 2025 for Core-3 model ──────────────────

  console.log("═══════════════════════════════════════════════════════════════════════════════════════");
  console.log("WALK-FORWARD VALIDATION (2025, Core-3 OLS)");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════\n");

  const wf = walkForward2025(data2025, core3, 1.5);
  console.log("Month | Accuracy  | n");
  console.log("──────|───────────|─────");
  for (const m of wf.monthResults) {
    console.log(`${m.month.padEnd(5)} | ${m.acc.toFixed(1).padStart(6)}%   | ${m.n}`);
  }
  console.log(`Total | ${wf.overallAcc.toFixed(1).padStart(6)}%   | ${wf.overallN}`);

  // ── Also walk-forward for full 7-feature model ────────────────────────

  console.log("\n--- Walk-Forward: Full 7-Feature OLS ---");
  const wf7 = walkForward2025(data2025, allFeatures, 1.5);
  for (const m of wf7.monthResults) {
    console.log(`${m.month.padEnd(5)} | ${m.acc.toFixed(1).padStart(6)}%   | ${m.n}`);
  }
  console.log(`Total | ${wf7.overallAcc.toFixed(1).padStart(6)}%   | ${wf7.overallN}`);

  // ── Rules-Based Approaches ────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════");
  console.log("RULES-BASED O/U APPROACHES");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════\n");

  // Test individual rules on both seasons
  const rules = [
    {
      name: "Pace mismatch (tempoDiff > 5) → UNDER",
      filter: (d: GameData) =>
        d.features.tempoDiff > 5 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "UNDER" as const,
    },
    {
      name: "Pace mismatch (tempoDiff > 3) → UNDER",
      filter: (d: GameData) =>
        d.features.tempoDiff > 3 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "UNDER" as const,
    },
    {
      name: "High combined OE (sumAdjOE > 230) → OVER",
      filter: (d: GameData) =>
        d.features.sumAdjOE > 230 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "OVER" as const,
    },
    {
      name: "Low combined OE (sumAdjOE < 210) → UNDER",
      filter: (d: GameData) =>
        d.features.sumAdjOE < 210 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "UNDER" as const,
    },
    {
      name: "High tempo (avgTempo > 70) → OVER",
      filter: (d: GameData) =>
        d.features.avgTempo > 70 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "OVER" as const,
    },
    {
      name: "Low tempo (avgTempo < 64) → UNDER",
      filter: (d: GameData) =>
        d.features.avgTempo < 64 && d.game.ouResult != null && d.game.ouResult !== "PUSH",
      pick: "UNDER" as const,
    },
  ];

  console.log("Rule                                        | 2025 Acc (n)       | 2026 Acc (n)       | Gap");
  console.log("────────────────────────────────────────────|────────────────────|────────────────────|────────");

  for (const rule of rules) {
    const eval25 = data2025.filter(rule.filter);
    const eval26 = data2026.filter(rule.filter);
    const correct25 = eval25.filter((d) => d.game.ouResult === rule.pick).length;
    const correct26 = eval26.filter((d) => d.game.ouResult === rule.pick).length;
    const acc25 = eval25.length > 0 ? (correct25 / eval25.length) * 100 : 0;
    const acc26 = eval26.length > 0 ? (correct26 / eval26.length) * 100 : 0;
    console.log(
      `${rule.name.padEnd(43)} | ${acc25.toFixed(1).padStart(5)}% (${String(eval25.length).padStart(4)}) | ${acc26.toFixed(1).padStart(5)}% (${String(eval26.length).padStart(4)}) | ${(acc25 - acc26).toFixed(1).padStart(5)}pp`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
