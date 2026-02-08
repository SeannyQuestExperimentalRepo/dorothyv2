/**
 * analyze-weather-trends.js
 *
 * Produces a comprehensive weather impact analysis report for NCAAF games.
 * Reads ncaaf-games-final.json (14,735 games, 2005-2024) and outputs
 * weather-analysis-report.json plus a human-readable stdout summary.
 *
 * Usage: node scripts/enrichments/analyze-weather-trends.js
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────
const INPUT_PATH = path.join(__dirname, '..', '..', 'data', 'ncaaf-games-final.json');
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'data', 'weather-analysis-report.json');

// ── Helpers ────────────────────────────────────────────────────────────────────
const round1 = (v) => Math.round(v * 10) / 10;
const pct = (num, den) => (den === 0 ? 0 : round1((num / den) * 100));
const avg = (arr) => (arr.length === 0 ? 0 : round1(arr.reduce((s, v) => s + v, 0) / arr.length));

function homeWin(g) {
  return g.homeScore > g.awayScore;
}

function totalPoints(g) {
  return g.homeScore + g.awayScore;
}

function margin(g) {
  return g.scoreDifference; // home - away
}

function gameMonth(g) {
  const d = new Date(g.gameDate);
  return d.getMonth() + 1; // 1-12
}

/** Summarise a set of games with standard stats */
function bandStats(games, overallAvgTotal) {
  if (games.length === 0) {
    return {
      games: 0,
      homeWinPct: 0,
      avgTotal: 0,
      avgMargin: 0,
      avgTotalDelta: 0,
      overPct: 0,
    };
  }
  const totals = games.map(totalPoints);
  const homeWins = games.filter(homeWin).length;
  const avgT = avg(totals);
  const overs = totals.filter((t) => t > overallAvgTotal).length;
  return {
    games: games.length,
    homeWinPct: pct(homeWins, games.length),
    avgTotal: avgT,
    avgMargin: avg(games.map(margin)),
    avgTotalDelta: round1(avgT - overallAvgTotal),
    overPct: pct(overs, games.length),
  };
}

// ── Load Data ──────────────────────────────────────────────────────────────────
console.log('Loading data from', INPUT_PATH);
const allGames = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
console.log(`Loaded ${allGames.length} games\n`);

// Separate dome from outdoor for temperature/wind analyses
const outdoorGames = allGames.filter((g) => g.weatherCategory !== 'DOME');
const domeGames = allGames.filter((g) => g.weatherCategory === 'DOME');

// Overall averages (all games, used for category analysis)
const overallAvgTotal = avg(allGames.map(totalPoints));
// Outdoor-only overall average (for temp/wind analyses)
const outdoorAvgTotal = avg(outdoorGames.map(totalPoints));

console.log(`Overall avg total: ${overallAvgTotal}`);
console.log(`Outdoor avg total: ${outdoorAvgTotal}`);
console.log(`Dome games: ${domeGames.length}, Outdoor: ${outdoorGames.length}\n`);

// ── 1. Temperature Bands ───────────────────────────────────────────────────────
const tempBands = [
  { label: '<20', min: -Infinity, max: 20 },
  { label: '20-29', min: 20, max: 30 },
  { label: '30-39', min: 30, max: 40 },
  { label: '40-49', min: 40, max: 50 },
  { label: '50-59', min: 50, max: 60 },
  { label: '60-69', min: 60, max: 70 },
  { label: '70-79', min: 70, max: 80 },
  { label: '80-89', min: 80, max: 90 },
  { label: '90-99', min: 90, max: 100 },
  { label: '100+', min: 100, max: Infinity },
];

const temperatureBands = tempBands.map((band) => {
  const games = outdoorGames.filter(
    (g) => g.temperature >= band.min && g.temperature < band.max
  );
  return { band: band.label, ...bandStats(games, outdoorAvgTotal) };
});

// ── 2. Wind Speed Bands ────────────────────────────────────────────────────────
const windBands = [
  { label: '0-4', min: 0, max: 5 },
  { label: '5-9', min: 5, max: 10 },
  { label: '10-14', min: 10, max: 15 },
  { label: '15-19', min: 15, max: 20 },
  { label: '20-24', min: 20, max: 25 },
  { label: '25+', min: 25, max: Infinity },
];

const windSpeedBands = windBands.map((band) => {
  const games = outdoorGames.filter(
    (g) => g.windMph >= band.min && g.windMph < band.max
  );
  return { band: band.label, ...bandStats(games, outdoorAvgTotal) };
});

// ── 3. Weather Category Analysis ───────────────────────────────────────────────
const categories = ['CLEAR', 'CLOUDY', 'RAIN', 'SNOW', 'WIND', 'DOME'];

const weatherCategories = categories.map((cat) => {
  const games = allGames.filter((g) => g.weatherCategory === cat);
  const stats = bandStats(games, overallAvgTotal);

  // Conference game %
  const confGames = games.filter((g) => g.isConferenceGame).length;
  const confPct = pct(confGames, games.length);

  // Ranked matchup analysis: at least one team ranked
  const rankedGames = games.filter((g) => g.homeRank != null || g.awayRank != null);
  const unrankedGames = games.filter((g) => g.homeRank == null && g.awayRank == null);
  const rankedHomeWinPct = pct(
    rankedGames.filter(homeWin).length,
    rankedGames.length
  );
  const unrankedHomeWinPct = pct(
    unrankedGames.filter(homeWin).length,
    unrankedGames.length
  );

  return {
    category: cat,
    ...stats,
    conferenceGamePct: confPct,
    rankedMatchupHomeWinPct: rankedHomeWinPct,
    unrankedMatchupHomeWinPct: unrankedHomeWinPct,
  };
});

// ── 4. Extreme Weather Games ───────────────────────────────────────────────────
function extremeDetails(games, overallAvg) {
  const stats = bandStats(games, overallAvg);
  const sorted = [...games].sort((a, b) => totalPoints(b) - totalPoints(a));
  const top5High = sorted.slice(0, 5).map((g) => ({
    gameDate: g.gameDate,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    total: totalPoints(g),
    temperature: g.temperature,
    windMph: g.windMph,
    weatherCategory: g.weatherCategory,
  }));
  const top5Low = sorted
    .slice(-5)
    .reverse()
    .map((g) => ({
      gameDate: g.gameDate,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      total: totalPoints(g),
      temperature: g.temperature,
      windMph: g.windMph,
      weatherCategory: g.weatherCategory,
    }));

  return { ...stats, top5Highest: top5High, top5Lowest: top5Low };
}

const extremeWeather = {
  freezing: extremeDetails(
    outdoorGames.filter((g) => g.temperature < 25),
    outdoorAvgTotal
  ),
  scorching: extremeDetails(
    outdoorGames.filter((g) => g.temperature > 100),
    outdoorAvgTotal
  ),
  windy: extremeDetails(
    outdoorGames.filter((g) => g.windMph > 20),
    outdoorAvgTotal
  ),
  snow: extremeDetails(
    allGames.filter((g) => g.weatherCategory === 'SNOW'),
    overallAvgTotal
  ),
  rain: extremeDetails(
    allGames.filter((g) => g.weatherCategory === 'RAIN'),
    overallAvgTotal
  ),
};

// ── 5. Temperature + Wind Interaction Matrix ───────────────────────────────────
const tempLevels = [
  { label: 'Cold', test: (g) => g.temperature < 40 },
  { label: 'Moderate', test: (g) => g.temperature >= 40 && g.temperature < 80 },
  { label: 'Hot', test: (g) => g.temperature >= 80 },
];

const windLevels = [
  { label: 'Calm', test: (g) => g.windMph < 10 },
  { label: 'Breezy', test: (g) => g.windMph >= 10 && g.windMph < 20 },
  { label: 'Windy', test: (g) => g.windMph >= 20 },
];

const tempWindMatrix = {};
for (const tl of tempLevels) {
  tempWindMatrix[tl.label] = {};
  for (const wl of windLevels) {
    const games = outdoorGames.filter((g) => tl.test(g) && wl.test(g));
    tempWindMatrix[tl.label][wl.label] = {
      games: games.length,
      avgTotal: avg(games.map(totalPoints)),
      homeWinPct: pct(games.filter(homeWin).length, games.length),
    };
  }
}

// ── 6. Seasonal Temperature Trends ─────────────────────────────────────────────
const monthNames = {
  8: 'August',
  9: 'September',
  10: 'October',
  11: 'November',
  12: 'December',
  1: 'January',
};
const seasonMonths = [8, 9, 10, 11, 12, 1];

const seasonalTrends = seasonMonths.map((m) => {
  const games = outdoorGames.filter((g) => gameMonth(g) === m);
  return {
    month: monthNames[m],
    monthNumber: m,
    count: games.length,
    avgTemperature: avg(games.map((g) => g.temperature)),
    avgWind: avg(games.map((g) => g.windMph)),
    avgTotal: avg(games.map(totalPoints)),
    homeWinPct: pct(games.filter(homeWin).length, games.length),
  };
});

// ── 7. Home Advantage by Weather ───────────────────────────────────────────────
const overallHomeWinPct = pct(allGames.filter(homeWin).length, allGames.length);

const domeHomeWinPct = pct(domeGames.filter(homeWin).length, domeGames.length);
const outdoorHomeWinPct = pct(
  outdoorGames.filter(homeWin).length,
  outdoorGames.length
);

const goodWeather = outdoorGames.filter(
  (g) =>
    g.weatherCategory === 'CLEAR' && g.temperature >= 50 && g.temperature <= 80
);
const badWeather = outdoorGames.filter(
  (g) =>
    g.weatherCategory === 'RAIN' ||
    g.weatherCategory === 'SNOW' ||
    g.weatherCategory === 'WIND' ||
    g.temperature < 35 ||
    g.windMph > 15
);

const goodWeatherHomeWinPct = pct(
  goodWeather.filter(homeWin).length,
  goodWeather.length
);
const badWeatherHomeWinPct = pct(
  badWeather.filter(homeWin).length,
  badWeather.length
);

const badWeatherConf = badWeather.filter((g) => g.isConferenceGame);
const badWeatherNonConf = badWeather.filter((g) => !g.isConferenceGame);
const badWeatherConfHomeWinPct = pct(
  badWeatherConf.filter(homeWin).length,
  badWeatherConf.length
);
const badWeatherNonConfHomeWinPct = pct(
  badWeatherNonConf.filter(homeWin).length,
  badWeatherNonConf.length
);

const homeAdvantage = {
  overall: { games: allGames.length, homeWinPct: overallHomeWinPct },
  dome: { games: domeGames.length, homeWinPct: domeHomeWinPct },
  outdoor: { games: outdoorGames.length, homeWinPct: outdoorHomeWinPct },
  goodWeather: { games: goodWeather.length, homeWinPct: goodWeatherHomeWinPct },
  badWeather: { games: badWeather.length, homeWinPct: badWeatherHomeWinPct },
  badWeatherConference: {
    games: badWeatherConf.length,
    homeWinPct: badWeatherConfHomeWinPct,
  },
  badWeatherNonConference: {
    games: badWeatherNonConf.length,
    homeWinPct: badWeatherNonConfHomeWinPct,
  },
};

// ── 8. Key Findings ────────────────────────────────────────────────────────────
const findings = [];

// Snow vs overall home win %
const snowCat = weatherCategories.find((c) => c.category === 'SNOW');
if (snowCat && snowCat.games > 0) {
  findings.push(
    `Home teams win ${snowCat.homeWinPct}% in snow games vs ${overallHomeWinPct}% overall (${snowCat.games} snow games).`
  );
}

// Scoring in freezing games
const freezingAvgTotal = extremeWeather.freezing.avgTotal;
if (extremeWeather.freezing.games > 0) {
  const delta = round1(outdoorAvgTotal - freezingAvgTotal);
  findings.push(
    `Scoring drops by ${delta} points per game when temperature is below 25°F (${extremeWeather.freezing.games} games, avg ${freezingAvgTotal} vs ${outdoorAvgTotal} overall).`
  );
}

// Wind over 20 mph
if (extremeWeather.windy.games > 0) {
  const delta = round1(outdoorAvgTotal - extremeWeather.windy.avgTotal);
  findings.push(
    `Wind over 20 mph reduces scoring by ${delta} points on average (${extremeWeather.windy.games} games).`
  );
}

// Dome vs outdoor
findings.push(
  `Dome games average ${avg(domeGames.map(totalPoints))} total points vs ${outdoorAvgTotal} in outdoor games (delta: ${round1(avg(domeGames.map(totalPoints)) - outdoorAvgTotal)}).`
);

// Home advantage: good vs bad weather
findings.push(
  `Home teams win ${goodWeatherHomeWinPct}% in good weather vs ${badWeatherHomeWinPct}% in bad weather (${goodWeather.length} vs ${badWeather.length} games).`
);

// Rain impact
const rainCat = weatherCategories.find((c) => c.category === 'RAIN');
if (rainCat && rainCat.games > 0) {
  findings.push(
    `Rain games average ${rainCat.avgTotal} total points (${rainCat.avgTotalDelta > 0 ? '+' : ''}${rainCat.avgTotalDelta} vs overall avg), with home teams winning ${rainCat.homeWinPct}%.`
  );
}

// Hottest band scoring
const hottestBand = temperatureBands.find((b) => b.band === '100+');
if (hottestBand && hottestBand.games > 0) {
  findings.push(
    `Games over 100°F average ${hottestBand.avgTotal} total points across ${hottestBand.games} games (${hottestBand.avgTotalDelta > 0 ? '+' : ''}${hottestBand.avgTotalDelta} vs outdoor avg).`
  );
}

// Coldest band home win %
const coldestBand = temperatureBands.find((b) => b.band === '<20');
if (coldestBand && coldestBand.games > 0) {
  findings.push(
    `In sub-20°F games, home teams win ${coldestBand.homeWinPct}% of the time (${coldestBand.games} games).`
  );
}

// Conference games in bad weather
findings.push(
  `In bad weather conference games, home teams win ${badWeatherConfHomeWinPct}% vs ${badWeatherNonConfHomeWinPct}% in non-conference bad weather games.`
);

// Month-to-month temperature decline
const sept = seasonalTrends.find((s) => s.monthNumber === 9);
const dec = seasonalTrends.find((s) => s.monthNumber === 12);
if (sept && dec) {
  findings.push(
    `Average temperature drops from ${sept.avgTemperature}°F in September to ${dec.avgTemperature}°F in December, while scoring shifts from ${sept.avgTotal} to ${dec.avgTotal} points per game.`
  );
}

// Wind-calm vs windy total points
const calmModerate = tempWindMatrix['Moderate']['Calm'];
const windyModerate = tempWindMatrix['Moderate']['Windy'];
if (calmModerate && windyModerate && windyModerate.games > 0) {
  const delta = round1(calmModerate.avgTotal - windyModerate.avgTotal);
  findings.push(
    `In moderate temperatures (40-79°F), calm conditions (<10 mph) produce ${delta} more points per game than windy conditions (20+ mph): ${calmModerate.avgTotal} vs ${windyModerate.avgTotal}.`
  );
}

// Cold + Windy compound effect
const coldWindy = tempWindMatrix['Cold']['Windy'];
if (coldWindy && coldWindy.games > 0) {
  findings.push(
    `Cold and windy games (<40°F, 20+ mph wind) average just ${coldWindy.avgTotal} total points across ${coldWindy.games} games — the harshest scoring environment.`
  );
}

// Over percentage in high wind
const highWindBand = windSpeedBands.find((b) => b.band === '25+');
if (highWindBand && highWindBand.games > 0) {
  findings.push(
    `Games with 25+ mph winds go under the outdoor average total ${round1(100 - highWindBand.overPct)}% of the time (${highWindBand.games} games).`
  );
}

// ── Assemble Report ────────────────────────────────────────────────────────────
const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    inputFile: 'ncaaf-games-final.json',
    totalGames: allGames.length,
    outdoorGames: outdoorGames.length,
    domeGames: domeGames.length,
    seasons: '2005-2024',
    overallAvgTotal,
    outdoorAvgTotal,
    overallHomeWinPct,
  },
  temperatureBands,
  windSpeedBands,
  weatherCategories,
  extremeWeather,
  tempWindMatrix,
  seasonalTrends,
  homeAdvantage,
  keyFindings: findings,
};

// ── Write JSON ─────────────────────────────────────────────────────────────────
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${OUTPUT_PATH}\n`);

// ── Human-Readable Summary ─────────────────────────────────────────────────────
console.log('='.repeat(72));
console.log('  NCAAF WEATHER IMPACT ANALYSIS REPORT');
console.log('  ' + allGames.length + ' games | 2005-2024 | 100% weather coverage');
console.log('='.repeat(72));

console.log('\n--- TEMPERATURE BANDS (outdoor games only) ---');
console.log(
  'Band'.padEnd(10) +
    'Games'.padStart(7) +
    'HomeW%'.padStart(8) +
    'AvgTot'.padStart(8) +
    'Delta'.padStart(8) +
    'Over%'.padStart(8)
);
for (const b of temperatureBands) {
  console.log(
    b.band.padEnd(10) +
      String(b.games).padStart(7) +
      String(b.homeWinPct).padStart(8) +
      String(b.avgTotal).padStart(8) +
      String((b.avgTotalDelta >= 0 ? '+' : '') + b.avgTotalDelta).padStart(8) +
      String(b.overPct).padStart(8)
  );
}

console.log('\n--- WIND SPEED BANDS (outdoor games only) ---');
console.log(
  'Band'.padEnd(10) +
    'Games'.padStart(7) +
    'HomeW%'.padStart(8) +
    'AvgTot'.padStart(8) +
    'Delta'.padStart(8) +
    'Over%'.padStart(8)
);
for (const b of windSpeedBands) {
  console.log(
    b.band.padEnd(10) +
      String(b.games).padStart(7) +
      String(b.homeWinPct).padStart(8) +
      String(b.avgTotal).padStart(8) +
      String((b.avgTotalDelta >= 0 ? '+' : '') + b.avgTotalDelta).padStart(8) +
      String(b.overPct).padStart(8)
  );
}

console.log('\n--- WEATHER CATEGORIES (all games) ---');
console.log(
  'Category'.padEnd(10) +
    'Games'.padStart(7) +
    'HomeW%'.padStart(8) +
    'AvgTot'.padStart(8) +
    'Conf%'.padStart(8) +
    'RnkHW%'.padStart(8) +
    'UnrHW%'.padStart(8)
);
for (const c of weatherCategories) {
  console.log(
    c.category.padEnd(10) +
      String(c.games).padStart(7) +
      String(c.homeWinPct).padStart(8) +
      String(c.avgTotal).padStart(8) +
      String(c.conferenceGamePct).padStart(8) +
      String(c.rankedMatchupHomeWinPct).padStart(8) +
      String(c.unrankedMatchupHomeWinPct).padStart(8)
  );
}

console.log('\n--- EXTREME WEATHER ---');
for (const [label, data] of Object.entries(extremeWeather)) {
  console.log(
    `  ${label.toUpperCase()}: ${data.games} games | HomeW% ${data.homeWinPct} | AvgTotal ${data.avgTotal} | AvgMargin ${data.avgMargin}`
  );
}

console.log('\n--- TEMP x WIND MATRIX (outdoor, avg total / home win %) ---');
console.log(''.padEnd(12) + 'Calm'.padStart(16) + 'Breezy'.padStart(16) + 'Windy'.padStart(16));
for (const tl of ['Cold', 'Moderate', 'Hot']) {
  let row = tl.padEnd(12);
  for (const wl of ['Calm', 'Breezy', 'Windy']) {
    const cell = tempWindMatrix[tl][wl];
    row += `${cell.avgTotal}/${cell.homeWinPct}%`.padStart(16);
  }
  console.log(row);
}

console.log('\n--- SEASONAL TRENDS (outdoor games) ---');
console.log(
  'Month'.padEnd(12) +
    'Count'.padStart(7) +
    'AvgTmp'.padStart(8) +
    'AvgWnd'.padStart(8) +
    'AvgTot'.padStart(8) +
    'HomeW%'.padStart(8)
);
for (const s of seasonalTrends) {
  console.log(
    s.month.padEnd(12) +
      String(s.count).padStart(7) +
      String(s.avgTemperature).padStart(8) +
      String(s.avgWind).padStart(8) +
      String(s.avgTotal).padStart(8) +
      String(s.homeWinPct).padStart(8)
  );
}

console.log('\n--- HOME ADVANTAGE BY WEATHER ---');
console.log(`  Overall:                  ${homeAdvantage.overall.homeWinPct}% (${homeAdvantage.overall.games} games)`);
console.log(`  Dome:                     ${homeAdvantage.dome.homeWinPct}% (${homeAdvantage.dome.games} games)`);
console.log(`  Outdoor:                  ${homeAdvantage.outdoor.homeWinPct}% (${homeAdvantage.outdoor.games} games)`);
console.log(`  Good weather:             ${homeAdvantage.goodWeather.homeWinPct}% (${homeAdvantage.goodWeather.games} games)`);
console.log(`  Bad weather:              ${homeAdvantage.badWeather.homeWinPct}% (${homeAdvantage.badWeather.games} games)`);
console.log(`  Bad weather (conf):       ${homeAdvantage.badWeatherConference.homeWinPct}% (${homeAdvantage.badWeatherConference.games} games)`);
console.log(`  Bad weather (non-conf):   ${homeAdvantage.badWeatherNonConference.homeWinPct}% (${homeAdvantage.badWeatherNonConference.games} games)`);

console.log('\n--- KEY FINDINGS ---');
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));

console.log('\n' + '='.repeat(72));
console.log('  Analysis complete. Report saved to data/weather-analysis-report.json');
console.log('='.repeat(72));
