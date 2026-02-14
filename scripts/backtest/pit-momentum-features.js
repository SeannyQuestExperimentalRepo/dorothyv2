/**
 * PIT Edge Discovery 3.1: Rating Momentum / Velocity Features
 *
 * Tests whether teams' rating CHANGES over time predict O/U better than
 * static ratings alone. This is the #1 most promising PIT feature because
 * it's fundamentally impossible with EOS (single-snapshot) data.
 *
 * Features tested:
 *   - emDelta7d: AdjEM change over past 7 days (team-level)
 *   - emDelta14d: AdjEM change over past 14 days
 *   - emMomentumDiff: relative momentum (home - away EM deltas)
 *   - oeDelta7d / deDelta7d: offensive/defensive efficiency momentum
 *
 * Walk-forward Ridge λ=1000 with augmented feature sets.
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

/**
 * Find the nearest snapshot to a target date within maxDays.
 * Returns the snapshot map for the closest available date, or null.
 */
function findNearestSnapshot(snapshotsByDate, targetDate, maxDays) {
  const dateKeys = [...snapshotsByDate.keys()].sort();
  const target = new Date(targetDate + "T00:00:00Z").getTime();
  let best = null, bestDist = Infinity;
  for (const dk of dateKeys) {
    const d = new Date(dk + "T00:00:00Z").getTime();
    const dist = Math.abs(d - target) / (24 * 3600 * 1000);
    if (dist <= maxDays && dist < bestDist) { best = dk; bestDist = dist; }
    if (d > target + maxDays * 24 * 3600 * 1000) break;
  }
  return best ? snapshotsByDate.get(best) : null;
}

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
  const sortedDates = [...snapshotsByDate.keys()].sort();
  console.log(`Loaded ${snapshots.length} snapshots across ${sortedDates.length} dates`);

  const games = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null } },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} completed games\n`);

  // Build enriched rows with momentum features
  const enriched = [];
  let matchedFull = 0, matchedBase = 0, noSnapshot = 0;

  for (const g of games) {
    const gameDate = formatDate(g.gameDate);
    // T-1 snapshot (primary)
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(gameDate);
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) { noSnapshot++; continue; }

    const homeR = lookupSnapshot(ds, g.homeTeam.name);
    const awayR = lookupSnapshot(ds, g.awayTeam.name);
    if (!homeR || !awayR) { noSnapshot++; continue; }

    // T-7 and T-14 snapshots for momentum
    const t7date = new Date(g.gameDate); t7date.setDate(t7date.getDate() - 7);
    const t14date = new Date(g.gameDate); t14date.setDate(t14date.getDate() - 14);

    const ds7 = findNearestSnapshot(snapshotsByDate, formatDate(t7date), 3);
    const ds14 = findNearestSnapshot(snapshotsByDate, formatDate(t14date), 3);

    const homeR7 = ds7 ? lookupSnapshot(ds7, g.homeTeam.name) : null;
    const awayR7 = ds7 ? lookupSnapshot(ds7, g.awayTeam.name) : null;
    const homeR14 = ds14 ? lookupSnapshot(ds14, g.homeTeam.name) : null;
    const awayR14 = ds14 ? lookupSnapshot(ds14, g.awayTeam.name) : null;

    const row = {
      season: g.season,
      line: g.overUnder,
      actualTotal: g.homeScore + g.awayScore,
      sumDE: homeR.adjDE + awayR.adjDE,
      sumOE: homeR.adjOE + awayR.adjOE,
      avgTempo: (homeR.adjTempo + awayR.adjTempo) / 2,
      // Momentum features (null if no historical snapshot)
      homeEMDelta7d: homeR7 ? homeR.adjEM - homeR7.adjEM : null,
      awayEMDelta7d: awayR7 ? awayR.adjEM - awayR7.adjEM : null,
      homeEMDelta14d: homeR14 ? homeR.adjEM - homeR14.adjEM : null,
      awayEMDelta14d: awayR14 ? awayR.adjEM - awayR14.adjEM : null,
      homeOEDelta7d: homeR7 ? homeR.adjOE - homeR7.adjOE : null,
      awayOEDelta7d: awayR7 ? awayR.adjOE - awayR7.adjOE : null,
      homeDEDelta7d: homeR7 ? homeR.adjDE - homeR7.adjDE : null,
      awayDEDelta7d: awayR7 ? awayR.adjDE - awayR7.adjDE : null,
      tempoShift7d: (homeR7 && awayR7) ? ((homeR.adjTempo + awayR.adjTempo) / 2) - ((homeR7.adjTempo + awayR7.adjTempo) / 2) : null,
      hasMomentum7d: !!(homeR7 && awayR7),
      hasMomentum14d: !!(homeR14 && awayR14),
    };

    // Derived momentum features
    if (row.hasMomentum7d) {
      row.emMomentumDiff7d = row.homeEMDelta7d - row.awayEMDelta7d;
      row.sumOEDelta7d = row.homeOEDelta7d + row.awayOEDelta7d;
      row.sumDEDelta7d = row.homeDEDelta7d + row.awayDEDelta7d;
      matchedFull++;
    } else {
      row.emMomentumDiff7d = null;
      row.sumOEDelta7d = null;
      row.sumDEDelta7d = null;
      matchedBase++;
    }

    enriched.push(row);
  }

  const hasMom7d = enriched.filter(r => r.hasMomentum7d);
  const hasMom14d = enriched.filter(r => r.hasMomentum14d);
  console.log(`Matched: ${enriched.length} total, ${hasMom7d.length} with 7d momentum, ${hasMom14d.length} with 14d momentum`);
  console.log(`Base only: ${matchedBase}, No snapshot: ${noSnapshot}\n`);

  // ─── Feature set definitions ───────────────────────────────────────────────
  const featureSets = {
    "baseline (4-feat)": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo],
      filter: () => true,
    },
    "+emMomentumDiff7d": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.emMomentumDiff7d],
      filter: g => g.hasMomentum7d,
    },
    "+sumOEDelta7d": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumOEDelta7d],
      filter: g => g.hasMomentum7d,
    },
    "+sumDEDelta7d": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumDEDelta7d],
      filter: g => g.hasMomentum7d,
    },
    "+OE+DE deltas": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumOEDelta7d, g.sumDEDelta7d],
      filter: g => g.hasMomentum7d,
    },
    "+emMom+OE+DE": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.emMomentumDiff7d, g.sumOEDelta7d, g.sumDEDelta7d],
      filter: g => g.hasMomentum7d,
    },
    "+tempoShift7d": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.tempoShift7d],
      filter: g => g.hasMomentum7d,
    },
    "+all7d": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.emMomentumDiff7d, g.sumOEDelta7d, g.sumDEDelta7d, g.tempoShift7d],
      filter: g => g.hasMomentum7d,
    },
    "mom7d only (4-feat)": {
      features: g => [1, g.sumDE, g.sumOE, g.avgTempo],
      filter: g => g.hasMomentum7d,
    },
  };

  const seasons = [...new Set(enriched.map(g => g.season))].sort();

  // ─── Walk-forward evaluation ───────────────────────────────────────────────
  console.log("═".repeat(95));
  console.log("  MOMENTUM FEATURE WALK-FORWARD COMPARISON");
  console.log("  Ridge λ=1000, edge >= 1.5 threshold");
  console.log("═".repeat(95));
  console.log();

  // Header
  const nameWidth = 22;
  console.log(`  ${"Feature Set".padEnd(nameWidth)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"OVER%".padStart(7)} ${"UNDER%".padStart(8)} ${"RMSE".padStart(6)} ${"N".padStart(6)}  ${"vs baseline".padStart(11)}`);
  console.log(`  ${"-".repeat(82)}`);

  const results = {};

  for (const [name, { features, filter }] of Object.entries(featureSets)) {
    let totalW = 0, totalL = 0, totalOverW = 0, totalOverL = 0;
    let totalUnderW = 0, totalUnderL = 0, totalSqErr = 0, totalPreds = 0;
    const seasonResults = {};

    for (const testSeason of seasons.slice(1)) {
      const trainAll = enriched.filter(g => g.season < testSeason);
      const testAll = enriched.filter(g => g.season === testSeason);

      // Apply momentum filter to both train and test
      const train = trainAll.filter(filter);
      const test = testAll.filter(filter);
      if (train.length < 100 || test.length === 0) continue;

      const beta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);

      let w = 0, l = 0, overW = 0, overL = 0, underW = 0, underL = 0, sqErr = 0;
      for (const g of test) {
        const x = features(g);
        const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
        sqErr += (pred - g.actualTotal) ** 2;
        const edge = pred - g.line;
        if (Math.abs(edge) < 1.5) continue;
        const ouDir = edge > 0 ? "over" : "under";
        let result;
        if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
        else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
        else continue;
        if (result === "WIN") { w++; if (ouDir === "over") overW++; else underW++; }
        else { l++; if (ouDir === "over") overL++; else underL++; }
      }

      totalW += w; totalL += l;
      totalOverW += overW; totalOverL += overL;
      totalUnderW += underW; totalUnderL += underL;
      totalSqErr += sqErr; totalPreds += test.length;
      seasonResults[testSeason] = { w, l, pct: (w + l) > 0 ? w / (w + l) * 100 : 0 };
    }

    const total = totalW + totalL;
    const pct = total > 0 ? totalW / total * 100 : 0;
    const overPct = (totalOverW + totalOverL) > 0 ? totalOverW / (totalOverW + totalOverL) * 100 : 0;
    const underPct = (totalUnderW + totalUnderL) > 0 ? totalUnderW / (totalUnderW + totalUnderL) * 100 : 0;
    const rmse = totalPreds > 0 ? Math.sqrt(totalSqErr / totalPreds) : 0;

    results[name] = { pct, total, totalW, totalL, overPct, underPct, rmse, seasonResults };

    const baselineDiff = results["baseline (4-feat)"]
      ? `${(pct - results["baseline (4-feat)"].pct) >= 0 ? "+" : ""}${(pct - results["baseline (4-feat)"].pct).toFixed(2)}pp`
      : "—";

    console.log(`  ${name.padEnd(nameWidth)} ${pct.toFixed(1).padStart(5)}% ${`${totalW}W-${totalL}L`.padStart(11)} ${overPct.toFixed(1).padStart(6)}% ${underPct.toFixed(1).padStart(7)}% ${rmse.toFixed(2).padStart(6)} ${String(total).padStart(6)}  ${baselineDiff.padStart(11)}`);
  }

  // ─── Per-season breakdown for top feature sets ─────────────────────────────
  console.log(`\n\n  ── Per-Season Comparison: baseline vs best momentum feature ──\n`);

  // Find best momentum feature
  const momentumResults = Object.entries(results).filter(([name]) => name !== "baseline (4-feat)" && name !== "mom7d only (4-feat)");
  const bestMom = momentumResults.sort((a, b) => b[1].pct - a[1].pct)[0];

  if (bestMom) {
    const baseline = results["baseline (4-feat)"];
    const baselineMomOnly = results["mom7d only (4-feat)"];

    console.log(`  Best momentum feature: ${bestMom[0]}`);
    console.log(`  (baseline on mom-filtered data shown as "base(filtered)" for fair comparison)\n`);

    console.log(`  ${"Season".padEnd(8)} ${"Baseline".padStart(10)} ${"Base(filt)".padStart(12)} ${bestMom[0].padStart(nameWidth)} ${"Δ vs filt".padStart(10)}`);
    console.log(`  ${"-".repeat(60)}`);

    for (const s of seasons.slice(1)) {
      const b = baseline.seasonResults[s];
      const bf = baselineMomOnly?.seasonResults[s];
      const m = bestMom[1].seasonResults[s];
      if (!b || !m) continue;
      const bPct = b.pct.toFixed(1);
      const bfPct = bf ? bf.pct.toFixed(1) : "N/A";
      const mPct = m.pct.toFixed(1);
      const diff = bf ? (m.pct - bf.pct).toFixed(1) : "N/A";
      console.log(`  ${String(s).padEnd(8)} ${(bPct + "%").padStart(10)} ${(bfPct + "%").padStart(12)} ${(mPct + "%").padStart(nameWidth)} ${(diff + "pp").padStart(10)}`);
    }
  }

  // ─── Momentum feature statistics ───────────────────────────────────────────
  console.log(`\n\n  ── Momentum Feature Statistics ──\n`);

  const mom7dGames = enriched.filter(g => g.hasMomentum7d);
  const emMomVals = mom7dGames.map(g => g.emMomentumDiff7d);
  const oeDeltaVals = mom7dGames.map(g => g.sumOEDelta7d);
  const deDeltaVals = mom7dGames.map(g => g.sumDEDelta7d);

  function stats(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
    return {
      mean: mean.toFixed(3), std: std.toFixed(3),
      p5: sorted[Math.floor(arr.length * 0.05)].toFixed(2),
      p25: sorted[Math.floor(arr.length * 0.25)].toFixed(2),
      p50: sorted[Math.floor(arr.length * 0.50)].toFixed(2),
      p75: sorted[Math.floor(arr.length * 0.75)].toFixed(2),
      p95: sorted[Math.floor(arr.length * 0.95)].toFixed(2),
    };
  }

  for (const [label, vals] of [["emMomentumDiff7d", emMomVals], ["sumOEDelta7d", oeDeltaVals], ["sumDEDelta7d", deDeltaVals]]) {
    const s = stats(vals);
    console.log(`  ${label.padEnd(20)} mean=${s.mean.padStart(7)} std=${s.std.padStart(6)} | p5=${s.p5} p25=${s.p25} p50=${s.p50} p75=${s.p75} p95=${s.p95}`);
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
