/**
 * PIT Edge Discovery 3.2 + 3.4: Seasonal Splits & Rating Stability
 *
 * Tests:
 *   1. Does accuracy vary by month? (Nov→Mar)
 *   2. Do optimal edge thresholds differ by season phase?
 *   3. Is "ratingAge" (days since season start) a useful feature?
 *   4. Does rating volatility (stdev of AdjEM over past 14d) predict accuracy?
 *
 * Combined 3.2 + 3.4 since both explore temporal stability.
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

function findNearestSnapshot(snapshotsByDate, targetDate, maxDays) {
  const target = new Date(targetDate + "T00:00:00Z").getTime();
  let best = null, bestDist = Infinity;
  for (const [dk, map] of snapshotsByDate) {
    const d = new Date(dk + "T00:00:00Z").getTime();
    const dist = Math.abs(d - target) / (24 * 3600 * 1000);
    if (dist <= maxDays && dist < bestDist) { best = dk; bestDist = dist; }
  }
  return best ? snapshotsByDate.get(best) : null;
}

// Season start: November 1 of the previous year (e.g., 2026 season starts Nov 2025)
function seasonStartDate(season) {
  return new Date(`${season - 1}-11-01T00:00:00Z`);
}

function daysBetween(d1, d2) {
  return Math.abs(d1.getTime() - d2.getTime()) / (24 * 3600 * 1000);
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
  console.log(`Loaded ${snapshots.length} snapshots across ${snapshotsByDate.size} dates`);

  const games = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null } },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} completed games\n`);

  // Enrich games
  const enriched = [];
  for (const g of games) {
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(formatDate(g.gameDate));
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) continue;
    const h = lookupSnapshot(ds, g.homeTeam.name), a = lookupSnapshot(ds, g.awayTeam.name);
    if (!h || !a) continue;

    const gameMonth = g.gameDate.getMonth(); // 0-indexed
    const ratingAge = daysBetween(g.gameDate, seasonStartDate(g.season));

    // Volatility: stdev of AdjEM over past 14 days
    let homeVol = null, awayVol = null;
    const recentDates = [];
    const t = g.gameDate.getTime();
    for (const [dk] of snapshotsByDate) {
      const d = new Date(dk + "T00:00:00Z").getTime();
      if (d <= t && d >= t - 14 * 24 * 3600 * 1000) recentDates.push(dk);
    }
    if (recentDates.length >= 3) {
      const homeEMs = [], awayEMs = [];
      for (const dk of recentDates) {
        const snap = snapshotsByDate.get(dk);
        const hr = lookupSnapshot(snap, g.homeTeam.name);
        const ar = lookupSnapshot(snap, g.awayTeam.name);
        if (hr) homeEMs.push(hr.adjEM);
        if (ar) awayEMs.push(ar.adjEM);
      }
      if (homeEMs.length >= 3) {
        const mean = homeEMs.reduce((s, v) => s + v, 0) / homeEMs.length;
        homeVol = Math.sqrt(homeEMs.reduce((s, v) => s + (v - mean) ** 2, 0) / homeEMs.length);
      }
      if (awayEMs.length >= 3) {
        const mean = awayEMs.reduce((s, v) => s + v, 0) / awayEMs.length;
        awayVol = Math.sqrt(awayEMs.reduce((s, v) => s + (v - mean) ** 2, 0) / awayEMs.length);
      }
    }

    enriched.push({
      season: g.season, line: g.overUnder,
      actualTotal: g.homeScore + g.awayScore,
      sumDE: h.adjDE + a.adjDE, sumOE: h.adjOE + a.adjOE,
      avgTempo: (h.adjTempo + a.adjTempo) / 2,
      gameMonth, ratingAge,
      homeVol, awayVol,
      avgVol: (homeVol !== null && awayVol !== null) ? (homeVol + awayVol) / 2 : null,
      hasVol: homeVol !== null && awayVol !== null,
    });
  }

  const seasons = [...new Set(enriched.map(g => g.season))].sort();
  const features = g => [1, g.sumDE, g.sumOE, g.avgTempo];
  console.log(`Enriched ${enriched.length} games across seasons: ${seasons.join(", ")}\n`);

  // ─── Part 1: Accuracy by Month ─────────────────────────────────────────────
  console.log("═".repeat(80));
  console.log("  PART 1: ACCURACY BY MONTH (walk-forward, edge ≥ 1.5)");
  console.log("═".repeat(80));
  console.log();

  // Month name mapping
  const monthNames = { 0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 10: "Nov", 11: "Dec" };

  const monthStats = {};
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100) continue;
    const beta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);

    for (const g of test) {
      const x = features(g);
      const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = pred - g.line;
      const absEdge = Math.abs(edge);
      if (absEdge < 1.5) continue;
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else continue;

      const m = g.gameMonth;
      if (!monthStats[m]) monthStats[m] = { w: 0, l: 0, overW: 0, overL: 0, underW: 0, underL: 0, edges: [] };
      monthStats[m].edges.push(absEdge);
      if (result === "WIN") {
        monthStats[m].w++;
        if (ouDir === "over") monthStats[m].overW++; else monthStats[m].underW++;
      } else {
        monthStats[m].l++;
        if (ouDir === "over") monthStats[m].overL++; else monthStats[m].underL++;
      }
    }
  }

  console.log(`  ${"Month".padEnd(6)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"OVER%".padStart(7)} ${"UNDER%".padStart(8)} ${"AvgEdge".padStart(8)} ${"MedEdge".padStart(8)}`);
  console.log(`  ${"-".repeat(55)}`);

  for (const m of [10, 11, 0, 1, 2, 3]) {
    const s = monthStats[m];
    if (!s) continue;
    const total = s.w + s.l;
    const pct = (s.w / total * 100).toFixed(1);
    const overPct = (s.overW + s.overL) > 0 ? (s.overW / (s.overW + s.overL) * 100).toFixed(1) : "N/A";
    const underPct = (s.underW + s.underL) > 0 ? (s.underW / (s.underW + s.underL) * 100).toFixed(1) : "N/A";
    const sorted = [...s.edges].sort((a, b) => a - b);
    const avgEdge = (sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(1);
    const medEdge = sorted[Math.floor(sorted.length / 2)].toFixed(1);
    console.log(`  ${(monthNames[m] || m).padEnd(6)} ${(pct + "%").padStart(6)} ${`${s.w}W-${s.l}L`.padStart(11)} ${(overPct + "%").padStart(7)} ${(underPct + "%").padStart(8)} ${avgEdge.padStart(8)} ${medEdge.padStart(8)}`);
  }

  // ─── Part 2: Edge Thresholds by Season Phase ──────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 2: OPTIMAL EDGE THRESHOLDS BY SEASON PHASE");
  console.log("═".repeat(80));
  console.log();

  const phases = [
    { name: "Early (Nov-Dec)", months: [10, 11] },
    { name: "Mid (Jan-Feb)", months: [0, 1] },
    { name: "Late (Mar-Apr)", months: [2, 3] },
  ];

  console.log(`  ${"Phase".padEnd(18)} ${"Edge≥".padEnd(6)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"~/wk".padStart(6)}`);
  console.log(`  ${"-".repeat(52)}`);

  // Collect all walk-forward predictions
  const allPreds = [];
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100) continue;
    const beta = ridge(train.map(features), train.map(g => g.actualTotal), 1000);
    for (const g of test) {
      const x = features(g);
      const pred = x.reduce((s, v, j) => s + v * beta[j], 0);
      const edge = pred - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";
      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else result = "PUSH";
      allPreds.push({ ...g, predicted: pred, edge, absEdge, ouDir, result });
    }
  }

  const totalWeeks = 13 * 20;
  for (const phase of phases) {
    for (const minEdge of [3, 5, 7, 9, 10, 12]) {
      const picks = allPreds.filter(p => phase.months.includes(p.gameMonth) && p.absEdge >= minEdge);
      const w = picks.filter(p => p.result === "WIN").length;
      const l = picks.filter(p => p.result === "LOSS").length;
      const total = w + l;
      if (total < 20) continue;
      const phaseWeeks = totalWeeks * (phase.months.length / 5); // rough proportion
      console.log(`  ${phase.name.padEnd(18)} ${String(minEdge).padEnd(6)} ${(w/total*100).toFixed(1).padStart(5)}% ${`${w}W-${l}L`.padStart(11)} ${(picks.length / phaseWeeks).toFixed(1).padStart(6)}`);
    }
    console.log();
  }

  // ─── Part 3: Rating Age as Feature ─────────────────────────────────────────
  console.log(`${"═".repeat(80)}`);
  console.log("  PART 3: ratingAge AS FEATURE (walk-forward comparison)");
  console.log("═".repeat(80));
  console.log();

  const featureSetsAge = {
    "baseline": { features: g => [1, g.sumDE, g.sumOE, g.avgTempo] },
    "+ratingAge": { features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.ratingAge] },
    "+ratingAge²": { features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.ratingAge, g.ratingAge ** 2] },
  };

  console.log(`  ${"Feature Set".padEnd(16)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"RMSE".padStart(6)} ${"vs base".padStart(9)}`);
  console.log(`  ${"-".repeat(52)}`);

  const ageResults = {};
  for (const [name, { features: feat }] of Object.entries(featureSetsAge)) {
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
    ageResults[name] = pct;
    const diff = ageResults["baseline"] ? (pct - ageResults["baseline"]).toFixed(2) : "—";
    console.log(`  ${name.padEnd(16)} ${pct.toFixed(1).padStart(5)}% ${`${totalW}W-${totalL}L`.padStart(11)} ${rmse.toFixed(2).padStart(6)} ${(diff + "pp").padStart(9)}`);
  }

  // ─── Part 4: Rating Volatility ─────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 4: RATING VOLATILITY (stdev AdjEM over 14d)");
  console.log("═".repeat(80));
  console.log();

  const volGames = enriched.filter(g => g.hasVol);
  console.log(`  Games with volatility data: ${volGames.length} / ${enriched.length}\n`);

  if (volGames.length > 1000) {
    // As feature
    console.log("  ── Volatility as Ridge Feature ──\n");
    const volFeatureSets = {
      "base(vol-filtered)": { features: g => [1, g.sumDE, g.sumOE, g.avgTempo] },
      "+avgVol": { features: g => [1, g.sumDE, g.sumOE, g.avgTempo, g.avgVol] },
    };

    console.log(`  ${"Feature Set".padEnd(20)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"RMSE".padStart(6)}`);
    console.log(`  ${"-".repeat(46)}`);

    for (const [name, { features: feat }] of Object.entries(volFeatureSets)) {
      let totalW = 0, totalL = 0, totalSqErr = 0, totalN = 0;
      for (const testSeason of seasons.slice(1)) {
        const train = volGames.filter(g => g.season < testSeason);
        const test = volGames.filter(g => g.season === testSeason);
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
      console.log(`  ${name.padEnd(20)} ${pct.toFixed(1).padStart(5)}% ${`${totalW}W-${totalL}L`.padStart(11)} ${rmse.toFixed(2).padStart(6)}`);
    }

    // As filter
    console.log("\n  ── Volatility as Tier FILTER (edge ≥ 9, baseline predictions) ──\n");
    console.log(`  ${"Filter".padEnd(20)} ${"Win%".padStart(6)} ${"W-L".padStart(11)} ${"~/wk".padStart(6)}`);
    console.log(`  ${"-".repeat(46)}`);

    const volPreds = allPreds.filter(p => {
      const eg = enriched.find(e => e.season === p.season && e.line === p.line && e.actualTotal === p.actualTotal);
      return eg && eg.hasVol;
    });

    // This is a rough approach. More precise would be to cross-reference by game ID.
    // For now, just show the volatility distribution of predictions.
    const volPredsWithVol = volPreds.map(p => {
      const eg = enriched.find(e => e.season === p.season && e.line === p.line && e.actualTotal === p.actualTotal);
      return { ...p, avgVol: eg?.avgVol ?? null };
    }).filter(p => p.avgVol !== null);

    for (const [label, filter] of [
      ["All", () => true],
      ["Low vol (< 0.5)", p => p.avgVol < 0.5],
      ["Med vol (0.5-1.0)", p => p.avgVol >= 0.5 && p.avgVol < 1.0],
      ["High vol (≥ 1.0)", p => p.avgVol >= 1.0],
    ]) {
      const picks = volPredsWithVol.filter(p => p.absEdge >= 9 && filter(p));
      const w = picks.filter(p => p.result === "WIN").length;
      const l = picks.filter(p => p.result === "LOSS").length;
      const total = w + l;
      if (total < 20) { console.log(`  ${label.padEnd(20)} (N < 20)`); continue; }
      console.log(`  ${label.padEnd(20)} ${(w/total*100).toFixed(1).padStart(5)}% ${`${w}W-${l}L`.padStart(11)} ${(picks.length / totalWeeks).toFixed(1).padStart(6)}`);
    }
  }

  console.log();
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
