/**
 * NCAAMB Score Scraper — Sports Reference CBB
 *
 * Strategy: Scrape daily boxscore pages from Sports Reference CBB.
 * Each page lists all D-I games for that day with scores, team slugs,
 * rankings, and home/away information (from boxscore URLs).
 *
 * The CBB season runs ~November 1 to April 10 (~160 days/season).
 * 160 days × 20 seasons = 3,200 pages at 3.5s = ~3 hours.
 *
 * URL: https://www.sports-reference.com/cbb/boxscores/index.cgi?month=M&day=D&year=Y
 *
 * Usage:
 *   node scripts/scrapers/ncaamb-scores.js [--start YYYY] [--end YYYY]
 *   Default: 2005-2025 (KenPom year = ending year of season)
 */

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const RATE_LIMIT_MS = 3500; // 3.5 seconds between SR requests
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Generate all dates in a CBB season.
 * KenPom season YYYY = November (YYYY-1) to April (YYYY).
 * E.g., season 2025 = Nov 2024 → Apr 2025.
 */
function getSeasonDates(season) {
  const dates = [];
  const start = new Date(season - 1, 10, 1); // Nov 1
  const end = new Date(season, 3, 15); // Apr 15

  let d = new Date(start);
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * Fetch and parse a daily boxscore page from Sports Reference CBB.
 */
async function fetchDailyGames(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const dateStr = formatDate(date);

  const url = `https://www.sports-reference.com/cbb/boxscores/index.cgi?month=${month}&day=${day}&year=${year}`;

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    if (res.status === 429) {
      console.log(`    Rate limited on ${dateStr}, waiting 10s...`);
      await sleep(10000);
      return fetchDailyGames(date);
    }
    return [];
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const games = [];

  $("div.game_summary.gender-m").each((_, el) => {
    const rows = $(el).find("table.teams tbody tr");
    if (rows.length < 2) return;

    // First two rows are the teams
    const row1 = rows.eq(0);
    const row2 = rows.eq(1);

    // Extract team info from each row
    function parseTeamRow(row) {
      const link = row.find("td:first-child a");
      const slug = link.attr("href")
        ? link.attr("href").match(/\/cbb\/schools\/([^/]+)\//)
        : null;
      const name = link.text().trim() || row.find("td:first-child").text().trim();
      const score = parseInt(row.find("td.right").first().text().trim());
      const rankText = row.find("span.pollrank").text().trim();
      const rankMatch = rankText.match(/\((\d+)\)/);
      const rank = rankMatch ? parseInt(rankMatch[1]) : null;
      const isWinner = row.hasClass("winner");

      return {
        name,
        slug: slug ? slug[1] : null,
        score: isNaN(score) ? null : score,
        rank,
        isWinner,
      };
    }

    const team1 = parseTeamRow(row1);
    const team2 = parseTeamRow(row2);

    if (team1.score === null || team2.score === null) return;

    // Determine home/away from boxscore link
    // The boxscore URL contains the home team slug
    const boxscoreLink = $(el).find("a[href*='/cbb/boxscores/']").attr("href") || "";
    const boxscoreMatch = boxscoreLink.match(
      /\/cbb\/boxscores\/\d{4}-\d{2}-\d{2}-\d+-([^.]+)\.html/
    );
    const homeSlug = boxscoreMatch ? boxscoreMatch[1] : null;

    // Description/notes
    const desc = $(el).find("td.desc small").text().trim();

    // Determine which is home, which is visitor
    let homeTeam, awayTeam;
    if (homeSlug && team1.slug === homeSlug) {
      homeTeam = team1;
      awayTeam = team2;
    } else if (homeSlug && team2.slug === homeSlug) {
      homeTeam = team2;
      awayTeam = team1;
    } else {
      // Fallback: second row is typically home
      homeTeam = team2;
      awayTeam = team1;
    }

    // Detect tournament/conference tourney games
    const descLower = desc.toLowerCase();
    const isNCAAT = descLower.includes("ncaa tournament") || descLower.includes("ncaa men");
    const isNIT = descLower.includes("nit ") || descLower === "nit";
    const isConfTourney = descLower.includes("conf tournament") || descLower.includes("conference tournament");
    const isNeutralSite = isNCAAT || isNIT; // Most tournament games are neutral

    // Detect overtime
    const otMatch = desc.match(/(\d+)OT/) || desc.match(/(\d+)\s*overtime/i);
    const overtimes = otMatch ? parseInt(otMatch[1]) : 0;

    games.push({
      gameDate: dateStr,
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      homeSlug: homeTeam.slug,
      awaySlug: awayTeam.slug,
      homeScore: homeTeam.score,
      awayScore: awayTeam.score,
      homeRank: homeTeam.rank,
      awayRank: awayTeam.rank,
      overtimes,
      isNCAAT,
      isNIT,
      isConfTourney,
      isNeutralSite,
      notes: desc || null,
    });
  });

  return games;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const startIdx = args.indexOf("--start");
  const endIdx = args.indexOf("--end");

  const startSeason = startIdx >= 0 ? parseInt(args[startIdx + 1]) : 2005;
  const endSeason = endIdx >= 0 ? parseInt(args[endIdx + 1]) : 2025;

  console.log(`NCAAMB Score Scraper: seasons ${startSeason}-${endSeason}`);
  console.log(`Source: Sports Reference CBB daily boxscores\n`);

  // Ensure output directory
  const outputDir = path.join(__dirname, "../../data/raw/ncaamb");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, "ncaamb-scores-raw.json");

  // Resume support: load existing data if present
  let allGames = [];
  let processedDates = new Set();

  if (fs.existsSync(outputPath)) {
    allGames = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    for (const g of allGames) {
      processedDates.add(g.gameDate);
    }
    console.log(`Resuming: ${allGames.length} games already scraped (${processedDates.size} dates)\n`);
  }

  let totalNewGames = 0;
  let daysScraped = 0;
  let daysSkipped = 0;
  const startTime = Date.now();

  for (let season = startSeason; season <= endSeason; season++) {
    const dates = getSeasonDates(season);
    let seasonGames = 0;
    let seasonSkipped = 0;

    console.log(`\n═══ Season ${season} (${dates.length} days, Nov ${season - 1} - Apr ${season}) ═══`);

    for (let i = 0; i < dates.length; i++) {
      const dateStr = formatDate(dates[i]);

      // Skip already scraped dates
      if (processedDates.has(dateStr)) {
        seasonSkipped++;
        daysSkipped++;
        continue;
      }

      const games = await fetchDailyGames(dates[i]);

      if (games.length > 0) {
        // Add season field
        for (const g of games) {
          g.season = season;
        }
        allGames.push(...games);
        totalNewGames += games.length;
        seasonGames += games.length;
      }

      processedDates.add(dateStr);
      daysScraped++;

      // Progress logging every 10 days
      if (daysScraped % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = daysScraped / elapsed;
        console.log(
          `  ${dateStr}: ${games.length} games | Season: ${seasonGames} | Total: ${totalNewGames} new`
        );
      }

      // Checkpoint every 50 days
      if (daysScraped % 50 === 0) {
        fs.writeFileSync(outputPath, JSON.stringify(allGames, null, 2));
        console.log(`  [Checkpoint: ${allGames.length} total games saved]\n`);
      }

      await sleep(RATE_LIMIT_MS);
    }

    console.log(
      `  Season ${season}: ${seasonGames} new games (${seasonSkipped} days skipped)`
    );

    // Save after each season
    fs.writeFileSync(outputPath, JSON.stringify(allGames, null, 2));
    console.log(`  [Season saved: ${allGames.length} total games]`);
  }

  // Final save
  fs.writeFileSync(outputPath, JSON.stringify(allGames, null, 2));

  console.log("\n═══ NCAAMB SCRAPE COMPLETE ═══");
  console.log(`Days scraped: ${daysScraped} (${daysSkipped} skipped)`);
  console.log(`New games: ${totalNewGames}`);
  console.log(`Total games: ${allGames.length}`);

  // Per-season breakdown
  const bySeason = {};
  for (const g of allGames) {
    bySeason[g.season] = (bySeason[g.season] || 0) + 1;
  }
  console.log("\nGames per season:");
  Object.entries(bySeason)
    .sort(([a], [b]) => a - b)
    .forEach(([s, c]) => console.log(`  ${s}: ${c}`));

  // Stats
  const withRank = allGames.filter((g) => g.homeRank || g.awayRank);
  const ncaat = allGames.filter((g) => g.isNCAAT);
  const ot = allGames.filter((g) => g.overtimes > 0);
  console.log(`\nGames with ranked team: ${withRank.length}`);
  console.log(`NCAA Tournament games: ${ncaat.length}`);
  console.log(`Overtime games: ${ot.length}`);

  console.log(`\nSaved: ${outputPath}`);
}

main().catch(console.error);
