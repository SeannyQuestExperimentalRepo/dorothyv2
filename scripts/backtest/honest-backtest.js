/**
 * HONEST BACKTEST — Uses point-in-time KenPom ratings (not end-of-season).
 *
 * For each game, looks up KenPom snapshot from the day BEFORE the game,
 * applies Ridge regression to predict totals, and evaluates O/U picks.
 *
 * This eliminates the look-ahead bias from using season-level ratings.
 */
const { PrismaClient } = require("@prisma/client");

// ─── KenPom team name mapping (same as src/lib/kenpom.ts) ───────────────────

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
  if (dbName.endsWith(" State") && !dbName.startsWith("Saint")) {
    return dbName.replace(/ State$/, " St.");
  }
  return dbName;
}

function lookupSnapshot(snapshotMap, dbTeamName) {
  // Direct match
  if (snapshotMap.has(dbTeamName)) return snapshotMap.get(dbTeamName);
  // Normalized
  const normalized = normalizeToKenpom(dbTeamName);
  if (snapshotMap.has(normalized)) return snapshotMap.get(normalized);
  // Case-insensitive
  const lower = dbTeamName.toLowerCase();
  for (const [k, v] of snapshotMap.entries()) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

// ─── Ridge regression (same as pick-engine v8) ─────────────────────────────

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

  // ─── 1. Load all snapshots into memory (grouped by date) ─────────────────
  console.log("Loading snapshots...");
  const snapshots = await prisma.kenpomSnapshot.findMany({
    orderBy: { snapshotDate: "asc" },
  });

  // Group snapshots by date → Map<teamName, snapshot>
  const snapshotsByDate = new Map();
  for (const s of snapshots) {
    const dateKey = formatDate(s.snapshotDate);
    if (!snapshotsByDate.has(dateKey)) snapshotsByDate.set(dateKey, new Map());
    snapshotsByDate.get(dateKey).set(s.teamName, s);
  }
  console.log(`Loaded ${snapshots.length} snapshots across ${snapshotsByDate.size} dates\n`);

  // ─── 2. Load all completed games with lines ──────────────────────────────
  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null },
      overUnder: { not: null },
    },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} completed games with lines\n`);

  // ─── 3. Match games to point-in-time ratings ─────────────────────────────
  const enriched = [];
  let matched = 0, unmatched = 0, noSnapshot = 0;

  for (const g of games) {
    const gameDate = formatDate(g.gameDate);
    // Look for snapshot from day before game
    const prevDate = new Date(g.gameDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const snapshotDate = formatDate(prevDate);

    const dateSnapshots = snapshotsByDate.get(snapshotDate);
    if (!dateSnapshots) {
      // Try same-day or 2 days before
      const sameDaySnapshots = snapshotsByDate.get(gameDate);
      const twoDaysBefore = new Date(g.gameDate);
      twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
      const fallbackSnapshots = snapshotsByDate.get(formatDate(twoDaysBefore));
      const usable = sameDaySnapshots || fallbackSnapshots;
      if (!usable) {
        noSnapshot++;
        continue;
      }
      // Use fallback
      const homeR = lookupSnapshot(usable, g.homeTeam.name);
      const awayR = lookupSnapshot(usable, g.awayTeam.name);
      if (!homeR || !awayR) { unmatched++; continue; }
      enriched.push(buildRow(g, homeR, awayR));
      matched++;
      continue;
    }

    const homeR = lookupSnapshot(dateSnapshots, g.homeTeam.name);
    const awayR = lookupSnapshot(dateSnapshots, g.awayTeam.name);
    if (!homeR || !awayR) { unmatched++; continue; }

    enriched.push(buildRow(g, homeR, awayR));
    matched++;
  }

  console.log(`Matched: ${matched}, Unmatched teams: ${unmatched}, No snapshot: ${noSnapshot}\n`);

  if (enriched.length === 0) {
    console.log("No games matched to snapshots! Run backfill-kenpom-snapshots.js first.");
    await prisma.$disconnect();
    return;
  }

  // ─── 4. Walk-forward Ridge regression ─────────────────────────────────────
  // Train on all data up to each season, predict on that season.
  // This is the honest way: no future data leaks.
  const seasons = [...new Set(enriched.map((g) => g.season))].sort();
  console.log(`Seasons with data: ${seasons.join(", ")}\n`);

  // Walk-forward: test each season trained on all prior seasons
  // Need at least 1 training season, so start from second available
  const testSeasons = seasons.slice(1);
  if (testSeasons.length === 0) {
    console.log("Need at least 2 seasons of data.");
    await prisma.$disconnect();
    return;
  }

  // Summary table at the end
  const summaryRows = [];

  // Preload EOS games for all seasons (one query instead of per-season)
  const eosGames = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null },
      overUnder: { not: null },
      homeAdjEM: { not: null }, homeAdjOE: { not: null },
      homeAdjDE: { not: null }, homeAdjTempo: { not: null },
      awayAdjEM: { not: null }, awayAdjOE: { not: null },
      awayAdjDE: { not: null }, awayAdjTempo: { not: null },
    },
    select: {
      season: true, homeScore: true, awayScore: true, overUnder: true,
      homeAdjEM: true, awayAdjEM: true, homeAdjOE: true, awayAdjOE: true,
      homeAdjDE: true, awayAdjDE: true, homeAdjTempo: true, awayAdjTempo: true,
    },
  });
  const eosGamesBySeason = new Map();
  for (const g of eosGames) {
    if (!eosGamesBySeason.has(g.season)) eosGamesBySeason.set(g.season, []);
    eosGamesBySeason.get(g.season).push(g);
  }

  for (const testSeason of testSeasons) {
    const train = enriched.filter((g) => g.season < testSeason);
    const test = enriched.filter((g) => g.season === testSeason);

    if (train.length < 100 || test.length === 0) continue;

    // Fit Ridge on training data
    const features = (g) => [1, g.sumDE, g.sumOE, g.avgTempo];
    const Xtrain = train.map(features);
    const ytrain = train.map((g) => g.actualTotal);
    const beta = ridge(Xtrain, ytrain, 1000);

    // Predict on test set
    const predictions = [];
    for (const g of test) {
      const x = features(g);
      const predicted = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = predicted - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : null;
      if (!ouDir) continue;

      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else result = "PUSH";

      predictions.push({ ...g, predicted, edge, absEdge, ouDir, result });
    }

    // Key metrics at edge >= 1.5
    const e15 = predictions.filter((p) => p.absEdge >= 1.5);
    const pitW = e15.filter((p) => p.result === "WIN").length;
    const pitL = e15.filter((p) => p.result === "LOSS").length;
    const pitTotal = pitW + pitL;
    const pitPct = pitTotal > 0 ? (pitW / pitTotal) * 100 : 0;

    // By direction at edge >= 1.5
    const overPicks = e15.filter((p) => p.ouDir === "over");
    const underPicks = e15.filter((p) => p.ouDir === "under");
    const overW = overPicks.filter((p) => p.result === "WIN").length;
    const overL = overPicks.filter((p) => p.result === "LOSS").length;
    const underW = underPicks.filter((p) => p.result === "WIN").length;
    const underL = underPicks.filter((p) => p.result === "LOSS").length;
    const overPct = (overW + overL) > 0 ? (overW / (overW + overL)) * 100 : 0;
    const underPct = (underW + underL) > 0 ? (underW / (underW + underL)) * 100 : 0;

    // v8.1 star tiers
    const tiers = { 5: { w: 0, l: 0, p: 0 }, 4: { w: 0, l: 0, p: 0 }, 3: { w: 0, l: 0, p: 0 } };
    for (const p of predictions) {
      let stars = 0;
      if (p.ouDir === "under" && p.absEdge >= 2.0 && p.avgTempo <= 67) stars = 5;
      else if ((p.ouDir === "under" && p.absEdge >= 2.0) || (p.ouDir === "over" && p.line < 140 && p.absEdge >= 5.0)) stars = 4;
      else if (p.absEdge >= 1.5) stars = 3;
      if (stars === 0) continue;
      if (p.result === "WIN") tiers[stars].w++;
      else if (p.result === "LOSS") tiers[stars].l++;
      else tiers[stars].p++;
    }

    // RMSE
    const errors = predictions.map((p) => p.predicted - p.actualTotal);
    const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);

    // EOS comparison using same beta
    let eosW = 0, eosL = 0;
    const seasonEos = eosGamesBySeason.get(testSeason) || [];
    for (const g of seasonEos) {
      const x = [1, g.homeAdjDE + g.awayAdjDE, g.homeAdjOE + g.awayAdjOE, (g.homeAdjTempo + g.awayAdjTempo) / 2];
      const predicted = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = predicted - g.overUnder;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";
      if (absEdge < 1.5) continue;
      const actual = g.homeScore + g.awayScore;
      let result;
      if (actual > g.overUnder) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (actual < g.overUnder) result = ouDir === "under" ? "WIN" : "LOSS";
      else continue;
      if (result === "WIN") eosW++;
      else eosL++;
    }
    const eosTotal = eosW + eosL;
    const eosPct = eosTotal > 0 ? (eosW / eosTotal) * 100 : 0;

    // Compact per-season output
    const t5 = tiers[5], t4 = tiers[4], t3 = tiers[3];
    const t5pct = (t5.w + t5.l) > 0 ? ((t5.w / (t5.w + t5.l)) * 100).toFixed(1) : "N/A";
    const t4pct = (t4.w + t4.l) > 0 ? ((t4.w / (t4.w + t4.l)) * 100).toFixed(1) : "N/A";
    const t3pct = (t3.w + t3.l) > 0 ? ((t3.w / (t3.w + t3.l)) * 100).toFixed(1) : "N/A";

    console.log(`  ${testSeason}: PIT ${pitPct.toFixed(1)}% (${pitW}W-${pitL}L) | EOS ${eosPct.toFixed(1)}% (${eosW}W-${eosL}L) | gap ${(eosPct - pitPct).toFixed(1)}pp | OVER ${overPct.toFixed(1)}% UNDER ${underPct.toFixed(1)}% | 5★ ${t5pct}% (${t5.w+t5.l}) 4★ ${t4pct}% (${t4.w+t4.l}) 3★ ${t3pct}% (${t3.w+t3.l}) | RMSE ${rmse.toFixed(1)} | train ${train.length}`);

    summaryRows.push({
      season: testSeason, trainN: train.length, testN: test.length,
      pitPct, pitW, pitL, eosPct, eosW, eosL,
      overPct, overN: overW + overL, underPct, underN: underW + underL,
      t5pct: (t5.w + t5.l) > 0 ? (t5.w / (t5.w + t5.l)) * 100 : null,
      t5n: t5.w + t5.l, t5w: t5.w, t5l: t5.l,
      t4pct: (t4.w + t4.l) > 0 ? (t4.w / (t4.w + t4.l)) * 100 : null,
      t4n: t4.w + t4.l, t4w: t4.w, t4l: t4.l,
      t3pct: (t3.w + t3.l) > 0 ? (t3.w / (t3.w + t3.l)) * 100 : null,
      t3n: t3.w + t3.l, t3w: t3.w, t3l: t3.l,
      rmse, beta: beta.map((b) => b.toFixed(4)),
    });
  }

  // ─── Summary Table ──────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(90)}`);
  console.log("  WALK-FORWARD SUMMARY — Honest Backtest (Point-in-Time KenPom Ratings)");
  console.log(`  Model: Ridge λ=1000, features=[intercept, sumDE, sumOE, avgTempo]`);
  console.log(`${"═".repeat(90)}\n`);

  console.log(`  ${"Season".padEnd(8)} ${"PIT%".padStart(6)} ${"PIT W-L".padStart(9)} ${"EOS%".padStart(6)} ${"Gap".padStart(6)} ${"OVER%".padStart(7)} ${"UNDER%".padStart(8)} ${"5★%".padStart(7)} ${"5★n".padStart(5)} ${"4★%".padStart(7)} ${"4★n".padStart(5)} ${"3★%".padStart(7)} ${"3★n".padStart(5)} ${"RMSE".padStart(6)}`);
  console.log(`  ${"-".repeat(88)}`);

  let totalPitW = 0, totalPitL = 0, totalEosW = 0, totalEosL = 0;
  let totalOverW = 0, totalOverL = 0, totalUnderW = 0, totalUnderL = 0;
  let total5w = 0, total5l = 0, total4w = 0, total4l = 0, total3w = 0, total3l = 0;

  for (const r of summaryRows) {
    const gap = r.eosPct - r.pitPct;
    console.log(`  ${String(r.season).padEnd(8)} ${r.pitPct.toFixed(1).padStart(5)}% ${`${r.pitW}W-${r.pitL}L`.padStart(9)} ${r.eosPct.toFixed(1).padStart(5)}% ${(gap >= 0 ? "+" : "") + gap.toFixed(1).padStart(5)}  ${r.overPct.toFixed(1).padStart(6)}% ${r.underPct.toFixed(1).padStart(7)}%  ${r.t5pct !== null ? r.t5pct.toFixed(1).padStart(5) + "%" : "   N/A"} ${String(r.t5n).padStart(5)} ${r.t4pct !== null ? r.t4pct.toFixed(1).padStart(5) + "%" : "   N/A"} ${String(r.t4n).padStart(5)} ${r.t3pct !== null ? r.t3pct.toFixed(1).padStart(5) + "%" : "   N/A"} ${String(r.t3n).padStart(5)} ${r.rmse.toFixed(1).padStart(6)}`);

    totalPitW += r.pitW; totalPitL += r.pitL;
    totalEosW += r.eosW; totalEosL += r.eosL;
    totalOverW += Math.round(r.overPct * r.overN / 100);
    totalOverL += r.overN - Math.round(r.overPct * r.overN / 100);
    totalUnderW += Math.round(r.underPct * r.underN / 100);
    totalUnderL += r.underN - Math.round(r.underPct * r.underN / 100);
    total5w += r.t5w; total5l += r.t5l;
    total4w += r.t4w; total4l += r.t4l;
    total3w += r.t3w; total3l += r.t3l;
  }

  console.log(`  ${"-".repeat(88)}`);
  const avgPit = totalPitW / (totalPitW + totalPitL) * 100;
  const avgEos = totalEosW / (totalEosW + totalEosL) * 100;
  const avgOver = (totalOverW + totalOverL) > 0 ? totalOverW / (totalOverW + totalOverL) * 100 : 0;
  const avgUnder = (totalUnderW + totalUnderL) > 0 ? totalUnderW / (totalUnderW + totalUnderL) * 100 : 0;
  const avg5 = (total5w + total5l) > 0 ? total5w / (total5w + total5l) * 100 : 0;
  const avg4 = (total4w + total4l) > 0 ? total4w / (total4w + total4l) * 100 : 0;
  const avg3 = (total3w + total3l) > 0 ? total3w / (total3w + total3l) * 100 : 0;
  const avgGap = avgEos - avgPit;

  console.log(`  ${"TOTAL".padEnd(8)} ${avgPit.toFixed(1).padStart(5)}% ${`${totalPitW}W-${totalPitL}L`.padStart(9)} ${avgEos.toFixed(1).padStart(5)}% ${(avgGap >= 0 ? "+" : "") + avgGap.toFixed(1).padStart(5)}  ${avgOver.toFixed(1).padStart(6)}% ${avgUnder.toFixed(1).padStart(7)}%  ${avg5.toFixed(1).padStart(5)}% ${String(total5w + total5l).padStart(5)} ${avg4.toFixed(1).padStart(5)}% ${String(total4w + total4l).padStart(5)} ${avg3.toFixed(1).padStart(5)}% ${String(total3w + total3l).padStart(5)}`);
  console.log();

  // Key insights
  const profitable = summaryRows.filter(r => r.pitPct >= 52.4);
  const losing = summaryRows.filter(r => r.pitPct < 50);
  console.log(`  Profitable seasons (≥52.4%): ${profitable.length}/${summaryRows.length} — ${profitable.map(r => r.season).join(", ") || "none"}`);
  console.log(`  Losing seasons (<50%):       ${losing.length}/${summaryRows.length} — ${losing.map(r => r.season).join(", ") || "none"}`);
  console.log(`  Avg bias gap (EOS - PIT):    ${avgGap.toFixed(1)}pp`);
  console.log();

  await prisma.$disconnect();
}

function buildRow(g, homeR, awayR) {
  const avgTempo = (homeR.adjTempo + awayR.adjTempo) / 2;
  return {
    season: g.season,
    gameDate: g.gameDate,
    line: g.overUnder,
    actualTotal: g.homeScore + g.awayScore,
    sumDE: homeR.adjDE + awayR.adjDE,
    sumOE: homeR.adjOE + awayR.adjOE,
    avgTempo,
    tempoDiff: Math.abs(homeR.adjTempo - awayR.adjTempo),
    emDiff: Math.abs(homeR.adjEM - awayR.adjEM),
    isConf: g.isConferenceGame ? 1 : 0,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
