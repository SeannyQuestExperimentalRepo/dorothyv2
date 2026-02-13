/**
 * Iteration Batch 2 — Advanced Model Strategies
 *
 * Explores strategies that go beyond simple feature/lambda sweeps:
 *   1. Tiered edge system (high/medium/low confidence with different thresholds)
 *   2. Weighted training (recent games weighted more)
 *   3. 2-stage models (filter stage + prediction stage)
 *   4. Calibrated probability (logistic-style calibration)
 *   5. Adaptive edge by game characteristics
 *   6. Ensemble with diverse models
 *   7. Residual correction models
 *   8. Spread: market-relative improvements
 *   9. Combined O/U + spread scoring optimization
 */

import { PrismaClient, type NCAAMBGame } from "@prisma/client";

const prisma = new PrismaClient();

function fitOLS(X: number[][], y: number[], lambda = 0) {
  const n = X.length;
  const p = X[0].length;
  const Xa = X.map((row) => [1, ...row]);
  const pp = p + 1;
  const XtX: number[][] = Array.from({ length: pp }, () => Array(pp).fill(0));
  for (let i = 0; i < pp; i++)
    for (let j = 0; j < pp; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Xa[k][i] * Xa[k][j];
      XtX[i][j] = s;
    }
  for (let i = 1; i < pp; i++) XtX[i][i] += lambda;
  const Xty: number[] = Array(pp).fill(0);
  for (let i = 0; i < pp; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += Xa[k][i] * y[k];
    Xty[i] = s;
  }
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < pp; col++) {
    let maxR = col;
    for (let r = col + 1; r < pp; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[maxR][col])) maxR = r;
    [aug[col], aug[maxR]] = [aug[maxR], aug[col]];
    const piv = aug[col][col];
    if (Math.abs(piv) < 1e-12) continue;
    for (let j = col; j <= pp; j++) aug[col][j] /= piv;
    for (let r = 0; r < pp; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let j = col; j <= pp; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  const beta = aug.map((row) => row[pp]);
  return { intercept: beta[0], coefficients: beta.slice(1) };
}

function fitWeightedOLS(X: number[][], y: number[], w: number[], lambda = 0) {
  const n = X.length;
  const p = X[0].length;
  const Xa = X.map((row) => [1, ...row]);
  const pp = p + 1;
  const XtWX: number[][] = Array.from({ length: pp }, () => Array(pp).fill(0));
  for (let i = 0; i < pp; i++)
    for (let j = 0; j < pp; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += w[k] * Xa[k][i] * Xa[k][j];
      XtWX[i][j] = s;
    }
  for (let i = 1; i < pp; i++) XtWX[i][i] += lambda;
  const XtWy: number[] = Array(pp).fill(0);
  for (let i = 0; i < pp; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += w[k] * Xa[k][i] * y[k];
    XtWy[i] = s;
  }
  const aug = XtWX.map((row, i) => [...row, XtWy[i]]);
  for (let col = 0; col < pp; col++) {
    let maxR = col;
    for (let r = col + 1; r < pp; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[maxR][col])) maxR = r;
    [aug[col], aug[maxR]] = [aug[maxR], aug[col]];
    const piv = aug[col][col];
    if (Math.abs(piv) < 1e-12) continue;
    for (let j = col; j <= pp; j++) aug[col][j] /= piv;
    for (let r = 0; r < pp; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      for (let j = col; j <= pp; j++) aug[r][j] -= f * aug[col][j];
    }
  }
  const beta = aug.map((row) => row[pp]);
  return { intercept: beta[0], coefficients: beta.slice(1) };
}

interface GameRow {
  game: NCAAMBGame;
  totalScore: number;
  scoreDiff: number;
  overUnder: number;
  spread: number | null;
  ouResult: string;
  spreadResult: string | null;
  homeAdjDE: number; awayAdjDE: number;
  homeAdjOE: number; awayAdjOE: number;
  homeTempo: number; awayTempo: number;
  homeEM: number; awayEM: number;
  homeRank: number; awayRank: number;
  isConf: number; gameMonth: number;
  dayOfSeason: number; // 0-based, from Nov 1
}

function prepareGame(g: NCAAMBGame): GameRow | null {
  if (
    g.homeScore == null || g.awayScore == null ||
    g.overUnder == null || g.ouResult == null || g.ouResult === "PUSH" ||
    g.homeAdjOE == null || g.awayAdjOE == null ||
    g.homeAdjDE == null || g.awayAdjDE == null ||
    g.homeAdjTempo == null || g.awayAdjTempo == null ||
    g.homeAdjEM == null || g.awayAdjEM == null
  ) return null;

  const seasonStart = new Date(g.season === 2025 ? "2024-11-01" : "2025-11-01");
  const dayOfSeason = Math.floor((g.gameDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24));

  return {
    game: g,
    totalScore: g.homeScore + g.awayScore,
    scoreDiff: g.homeScore - g.awayScore,
    overUnder: g.overUnder,
    spread: g.spread,
    ouResult: g.ouResult,
    spreadResult: g.spreadResult,
    homeAdjDE: g.homeAdjDE, awayAdjDE: g.awayAdjDE,
    homeAdjOE: g.homeAdjOE, awayAdjOE: g.awayAdjOE,
    homeTempo: g.homeAdjTempo, awayTempo: g.awayAdjTempo,
    homeEM: g.homeAdjEM, awayEM: g.awayAdjEM,
    homeRank: g.homeKenpomRank ?? 200,
    awayRank: g.awayKenpomRank ?? 200,
    isConf: g.isConferenceGame ? 1 : 0,
    gameMonth: g.gameDate.getMonth() + 1,
    dayOfSeason: Math.max(0, dayOfSeason),
  };
}

function getFeatures(g: GameRow): number[] {
  return [
    g.homeAdjDE + g.awayAdjDE,
    g.homeAdjOE + g.awayAdjOE,
    (g.homeTempo + g.awayTempo) / 2,
    Math.abs(g.homeTempo - g.awayTempo),
    Math.abs(g.homeEM - g.awayEM),
    g.isConf,
  ];
}

function getCore3(g: GameRow): number[] {
  return [
    g.homeAdjDE + g.awayAdjDE,
    g.homeAdjOE + g.awayAdjOE,
    (g.homeTempo + g.awayTempo) / 2,
  ];
}

interface EvalResult {
  correct: number;
  total: number;
  pct: number;
  roi: number;
}

function grade(acc2026: number, gap: number, roi2026: number, n2026: number): number {
  if (acc2026 < 55 || gap > 8 || n2026 < 100) return 0;
  const accScore = Math.min(100, Math.max(0, (acc2026 - 55) / 15 * 100));
  const gapScore = Math.min(100, Math.max(0, (8 - gap) / 8 * 100));
  const roiScore = Math.min(100, Math.max(0, roi2026 / 40 * 100));
  const volScore = Math.min(100, Math.max(0, (n2026 - 200) / 1200 * 100));
  return 0.40 * accScore + 0.25 * gapScore + 0.20 * roiScore + 0.15 * volScore;
}

async function main() {
  console.log("=== Iteration Batch 2 — Advanced Model Strategies ===");
  console.log(`Date: ${new Date().toISOString()}\n`);

  const rawGames = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, overUnder: { not: null }, homeAdjEM: { not: null } },
    orderBy: { gameDate: "asc" },
  });

  const allGames = rawGames.map(prepareGame).filter(Boolean) as GameRow[];
  const data2025 = allGames.filter((g) => g.game.season === 2025);
  const data2026 = allGames.filter((g) => g.game.season === 2026);

  console.log(`Games: 2025=${data2025.length}, 2026=${data2026.length}\n`);

  interface ExperimentResult {
    name: string;
    category: string;
    acc2025: number;
    acc2026: number;
    gap: number;
    n2025: number;
    n2026: number;
    roi2025: number;
    roi2026: number;
    grade: number;
  }

  const results: ExperimentResult[] = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 1: Tiered Edge Systems
  // Instead of a single minEdge, use different thresholds for different tiers
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("═══ Experiment 1: Tiered Edge Systems ═══\n");

  // Train base model
  const X6 = data2025.map(getFeatures);
  const y6 = data2025.map((d) => d.totalScore);
  const baseModel = fitOLS(X6, y6, 1000);

  // Test tiered systems: [tier3_min, tier4_min, tier5_min]
  // Tier 3 = 3-star (low conf), Tier 4 = 4-star (medium), Tier 5 = 5-star (high)
  const tierConfigs = [
    { name: "Tier: 1.5/3/5",  t3: 1.5, t4: 3, t5: 5 },
    { name: "Tier: 1.5/3/7",  t3: 1.5, t4: 3, t5: 7 },
    { name: "Tier: 2/4/7",    t3: 2, t4: 4, t5: 7 },
    { name: "Tier: 2/5/8",    t3: 2, t4: 5, t5: 8 },
    { name: "Tier: 3/5/7",    t3: 3, t4: 5, t5: 7 },
    { name: "Tier: 3/5/10",   t3: 3, t4: 5, t5: 10 },
    { name: "Tier: 2/3/5",    t3: 2, t4: 3, t5: 5 },
    { name: "Tier: 1/2/5",    t3: 1, t4: 2, t5: 5 },
    // Only high-confidence: skip tier 3
    { name: "Tier: -/5/7",    t3: 999, t4: 5, t5: 7 },
    { name: "Tier: -/5/10",   t3: 999, t4: 5, t5: 10 },
    { name: "Tier: -/3/7",    t3: 999, t4: 3, t5: 7 },
    { name: "Tier: -/7/10",   t3: 999, t4: 7, t5: 10 },
  ];

  for (const tc of tierConfigs) {
    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const feats = getFeatures(d);
        let pred = baseModel.intercept;
        for (let i = 0; i < feats.length; i++) pred += baseModel.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;
        const absEdge = Math.abs(edge);

        // Tiered: only pick if edge exceeds at least tier 3
        if (absEdge < Math.min(tc.t3, tc.t4, tc.t5)) continue;

        // Assign tier (for weighting)
        let betSize = 0;
        if (absEdge >= tc.t5) betSize = 3; // 3 units on 5-star
        else if (absEdge >= tc.t4) betSize = 2; // 2 units on 4-star
        else if (absEdge >= tc.t3) betSize = 1; // 1 unit on 3-star
        else continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        const isCorrect = pick === d.ouResult;
        if (isCorrect) { correct++; units += betSize; }
        else units -= betSize * 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (tc as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (tc as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: tc.name,
          category: "tiered-edge",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi,
          grade: g,
        });
        console.log(`  ${tc.name.padEnd(20)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | ROI=${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 2: Weighted Training (recent games matter more)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 2: Weighted Training ═══\n");

  // Weight schemes: exponential decay, linear, step function
  const weightSchemes = [
    { name: "Uniform", fn: (_day: number) => 1.0 },
    { name: "Linear 1-2x", fn: (day: number) => 1.0 + day / 180 },
    { name: "Linear 1-3x", fn: (day: number) => 1.0 + 2 * day / 180 },
    { name: "Exp decay τ=60", fn: (day: number) => Math.exp(-(180 - day) / 60) },
    { name: "Exp decay τ=90", fn: (day: number) => Math.exp(-(180 - day) / 90) },
    { name: "Exp decay τ=120", fn: (day: number) => Math.exp(-(180 - day) / 120) },
    { name: "Step 2x last 60d", fn: (day: number) => day >= 120 ? 2.0 : 1.0 },
    { name: "Step 3x last 60d", fn: (day: number) => day >= 120 ? 3.0 : 1.0 },
    { name: "Step 2x last 90d", fn: (day: number) => day >= 90 ? 2.0 : 1.0 },
    { name: "Conf season only", fn: (_day: number, g: GameRow) => g.isConf ? 2.0 : 1.0 },
    { name: "Drop first 30d", fn: (day: number) => day < 30 ? 0.01 : 1.0 },
    { name: "Drop first 60d", fn: (day: number) => day < 60 ? 0.01 : 1.0 },
  ];

  for (const ws of weightSchemes) {
    const weights = data2025.map((d) => ws.fn(d.dayOfSeason, d));
    const wModel = fitWeightedOLS(X6, y6, weights, 1000);

    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const feats = getFeatures(d);
        let pred = wModel.intercept;
        for (let i = 0; i < feats.length; i++) pred += wModel.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;
        if (Math.abs(edge) < 1.5) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (ws as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (ws as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `W: ${ws.name}`,
          category: "weighted-training",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${ws.name.padEnd(22)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | ROI=${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 3: 2-Stage Models (filter + predict)
  // Stage 1: Classify whether game is "predictable" (use different features)
  // Stage 2: Run regression only on "predictable" games
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 3: 2-Stage Filter Models ═══\n");

  // Filter strategies: games most likely to be predictable
  const filterStrategies = [
    { name: "No filter (baseline)", fn: (_g: GameRow) => true },
    { name: "Both ranked <=150", fn: (g: GameRow) => g.homeRank <= 150 && g.awayRank <= 150 },
    { name: "At least one <=50", fn: (g: GameRow) => g.homeRank <= 50 || g.awayRank <= 50 },
    { name: "Rank gap < 100", fn: (g: GameRow) => Math.abs(g.homeRank - g.awayRank) < 100 },
    { name: "Rank gap >= 100", fn: (g: GameRow) => Math.abs(g.homeRank - g.awayRank) >= 100 },
    { name: "Conference games", fn: (g: GameRow) => g.isConf === 1 },
    { name: "Non-conference", fn: (g: GameRow) => g.isConf === 0 },
    { name: "Line 140-160", fn: (g: GameRow) => g.overUnder >= 140 && g.overUnder <= 160 },
    { name: "Line < 140", fn: (g: GameRow) => g.overUnder < 140 },
    { name: "Line >= 150", fn: (g: GameRow) => g.overUnder >= 150 },
    { name: "Both ranked <=100", fn: (g: GameRow) => g.homeRank <= 100 && g.awayRank <= 100 },
    { name: "Tempo avg > 68", fn: (g: GameRow) => (g.homeTempo + g.awayTempo) / 2 > 68 },
    { name: "Tempo avg <= 66", fn: (g: GameRow) => (g.homeTempo + g.awayTempo) / 2 <= 66 },
    { name: "EM gap > 10", fn: (g: GameRow) => Math.abs(g.homeEM - g.awayEM) > 10 },
    { name: "EM gap <= 5", fn: (g: GameRow) => Math.abs(g.homeEM - g.awayEM) <= 5 },
    { name: "Dec-Feb only", fn: (g: GameRow) => g.gameMonth >= 12 || g.gameMonth <= 2 },
    { name: "Nov only", fn: (g: GameRow) => g.gameMonth === 11 },
  ];

  for (const fs of filterStrategies) {
    // Train on filtered 2025 games
    const trainFiltered = data2025.filter(fs.fn);
    if (trainFiltered.length < 200) continue;

    const Xf = trainFiltered.map(getFeatures);
    const yf = trainFiltered.map((d) => d.totalScore);
    const filteredModel = fitOLS(Xf, yf, 1000);

    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      // Apply filter to test set too
      const testFiltered = data.filter(fs.fn);
      let correct = 0, total = 0, units = 0;

      for (const d of testFiltered) {
        const feats = getFeatures(d);
        let pred = filteredModel.intercept;
        for (let i = 0; i < feats.length; i++) pred += filteredModel.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;
        if (Math.abs(edge) < 1.5) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (fs as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (fs as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `Filter: ${fs.name}`,
          category: "2-stage-filter",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${fs.name.padEnd(25)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) train=${trainFiltered.length} | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 4: Adaptive Edge Thresholds
  // Different minimum edge based on game characteristics
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 4: Adaptive Edge Thresholds ═══\n");

  const adaptiveConfigs = [
    {
      name: "Rank-adaptive",
      getMinEdge: (g: GameRow) => {
        if (g.homeRank <= 100 && g.awayRank <= 100) return 1.0; // Top 100 matchups — more predictable
        if (g.homeRank > 200 || g.awayRank > 200) return 3.0; // Weak teams — need bigger edge
        return 1.5;
      },
    },
    {
      name: "Line-adaptive",
      getMinEdge: (g: GameRow) => {
        if (g.overUnder >= 155) return 2.0; // High-scoring — more volatile
        if (g.overUnder < 130) return 2.0;  // Low-scoring — also volatile
        return 1.0;
      },
    },
    {
      name: "Tempo-adaptive",
      getMinEdge: (g: GameRow) => {
        const avgTempo = (g.homeTempo + g.awayTempo) / 2;
        if (avgTempo > 70) return 2.0;
        if (avgTempo < 64) return 2.0;
        return 1.0;
      },
    },
    {
      name: "EM-gap adaptive",
      getMinEdge: (g: GameRow) => {
        const emGap = Math.abs(g.homeEM - g.awayEM);
        if (emGap > 15) return 1.0; // Big mismatch — more predictable
        if (emGap < 3) return 3.0;  // Close game — harder to predict
        return 1.5;
      },
    },
    {
      name: "Conf-adaptive",
      getMinEdge: (g: GameRow) => {
        return g.isConf ? 1.5 : 2.0; // Conference games more predictable
      },
    },
    {
      name: "Combined adaptive",
      getMinEdge: (g: GameRow) => {
        let base = 1.5;
        if (g.homeRank <= 100 && g.awayRank <= 100) base -= 0.5;
        if (g.homeRank > 200 || g.awayRank > 200) base += 1.0;
        const emGap = Math.abs(g.homeEM - g.awayEM);
        if (emGap > 15) base -= 0.5;
        if (emGap < 3) base += 1.0;
        return Math.max(0.5, Math.min(5.0, base));
      },
    },
    {
      name: "Aggressive combined",
      getMinEdge: (g: GameRow) => {
        let base = 1.0;
        if (g.homeRank > 200 || g.awayRank > 200) base += 1.5;
        const emGap = Math.abs(g.homeEM - g.awayEM);
        if (emGap < 3) base += 1.5;
        return base;
      },
    },
  ];

  for (const ac of adaptiveConfigs) {
    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const feats = getFeatures(d);
        let pred = baseModel.intercept;
        for (let i = 0; i < feats.length; i++) pred += baseModel.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;
        const minEdge = ac.getMinEdge(d);
        if (Math.abs(edge) < minEdge) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (ac as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (ac as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `Adaptive: ${ac.name}`,
          category: "adaptive-edge",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${ac.name.padEnd(25)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | ROI=${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 5: Ensemble with Diverse Models
  // Average predictions from models trained on different subsets/features
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 5: Diverse Ensembles ═══\n");

  // Define model specs for ensemble members
  const ensembleMembers = [
    { feats: getFeatures, lambda: 1000 },                       // Core-6 Ridge
    { feats: getCore3, lambda: 1000 },                           // Core-3 Ridge
    { feats: (g: GameRow) => [g.homeAdjDE, g.awayAdjDE, g.homeAdjOE, g.awayAdjOE, (g.homeTempo + g.awayTempo) / 2], lambda: 1000 }, // 4-way + tempo
    { feats: getFeatures, lambda: 500 },                         // Core-6 Ridge-500
    { feats: getFeatures, lambda: 2000 },                        // Core-6 Ridge-2000
  ];

  // Train all ensemble members
  const trainedMembers = ensembleMembers.map((m) => {
    const X = data2025.map(m.feats);
    const y = data2025.map((d) => d.totalScore);
    return { model: fitOLS(X, y, m.lambda), feats: m.feats };
  });

  // Test different ensemble configurations
  const ensembleConfigs = [
    { name: "Ens: All 5", members: [0, 1, 2, 3, 4] },
    { name: "Ens: 3 λ variants", members: [0, 3, 4] },
    { name: "Ens: 3 feat variants", members: [0, 1, 2] },
    { name: "Ens: Core-6 + Core-3", members: [0, 1] },
    { name: "Ens: Core-6 + 4-way", members: [0, 2] },
    { name: "Ens: Core-3 + 4-way", members: [1, 2] },
  ];

  for (const ec of ensembleConfigs) {
    for (const minEdge of [1.5, 2.0, 3.0]) {
      for (const season of [2025, 2026]) {
        const data = season === 2025 ? data2025 : data2026;
        let correct = 0, total = 0, units = 0;

        for (const d of data) {
          let totalEdge = 0;
          for (const idx of ec.members) {
            const m = trainedMembers[idx];
            const feats = m.feats(d);
            let pred = m.model.intercept;
            for (let i = 0; i < feats.length; i++) pred += m.model.coefficients[i] * feats[i];
            totalEdge += pred - d.overUnder;
          }
          const avgEdge = totalEdge / ec.members.length;
          if (Math.abs(avgEdge) < minEdge) continue;

          const pick = avgEdge > 0 ? "OVER" : "UNDER";
          if (pick === d.ouResult) { correct++; units += 1; }
          else units -= 1.1;
          total++;
        }

        const pct = total > 0 ? (correct / total) * 100 : 0;
        const roi = total > 0 ? (units / total) * 100 : 0;

        if (season === 2025) {
          (ec as any)[`_r25_${minEdge}`] = { pct, total, roi };
        } else {
          const r25 = (ec as any)[`_r25_${minEdge}`];
          const gap = r25.pct - pct;
          const g = grade(pct, gap, roi, total);
          results.push({
            name: `${ec.name} e>=${minEdge}`,
            category: "ensemble",
            acc2025: r25.pct, acc2026: pct, gap,
            n2025: r25.total, n2026: total,
            roi2025: r25.roi, roi2026: roi, grade: g,
          });
          if (minEdge === 1.5) {
            console.log(`  ${(ec.name + ` e>=${minEdge}`).padEnd(30)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | grade=${g.toFixed(1)}`);
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 6: Residual Correction
  // Train a second model on the residuals of the first model
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 6: Residual Correction ═══\n");

  // Step 1: Get residuals from base model on 2025
  const residuals2025 = data2025.map((d) => {
    const feats = getFeatures(d);
    let pred = baseModel.intercept;
    for (let i = 0; i < feats.length; i++) pred += baseModel.coefficients[i] * feats[i];
    return d.totalScore - pred;
  });

  // Step 2: Try to predict residuals with different features
  const residualFeatureSets: [string, (g: GameRow) => number[]][] = [
    ["Rank features", (g) => [g.homeRank, g.awayRank, Math.abs(g.homeRank - g.awayRank)]],
    ["Squared features", (g) => [(g.homeAdjDE + g.awayAdjDE) ** 2, (g.homeAdjOE + g.awayAdjOE) ** 2, ((g.homeTempo + g.awayTempo) / 2) ** 2]],
    ["Interaction features", (g) => [
      (g.homeAdjDE + g.awayAdjDE) * ((g.homeTempo + g.awayTempo) / 2),
      (g.homeAdjOE + g.awayAdjOE) * ((g.homeTempo + g.awayTempo) / 2),
    ]],
    ["Month indicators", (g) => [g.gameMonth === 11 ? 1 : 0, g.gameMonth === 12 ? 1 : 0, g.gameMonth === 1 ? 1 : 0, g.gameMonth === 2 ? 1 : 0]],
    ["Line + conf", (g) => [g.overUnder, g.isConf]],
    ["EM gap + rank gap", (g) => [Math.abs(g.homeEM - g.awayEM), Math.abs(g.homeRank - g.awayRank)]],
  ];

  for (const [name, featFn] of residualFeatureSets) {
    const Xr = data2025.map(featFn);
    const residModel = fitOLS(Xr, residuals2025, 1000);

    // Check residual model R²
    const residMean = residuals2025.reduce((a, b) => a + b, 0) / residuals2025.length;
    const ssTot = residuals2025.reduce((acc, r) => acc + (r - residMean) ** 2, 0);
    let ssRes = 0;
    for (let i = 0; i < data2025.length; i++) {
      const feats = featFn(data2025[i]);
      let pred = residModel.intercept;
      for (let j = 0; j < feats.length; j++) pred += residModel.coefficients[j] * feats[j];
      ssRes += (residuals2025[i] - pred) ** 2;
    }
    const r2 = 1 - ssRes / ssTot;

    // Combined model evaluation
    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const baseFeats = getFeatures(d);
        let basePred = baseModel.intercept;
        for (let i = 0; i < baseFeats.length; i++) basePred += baseModel.coefficients[i] * baseFeats[i];

        const resFeats = featFn(d);
        let resPred = residModel.intercept;
        for (let i = 0; i < resFeats.length; i++) resPred += residModel.coefficients[i] * resFeats[i];

        const combinedPred = basePred + resPred;
        const edge = combinedPred - d.overUnder;
        if (Math.abs(edge) < 1.5) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (featFn as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (featFn as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `Resid: ${name}`,
          category: "residual-correction",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${name.padEnd(25)} | R²=${r2.toFixed(4)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 7: Split Models (different model for different game types)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 7: Split Models ═══\n");

  const splitStrategies = [
    {
      name: "Conf / Non-conf",
      split: (g: GameRow) => g.isConf === 1 ? "conf" : "non-conf",
    },
    {
      name: "Top-100 / Mid / Bottom",
      split: (g: GameRow) => {
        const avgRank = (g.homeRank + g.awayRank) / 2;
        return avgRank <= 100 ? "top" : avgRank <= 200 ? "mid" : "bottom";
      },
    },
    {
      name: "High-line / Mid / Low-line",
      split: (g: GameRow) => {
        return g.overUnder >= 150 ? "high" : g.overUnder >= 135 ? "mid" : "low";
      },
    },
    {
      name: "Fast / Normal / Slow",
      split: (g: GameRow) => {
        const avgTempo = (g.homeTempo + g.awayTempo) / 2;
        return avgTempo >= 69 ? "fast" : avgTempo >= 65 ? "normal" : "slow";
      },
    },
  ];

  for (const ss of splitStrategies) {
    // Train separate models for each split
    const splits = new Map<string, GameRow[]>();
    for (const d of data2025) {
      const key = ss.split(d);
      if (!splits.has(key)) splits.set(key, []);
      splits.get(key)!.push(d);
    }

    const splitModels = new Map<string, { intercept: number; coefficients: number[] }>();
    for (const [key, splitData] of splits) {
      if (splitData.length < 100) continue;
      const X = splitData.map(getFeatures);
      const y = splitData.map((d) => d.totalScore);
      splitModels.set(key, fitOLS(X, y, 1000));
    }

    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const key = ss.split(d);
        const model = splitModels.get(key);
        if (!model) continue;

        const feats = getFeatures(d);
        let pred = model.intercept;
        for (let i = 0; i < feats.length; i++) pred += model.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;
        if (Math.abs(edge) < 1.5) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (ss as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (ss as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `Split: ${ss.name}`,
          category: "split-models",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${ss.name.padEnd(30)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | splits=${splits.size} | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPERIMENT 8: Calibrated Edge → Probability
  // Instead of linear edge → bet, use calibrated probability from 2025 data
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n═══ Experiment 8: Calibrated Probabilities ═══\n");

  // Calibrate: for each edge bucket, what's the actual win probability on 2025?
  const calibrationBuckets = [
    { min: -Infinity, max: -10 },
    { min: -10, max: -7 },
    { min: -7, max: -5 },
    { min: -5, max: -3 },
    { min: -3, max: -1.5 },
    { min: -1.5, max: 1.5 },
    { min: 1.5, max: 3 },
    { min: 3, max: 5 },
    { min: 5, max: 7 },
    { min: 7, max: 10 },
    { min: 10, max: Infinity },
  ];

  // Get calibration from 2025
  const edgeBucketWinRate = calibrationBuckets.map((b) => {
    let wins = 0, total = 0;
    for (const d of data2025) {
      const feats = getFeatures(d);
      let pred = baseModel.intercept;
      for (let i = 0; i < feats.length; i++) pred += baseModel.coefficients[i] * feats[i];
      const edge = pred - d.overUnder;
      if (edge < b.min || edge >= b.max) continue;

      const pick = edge > 0 ? "OVER" : "UNDER";
      if (pick === d.ouResult) wins++;
      total++;
    }
    return { ...b, winRate: total > 0 ? wins / total : 0.5, total };
  });

  console.log("  Edge bucket calibration (2025 training):");
  for (const b of edgeBucketWinRate) {
    const label = b.min === -Infinity ? `< ${b.max}` : b.max === Infinity ? `>= ${b.min}` : `${b.min} to ${b.max}`;
    console.log(`    ${label.padEnd(15)} | winRate=${(b.winRate * 100).toFixed(1)}% | n=${b.total}`);
  }

  // Now use calibrated probabilities with Kelly-style thresholds
  const kellyConfigs = [
    { name: "Kelly 52%", minProb: 0.52 },
    { name: "Kelly 55%", minProb: 0.55 },
    { name: "Kelly 58%", minProb: 0.58 },
    { name: "Kelly 60%", minProb: 0.60 },
    { name: "Kelly 65%", minProb: 0.65 },
  ];

  for (const kc of kellyConfigs) {
    for (const season of [2025, 2026]) {
      const data = season === 2025 ? data2025 : data2026;
      let correct = 0, total = 0, units = 0;

      for (const d of data) {
        const feats = getFeatures(d);
        let pred = baseModel.intercept;
        for (let i = 0; i < feats.length; i++) pred += baseModel.coefficients[i] * feats[i];
        const edge = pred - d.overUnder;

        // Find calibrated probability
        const bucket = edgeBucketWinRate.find((b) => edge >= b.min && edge < b.max);
        if (!bucket || bucket.winRate < kc.minProb) continue;

        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.ouResult) { correct++; units += 1; }
        else units -= 1.1;
        total++;
      }

      const pct = total > 0 ? (correct / total) * 100 : 0;
      const roi = total > 0 ? (units / total) * 100 : 0;

      if (season === 2025) {
        (kc as any)._r25 = { pct, total, roi };
      } else {
        const r25 = (kc as any)._r25;
        const gap = r25.pct - pct;
        const g = grade(pct, gap, roi, total);
        results.push({
          name: `Calibrated: ${kc.name}`,
          category: "calibrated",
          acc2025: r25.pct, acc2026: pct, gap,
          n2025: r25.total, n2026: total,
          roi2025: r25.roi, roi2026: roi, grade: g,
        });
        console.log(`  ${kc.name.padEnd(15)} | 2025: ${r25.pct.toFixed(1)}% (${r25.total}) | 2026: ${pct.toFixed(1)}% (${total}) | gap=${gap.toFixed(1)}pp | ROI=${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% | grade=${g.toFixed(1)}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  results.sort((a, b) => b.grade - a.grade);

  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("BATCH 2 LEADERBOARD — TOP 30");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════\n");

  console.log(
    "#  | Grade | Category            | Name                                     | 2025 Acc | 2026 Acc | Gap    | 2026 ROI | n(2026)",
  );
  console.log(
    "---|-------|---------------------|------------------------------------------|----------|----------|--------|----------|--------",
  );

  for (let i = 0; i < Math.min(30, results.length); i++) {
    const r = results[i];
    console.log(
      `${String(i + 1).padStart(2)} | ${r.grade.toFixed(1).padStart(5)} | ${r.category.padEnd(19)} | ${r.name.padEnd(40)} | ${r.acc2025.toFixed(1).padStart(6)}% | ${r.acc2026.toFixed(1).padStart(6)}% | ${r.gap.toFixed(1).padStart(5)}pp | ${(r.roi2026 >= 0 ? "+" : "") + r.roi2026.toFixed(1).padStart(5)}% | ${String(r.n2026).padStart(6)}`,
    );
  }

  // Category summary
  console.log("\n─── Category Summary ───");
  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const best = catResults[0];
    const passing = catResults.filter((r) => r.acc2026 >= 55 && r.gap <= 5 && r.n2026 >= 200).length;
    console.log(
      `${cat.padEnd(22)} | best: ${best.name.padEnd(35)} | grade=${best.grade.toFixed(1)} | 2026: ${best.acc2026.toFixed(1)}% | gap=${best.gap.toFixed(1)}pp | ${passing}/${catResults.length} pass`,
    );
  }

  const v8Grade = grade(65.7, 4.3, 28.0, 1345);
  const beatsV8 = results.filter((r) => r.grade > v8Grade).length;
  console.log(`\nv8 baseline grade: ${v8Grade.toFixed(1)}`);
  console.log(`Beat v8: ${beatsV8}/${results.length}`);

  console.log("\n✅ Batch 2 complete.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
