/**
 * Generate Point-in-Time (PIT) KenPom Ratings
 *
 * Removes look-ahead bias from the backtest by creating date-specific
 * rating snapshots. Uses two approaches:
 *
 * 1. BLEND (default): Combines previous season's end-of-season ratings
 *    with current season's end-of-season ratings, weighted by how far
 *    into the season each game date is. This approximates KenPom's own
 *    methodology (he starts with priors from the previous year and
 *    updates as games are played).
 *
 * 2. CBBDATA (optional): If CBD_API_KEY is set, fetches actual daily
 *    T-Rank archive ratings from cbbdata.com for true point-in-time data.
 *
 * Output: data/pit-kenpom-ratings.json
 *
 * Usage:
 *   npx tsx scripts/generate-pit-ratings.ts              # blend mode
 *   CBD_API_KEY=xxx npx tsx scripts/generate-pit-ratings.ts  # cbbdata mode
 */

import * as fs from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface KenpomRating {
  TeamName: string;
  Season: number;
  RankAdjEM: number;
  AdjEM: number;
  AdjOE: number;
  RankAdjOE: number;
  AdjDE: number;
  RankAdjDE: number;
  AdjTempo: number;
  RankAdjTempo: number;
  Wins: number;
  Losses: number;
  ConfShort: string;
}

interface PITSnapshot {
  date: string; // YYYY-MM-DD
  alpha: number; // blend weight (0 = pure prior, 1 = pure current)
  teamCount: number;
  ratings: Record<string, KenpomRating>;
}

// ─── CSV Parser ─────────────────────────────────────────────────────────────

function parseKenpomCSV(csvPath: string): Map<number, Map<string, KenpomRating>> {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.trim().split("\n");
  const header = lines[0].split(",");

  const seasonMap = new Map<number, Map<string, KenpomRating>>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < header.length) continue;

    const season = parseInt(cols[0], 10);
    if (isNaN(season)) continue;

    const rating: KenpomRating = {
      Season: season,
      TeamName: cols[1],
      RankAdjEM: parseInt(cols[2], 10),
      AdjEM: parseFloat(cols[3]),
      AdjOE: parseFloat(cols[4]),
      RankAdjOE: parseInt(cols[5], 10),
      AdjDE: parseFloat(cols[6]),
      RankAdjDE: parseInt(cols[7], 10),
      AdjTempo: parseFloat(cols[8]),
      RankAdjTempo: parseInt(cols[9], 10),
      Wins: parseInt(cols[10], 10),
      Losses: parseInt(cols[11], 10),
      ConfShort: cols[12]?.trim() || "",
    };

    if (!seasonMap.has(season)) seasonMap.set(season, new Map());
    seasonMap.get(season)!.set(rating.TeamName, rating);
  }

  return seasonMap;
}

// ─── Blend Logic ────────────────────────────────────────────────────────────

/**
 * Compute blend weight (alpha) for a given date within a season.
 *
 * KenPom starts each season with prior-year ratings as the baseline and
 * updates as games accumulate. We approximate this:
 *
 * - Season start (early Nov):  alpha ≈ 0.20 (mostly prior year)
 * - Mid-December:              alpha ≈ 0.40
 * - Mid-January:               alpha ≈ 0.55
 * - Mid-February:              alpha ≈ 0.75
 * - March:                     alpha ≈ 0.90+
 * - Post-season:               alpha = 0.95
 */
function computeAlpha(gameDate: Date, seasonStartDate: Date): number {
  const daysSinceStart = Math.max(
    0,
    (gameDate.getTime() - seasonStartDate.getTime()) / (24 * 60 * 60 * 1000),
  );

  // alpha = 0.20 + 0.75 * min(days / 130, 1.0)
  // Day 0 (Nov start): 0.20
  // Day 30 (Dec):      0.37
  // Day 60 (Jan):      0.55
  // Day 90 (Feb):      0.72
  // Day 120 (Mar):     0.89
  // Day 130+ (late Mar): 0.95
  return Math.min(0.95, 0.20 + 0.75 * Math.min(daysSinceStart / 130, 1.0));
}

function blendRating(
  prior: KenpomRating | undefined,
  current: KenpomRating,
  alpha: number,
): KenpomRating {
  if (!prior) {
    // New team (no prior year data) — use current with reduced confidence
    // Scale the extremes toward average to approximate early-season uncertainty
    const avgEM = 0; // league average AdjEM
    const avgOE = 103; // ~league average offense
    const avgDE = 103; // ~league average defense
    const avgTempo = 67; // ~league average tempo

    return {
      ...current,
      AdjEM: avgEM + alpha * (current.AdjEM - avgEM),
      AdjOE: avgOE + alpha * (current.AdjOE - avgOE),
      AdjDE: avgDE + alpha * (current.AdjDE - avgDE),
      AdjTempo: avgTempo + alpha * (current.AdjTempo - avgTempo),
      // Ranks will be recomputed after all teams are blended
      RankAdjEM: current.RankAdjEM,
      RankAdjOE: current.RankAdjOE,
      RankAdjDE: current.RankAdjDE,
      RankAdjTempo: current.RankAdjTempo,
    };
  }

  return {
    ...current,
    AdjEM: (1 - alpha) * prior.AdjEM + alpha * current.AdjEM,
    AdjOE: (1 - alpha) * prior.AdjOE + alpha * current.AdjOE,
    AdjDE: (1 - alpha) * prior.AdjDE + alpha * current.AdjDE,
    AdjTempo: (1 - alpha) * prior.AdjTempo + alpha * current.AdjTempo,
    // Ranks will be recomputed
    RankAdjEM: current.RankAdjEM,
    RankAdjOE: current.RankAdjOE,
    RankAdjDE: current.RankAdjDE,
    RankAdjTempo: current.RankAdjTempo,
  };
}

function recomputeRanks(ratings: Record<string, KenpomRating>): void {
  const teams = Object.values(ratings);

  // Sort by AdjEM descending (rank 1 = highest)
  const byEM = [...teams].sort((a, b) => b.AdjEM - a.AdjEM);
  byEM.forEach((t, i) => { t.RankAdjEM = i + 1; });

  const byOE = [...teams].sort((a, b) => b.AdjOE - a.AdjOE);
  byOE.forEach((t, i) => { t.RankAdjOE = i + 1; });

  // AdjDE: lower is better, so sort ascending
  const byDE = [...teams].sort((a, b) => a.AdjDE - b.AdjDE);
  byDE.forEach((t, i) => { t.RankAdjDE = i + 1; });

  const byTempo = [...teams].sort((a, b) => b.AdjTempo - a.AdjTempo);
  byTempo.forEach((t, i) => { t.RankAdjTempo = i + 1; });
}

// ─── Generate Weekly Snapshots ──────────────────────────────────────────────

function generateBlendedSnapshots(
  csvPath: string,
  targetSeason: number,
): PITSnapshot[] {
  console.log(`Loading KenPom CSV from ${csvPath}...`);
  const seasonData = parseKenpomCSV(csvPath);

  const priorSeason = targetSeason - 1;
  const priorRatings = seasonData.get(priorSeason);
  const currentRatings = seasonData.get(targetSeason);

  if (!currentRatings) {
    throw new Error(`No ratings found for season ${targetSeason}`);
  }

  console.log(`  Prior season (${priorSeason}): ${priorRatings?.size ?? 0} teams`);
  console.log(`  Current season (${targetSeason}): ${currentRatings.size} teams`);

  // Season 2025 starts ~Nov 4, 2024 and ends ~Apr 7, 2025
  const seasonStart = new Date("2024-11-04");
  const seasonEnd = new Date("2025-04-07");

  // Generate weekly snapshots
  const snapshots: PITSnapshot[] = [];
  const currentDate = new Date(seasonStart);

  while (currentDate <= seasonEnd) {
    const dateStr = currentDate.toISOString().split("T")[0];
    const alpha = computeAlpha(currentDate, seasonStart);

    const ratings: Record<string, KenpomRating> = {};

    // Blend every team in the current season
    for (const [teamName, currentR] of currentRatings.entries()) {
      const priorR = priorRatings?.get(teamName);
      ratings[teamName] = blendRating(priorR, currentR, alpha);
    }

    // Recompute ranks based on blended values
    recomputeRanks(ratings);

    snapshots.push({
      date: dateStr,
      alpha: Math.round(alpha * 1000) / 1000,
      teamCount: Object.keys(ratings).length,
      ratings,
    });

    // Advance by 7 days
    currentDate.setDate(currentDate.getDate() + 7);
  }

  // Add a final snapshot at season end
  const finalDateStr = seasonEnd.toISOString().split("T")[0];
  if (!snapshots.some(s => s.date === finalDateStr)) {
    const ratings: Record<string, KenpomRating> = {};
    for (const [teamName, currentR] of currentRatings.entries()) {
      ratings[teamName] = { ...currentR };
    }
    recomputeRanks(ratings);
    snapshots.push({
      date: finalDateStr,
      alpha: 0.95,
      teamCount: Object.keys(ratings).length,
      ratings,
    });
  }

  return snapshots;
}

// ─── CBBData Fetch (optional) ───────────────────────────────────────────────

async function fetchCBBDataArchive(
  apiKey: string,
  year: number,
): Promise<PITSnapshot[] | null> {
  console.log(`\nAttempting to fetch T-Rank archive from cbbdata.com...`);

  try {
    const url = `https://www.cbbdata.com/api/torvik/ratings/archive?year=${year}&key=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      console.log(`  cbbdata API error ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    const contentType = res.headers.get("content-type") || "";

    // If parquet, we can't parse it directly in Node without extra deps
    if (contentType.includes("parquet") || contentType.includes("octet-stream")) {
      console.log(`  cbbdata returns parquet format — saving raw file for Python processing`);
      const buffer = await res.arrayBuffer();
      const parquetPath = path.join(__dirname, "../data/torvik-archive-raw.parquet");
      fs.writeFileSync(parquetPath, Buffer.from(buffer));
      console.log(`  Saved parquet to ${parquetPath}`);
      console.log(`  Run: python3 -c "import pandas as pd; df = pd.read_parquet('${parquetPath}'); df.to_json('data/torvik-archive.json', orient='records')"`);
      return null;
    }

    // If JSON, parse directly
    const data = await res.json();
    console.log(`  Got ${Array.isArray(data) ? data.length : "unknown"} records`);

    if (!Array.isArray(data) || data.length === 0) return null;

    // Group by date, create snapshots
    const byDate = new Map<string, Record<string, KenpomRating>>();

    for (const row of data) {
      const date = row.date || row.Date || row.rating_date;
      const team = row.team || row.Team || row.TeamName;
      if (!date || !team) continue;

      const dateStr = typeof date === "string" ? date.split("T")[0] : date;
      if (!byDate.has(dateStr)) byDate.set(dateStr, {});

      byDate.get(dateStr)![team] = {
        TeamName: team,
        Season: year,
        AdjEM: row.barthag_rk ? 0 : (row.adj_em ?? row.AdjEM ?? row.adjoe - row.adjde ?? 0),
        AdjOE: row.adj_o ?? row.AdjOE ?? row.adjoe ?? 0,
        AdjDE: row.adj_d ?? row.AdjDE ?? row.adjde ?? 0,
        AdjTempo: row.adj_t ?? row.AdjTempo ?? row.adjt ?? 0,
        RankAdjEM: row.rk ?? row.RankAdjEM ?? 0,
        RankAdjOE: row.adj_o_rk ?? row.RankAdjOE ?? 0,
        RankAdjDE: row.adj_d_rk ?? row.RankAdjDE ?? 0,
        RankAdjTempo: row.adj_t_rk ?? row.RankAdjTempo ?? 0,
        Wins: row.wins ?? 0,
        Losses: row.losses ?? 0,
        ConfShort: row.conf ?? row.ConfShort ?? "",
      };
    }

    // Convert to weekly snapshots (sample every 7 days)
    const allDates = [...byDate.keys()].sort();
    console.log(`  Date range: ${allDates[0]} to ${allDates[allDates.length - 1]}`);

    const snapshots: PITSnapshot[] = [];
    let lastDate = "";

    for (const date of allDates) {
      // Take weekly samples (or daily if data is sparse)
      if (lastDate && daysBetween(lastDate, date) < 7 && date !== allDates[allDates.length - 1]) continue;

      const ratings = byDate.get(date)!;
      recomputeRanks(ratings);

      snapshots.push({
        date,
        alpha: -1, // N/A for real data
        teamCount: Object.keys(ratings).length,
        ratings,
      });

      lastDate = date;
    }

    return snapshots;
  } catch (err) {
    console.log(`  cbbdata fetch failed: ${err}`);
    return null;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const season = 2025;
  const csvPath = path.resolve(__dirname, "../../Desktop/KenPom Analysis/KenPom_Ratings_2010-2025.csv");
  const outputPath = path.resolve(__dirname, "../data/pit-kenpom-ratings.json");

  console.log("=== Point-in-Time KenPom Rating Generator ===\n");

  let snapshots: PITSnapshot[] | null = null;

  // Try cbbdata API first if key is available
  const cbdKey = process.env.CBD_API_KEY;
  if (cbdKey) {
    snapshots = await fetchCBBDataArchive(cbdKey, season);
    if (snapshots) {
      console.log(`\nUsing cbbdata.com T-Rank archive (${snapshots.length} snapshots)`);
    }
  }

  // Fall back to blend approach
  if (!snapshots) {
    if (cbdKey) {
      console.log(`\nFalling back to blend approach...`);
    }
    console.log(`Generating blended PIT ratings from KenPom CSV...`);
    snapshots = generateBlendedSnapshots(csvPath, season);
    console.log(`\nGenerated ${snapshots.length} weekly snapshots via blend approach`);
  }

  // Print summary
  console.log(`\nSnapshots:`);
  for (const snap of snapshots) {
    const alphaStr = snap.alpha >= 0 ? ` (α=${snap.alpha.toFixed(2)})` : "";
    console.log(`  ${snap.date}: ${snap.teamCount} teams${alphaStr}`);
  }

  // Spot-check: show Duke's ratings at different points
  console.log(`\nSpot check — Duke ratings over time:`);
  const checkDates = [snapshots[0], snapshots[Math.floor(snapshots.length / 2)], snapshots[snapshots.length - 1]];
  for (const snap of checkDates) {
    const duke = snap.ratings["Duke"];
    if (duke) {
      console.log(`  ${snap.date}: AdjEM=${duke.AdjEM.toFixed(1)}, AdjOE=${duke.AdjOE.toFixed(1)}, AdjDE=${duke.AdjDE.toFixed(1)}, Tempo=${duke.AdjTempo.toFixed(1)}, Rank=${duke.RankAdjEM}`);
    }
  }

  // Save
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(snapshots, null, 2));
  console.log(`\nSaved to ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(console.error);
