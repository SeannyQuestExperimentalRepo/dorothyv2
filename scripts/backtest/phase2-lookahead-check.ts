/**
 * Phase 2: Check for KenPom look-ahead bias
 *
 * KenPom ratings on NCAAMBGame are season-level, not point-in-time.
 * For 2025: end-of-season ratings applied to all games
 * For 2026: current (Feb 2026) ratings applied to all games
 *
 * This creates look-ahead bias: early-season games use info from later.
 * Test: does model accuracy vary by month? If look-ahead matters,
 * early-season games should be MORE accurate (bigger info advantage).
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

async function main() {
  console.log("=== Phase 2: KenPom Look-Ahead Bias Check ===\n");

  const rawGames = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, spread: { not: null }, homeAdjEM: { not: null } },
    orderBy: { gameDate: "asc" },
  });

  interface GD {
    game: NCAAMBGame;
    totalScore: number;
    scoreDiff: number;
    emDiff: number;
    sumAdjOE: number;
    sumAdjDE: number;
    avgTempo: number;
  }

  const games: GD[] = [];
  for (const g of rawGames) {
    if (!g.homeAdjOE || !g.awayAdjOE || !g.homeAdjDE || !g.awayAdjDE || !g.homeAdjTempo || !g.awayAdjTempo) continue;
    games.push({
      game: g,
      totalScore: g.homeScore! + g.awayScore!,
      scoreDiff: g.homeScore! - g.awayScore!,
      emDiff: g.homeAdjEM! - g.awayAdjEM!,
      sumAdjOE: g.homeAdjOE + g.awayAdjOE,
      sumAdjDE: g.homeAdjDE + g.awayAdjDE,
      avgTempo: (g.homeAdjTempo + g.awayAdjTempo) / 2,
    });
  }

  // Train O/U model on 2025
  const train = games.filter((g) => g.game.season === 2025);
  const X = train.map((g) => [g.sumAdjDE, g.sumAdjOE, g.avgTempo]);
  const y = train.map((g) => g.totalScore);
  const ouModel = fitOLS(X, y);

  // Train spread model on 2025
  const Xs = train.map((g) => [g.emDiff]);
  const ys = train.map((g) => g.scoreDiff);
  const spreadModel = fitOLS(Xs, ys);

  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ── O/U accuracy by month ──────────────────────────────────────────

  console.log("O/U ACCURACY BY MONTH (Core-3 model, edge >= 1.5)");
  console.log("Month   | 2025 Acc (n)       | 2026 Acc (n)");
  console.log("────────|────────────────────|───────────────────");

  for (const month of [11, 12, 1, 2, 3, 4]) {
    for (const season of [2025, 2026]) {
      const data = games.filter(
        (g) => g.game.season === season && g.game.gameDate.getMonth() + 1 === month,
      );
      let correct = 0, total = 0;
      for (const d of data) {
        if (d.game.ouResult == null || d.game.ouResult === "PUSH" || d.game.overUnder == null) continue;
        const pred = ouModel.intercept + ouModel.coefficients[0] * d.sumAdjDE + ouModel.coefficients[1] * d.sumAdjOE + ouModel.coefficients[2] * d.avgTempo;
        const edge = pred - d.game.overUnder!;
        if (Math.abs(edge) < 1.5) continue;
        const pick = edge > 0 ? "OVER" : "UNDER";
        if (pick === d.game.ouResult) correct++;
        total++;
      }
      if (season === 2025) {
        process.stdout.write(`${monthNames[month].padEnd(7)} | ${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)}) | `);
      } else {
        console.log(`${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)})`);
      }
    }
  }

  // ── Spread accuracy by month ───────────────────────────────────────

  console.log("\nSPREAD ACCURACY BY MONTH (EM-diff model, edge >= 1)");
  console.log("Month   | 2025 Acc (n)       | 2026 Acc (n)");
  console.log("────────|────────────────────|───────────────────");

  for (const month of [11, 12, 1, 2, 3, 4]) {
    for (const season of [2025, 2026]) {
      const data = games.filter(
        (g) => g.game.season === season && g.game.gameDate.getMonth() + 1 === month,
      );
      let correct = 0, total = 0;
      for (const d of data) {
        if (d.game.spreadResult == null || d.game.spreadResult === "PUSH" || d.game.spread == null) continue;
        const pred = spreadModel.intercept + spreadModel.coefficients[0] * d.emDiff;
        const edge = pred + d.game.spread!;
        if (Math.abs(edge) < 1) continue;
        const pick = edge > 0 ? "COVERED" : "LOST";
        if (pick === d.game.spreadResult) correct++;
        total++;
      }
      if (season === 2025) {
        process.stdout.write(`${monthNames[month].padEnd(7)} | ${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)}) | `);
      } else {
        console.log(`${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)})`);
      }
    }
  }

  // ── How different are early-season vs late-season KenPom? ──────────

  console.log("\n--- KenPom AdjEM stability check ---");
  // Check: for teams that appear in both seasons, how much did their AdjEM change?
  // This gives a sense of how "stable" the ratings are
  const homeEMs2025 = new Map<number, number[]>();
  const homeEMs2026 = new Map<number, number[]>();

  for (const g of games) {
    if (g.game.season === 2025) {
      if (!homeEMs2025.has(g.game.homeTeamId)) homeEMs2025.set(g.game.homeTeamId, []);
      homeEMs2025.get(g.game.homeTeamId)!.push(g.game.homeAdjEM!);
    } else if (g.game.season === 2026) {
      if (!homeEMs2026.has(g.game.homeTeamId)) homeEMs2026.set(g.game.homeTeamId, []);
      homeEMs2026.get(g.game.homeTeamId)!.push(g.game.homeAdjEM!);
    }
  }

  // Check if a team's AdjEM is the same across all their games (confirming season-level, not game-level)
  let sameEM = 0, diffEM = 0;
  for (const [tid, ems] of homeEMs2025) {
    const unique = new Set(ems.map((e) => e.toFixed(4)));
    if (unique.size === 1) sameEM++;
    else diffEM++;
  }
  console.log(`2025 teams with identical AdjEM across all games: ${sameEM}/${sameEM + diffEM}`);

  for (const [tid, ems] of homeEMs2026) {
    const unique = new Set(ems.map((e) => e.toFixed(4)));
    if (unique.size === 1) sameEM++;
    else diffEM++;
  }
  console.log(`Including 2026: ${sameEM}/${sameEM + diffEM}`);

  // ── Critical test: Market-relative O/U by month ────────────────────

  console.log("\nMARKET-RELATIVE O/U (predict deviation, Core-3 features)");
  const Xdev = train.map((g) => [g.sumAdjDE, g.sumAdjOE, g.avgTempo]);
  const ydev = train.map((g) => g.totalScore - g.game.overUnder!);
  const devModel = fitOLS(Xdev, ydev);

  console.log("Month   | 2025 Acc (n)       | 2026 Acc (n)");
  console.log("────────|────────────────────|───────────────────");

  for (const month of [11, 12, 1, 2, 3, 4]) {
    for (const season of [2025, 2026]) {
      const data = games.filter(
        (g) => g.game.season === season && g.game.gameDate.getMonth() + 1 === month,
      );
      let correct = 0, total = 0;
      for (const d of data) {
        if (d.game.ouResult == null || d.game.ouResult === "PUSH" || d.game.overUnder == null) continue;
        const pred = devModel.intercept + devModel.coefficients[0] * d.sumAdjDE + devModel.coefficients[1] * d.sumAdjOE + devModel.coefficients[2] * d.avgTempo;
        if (Math.abs(pred) < 1.5) continue;
        const pick = pred > 0 ? "OVER" : "UNDER";
        if (pick === d.game.ouResult) correct++;
        total++;
      }
      if (season === 2025) {
        process.stdout.write(`${monthNames[month].padEnd(7)} | ${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)}) | `);
      } else {
        console.log(`${total > 0 ? (((correct / total) * 100).toFixed(1) + "%").padStart(5) : "  N/A"} (${String(total).padStart(4)})`);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
