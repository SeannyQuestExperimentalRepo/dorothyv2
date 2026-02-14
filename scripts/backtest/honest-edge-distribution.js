/**
 * Quick diagnostic: edge distribution with honest PIT data.
 * Helps calibrate tier sweep thresholds.
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

async function main() {
  const prisma = new PrismaClient();
  console.log("Loading...");
  const snapshots = await prisma.kenpomSnapshot.findMany({ orderBy: { snapshotDate: "asc" } });
  const snapshotsByDate = new Map();
  for (const s of snapshots) {
    const dk = formatDate(s.snapshotDate);
    if (!snapshotsByDate.has(dk)) snapshotsByDate.set(dk, new Map());
    snapshotsByDate.get(dk).set(s.teamName, s);
  }

  const games = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null } },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });

  const enriched = [];
  for (const g of games) {
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(formatDate(g.gameDate));
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) continue;
    const h = lookupSnapshot(ds, g.homeTeam.name), a = lookupSnapshot(ds, g.awayTeam.name);
    if (!h || !a) continue;
    const avgTempo = (h.adjTempo + a.adjTempo) / 2;
    enriched.push({
      season: g.season, line: g.overUnder, actualTotal: g.homeScore + g.awayScore,
      sumDE: h.adjDE + a.adjDE, sumOE: h.adjOE + a.adjOE, avgTempo,
      isConf: g.isConferenceGame ? 1 : 0,
    });
  }

  const seasons = [...new Set(enriched.map(g => g.season))].sort();
  const allPreds = [];

  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100 || test.length === 0) continue;
    const features = g => [1, g.sumDE, g.sumOE, g.avgTempo];
    const beta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);

    for (const g of test) {
      const x = features(g);
      const predicted = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = predicted - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else result = "PUSH";
      allPreds.push({ ...g, predicted, edge, absEdge, ouDir, result });
    }
  }

  const totalWeeks = 13 * 20; // 13 full seasons * ~20 weeks each (excl 2026)
  const fullPreds = allPreds.filter(p => p.season <= 2025);
  const recentPreds = allPreds.filter(p => p.season >= 2022 && p.season <= 2025);
  const recentWeeks = 4 * 20;

  console.log(`\nTotal predictions: ${allPreds.length} (${fullPreds.length} in full seasons 2013-2025)\n`);

  // Edge distribution table
  console.log("  ── EDGE DISTRIBUTION (Full seasons 2013-2025) ──\n");
  console.log(`  ${"Dir".padEnd(7)} ${"Edge≥".padEnd(7)} ${"Count".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)} ${"~/day".padStart(6)}  | ${"2022-25 ~/wk".padStart(12)} ${"Win%".padStart(6)}`);
  console.log(`  ${"-".repeat(72)}`);

  for (const dir of ["any", "over", "under"]) {
    for (const minEdge of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 15]) {
      const matching = fullPreds.filter(p => p.absEdge >= minEdge && (dir === "any" || p.ouDir === dir));
      const w = matching.filter(p => p.result === "WIN").length;
      const l = matching.filter(p => p.result === "LOSS").length;
      const total = w + l;
      if (total < 10) continue;
      const pct = (w / total * 100).toFixed(1);
      const perWk = (matching.length / totalWeeks).toFixed(1);
      const perDay = (matching.length / totalWeeks / 7).toFixed(1);

      // Recent seasons
      const recent = recentPreds.filter(p => p.absEdge >= minEdge && (dir === "any" || p.ouDir === dir));
      const rw = recent.filter(p => p.result === "WIN").length;
      const rl = recent.filter(p => p.result === "LOSS").length;
      const rt = rw + rl;
      const rpct = rt > 0 ? (rw / rt * 100).toFixed(1) : "N/A";
      const rperWk = (recent.length / recentWeeks).toFixed(1);

      console.log(`  ${dir.padEnd(7)} ${String(minEdge).padStart(5)}   ${String(total).padStart(6)} ${pct.padStart(5)}% ${perWk.padStart(6)} ${perDay.padStart(6)}  | ${rperWk.padStart(12)} ${rpct.padStart(5)}%`);
    }
    if (dir !== "under") console.log();
  }

  // Tempo breakdown for under picks
  console.log("\n  ── UNDER picks by TEMPO band (edge ≥ 2, full seasons) ──\n");
  console.log(`  ${"Tempo".padEnd(12)} ${"Count".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)}`);
  console.log(`  ${"-".repeat(35)}`);

  const underE2 = fullPreds.filter(p => p.ouDir === "under" && p.absEdge >= 2);
  for (const [lo, hi] of [[0,64],[64,66],[66,68],[68,70],[70,72],[72,999]]) {
    const band = underE2.filter(p => p.avgTempo >= lo && p.avgTempo < hi);
    const w = band.filter(p => p.result === "WIN").length;
    const l = band.filter(p => p.result === "LOSS").length;
    const t = w + l;
    if (t < 5) continue;
    console.log(`  ${`${lo}-${hi === 999 ? "∞" : hi}`.padEnd(12)} ${String(t).padStart(6)} ${(w/t*100).toFixed(1).padStart(5)}% ${(band.length/totalWeeks).toFixed(1).padStart(6)}`);
  }

  // Line breakdown for under picks
  console.log("\n  ── UNDER picks by LINE band (edge ≥ 2, full seasons) ──\n");
  console.log(`  ${"Line".padEnd(12)} ${"Count".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)}`);
  console.log(`  ${"-".repeat(35)}`);

  for (const [lo, hi] of [[0,120],[120,130],[130,140],[140,150],[150,160],[160,999]]) {
    const band = underE2.filter(p => p.line >= lo && p.line < hi);
    const w = band.filter(p => p.result === "WIN").length;
    const l = band.filter(p => p.result === "LOSS").length;
    const t = w + l;
    if (t < 5) continue;
    console.log(`  ${`${lo}-${hi === 999 ? "∞" : hi}`.padEnd(12)} ${String(t).padStart(6)} ${(w/t*100).toFixed(1).padStart(5)}% ${(band.length/totalWeeks).toFixed(1).padStart(6)}`);
  }

  // Over picks by edge
  console.log("\n  ── OVER picks by LINE band (edge ≥ 3, full seasons) ──\n");
  console.log(`  ${"Line".padEnd(12)} ${"Count".padStart(6)} ${"Win%".padStart(6)} ${"~/wk".padStart(6)}`);
  console.log(`  ${"-".repeat(35)}`);

  const overE3 = fullPreds.filter(p => p.ouDir === "over" && p.absEdge >= 3);
  for (const [lo, hi] of [[0,120],[120,130],[130,140],[140,150],[150,160],[160,999]]) {
    const band = overE3.filter(p => p.line >= lo && p.line < hi);
    const w = band.filter(p => p.result === "WIN").length;
    const l = band.filter(p => p.result === "LOSS").length;
    const t = w + l;
    if (t < 5) continue;
    console.log(`  ${`${lo}-${hi === 999 ? "∞" : hi}`.padEnd(12)} ${String(t).padStart(6)} ${(w/t*100).toFixed(1).padStart(5)}% ${(band.length/totalWeeks).toFixed(1).padStart(6)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
