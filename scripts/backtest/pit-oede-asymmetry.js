/**
 * PIT Edge Discovery 3.6: Offensive vs Defensive Momentum Asymmetry
 *
 * Hypothesis: The 15pp UNDER > OVER gap may be driven by defensive improvements
 * being more predictive. Tests:
 *   1. DE momentum for UNDER vs OE momentum for OVER (direction-specific)
 *   2. Asymmetric feature weighting (separate models per direction)
 *   3. Direction-specific tier gates using momentum as filter
 *   4. Whether momentum direction-matching improves tier accuracy
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
  console.log(`Loaded ${snapshots.length} snapshots across ${snapshotsByDate.size} dates`);

  const games = await prisma.nCAAMBGame.findMany({
    where: { homeScore: { not: null }, awayScore: { not: null }, overUnder: { not: null } },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    orderBy: { gameDate: "asc" },
  });
  console.log(`Loaded ${games.length} completed games\n`);

  // Build enriched rows with OE/DE momentum
  const enriched = [];
  for (const g of games) {
    const gameDate = formatDate(g.gameDate);
    const prev = new Date(g.gameDate); prev.setDate(prev.getDate() - 1);
    let ds = snapshotsByDate.get(formatDate(prev));
    if (!ds) ds = snapshotsByDate.get(gameDate);
    if (!ds) { const tb = new Date(g.gameDate); tb.setDate(tb.getDate() - 2); ds = snapshotsByDate.get(formatDate(tb)); }
    if (!ds) continue;

    const homeR = lookupSnapshot(ds, g.homeTeam.name);
    const awayR = lookupSnapshot(ds, g.awayTeam.name);
    if (!homeR || !awayR) continue;

    const t7date = new Date(g.gameDate); t7date.setDate(t7date.getDate() - 7);
    const ds7 = findNearestSnapshot(snapshotsByDate, formatDate(t7date), 3);
    const homeR7 = ds7 ? lookupSnapshot(ds7, g.homeTeam.name) : null;
    const awayR7 = ds7 ? lookupSnapshot(ds7, g.awayTeam.name) : null;

    if (!homeR7 || !awayR7) continue; // Need momentum for this test

    const row = {
      season: g.season,
      line: g.overUnder,
      actualTotal: g.homeScore + g.awayScore,
      sumDE: homeR.adjDE + awayR.adjDE,
      sumOE: homeR.adjOE + awayR.adjOE,
      avgTempo: (homeR.adjTempo + awayR.adjTempo) / 2,
      // OE momentum (positive = offenses improving = higher scoring expected)
      homeOEDelta7d: homeR.adjOE - homeR7.adjOE,
      awayOEDelta7d: awayR.adjOE - awayR7.adjOE,
      sumOEDelta7d: (homeR.adjOE - homeR7.adjOE) + (awayR.adjOE - awayR7.adjOE),
      // DE momentum (positive = defenses worsening = higher scoring expected)
      // Note: lower AdjDE = better defense, so delta>0 means getting worse
      homeDEDelta7d: homeR.adjDE - homeR7.adjDE,
      awayDEDelta7d: awayR.adjDE - awayR7.adjDE,
      sumDEDelta7d: (homeR.adjDE - homeR7.adjDE) + (awayR.adjDE - awayR7.adjDE),
      // Combined
      emMomDiff: (homeR.adjEM - homeR7.adjEM) - (awayR.adjEM - awayR7.adjEM),
    };

    // Direction-specific momentum indicators
    // "defenses improving" = sumDEDelta7d < 0 (lower DE = better defense = fewer points)
    row.defensesImproving = row.sumDEDelta7d < 0 ? 1 : 0;
    // "offenses improving" = sumOEDelta7d > 0
    row.offensesImproving = row.sumOEDelta7d > 0 ? 1 : 0;

    enriched.push(row);
  }

  const seasons = [...new Set(enriched.map(g => g.season))].sort();
  console.log(`Enriched ${enriched.length} games with OE/DE momentum\n`);

  const baseFeatures = g => [1, g.sumDE, g.sumOE, g.avgTempo];

  // ═══ PART 1: OVER vs UNDER accuracy split by momentum direction ═══════════
  console.log("═".repeat(80));
  console.log("  PART 1: OVER vs UNDER WIN% BY MOMENTUM DIRECTION");
  console.log("  (walk-forward Ridge, edge ≥ 9 — config #26 threshold)");
  console.log("═".repeat(80));
  console.log();

  // Walk-forward with base model, then split results by momentum
  const allPreds = [];
  for (const testSeason of seasons.slice(1)) {
    const train = enriched.filter(g => g.season < testSeason);
    const test = enriched.filter(g => g.season === testSeason);
    if (train.length < 100) continue;

    const beta = ridge(train.map(baseFeatures), train.map(g => g.actualTotal), 1000);

    for (const g of test) {
      const pred = baseFeatures(g).reduce((s, v, j) => s + v * beta[j], 0);
      const edge = pred - g.line;
      const absEdge = Math.abs(edge);
      const ouDir = edge > 0 ? "over" : "under";

      let result;
      if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
      else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
      else result = "PUSH";

      allPreds.push({
        ...g, pred, edge, absEdge, ouDir, result,
      });
    }
  }

  // Analyze UNDER picks: does defensive momentum (improving defenses) help?
  console.log("  UNDER picks (edge ≥ 9):");
  console.log(`  ${"DE Momentum".padEnd(25)} ${"Win%".padStart(6)} ${"W-L".padStart(12)} ${"Interpretation".padStart(35)}`);
  console.log(`  ${"-".repeat(80)}`);

  const underPicks = allPreds.filter(p => p.ouDir === "under" && p.absEdge >= 9 && p.result !== "PUSH");

  for (const [label, filter, interp] of [
    ["All UNDER", () => true, "Baseline"],
    ["DE improving (Δ<0)", p => p.sumDEDelta7d < 0, "Defenses getting better → more UNDER wins?"],
    ["DE worsening (Δ>0)", p => p.sumDEDelta7d > 0, "Defenses getting worse → fewer UNDER wins?"],
    ["DE strongly impr (<-1)", p => p.sumDEDelta7d < -1, "Strong defensive improvement"],
    ["DE strongly wors (>1)", p => p.sumDEDelta7d > 1, "Strong defensive decline"],
    ["OE declining (Δ<0)", p => p.sumOEDelta7d < 0, "Offenses getting worse → more UNDER wins?"],
    ["OE improving (Δ>0)", p => p.sumOEDelta7d > 0, "Offenses getting better → fewer UNDER wins?"],
    ["Both favor UNDER", p => p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0, "DE improving + OE declining"],
    ["Both oppose UNDER", p => p.sumDEDelta7d > 0 && p.sumOEDelta7d > 0, "DE worsening + OE improving"],
  ]) {
    const picks = underPicks.filter(filter);
    const w = picks.filter(p => p.result === "WIN").length;
    const l = picks.filter(p => p.result === "LOSS").length;
    if (w + l < 20) { console.log(`  ${label.padEnd(25)} (N=${w+l} < 20)`); continue; }
    console.log(`  ${label.padEnd(25)} ${(w/(w+l)*100).toFixed(1).padStart(5)}% ${`${w}W-${l}L`.padStart(12)} ${interp.padStart(35)}`);
  }

  // Analyze OVER picks: does offensive momentum help?
  console.log(`\n  OVER picks (edge ≥ 9):`);
  console.log(`  ${"OE Momentum".padEnd(25)} ${"Win%".padStart(6)} ${"W-L".padStart(12)} ${"Interpretation".padStart(35)}`);
  console.log(`  ${"-".repeat(80)}`);

  const overPicks = allPreds.filter(p => p.ouDir === "over" && p.absEdge >= 9 && p.result !== "PUSH");

  for (const [label, filter, interp] of [
    ["All OVER", () => true, "Baseline"],
    ["OE improving (Δ>0)", p => p.sumOEDelta7d > 0, "Offenses getting better → more OVER wins?"],
    ["OE declining (Δ<0)", p => p.sumOEDelta7d < 0, "Offenses getting worse → fewer OVER wins?"],
    ["OE strongly impr (>1)", p => p.sumOEDelta7d > 1, "Strong offensive improvement"],
    ["OE strongly decl (<-1)", p => p.sumOEDelta7d < -1, "Strong offensive decline"],
    ["DE worsening (Δ>0)", p => p.sumDEDelta7d > 0, "Defenses getting worse → more OVER wins?"],
    ["DE improving (Δ<0)", p => p.sumDEDelta7d < 0, "Defenses getting better → fewer OVER wins?"],
    ["Both favor OVER", p => p.sumDEDelta7d > 0 && p.sumOEDelta7d > 0, "DE worsening + OE improving"],
    ["Both oppose OVER", p => p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0, "DE improving + OE declining"],
  ]) {
    const picks = overPicks.filter(filter);
    const w = picks.filter(p => p.result === "WIN").length;
    const l = picks.filter(p => p.result === "LOSS").length;
    if (w + l < 20) { console.log(`  ${label.padEnd(25)} (N=${w+l} < 20)`); continue; }
    console.log(`  ${label.padEnd(25)} ${(w/(w+l)*100).toFixed(1).padStart(5)}% ${`${w}W-${l}L`.padStart(12)} ${interp.padStart(35)}`);
  }

  // ═══ PART 2: Direction-specific Ridge models ══════════════════════════════
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 2: DIRECTION-SPECIFIC RIDGE MODELS");
  console.log("  Train separate models for predicting low vs high totals");
  console.log("═".repeat(80));
  console.log();

  // Instead of one model, train two: one weighted toward UNDER features, one toward OVER
  const featureSets = {
    "baseline": g => [1, g.sumDE, g.sumOE, g.avgTempo],
    "+sumDEDelta7d": g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumDEDelta7d],
    "+sumOEDelta7d": g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumOEDelta7d],
    "+OE+DE deltas": g => [1, g.sumDE, g.sumOE, g.avgTempo, g.sumOEDelta7d, g.sumDEDelta7d],
  };

  console.log(`  ${"Model".padEnd(18)} ${"OVER%".padStart(7)} ${"OVER N".padStart(8)} ${"UNDER%".padStart(8)} ${"UNDER N".padStart(8)} ${"ALL%".padStart(6)} ${"ALL N".padStart(7)}`);
  console.log(`  ${"-".repeat(65)}`);

  for (const [name, feat] of Object.entries(featureSets)) {
    let overW = 0, overL = 0, underW = 0, underL = 0;

    for (const testSeason of seasons.slice(1)) {
      const train = enriched.filter(g => g.season < testSeason);
      const test = enriched.filter(g => g.season === testSeason);
      if (train.length < 100) continue;

      const beta = ridge(train.map(feat), train.map(g => g.actualTotal), 1000);

      for (const g of test) {
        const pred = feat(g).reduce((s, v, j) => s + v * beta[j], 0);
        const edge = pred - g.line;
        if (Math.abs(edge) < 9) continue;
        const ouDir = edge > 0 ? "over" : "under";

        let result;
        if (g.actualTotal > g.line) result = ouDir === "over" ? "WIN" : "LOSS";
        else if (g.actualTotal < g.line) result = ouDir === "under" ? "WIN" : "LOSS";
        else continue;

        if (ouDir === "over") { if (result === "WIN") overW++; else overL++; }
        else { if (result === "WIN") underW++; else underL++; }
      }
    }

    const overPct = overW + overL > 0 ? (overW / (overW + overL) * 100).toFixed(1) : "N/A";
    const underPct = underW + underL > 0 ? (underW / (underW + underL) * 100).toFixed(1) : "N/A";
    const allW = overW + underW, allL = overL + underL;
    const allPct = allW + allL > 0 ? (allW / (allW + allL) * 100).toFixed(1) : "N/A";

    console.log(`  ${name.padEnd(18)} ${(overPct + "%").padStart(7)} ${String(overW + overL).padStart(8)} ${(underPct + "%").padStart(8)} ${String(underW + underL).padStart(8)} ${(allPct + "%").padStart(6)} ${String(allW + allL).padStart(7)}`);
  }

  // ═══ PART 3: Momentum as TIER FILTER ══════════════════════════════════════
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 3: MOMENTUM AS TIER FILTER");
  console.log("  Can momentum filters improve config #26 tiers?");
  console.log("═".repeat(80));
  console.log();

  // Config #26 tiers: 5★ U+edge≥12+T≤64, 4★ U+edge≥10, 3★ any edge≥9
  const tierPreds = allPreds.filter(p => p.result !== "PUSH");

  const filters = [
    // 5★ tier + momentum
    ["5★ baseline (U≥12,T≤64)", p => p.ouDir === "under" && p.absEdge >= 12 && p.avgTempo <= 64],
    ["5★ + DE improving", p => p.ouDir === "under" && p.absEdge >= 12 && p.avgTempo <= 64 && p.sumDEDelta7d < 0],
    ["5★ + both favor UNDER", p => p.ouDir === "under" && p.absEdge >= 12 && p.avgTempo <= 64 && p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0],
    // 4★ tier + momentum
    ["4★ baseline (U≥10)", p => p.ouDir === "under" && p.absEdge >= 10],
    ["4★ + DE improving", p => p.ouDir === "under" && p.absEdge >= 10 && p.sumDEDelta7d < 0],
    ["4★ + OE declining", p => p.ouDir === "under" && p.absEdge >= 10 && p.sumOEDelta7d < 0],
    ["4★ + both favor UNDER", p => p.ouDir === "under" && p.absEdge >= 10 && p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0],
    // 3★ tier + momentum
    ["3★ baseline (any≥9)", p => p.absEdge >= 9],
    ["3★ + DE favor direction", p => p.absEdge >= 9 && ((p.ouDir === "under" && p.sumDEDelta7d < 0) || (p.ouDir === "over" && p.sumDEDelta7d > 0))],
    ["3★ + OE favor direction", p => p.absEdge >= 9 && ((p.ouDir === "over" && p.sumOEDelta7d > 0) || (p.ouDir === "under" && p.sumOEDelta7d < 0))],
    ["3★ + both favor dir", p => p.absEdge >= 9 && (
      (p.ouDir === "under" && p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0) ||
      (p.ouDir === "over" && p.sumDEDelta7d > 0 && p.sumOEDelta7d > 0)
    )],
  ];

  console.log(`  ${"Filter".padEnd(30)} ${"Win%".padStart(6)} ${"W-L".padStart(12)} ${"~/wk".padStart(6)}`);
  console.log(`  ${"-".repeat(56)}`);

  const numWeeks = 13 * seasons.length; // ~13 weeks per season
  for (const [label, filter] of filters) {
    const picks = tierPreds.filter(filter);
    const w = picks.filter(p => p.result === "WIN").length;
    const l = picks.filter(p => p.result === "LOSS").length;
    if (w + l < 20) { console.log(`  ${label.padEnd(30)} (N=${w+l} < 20)`); continue; }
    const perWk = ((w + l) / numWeeks).toFixed(1);
    console.log(`  ${label.padEnd(30)} ${(w/(w+l)*100).toFixed(1).padStart(5)}% ${`${w}W-${l}L`.padStart(12)} ${perWk.padStart(6)}`);
  }

  // ═══ PART 4: Per-season stability of momentum filters ═════════════════════
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 4: PER-SEASON STABILITY — MOMENTUM FILTER ON 4★ TIER");
  console.log("═".repeat(80));
  console.log();

  console.log(`  ${"Season".padEnd(8)} ${"4★ base".padStart(10)} ${"N".padStart(5)} ${"4★+DE impr".padStart(12)} ${"N".padStart(5)} ${"Δ".padStart(7)}`);
  console.log(`  ${"-".repeat(50)}`);

  for (const s of seasons.slice(1)) {
    const seasonPreds = tierPreds.filter(p => p.season === s);
    const base = seasonPreds.filter(p => p.ouDir === "under" && p.absEdge >= 10);
    const filtered = seasonPreds.filter(p => p.ouDir === "under" && p.absEdge >= 10 && p.sumDEDelta7d < 0);

    const bW = base.filter(p => p.result === "WIN").length;
    const bL = base.filter(p => p.result === "LOSS").length;
    const fW = filtered.filter(p => p.result === "WIN").length;
    const fL = filtered.filter(p => p.result === "LOSS").length;

    if (bW + bL < 5) continue;
    const bPct = bW / (bW + bL) * 100;
    const fPct = fW + fL > 0 ? fW / (fW + fL) * 100 : 0;
    const delta = fW + fL > 0 ? (fPct - bPct).toFixed(1) : "N/A";

    console.log(`  ${String(s).padEnd(8)} ${bPct.toFixed(1).padStart(9)}% ${String(bW+bL).padStart(5)} ${fPct.toFixed(1).padStart(11)}% ${String(fW+fL).padStart(5)} ${(delta + "pp").padStart(7)}`);
  }

  // ═══ PART 5: Summary statistics ═══════════════════════════════════════════
  console.log(`\n\n${"═".repeat(80)}`);
  console.log("  PART 5: MOMENTUM DIRECTION DISTRIBUTION");
  console.log("═".repeat(80));
  console.log();

  const e9 = allPreds.filter(p => p.absEdge >= 9 && p.result !== "PUSH");
  const underE9 = e9.filter(p => p.ouDir === "under");
  const overE9 = e9.filter(p => p.ouDir === "over");

  console.log(`  UNDER picks (edge≥9): ${underE9.length}`);
  console.log(`    DE improving: ${underE9.filter(p => p.sumDEDelta7d < 0).length} (${(underE9.filter(p => p.sumDEDelta7d < 0).length/underE9.length*100).toFixed(0)}%)`);
  console.log(`    OE declining: ${underE9.filter(p => p.sumOEDelta7d < 0).length} (${(underE9.filter(p => p.sumOEDelta7d < 0).length/underE9.length*100).toFixed(0)}%)`);
  console.log(`    Both:         ${underE9.filter(p => p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0).length} (${(underE9.filter(p => p.sumDEDelta7d < 0 && p.sumOEDelta7d < 0).length/underE9.length*100).toFixed(0)}%)`);
  console.log();
  console.log(`  OVER picks (edge≥9): ${overE9.length}`);
  console.log(`    OE improving: ${overE9.filter(p => p.sumOEDelta7d > 0).length} (${(overE9.filter(p => p.sumOEDelta7d > 0).length/overE9.length*100).toFixed(0)}%)`);
  console.log(`    DE worsening: ${overE9.filter(p => p.sumDEDelta7d > 0).length} (${(overE9.filter(p => p.sumDEDelta7d > 0).length/overE9.length*100).toFixed(0)}%)`);
  console.log(`    Both:         ${overE9.filter(p => p.sumDEDelta7d > 0 && p.sumOEDelta7d > 0).length} (${(overE9.filter(p => p.sumDEDelta7d > 0 && p.sumOEDelta7d > 0).length/overE9.length*100).toFixed(0)}%)`);

  console.log();
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
