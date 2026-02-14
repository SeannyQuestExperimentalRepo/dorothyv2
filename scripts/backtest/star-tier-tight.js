const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();

  const games = await prisma.nCAAMBGame.findMany({
    where: {
      homeScore: { not: null }, awayScore: { not: null },
      overUnder: { not: null },
      homeAdjEM: { not: null }, homeAdjOE: { not: null },
      homeAdjDE: { not: null }, homeAdjTempo: { not: null },
      awayAdjEM: { not: null }, awayAdjOE: { not: null },
      awayAdjDE: { not: null }, awayAdjTempo: { not: null },
    },
    select: {
      season: true, gameDate: true,
      homeScore: true, awayScore: true, overUnder: true,
      homeAdjEM: true, awayAdjEM: true,
      homeAdjOE: true, awayAdjOE: true,
      homeAdjDE: true, awayAdjDE: true,
      homeAdjTempo: true, awayAdjTempo: true,
      fmHomePred: true, fmAwayPred: true,
      isConferenceGame: true,
    },
    orderBy: { gameDate: "asc" },
  });

  function predictTotal(g) {
    return -407.6385 + 0.6685 * (g.homeAdjDE + g.awayAdjDE) +
      0.6597 * (g.homeAdjOE + g.awayAdjOE) +
      3.9804 * ((g.homeAdjTempo + g.awayAdjTempo) / 2) +
      -0.1391 * Math.abs(g.homeAdjTempo - g.awayAdjTempo) +
      0.0064 * Math.abs(g.homeAdjEM - g.awayAdjEM) +
      -0.6345 * (g.isConferenceGame ? 1 : 0) +
      0.0100 * ((g.fmHomePred || 0) + (g.fmAwayPred || 0));
  }

  const enriched = [];
  for (const g of games) {
    const predicted = predictTotal(g);
    const line = g.overUnder;
    const edge = predicted - line;
    const absEdge = Math.abs(edge);
    const avgTempo = (g.homeAdjTempo + g.awayAdjTempo) / 2;
    const ouDir = edge > 0 ? "over" : edge < 0 ? "under" : null;
    if (!ouDir) continue;
    const actualTotal = g.homeScore + g.awayScore;
    let result;
    if (actualTotal > line) result = ouDir === "over" ? "WIN" : "LOSS";
    else if (actualTotal < line) result = ouDir === "under" ? "WIN" : "LOSS";
    else result = "PUSH";
    enriched.push({ ...g, predicted, edge, absEdge, avgTempo, ouDir, result, line });
  }

  const numSeasons = new Set(enriched.map(g => g.season)).size;
  const totalWeeks = numSeasons * 20;

  // Target: 5★ ~2/week, 4★ ~5-8/week, 3★ ~15-25/week
  // All monotonic (higher stars = higher win %)
  const configs = [
    {
      name: "F: OVER-focused 5★ (edge>=15 any, or OVER edge>=12)",
      tiers: (g) => {
        if (g.absEdge >= 15) return 5;
        if (g.ouDir === "over" && g.absEdge >= 12) return 5;
        if (g.ouDir === "over" && g.absEdge >= 8) return 4;
        if (g.ouDir === "under" && g.absEdge >= 12) return 4;
        if (g.absEdge >= 5) return 3;
        return 0;
      },
    },
    {
      name: "G: Ultra-selective 5★ (OVER edge>=15 OR any edge>=18)",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 15) return 5;
        if (g.absEdge >= 18) return 5;
        if (g.ouDir === "over" && g.absEdge >= 10) return 4;
        if (g.ouDir === "under" && g.absEdge >= 15) return 4;
        if (g.absEdge >= 5) return 3;
        return 0;
      },
    },
    {
      name: "H: OVER edge>=12 = 5★, OVER edge>=8 = 4★, edge>=5 = 3★",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 12) return 5;
        if (g.ouDir === "over" && g.absEdge >= 8) return 4;
        if (g.ouDir === "under" && g.absEdge >= 15) return 4;
        if (g.absEdge >= 5) return 3;
        return 0;
      },
    },
    {
      name: "I: OVER edge>=10 = 5★, OVER edge>=7 OR UNDER edge>=12 = 4★, edge>=5 = 3★",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 10) return 5;
        if (g.ouDir === "over" && g.absEdge >= 7) return 4;
        if (g.ouDir === "under" && g.absEdge >= 12) return 4;
        if (g.absEdge >= 5) return 3;
        return 0;
      },
    },
    {
      name: "J: OVER edge>=10 line<145 = 5★, OVER edge>=7 = 4★, edge>=4 = 3★",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 10 && g.line <= 145) return 5;
        if (g.ouDir === "over" && g.absEdge >= 7) return 4;
        if (g.ouDir === "under" && g.absEdge >= 10) return 4;
        if (g.absEdge >= 4) return 3;
        return 0;
      },
    },
    {
      name: "K: OVER edge>=12 line<140 = 5★, OVER edge>=7 = 4★, edge>=4 = 3★",
      tiers: (g) => {
        if (g.ouDir === "over" && g.absEdge >= 12 && g.line <= 140) return 5;
        if (g.ouDir === "over" && g.absEdge >= 7) return 4;
        if (g.ouDir === "under" && g.absEdge >= 10) return 4;
        if (g.absEdge >= 4) return 3;
        return 0;
      },
    },
  ];

  for (const config of configs) {
    console.log(`\n── ${config.name} ──\n`);
    const buckets = {};
    let totalPicks = 0;

    // Also track by season for OOS validation
    const bySeason = {};

    for (const g of enriched) {
      const stars = config.tiers(g);
      if (stars === 0) continue;
      totalPicks++;
      if (!buckets[stars]) buckets[stars] = { win: 0, loss: 0, push: 0 };
      buckets[stars][g.result.toLowerCase()]++;

      const sKey = `${g.season}|${stars}`;
      if (!bySeason[sKey]) bySeason[sKey] = { win: 0, loss: 0, push: 0, count: 0 };
      bySeason[sKey][g.result.toLowerCase()]++;
      bySeason[sKey].count++;
    }

    let prevPct = 0;
    let monotonic = true;
    for (let s = 3; s <= 5; s++) {
      const r = buckets[s] || { win: 0, loss: 0, push: 0 };
      const total = r.win + r.loss;
      const pct = total > 0 ? (r.win / total) * 100 : 0;
      const perWeek = ((r.win + r.loss + r.push) / totalWeeks).toFixed(1);
      if (s > 3 && pct <= prevPct) monotonic = false;
      prevPct = pct;
      console.log(`  ${s}★: ${String(r.win).padStart(5)}W - ${String(r.loss).padStart(5)}L - ${String(r.push).padStart(3)}P  (${pct.toFixed(1)}%)  ~${perWeek}/week`);
    }

    const allW = Object.values(buckets).reduce((a, b) => a + b.win, 0);
    const allL = Object.values(buckets).reduce((a, b) => a + b.loss, 0);
    const allT = allW + allL;
    console.log(`  Monotonic: ${monotonic ? "YES ✓" : "NO ✗"}`);

    // Show 2025 + 2026 OOS for the best looking configs
    for (const yr of [2025, 2026]) {
      const parts = [];
      for (let s = 5; s >= 3; s--) {
        const r = bySeason[`${yr}|${s}`];
        if (!r || r.win + r.loss === 0) continue;
        const pct = ((r.win / (r.win + r.loss)) * 100).toFixed(0);
        const pw = (r.count / 20).toFixed(1);
        parts.push(`${s}★=${pct}%(${pw}/wk)`);
      }
      if (parts.length) console.log(`  ${yr}: ${parts.join("  ")}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
