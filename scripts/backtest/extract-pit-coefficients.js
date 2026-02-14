/**
 * Extract PIT Ridge coefficients for production deployment.
 *
 * Trains Ridge λ=1000 on ALL completed seasons (2012-2025) using
 * point-in-time KenPom snapshots. Outputs the 4 beta coefficients
 * to paste into pick-engine.ts.
 *
 * Also runs a walk-forward validation to confirm accuracy matches
 * the honest backtest results.
 */
const { PrismaClient } = require("@prisma/client");

// ─── KenPom team name mapping ────────────────────────────────────────────────

const DB_TO_KENPOM = {
  "N.C. State": "NC State", "NC State": "NC State",
  "UConn": "Connecticut", "UCONN": "Connecticut",
  "UMass": "Massachusetts", "Ole Miss": "Mississippi",
  "Pitt": "Pittsburgh", "PITT": "Pittsburgh",
  "UCF": "Central Florida", "USC": "Southern California",
  "UNC": "North Carolina", "UNLV": "UNLV", "SMU": "SMU",
  "LSU": "LSU", "VCU": "VCU", "UAB": "UAB", "UTEP": "UTEP",
  "UTSA": "UT San Antonio", "UT Arlington": "UT Arlington",
  "UT Martin": "Tennessee Martin", "FIU": "FIU", "LIU": "LIU",
  "NIU": "Northern Illinois", "SIU": "Southern Illinois",
  "SIU Edwardsville": "SIU Edwardsville",
  "UIC": "Illinois Chicago", "IUPUI": "IUPUI",
  "Miami (FL)": "Miami FL", "Miami (OH)": "Miami OH",
  "Saint Mary's": "Saint Mary's", "St. Mary's": "Saint Mary's",
  "St. John's": "St. John's", "Saint Joseph's": "Saint Joseph's",
  "St. Joseph's": "Saint Joseph's", "Saint Peter's": "Saint Peter's",
  "St. Peter's": "Saint Peter's", "St. Bonaventure": "St. Bonaventure",
  "Saint Bonaventure": "St. Bonaventure",
  "Loyola Chicago": "Loyola Chicago", "Loyola (MD)": "Loyola MD",
  "Loyola Marymount": "Loyola Marymount",
  "Cal St. Bakersfield": "Cal St. Bakersfield",
  "Cal St. Fullerton": "Cal St. Fullerton",
  "Cal St. Northridge": "CSUN", "Seattle": "Seattle",
  "Hawai'i": "Hawaii", "Hawaii": "Hawaii",
  "UNI": "Northern Iowa", "ETSU": "East Tennessee St.",
  "FGCU": "Florida Gulf Coast", "UMBC": "UMBC",
  "SIUE": "SIU Edwardsville",
  "App State": "Appalachian St.", "Appalachian State": "Appalachian St.",
  "BYU": "BYU", "TCU": "TCU", "UNF": "North Florida",
  "UNCG": "UNC Greensboro", "UNCW": "UNC Wilmington",
  "UNCA": "UNC Asheville",
  "Central Connecticut": "Central Connecticut",
  "Central Connecticut State": "Central Connecticut",
  "Cal Poly": "Cal Poly", "Iona": "Iona", "Gonzaga": "Gonzaga",
  "Saint Louis": "Saint Louis", "St. Louis": "Saint Louis",
  "UNC Greensboro": "UNC Greensboro", "UNC Wilmington": "UNC Wilmington",
  "UNC Asheville": "UNC Asheville", "NJIT": "NJIT",
  "FAU": "Florida Atlantic", "WKU": "Western Kentucky",
  "Middle Tennessee": "Middle Tennessee", "MTSU": "Middle Tennessee",
  "South Florida": "South Florida", "USF": "South Florida",
  "North Texas": "North Texas", "Louisiana": "Louisiana",
  "Louisiana-Lafayette": "Louisiana", "Louisiana-Monroe": "Louisiana Monroe",
  "Little Rock": "Little Rock", "UALR": "Little Rock",
  "Omaha": "Omaha", "Detroit Mercy": "Detroit Mercy",
  "Detroit": "Detroit Mercy", "Green Bay": "Green Bay",
  "Milwaukee": "Milwaukee",
};

function normalizeToKenpom(dbName) {
  if (DB_TO_KENPOM[dbName]) return DB_TO_KENPOM[dbName];
  if (dbName.endsWith(" State") && !dbName.startsWith("Saint"))
    return dbName.replace(/ State$/, " St.");
  return dbName;
}

function lookupSnapshot(snapshotMap, dbTeamName) {
  if (snapshotMap.has(dbTeamName)) return snapshotMap.get(dbTeamName);
  const n = normalizeToKenpom(dbTeamName);
  if (snapshotMap.has(n)) return snapshotMap.get(n);
  const lower = dbTeamName.toLowerCase();
  for (const [k, v] of snapshotMap.entries()) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function formatDate(d) { return d.toISOString().split("T")[0]; }

function ridge(X, y, lambda) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) for (let k = j; k < p; k++) XtX[j][k] += X[i][j] * X[i][k];
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) XtX[j][k] = XtX[k][j];
  for (let j = 1; j < p; j++) XtX[j][j] += lambda;
  const Xty = new Float64Array(p);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) Xty[j] += X[i][j] * y[i];
  const L = Array.from({ length: p }, () => new Float64Array(p));
  for (let i = 0; i < p; i++) { for (let j = 0; j <= i; j++) { let sum = XtX[i][j]; for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(sum, 1e-10)) : sum / L[j][j]; } }
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) { let sum = Xty[i]; for (let j = 0; j < i; j++) sum -= L[i][j] * z[j]; z[i] = sum / L[i][i]; }
  const beta = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) { let sum = z[i]; for (let j = i + 1; j < p; j++) sum -= L[j][i] * beta[j]; beta[i] = sum / L[i][i]; }
  return Array.from(beta);
}

function buildRow(g, homeR, awayR) {
  return {
    season: g.season,
    line: g.overUnder,
    actualTotal: g.homeScore + g.awayScore,
    sumDE: homeR.adjDE + awayR.adjDE,
    sumOE: homeR.adjOE + awayR.adjOE,
    avgTempo: (homeR.adjTempo + awayR.adjTempo) / 2,
  };
}

async function main() {
  const prisma = new PrismaClient();

  // ─── 1. Load snapshots ──────────────────────────────────────────────────────
  console.log("Loading snapshots...");
  const snapshots = await prisma.kenpomSnapshot.findMany({ orderBy: { snapshotDate: "asc" } });
  const snapshotsByDate = new Map();
  for (const s of snapshots) {
    const dk = formatDate(s.snapshotDate);
    if (!snapshotsByDate.has(dk)) snapshotsByDate.set(dk, new Map());
    snapshotsByDate.get(dk).set(s.teamName, s);
  }
  console.log(`Loaded ${snapshots.length} snapshots across ${snapshotsByDate.size} dates`);

  // ─── 2. Load completed games ────────────────────────────────────────────────
  const games = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null } },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} completed games`);

  // ─── 3. Match games to PIT snapshots ────────────────────────────────────────
  const enriched = [];
  for (const g of games) {
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(formatDate(g.gameDate));
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) continue;
    const h = lookupSnapshot(ds, g.homeTeam.name), a = lookupSnapshot(ds, g.awayTeam.name);
    if (!h || !a) continue;
    enriched.push(buildRow(g, h, a));
  }

  const seasons = [...new Set(enriched.map(g => g.season))].sort();
  console.log(`\nMatched ${enriched.length} games across seasons: ${seasons.join(", ")}\n`);

  // ─── 4. Train on all completed seasons (exclude 2026 partial) ──────────────
  const trainData = enriched.filter(g => g.season <= 2025);
  const features = g => [1, g.sumDE, g.sumOE, g.avgTempo];
  const X = trainData.map(features);
  const y = trainData.map(g => g.actualTotal);

  const beta = ridge(X, y, 1000);

  console.log("═".repeat(60));
  console.log("  PRODUCTION PIT COEFFICIENTS — Ridge λ=1000");
  console.log("  Trained on ALL completed seasons with PIT snapshots");
  console.log("═".repeat(60));
  console.log();
  console.log(`  Training samples:  ${trainData.length}`);
  console.log(`  Training seasons:  ${[...new Set(trainData.map(g => g.season))].sort().join(", ")}`);
  console.log();
  console.log("  Features: [intercept, sumAdjDE, sumAdjOE, avgTempo]");
  console.log();
  console.log(`  beta[0] (intercept): ${beta[0].toFixed(4)}`);
  console.log(`  beta[1] (sumAdjDE):  ${beta[1].toFixed(4)}`);
  console.log(`  beta[2] (sumAdjOE):  ${beta[2].toFixed(4)}`);
  console.log(`  beta[3] (avgTempo):  ${beta[3].toFixed(4)}`);
  console.log();

  // ─── 5. Code snippet for pick-engine.ts ─────────────────────────────────────
  console.log("  ── Copy-paste for pick-engine.ts ──");
  console.log();
  console.log(`    // v9: PIT Ridge λ=1000, trained on ${trainData.length} games (2012-2025 PIT snapshots)`);
  console.log(`    const predictedTotal =`);
  console.log(`      ${beta[0].toFixed(4)} +`);
  console.log(`      ${beta[1].toFixed(4)} * sumAdjDE +`);
  console.log(`      ${beta[2].toFixed(4)} * sumAdjOE +`);
  console.log(`      ${beta[3].toFixed(4)} * avgTempo;`);
  console.log();

  // ─── 6. Diagnostics on training data ────────────────────────────────────────
  console.log("  ── Training Diagnostics ──");
  const trainErrors = trainData.map(g => {
    const x = features(g);
    const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
    return pred - g.actualTotal;
  });
  const trainRMSE = Math.sqrt(trainErrors.reduce((s, e) => s + e * e, 0) / trainErrors.length);
  const trainMAE = trainErrors.reduce((s, e) => s + Math.abs(e), 0) / trainErrors.length;
  console.log(`  Train RMSE: ${trainRMSE.toFixed(2)}`);
  console.log(`  Train MAE:  ${trainMAE.toFixed(2)}`);
  console.log();

  // ─── 7. Edge distribution with all-data coefficients ────────────────────────
  console.log("  ── Edge Distribution (All-Data Coefficients on Training Set) ──");
  console.log(`  ${"Edge≥".padEnd(8)} ${"Count".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)} ${"Over%".padStart(7)} ${"Under%".padStart(8)}`);
  console.log(`  ${"-".repeat(46)}`);

  const totalWeeks = 13 * 20; // ~13 seasons * ~20 weeks each
  for (const minEdge of [1, 2, 3, 5, 7, 9, 10, 12, 15]) {
    const preds = trainData.map(g => {
      const x = features(g);
      const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = pred - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else result = "PUSH";
      return { absEdge, ouDir, result };
    }).filter(p => p.absEdge >= minEdge);

    const w = preds.filter(p => p.result === "WIN").length;
    const l = preds.filter(p => p.result === "LOSS").length;
    const total = w + l;
    if (total < 10) continue;
    const overP = preds.filter(p => p.ouDir === "over");
    const underP = preds.filter(p => p.ouDir === "under");
    const ow = overP.filter(p => p.result === "WIN").length;
    const ol = overP.filter(p => p.result === "LOSS").length;
    const uw = underP.filter(p => p.result === "WIN").length;
    const ul = underP.filter(p => p.result === "LOSS").length;

    console.log(`  ${String(minEdge).padEnd(8)} ${String(total).padStart(6)} ${(w/total*100).toFixed(1).padStart(5)}% ${(preds.length/totalWeeks).toFixed(1).padStart(6)} ${(ow+ol > 0 ? (ow/(ow+ol)*100).toFixed(1) : "N/A").padStart(6)}% ${(uw+ul > 0 ? (uw/(uw+ul)*100).toFixed(1) : "N/A").padStart(7)}%`);
  }

  // ─── 8. Walk-forward validation (confirm honest backtest match) ─────────────
  console.log("\n  ── Walk-Forward Validation (should match honest-backtest.js) ──\n");

  let totalWfW = 0, totalWfL = 0;
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100 || test.length === 0) continue;

    const wfBeta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);
    let w = 0, l = 0;
    for (const g of test) {
      const x = features(g);
      const pred = x.reduce((s, v, j) => s + v * wfBeta[j], 0);
      const edge = pred - g.line;
      if (Math.abs(edge) < 1.5) continue;
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else continue;
      if (result === "WIN") w++; else l++;
    }
    const pct = (w + l) > 0 ? (w / (w + l) * 100).toFixed(1) : "N/A";
    console.log(`    ${testSeason}: ${pct}% (${w}W-${l}L)`);
    totalWfW += w; totalWfL += l;
  }
  const wfTotal = totalWfW + totalWfL;
  console.log(`    ──────────────────────`);
  console.log(`    TOTAL: ${(totalWfW / wfTotal * 100).toFixed(1)}% (${totalWfW}W-${totalWfL}L)\n`);

  // ─── 9. Config #26 tier validation with all-data coefficients ───────────────
  console.log("  ── Config #26 Tier Validation (All-Data Coefficients) ──\n");

  const tiers = { 5: { w: 0, l: 0 }, 4: { w: 0, l: 0 }, 3: { w: 0, l: 0 } };
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100 || test.length === 0) continue;

    const wfBeta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);
    for (const g of test) {
      const x = features(g);
      const pred = x.reduce((s, v, j) => s + v * wfBeta[j], 0);
      const edge = pred - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else continue;

      let stars = 0;
      if (ouDir === "under" && absEdge >= 12 && g.avgTempo <= 64) stars = 5;
      else if (ouDir === "under" && absEdge >= 10) stars = 4;
      else if (absEdge >= 9) stars = 3;
      if (stars === 0) continue;

      if (result === "WIN") tiers[stars].w++; else tiers[stars].l++;
    }
  }

  for (const [star, { w, l }] of Object.entries(tiers).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const total = w + l;
    const pct = total > 0 ? (w / total * 100).toFixed(1) : "N/A";
    const perWk = (total / (13 * 20)).toFixed(1);
    console.log(`    ${star}★: ${pct}% (${w}W-${l}L, ${total} total, ~${perWk}/wk)`);
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
