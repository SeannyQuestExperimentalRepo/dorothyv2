/**
 * PIT Edge Discovery 3.8: PIT vs EOS Edge Decomposition
 *
 * Analyzes WHERE the 4.6pp look-ahead bias gap is largest:
 *   - By season phase (early vs late)
 *   - By team quality (top vs bottom)
 *   - By game type (conference vs non-conference)
 *   - Tests whether "edgeGap" (EOS edge - PIT edge) is itself a useful signal
 */
const { PrismaClient } = require("@prisma/client");

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

const monthNames = { 0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 10: "Nov", 11: "Dec" };

async function main() {
  const prisma = new PrismaClient();

  console.log("Loading snapshots...");
  const snapshots = await prisma.kenpomSnapshot.findMany({ orderBy: { snapshotDate: "asc" } });
  const snapshotsByDate = new Map();
  for (const s of snapshots) {
    const dk = formatDate(s.snapshotDate);
    if (!snapshotsByDate.has(dk)) snapshotsByDate.set(dk, new Map());
    snapshotsByDate.get(dk).set(s.teamName, s);
  }
  console.log(`Loaded ${snapshots.length} snapshots across ${snapshotsByDate.size} dates`);

  // Load games with BOTH PIT and EOS data
  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null },
      homeAdjEM: { not: null }, homeAdjOE: { not: null },
      homeAdjDE: { not: null }, homeAdjTempo: { not: null },
      awayAdjEM: { not: null }, awayAdjOE: { not: null },
      awayAdjDE: { not: null }, awayAdjTempo: { not: null },
    },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} games with EOS data\n`);

  // Match to PIT snapshots
  const enriched = [];
  for (const g of games) {
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(formatDate(g.gameDate));
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) continue;
    const h = lookupSnapshot(ds, g.homeTeam.name), a = lookupSnapshot(ds, g.awayTeam.name);
    if (!h || !a) continue;

    enriched.push({
      season: g.season, line: g.overUnder,
      actualTotal: g.homeScore + g.awayScore,
      gameMonth: g.gameDate.getMonth(),
      isConf: g.isConferenceGame ? 1 : 0,
      avgRank: (h.rankAdjEM + a.rankAdjEM) / 2,
      // PIT features
      pitSumDE: h.adjDE + a.adjDE, pitSumOE: h.adjOE + a.adjOE,
      pitAvgTempo: (h.adjTempo + a.adjTempo) / 2,
      // EOS features
      eosSumDE: g.homeAdjDE + g.awayAdjDE, eosSumOE: g.homeAdjOE + g.awayAdjOE,
      eosAvgTempo: (g.homeAdjTempo + g.awayAdjTempo) / 2,
    });
  }

  const seasons = [...new Set(enriched.map(g => g.season))].sort();
  console.log(`Matched ${enriched.length} games with both PIT and EOS data\n`);

  const pitFeatures = g => [1, g.pitSumDE, g.pitSumOE, g.pitAvgTempo];
  const eosFeatures = g => [1, g.eosSumDE, g.eosSumOE, g.eosAvgTempo];

  // ─── Walk-forward: compute both PIT and EOS edges for every game ──────────
  const allPreds = [];
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100) continue;

    const pitBeta = ridge(train.map(pitFeatures), train.map(g => g.actualTotal), 1000);
    const eosBeta = ridge(train.map(eosFeatures), train.map(g => g.actualTotal), 1000);

    for (const g of test) {
      const pitPred = pitFeatures(g).reduce((s, v, j) => s + v * pitBeta[j], 0);
      const eosPred = eosFeatures(g).reduce((s, v, j) => s + v * eosBeta[j], 0);
      const pitEdge = pitPred - g.line;
      const eosEdge = eosPred - g.line;
      const edgeGap = Math.abs(eosEdge) - Math.abs(pitEdge);

      const ouDir = pitEdge > 0 ? "over" : "under";
      let pitResult, eosResult;
      if (g.actualTotal > g.line) {
        pitResult = pitEdge > 0 ? "WIN" : "LOSS";
        eosResult = eosEdge > 0 ? "WIN" : "LOSS";
      } else if (g.actualTotal < g.line) {
        pitResult = pitEdge < 0 ? "WIN" : "LOSS";
        eosResult = eosEdge < 0 ? "WIN" : "LOSS";
      } else {
        pitResult = "PUSH"; eosResult = "PUSH";
      }

      allPreds.push({
        ...g, pitEdge, eosEdge, edgeGap,
        pitAbsEdge: Math.abs(pitEdge), eosAbsEdge: Math.abs(eosEdge),
        ouDir, pitResult, eosResult,
      });
    }
  }

  console.log(`Generated ${allPreds.length} paired PIT/EOS predictions\n`);

  // ─── Part 1: Gap by Season Phase ──────────────────────────────────────────
  console.log("═".repeat(80));
  console.log("  PART 1: BIAS GAP BY SEASON PHASE");
  console.log("═".repeat(80));
  console.log();

  console.log(`  ${"Phase".padEnd(18)} ${"PIT%".padStart(6)} ${"EOS%".padStart(6)} ${"Gap".padStart(7)} ${"AvgEdgeGap".padStart(11)} ${"N".padStart(6)}`);
  console.log(`  ${"-".repeat(55)}`);

  for (const [name, months] of [["Early (Nov-Dec)", [10, 11]], ["Mid (Jan-Feb)", [0, 1]], ["Late (Mar-Apr)", [2, 3]], ["All", [0, 1, 2, 3, 10, 11]]]) {
    const picks = allPreds.filter(p => months.includes(p.gameMonth) && p.pitAbsEdge >= 1.5);
    const pitW = picks.filter(p => p.pitResult === "WIN").length;
    const pitL = picks.filter(p => p.pitResult === "LOSS").length;
    const eosW = picks.filter(p => p.eosResult === "WIN").length;
    const eosL = picks.filter(p => p.eosResult === "LOSS").length;
    const pitTotal = pitW + pitL, eosTotal = eosW + eosL;
    if (pitTotal < 20) continue;
    const pitPct = pitW / pitTotal * 100;
    const eosPct = eosW / eosTotal * 100;
    const avgGap = picks.reduce((s, p) => s + p.edgeGap, 0) / picks.length;
    console.log(`  ${name.padEnd(18)} ${pitPct.toFixed(1).padStart(5)}% ${eosPct.toFixed(1).padStart(5)}% ${((eosPct - pitPct) >= 0 ? "+" : "") + (eosPct - pitPct).toFixed(1).padStart(5)}pp ${avgGap.toFixed(2).padStart(11)} ${String(pitTotal).padStart(6)}`);
  }

  // ─── Part 2: Gap by Team Quality ──────────────────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 2: BIAS GAP BY TEAM QUALITY (avg KenPom rank)");
  console.log("═".repeat(80));
  console.log();

  console.log(`  ${"Quality".padEnd(20)} ${"PIT%".padStart(6)} ${"EOS%".padStart(6)} ${"Gap".padStart(7)} ${"AvgEdgeGap".padStart(11)} ${"N".padStart(6)}`);
  console.log(`  ${"-".repeat(57)}`);

  for (const [label, lo, hi] of [["Top 50 (avg)", 0, 50], ["51-100", 50, 100], ["101-200", 100, 200], ["201+", 200, 999]]) {
    const picks = allPreds.filter(p => p.avgRank >= lo && p.avgRank < hi && p.pitAbsEdge >= 1.5);
    const pitW = picks.filter(p => p.pitResult === "WIN").length;
    const pitL = picks.filter(p => p.pitResult === "LOSS").length;
    const eosW = picks.filter(p => p.eosResult === "WIN").length;
    const eosL = picks.filter(p => p.eosResult === "LOSS").length;
    const pitTotal = pitW + pitL, eosTotal = eosW + eosL;
    if (pitTotal < 20) continue;
    const pitPct = pitW / pitTotal * 100;
    const eosPct = eosW / eosTotal * 100;
    const avgGap = picks.reduce((s, p) => s + p.edgeGap, 0) / picks.length;
    console.log(`  ${label.padEnd(20)} ${pitPct.toFixed(1).padStart(5)}% ${eosPct.toFixed(1).padStart(5)}% ${((eosPct - pitPct) >= 0 ? "+" : "") + (eosPct - pitPct).toFixed(1).padStart(5)}pp ${avgGap.toFixed(2).padStart(11)} ${String(pitTotal).padStart(6)}`);
  }

  // ─── Part 3: Gap by Conference ─────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 3: BIAS GAP — CONFERENCE vs NON-CONFERENCE");
  console.log("═".repeat(80));
  console.log();

  for (const [label, filter] of [["Conference", p => p.isConf === 1], ["Non-conf", p => p.isConf === 0]]) {
    const picks = allPreds.filter(p => filter(p) && p.pitAbsEdge >= 1.5);
    const pitW = picks.filter(p => p.pitResult === "WIN").length;
    const pitL = picks.filter(p => p.pitResult === "LOSS").length;
    const eosW = picks.filter(p => p.eosResult === "WIN").length;
    const eosL = picks.filter(p => p.eosResult === "LOSS").length;
    const pitTotal = pitW + pitL, eosTotal = eosW + eosL;
    if (pitTotal < 20) {
      console.log(`  ${label}: N < 20`);
      continue;
    }
    const pitPct = pitW / pitTotal * 100;
    const eosPct = eosW / eosTotal * 100;
    const avgGap = picks.reduce((s, p) => s + p.edgeGap, 0) / picks.length;
    console.log(`  ${label.padEnd(15)} PIT: ${pitPct.toFixed(1)}% (${pitW}W-${pitL}L)  EOS: ${eosPct.toFixed(1)}% (${eosW}W-${eosL}L)  gap: ${(eosPct - pitPct).toFixed(1)}pp  avgEdgeGap: ${avgGap.toFixed(2)}`);
  }

  // ─── Part 4: edgeGap as Signal ─────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 4: EDGE GAP AS SIGNAL (does EOS inflation predict outcomes?)");
  console.log("═".repeat(80));
  console.log();

  // Hypothesis: when EOS inflates the edge (edgeGap > 0), the bet is worse
  console.log(`  ${"EdgeGap Band".padEnd(18)} ${"PIT Win%".padStart(9)} ${"N".padStart(6)} ${"Interpretation".padStart(30)}`);
  console.log(`  ${"-".repeat(66)}`);

  const e9preds = allPreds.filter(p => p.pitAbsEdge >= 9);
  for (const [lo, hi, label, interp] of [
    [-999, -2, "EOS << PIT (gap<-2)", "EOS edge smaller → PIT overconfident?"],
    [-2, 0, "EOS < PIT (gap -2~0)", "EOS edge slightly smaller"],
    [0, 2, "EOS > PIT (gap 0~2)", "EOS edge slightly inflated"],
    [2, 5, "EOS >> PIT (gap 2~5)", "EOS moderately inflated"],
    [5, 999, "EOS >>> PIT (gap>5)", "EOS heavily inflated → overrated?"],
  ]) {
    const picks = e9preds.filter(p => p.edgeGap >= lo && p.edgeGap < hi);
    const w = picks.filter(p => p.pitResult === "WIN").length;
    const l = picks.filter(p => p.pitResult === "LOSS").length;
    const total = w + l;
    if (total < 20) { console.log(`  ${label.padEnd(18)} ${`(N=${total})`.padStart(9)}`); continue; }
    console.log(`  ${label.padEnd(18)} ${(w/total*100).toFixed(1).padStart(8)}% ${String(total).padStart(6)} ${interp.padStart(30)}`);
  }

  // ─── Part 5: edgeGap as Ridge Feature ──────────────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 5: EDGE GAP AS RIDGE FEATURE (walk-forward)");
  console.log("═".repeat(80));
  console.log();

  // Can we add edgeGap as a feature to improve the PIT model?
  // Note: This requires EOS data which introduces a subtle dependency.
  // In production we don't have EOS data for upcoming games, but we COULD
  // compute an "expected edgeGap" from team characteristics.

  const featureSets = {
    "PIT baseline": { feat: g => [1, g.pitSumDE, g.pitSumOE, g.pitAvgTempo] },
    "PIT + isConf": { feat: g => [1, g.pitSumDE, g.pitSumOE, g.pitAvgTempo, g.isConf] },
    "PIT + avgRank": { feat: g => [1, g.pitSumDE, g.pitSumOE, g.pitAvgTempo, g.avgRank] },
    "PIT + rank + conf": { feat: g => [1, g.pitSumDE, g.pitSumOE, g.pitAvgTempo, g.avgRank, g.isConf] },
  };

  console.log(`  ${"Feature Set".padEnd(22)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"RMSE".padStart(6)} ${"vs base".padStart(9)}`);
  console.log(`  ${"-".repeat(58)}`);

  const fsResults = {};
  for (const [name, { feat }] of Object.entries(featureSets)) {
    let totalW = 0, totalL = 0, totalSqErr = 0, totalN = 0;
    for (const testSeason of seasons.slice(1)) {
      const train = enriched.filter(g => g.season < testSeason);
      const test = enriched.filter(g => g.season === testSeason);
      if (train.length < 100) continue;
      const beta = ridge(train.map(feat), train.map(g => g.actualTotal), 1000);
      for (const g of test) {
        const x = feat(g);
        const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
        totalSqErr += (pred - g.actualTotal) ** 2; totalN++;
        const edge = pred - g.line;
        if (Math.abs(edge) < 1.5) continue;
        const ouDir = edge > 0 ? "over" : "under";
        let result;
        if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
        else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
        else continue;
        if (result === "WIN") totalW++; else totalL++;
      }
    }
    const pct = totalW / (totalW + totalL) * 100;
    const rmse = Math.sqrt(totalSqErr / totalN);
    fsResults[name] = pct;
    const diff = fsResults["PIT baseline"] ? (pct - fsResults["PIT baseline"]).toFixed(2) : "—";
    console.log(`  ${name.padEnd(22)} ${pct.toFixed(1).padStart(5)}% ${`${totalW}W-${totalL}L`.padStart(11)} ${rmse.toFixed(2).padStart(6)} ${(diff + "pp").padStart(9)}`);
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
