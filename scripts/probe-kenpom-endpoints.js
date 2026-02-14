#!/usr/bin/env node

/**
 * KenPom API endpoint discovery script.
 * Tests ~30 candidate endpoint names against api.php.
 * Logs HTTP status, field names, row count, and a sample row.
 * Rate-limited: 3s between calls. No DB writes.
 *
 * Usage: node scripts/probe-kenpom-endpoints.js
 */

require("dotenv/config");

const KENPOM_BASE = "https://kenpom.com/api.php";
const API_KEY = process.env.KENPOM_API_KEY;

if (!API_KEY) {
  console.error("KENPOM_API_KEY not set");
  process.exit(1);
}

const ENDPOINTS = [
  // Known working
  "ratings",
  "fanmatch",
  "archive",
  // Four factors variants
  "fourfactors",
  "four_factors",
  "ff",
  // Team stats variants
  "stats",
  "teamstats",
  "team_stats",
  // Point distribution
  "pointdist",
  "point_dist",
  // Height / experience
  "height",
  "heightexp",
  "height_exp",
  // Player stats
  "playerstats",
  "player_stats",
  "players",
  // Efficiency
  "efficiency",
  "eff",
  // Summary / misc
  "summary",
  "hca",
  "home_court",
  "arenas",
  // Game attributes
  "gameattribs",
  "game_attrs",
  "game_attributes",
  // Schedule
  "schedule",
  "team",
  // Officials
  "refs",
  "officials",
  // Awards
  "kpoy",
  // Program ratings
  "programratings",
  "program_ratings",
  "programs",
  // Trends / conference
  "trends",
  "confstats",
  "conf_stats",
  "conference",
  // Scouting
  "scouting",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeEndpoint(endpoint) {
  // Try with current season first, then without season param
  for (const params of [
    { endpoint, y: "2026" },
    { endpoint, d: "2026-02-10" },
    { endpoint },
  ]) {
    const url = new URL(KENPOM_BASE);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });

      if (res.status === 200) {
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return {
            endpoint,
            params,
            status: 200,
            error: "Non-JSON response",
            preview: text.slice(0, 200),
          };
        }

        const isArray = Array.isArray(data);
        const count = isArray ? data.length : null;
        const sample = isArray ? data[0] : data;
        const fields = sample ? Object.keys(sample) : [];

        return {
          endpoint,
          params,
          status: 200,
          count,
          fields,
          sample,
        };
      }

      // If 400/404, try next param combo
      if (res.status === 400 || res.status === 404) continue;

      // Other status — log and move on
      return {
        endpoint,
        params,
        status: res.status,
        error: await res.text().catch(() => ""),
      };
    } catch (err) {
      return { endpoint, params, status: "error", error: err.message };
    }
  }

  return { endpoint, status: "all_failed" };
}

async function main() {
  console.log(`Probing ${ENDPOINTS.length} endpoint candidates...\n`);
  console.log("=".repeat(80));

  const results = { working: [], failed: [] };

  for (const ep of ENDPOINTS) {
    const result = await probeEndpoint(ep);

    if (result.status === 200 && result.count !== null) {
      console.log(`\n✅ ${ep} — ${result.count} rows`);
      console.log(`   Params: ${JSON.stringify(result.params)}`);
      console.log(`   Fields (${result.fields.length}): ${result.fields.join(", ")}`);
      if (result.sample) {
        console.log(`   Sample: ${JSON.stringify(result.sample).slice(0, 300)}`);
      }
      results.working.push(result);
    } else if (result.status === 200) {
      console.log(`\n⚠️  ${ep} — 200 but non-array`);
      console.log(`   ${JSON.stringify(result).slice(0, 300)}`);
      results.working.push(result);
    } else {
      console.log(`\n❌ ${ep} — ${result.status}`);
      if (result.error) console.log(`   ${String(result.error).slice(0, 150)}`);
      results.failed.push(result);
    }

    await sleep(3000);
  }

  console.log("\n" + "=".repeat(80));
  console.log(`\nSUMMARY: ${results.working.length} working, ${results.failed.length} failed`);
  console.log("\nWorking endpoints:");
  for (const r of results.working) {
    console.log(`  - ${r.endpoint} (${r.count ?? "?"} rows, ${r.fields?.length ?? "?"} fields)`);
  }
}

main().catch(console.error);
