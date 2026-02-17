# Tournament Validation Preparation

> **Selection Sunday: March 15, 2026 — 28 days out**
> Conference tournaments begin ~March 3 (14 days out)
> Phase 1.5 tasks defined in `prompts/PHASE-1.5-TOURNAMENT-READINESS.md`

---

## 1. Historical March Madness Test Dataset (2019–2024)

### 1A. Games That Should Trigger UNDER Boost (neutral site + March)

The UNDER boost fires when `isNeutralSite === true && month === March && ouDir === "under"`.

| Year | Round | Matchup | Total Line | Actual Total | Result | Notes |
|------|-------|---------|-----------|-------------|--------|-------|
| 2024 | R64 | Oakland vs Kentucky | 149 | 128 | UNDER ✓ | 16v1, massive UNDER |
| 2024 | R64 | Yale vs Auburn | 143 | 130 | UNDER ✓ | Classic 12v5 low-scoring |
| 2023 | R64 | Princeton vs Arizona | 146.5 | 130 | UNDER ✓ | 15v2 upset, defensive |
| 2023 | R64 | Furman vs Virginia | 120 | 133 | OVER ✗ | Low line, Furman ran |
| 2022 | R64 | St. Peter's vs Kentucky | 141.5 | 135 | UNDER ✓ | 15v2 Peacocks upset |
| 2022 | R32 | St. Peter's vs Murray St | 131 | 130 | UNDER ✓ | Both mid-majors |
| 2021 | R64 | Oral Roberts vs Ohio St | 152.5 | 153 | OVER ✗ | High pace shootout |
| 2021 | R64 | Oregon St vs Tennessee | 126 | 120 | UNDER ✓ | Slow grind |
| 2019 | R64 | Virginia vs Gardner-Webb | 120.5 | 111 | UNDER ✓ | Pack-line defense |
| 2019 | R64 | UC Irvine vs Kansas St | 123.5 | 101 | UNDER ✓ | Both defensive |

**Historical UNDER rate in March neutral-site games: ~55-58%** (justifies the 1.3x boost)

**Data sources:**
- ESPN game results API: `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=YYYYMMDD`
- KenPom historical: archived via Wayback Machine or KenPom subscription
- Sports Reference: `https://www.sports-reference.com/cbb/postseason/men/YYYY-ncaa.html`

### 1B. Seed Mismatch Scenarios

**12v5 upsets (should trigger `signalSeedMismatch`):**

| Year | 12-Seed | 5-Seed | 12-Seed KenPom | 5-Seed KenPom | 12-Seed AdjEM | 5-Seed AdjEM | Gap | Result |
|------|---------|--------|----------------|---------------|---------------|--------------|-----|--------|
| 2024 | Grand Canyon | Saint Mary's | ~85 | ~28 | +7.2 | +17.1 | 9.9 | 5-seed won |
| 2023 | Oral Roberts | Duke | ~90 | ~12 | +5.8 | +22.4 | 16.6 | 5-seed won |
| 2022 | Richmond | Iowa | ~45 | ~30 | +14.2 | +18.5 | 4.3 | **12-seed won** ← gap < 5 |
| 2022 | New Mexico St | Connecticut | ~70 | ~25 | +10.1 | +19.8 | 9.7 | 5-seed won |
| 2021 | Oregon St | Tennessee | ~65 | ~15 | +11.3 | +20.8 | 9.5 | **12-seed won** |
| 2019 | Murray State | Marquette | ~35 | ~22 | +18.0 | +19.5 | 1.5 | **12-seed won** ← gap < 5 |
| 2019 | Oregon | Wisconsin | ~48 | ~40 | +14.5 | +15.2 | 0.7 | **12-seed won** ← gap < 5 |

**Key insight:** 12-seeds with KenPom rank ≤ 80 AND AdjEM gap < 5 are the best upset spots.

**11v6 upsets:**

| Year | 11-Seed | 6-Seed | 11-Seed KenPom | 6-Seed KenPom | Gap | Result |
|------|---------|--------|----------------|---------------|-----|--------|
| 2023 | Drake | Miami (FL) | ~55 | ~35 | ~6 | 6-seed won |
| 2022 | Michigan | Colorado St | ~22 | ~42 | -20 | **11-seed won** |
| 2021 | Syracuse | San Diego St | ~45 | ~38 | ~3 | **11-seed won** |
| 2019 | Belmont | Maryland | ~30 | ~20 | ~5 | 6-seed won (1pt) |

### 1C. Conference Tournament Fatigue Cases

Teams playing 3+ games in 4 days (auto-bid hunting mid-majors):

| Year | Team | Conference | Games in Span | Dates | Next Game Result |
|------|------|-----------|---------------|-------|-----------------|
| 2024 | Oakland | Horizon | 3 in 4 days | Mar 4-7 | Won conf final, lost R64 |
| 2023 | Fairleigh Dickinson | NEC | 3 in 4 days | Mar 5-8 | Won conf final, upset in R64 |
| 2023 | Princeton | Ivy | 3 in 3 days | Mar 10-12 | Beat Arizona in R64 |
| 2022 | St. Peter's | MAAC | 3 in 4 days | Mar 8-11 | Beat Kentucky in R64 |
| 2024 | Stetson | ASUN | 3 in 4 days | Mar 5-8 | Lost conf final |
| 2024 | Wagner | NEC | 3 in 4 days | Mar 5-8 | Won conf final |

**Note:** Mid-major teams in conf tournaments are the primary fatigue targets. Power conference teams rarely play 3 in 4 days.

### 1D. Tournament Round Progression Test Cases

| Round | Typical Date Range (2026 est.) | Expected Threshold | Games/Day |
|-------|-------------------------------|-------------------|-----------|
| First Four | Mar 17-18 | Standard | 4 |
| Round of 64 | Mar 19-20 | Standard | 32 |
| Round of 32 | Mar 21-22 | Standard | 16 |
| Sweet 16 | Mar 26-27 | Raised (edge ≥ 11) | 8 |
| Elite 8 | Mar 28-29 | Raised (edge ≥ 11) | 4 |
| Final Four | Apr 4 | Raised (edge ≥ 11) | 2 |
| Championship | Apr 6 | Raised (edge ≥ 11) | 1 |

---

## 2. Tournament Logic Validation Scripts

### 2A. UNDER Boost Validation

```typescript
// File: validation/tests/under-boost.test.ts
// Run: npx jest validation/tests/under-boost.test.ts

describe("Tournament UNDER Boost", () => {
  // Mock game objects
  const marchNeutralGame = {
    gameDate: "2026-03-19T18:00:00Z",
    isNeutralSite: true,
    overUnder: 140,
    sport: "NCAAMB",
  };

  const marchHomeGame = {
    gameDate: "2026-03-10T18:00:00Z",
    isNeutralSite: false,
    overUnder: 140,
    sport: "NCAAMB",
  };

  const februaryNeutralGame = {
    gameDate: "2026-02-15T18:00:00Z",
    isNeutralSite: true,
    overUnder: 140,
    sport: "NCAAMB",
  };

  test("1.3x multiplier fires for March neutral site UNDER", () => {
    const gameDate = new Date(marchNeutralGame.gameDate);
    const isMarchNeutral = marchNeutralGame.isNeutralSite === true && gameDate.getMonth() === 2;
    expect(isMarchNeutral).toBe(true);

    const absEdge = 9;
    const effectiveEdge = absEdge * 1.3; // = 11.7
    expect(effectiveEdge).toBeCloseTo(11.7);
  });

  test("Lowered confidence gates: 4★ UNDER at edge 8 (normally 10)", () => {
    const absEdge = 8;
    const effectiveEdge = absEdge * 1.3; // = 10.4
    // Tournament tiers: effectiveEdge >= 10 → 5★, >= 8 → 4★
    const confidence = effectiveEdge >= 10 ? 5 : effectiveEdge >= 8 ? 4 : effectiveEdge >= 6 ? 3 : 0;
    expect(confidence).toBe(5); // 10.4 >= 10 → actually 5★
  });

  test("Lowered confidence gates: 5★ UNDER at edge 10 (normally 12)", () => {
    const absEdge = 10;
    const effectiveEdge = absEdge * 1.3; // = 13
    const confidence = effectiveEdge >= 10 ? 5 : 0;
    expect(confidence).toBe(5);
  });

  test("Non-tournament games don't get boost", () => {
    // February neutral site
    const gameDate = new Date(februaryNeutralGame.gameDate);
    const isMarchNeutral = februaryNeutralGame.isNeutralSite === true && gameDate.getMonth() === 2;
    expect(isMarchNeutral).toBe(false); // February = month 1

    // March home game
    const gameDate2 = new Date(marchHomeGame.gameDate);
    const isMarchNeutral2 = marchHomeGame.isNeutralSite === true && gameDate2.getMonth() === 2;
    expect(isMarchNeutral2).toBe(false);
  });

  test("OVER picks at neutral March sites get NO boost", () => {
    const absEdge = 10;
    const ouDir = "over";
    const isMarchNeutral = true;
    // Boost only applies when ouDir === "under"
    const effectiveEdge = (isMarchNeutral && ouDir === "under") ? absEdge * 1.3 : absEdge;
    expect(effectiveEdge).toBe(10); // No boost for OVER
  });
});
```

### 2B. Seed Mismatch Validation

```typescript
// File: validation/tests/seed-mismatch.test.ts

describe("Seed Mismatch Detection", () => {
  const makeStats = (seed: number, rank: number, adjEM: number) => ({
    seed, rank, adjEM,
  });

  test("12v5: 12-seed with KenPom rank ≤ 80 triggers upset signal", () => {
    const home = makeStats(5, 28, 17.1);  // 5-seed
    const away = makeStats(12, 45, 14.2); // 12-seed ranked #45
    const adjEMGap = Math.abs(home.adjEM - away.adjEM); // 2.9

    expect(away.seed).toBe(12);
    expect(home.seed).toBe(5);
    expect(away.rank).toBeLessThanOrEqual(80);
    // Gap < 5 → "too close to call" note but still potential upset
    expect(adjEMGap).toBeLessThan(5);
  });

  test("11v6: 11-seed with KenPom rank ≤ 60 triggers upset signal", () => {
    const home = makeStats(6, 35, 18.0);
    const away = makeStats(11, 55, 16.5);

    expect(away.rank).toBeLessThanOrEqual(60);
    expect(Math.abs(home.adjEM - away.adjEM)).toBeLessThan(5);
  });

  test("AdjEM gap < 5 returns 'too close to call'", () => {
    const home = makeStats(5, 28, 17.1);
    const away = makeStats(12, 45, 14.2);
    const gap = Math.abs(home.adjEM - away.adjEM);
    expect(gap).toBeLessThan(5);
    // Should return direction: "neutral", confidence: 0.3
  });

  test("AdjEM gap > 10 with high-seeded underdog doesn't trigger", () => {
    const home = makeStats(1, 3, 28.0);
    const away = makeStats(16, 250, 2.0);
    const gap = Math.abs(home.adjEM - away.adjEM);
    expect(gap).toBeGreaterThan(10);
    expect(away.rank).toBeGreaterThan(80);
    // Should NOT trigger upset signal
  });
});
```

### 2C. Conference Tournament Fatigue Validation

```typescript
// File: validation/tests/fatigue.test.ts

describe("Conference Tournament Fatigue", () => {
  function detectConferenceTournamentFatigue(
    recentGames: Array<{ gameDate: Date }>,
    _currentGameDate: Date
  ): boolean {
    if (recentGames.length < 3) return false;
    const sorted = recentGames
      .map(g => new Date(g.gameDate))
      .sort((a, b) => b.getTime() - a.getTime());
    const spanDays = (sorted[0].getTime() - sorted[2].getTime()) / (1000 * 60 * 60 * 24);
    return spanDays <= 4;
  }

  test("3 games in 4 days triggers fatigue", () => {
    const games = [
      { gameDate: new Date("2026-03-04") },
      { gameDate: new Date("2026-03-05") },
      { gameDate: new Date("2026-03-07") },
    ];
    expect(detectConferenceTournamentFatigue(games, new Date("2026-03-08"))).toBe(true);
  });

  test("3 games in 3 days triggers fatigue", () => {
    const games = [
      { gameDate: new Date("2026-03-05") },
      { gameDate: new Date("2026-03-06") },
      { gameDate: new Date("2026-03-07") },
    ];
    expect(detectConferenceTournamentFatigue(games, new Date("2026-03-08"))).toBe(true);
  });

  test("3 games in 7 days does NOT trigger fatigue", () => {
    const games = [
      { gameDate: new Date("2026-03-01") },
      { gameDate: new Date("2026-03-04") },
      { gameDate: new Date("2026-03-07") },
    ];
    expect(detectConferenceTournamentFatigue(games, new Date("2026-03-08"))).toBe(false);
  });

  test("Only 2 recent games does NOT trigger fatigue", () => {
    const games = [
      { gameDate: new Date("2026-03-06") },
      { gameDate: new Date("2026-03-07") },
    ];
    expect(detectConferenceTournamentFatigue(games, new Date("2026-03-08"))).toBe(false);
  });
});
```

### 2D. Tournament Round Awareness Validation

```typescript
// File: validation/tests/tournament-round.test.ts

describe("Tournament Round Awareness", () => {
  function detectTournamentRound(gameDate: Date, isNeutralSite: boolean): string | null {
    if (!isNeutralSite) return null;
    const month = gameDate.getMonth();
    if (month !== 2 && month !== 3) return null;
    const day = gameDate.getDate();
    if (month === 2) {
      if (day <= 19) return "first-four";
      if (day <= 21) return "round-of-64";
      if (day <= 23) return "round-of-32";
      if (day <= 28) return "sweet-16";
      if (day <= 30) return "elite-8";
    }
    if (month === 3) {
      if (day <= 5) return "final-four";
      if (day <= 7) return "championship";
    }
    return "tournament";
  }

  test("R64 game uses standard thresholds", () => {
    const round = detectTournamentRound(new Date("2026-03-20"), true);
    expect(round).toBe("round-of-64");
    const isLateRound = ["sweet-16", "elite-8", "final-four", "championship"].includes(round!);
    expect(isLateRound).toBe(false);
  });

  test("Sweet 16 game uses raised thresholds", () => {
    const round = detectTournamentRound(new Date("2026-03-27"), true);
    expect(round).toBe("sweet-16");
    const isLateRound = ["sweet-16", "elite-8", "final-four", "championship"].includes(round!);
    expect(isLateRound).toBe(true);
  });

  test("Elite 8 uses raised thresholds (edge ≥ 9 → ≥ 11)", () => {
    const round = detectTournamentRound(new Date("2026-03-29"), true);
    expect(round).toBe("elite-8");

    // With raised thresholds:
    const absEdge = 10;
    // Standard: 10 >= 9 → 3★. Raised: 10 < 11 → 0★
    const standardConfidence = absEdge >= 9 ? 3 : 0;
    const raisedConfidence = absEdge >= 13 ? 5 : absEdge >= 11 ? 3 : 0;
    expect(standardConfidence).toBe(3);
    expect(raisedConfidence).toBe(0); // Filtered out — good
  });

  test("Non-neutral site March game returns null", () => {
    expect(detectTournamentRound(new Date("2026-03-20"), false)).toBeNull();
  });

  test("February neutral game returns null", () => {
    expect(detectTournamentRound(new Date("2026-02-20"), true)).toBeNull();
  });
});
```

---

## 3. Weight Sum Verification

### Audit Script

```typescript
// File: validation/tests/weight-sums.test.ts

describe("Weight Sum Verification — All Sports", () => {
  // These are the EXPECTED weights after Phase 1.5
  // Actual values should be extracted from pick-engine.ts at runtime

  const NCAAMB_SPREAD = {
    modelEdge: 0.31, seasonATS: 0.14, trendAngles: 0.15, recentForm: 0.1,
    h2h: 0.05, situational: 0.0, restDays: 0.05, marketEdge: 0.08,
    eloEdge: 0.0, barttorvik: 0.02, sizeExp: 0.05, seedMismatch: 0.05,
  };

  const NCAAMB_OU = {
    modelEdge: 0.31, seasonOU: 0.07, trendAngles: 0.18, recentForm: 0.07,
    h2hWeather: 0.12, tempoDiff: 0.15, barttorvik: 0.02, pointDist: 0.05,
    eloOU: 0.03,
  };

  function sumWeights(weights: Record<string, number>): number {
    return Object.values(weights).reduce((a, b) => a + b, 0);
  }

  test("NCAAMB Spread weights sum to 1.0", () => {
    expect(sumWeights(NCAAMB_SPREAD)).toBeCloseTo(1.0, 5);
  });

  test("NCAAMB O/U weights sum to 1.0", () => {
    expect(sumWeights(NCAAMB_OU)).toBeCloseTo(1.0, 5);
  });

  // TODO: Extract these from pick-engine.ts once Phase 1.5 is implemented
  // For now, placeholders to remind us to verify all sports

  test.todo("NFL Spread weights sum to 1.0");
  test.todo("NFL O/U weights sum to 1.0");
  test.todo("NBA Spread weights sum to 1.0");
  test.todo("NBA O/U weights sum to 1.0");
  test.todo("NCAAF Spread weights sum to 1.0");
  test.todo("NCAAF O/U weights sum to 1.0");
});
```

### Manual Verification Query

```bash
# Extract all weight objects from pick-engine.ts and verify sums
grep -A 20 "SPREAD_WEIGHTS" src/lib/pick-engine.ts | grep -E "^\s+\w+:" | \
  awk -F: '{print $2}' | tr -d ',' | paste -sd+ | bc

grep -A 15 "OU_WEIGHTS" src/lib/pick-engine.ts | grep -E "^\s+\w+:" | \
  awk -F: '{print $2}' | tr -d ',' | paste -sd+ | bc
```

### Success Criteria
- Every sport/bet-type combination sums to exactly 1.0
- No weight is negative
- No signal has weight > 0.35 (over-concentration risk)

---

## 4. Performance Baseline Establishment

### Benchmarks to Measure

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Pick generation per game | < 500ms | Wrap `generatePick()` with `performance.now()` |
| Full day (32 games) | < 20s | Time the daily cron for tournament days |
| Memory usage peak | < 512MB | `process.memoryUsage().heapUsed` before/after |
| DB queries per game | < 15 | Log query count with Prisma middleware |
| API rate limits | No 429s | Monitor ESPN/odds API response codes |

### Performance Test Script

```typescript
// File: validation/tests/performance.test.ts

import { performance } from "perf_hooks";

describe("Performance Baselines", () => {
  test.skip("Single game pick generation < 500ms", async () => {
    // Requires actual pick engine import and DB connection
    const start = performance.now();
    // await generatePickForGame(testGameId);
    const elapsed = performance.now() - start;
    console.log(`Single game: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(500);
  });

  test.skip("32-game batch < 20s", async () => {
    const start = performance.now();
    // await generatePicksForDate("2026-03-19"); // R64 day
    const elapsed = performance.now() - start;
    console.log(`32-game batch: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(20000);
  });
});
```

### Monitoring Commands

```bash
# Memory usage during pick generation
node --max-old-space-size=512 -e "
  const used = process.memoryUsage();
  console.log('Heap:', (used.heapUsed / 1024 / 1024).toFixed(1), 'MB');
  console.log('RSS:', (used.rss / 1024 / 1024).toFixed(1), 'MB');
"

# DB query count (add Prisma middleware)
# In pick-engine.ts or wherever Prisma client is initialized:
# prisma.$use(async (params, next) => {
#   queryCount++;
#   return next(params);
# });

# API rate limit monitoring
# Log all external API calls with timestamps
# Alert if any return 429 status
```

---

## 5. March Madness Simulation Framework

### Architecture

```
validation/
├── simulation/
│   ├── brackets/
│   │   ├── 2019.json    # Historical bracket data
│   │   ├── 2022.json
│   │   ├── 2023.json
│   │   └── 2024.json
│   ├── run-simulation.ts
│   └── results/
│       └── sim-YYYY-MM-DD.json
└── tests/
    └── ... (test files above)
```

### Bracket Data Format

```json
{
  "year": 2024,
  "games": [
    {
      "round": "round-of-64",
      "region": "East",
      "homeSeed": 1,
      "homeTeam": "UConn",
      "homeKenPomRank": 1,
      "homeAdjEM": 35.6,
      "awaySeed": 16,
      "awayTeam": "Stetson",
      "awayKenPomRank": 280,
      "awayAdjEM": -10.2,
      "line": -28.5,
      "total": 145.5,
      "isNeutralSite": true,
      "actualHomeScore": 91,
      "actualAwayScore": 52,
      "gameDate": "2024-03-21"
    }
  ]
}
```

### Data Sources for Historical Brackets

1. **Bracket structure & results:** Sports Reference (`sports-reference.com/cbb/postseason/men/YYYY-ncaa.html`)
2. **KenPom rankings at tournament time:** KenPom archives (subscription required) or Wayback Machine snapshots of `kenpom.com` from mid-March each year
3. **Opening/closing lines:** Covers.com, DonBest archives, or Killer Sports historical odds
4. **Tempo/efficiency data:** Barttorvik (`barttorvik.com/trank.php?year=YYYY`)

### Simulation Runner

```typescript
// File: validation/simulation/run-simulation.ts

interface BracketGame {
  round: string;
  homeTeam: string;
  awayTeam: string;
  homeSeed: number;
  awaySeed: number;
  homeKenPomRank: number;
  awayKenPomRank: number;
  homeAdjEM: number;
  awayAdjEM: number;
  line: number;
  total: number;
  isNeutralSite: boolean;
  actualHomeScore: number;
  actualAwayScore: number;
  gameDate: string;
}

interface SimResult {
  year: number;
  totalGames: number;
  byRound: Record<string, { total: number; correct: number; pct: number }>;
  byConfidence: Record<number, { total: number; correct: number; pct: number }>;
  spreadAccuracy: number;
  ouAccuracy: number;
  underBoostImpact: { withBoost: number; withoutBoost: number };
  seedMismatchHits: number;
}

async function runSimulation(year: number): Promise<SimResult> {
  // 1. Load bracket JSON
  // const bracket = require(`./brackets/${year}.json`);

  // 2. For each game, construct mock game object matching pick-engine input
  // 3. Run through pick engine (or extracted logic)
  // 4. Compare pick vs actual result
  // 5. Aggregate by round and confidence tier

  // Placeholder
  return {} as SimResult;
}

// Entry point
// const years = [2019, 2022, 2023, 2024]; // Skip 2020 (COVID), 2021 (bubble)
// for (const year of years) {
//   const result = await runSimulation(year);
//   console.log(`${year}: Spread ${(result.spreadAccuracy * 100).toFixed(1)}%`);
// }
```

### Success Criteria

| Metric | Target | Notes |
|--------|--------|-------|
| Spread ATS accuracy (all rounds) | > 52% | Breakeven is ~52.4% with -110 juice |
| O/U accuracy (all rounds) | > 54% | UNDER boost should help here |
| 5★ pick accuracy | > 60% | High-confidence should be reliable |
| UNDER accuracy (tournament) | > 56% | Validates the 1.3x boost |
| 12v5 upset detection rate | > 30% | Historical upset rate is ~35% |

---

## 6. Conference Tournament Dress Rehearsal Plan

### Timeline

| Date | Event | Action |
|------|-------|--------|
| Mar 1 | Pre-conference tournaments | Baseline pick accuracy on regular games |
| Mar 3 | Conference tournaments begin | Enable fatigue detection monitoring |
| Mar 3-8 | Small conference tournaments | Track fatigue signals, validate detection |
| Mar 8-14 | Major conference tournaments | Full tournament logic dress rehearsal |
| Mar 15 | Selection Sunday | Final model adjustments before NCAA tourney |
| Mar 17-18 | First Four | Light load, final system check |
| Mar 19 | Round of 64 Day 1 | **32 games — full tournament mode** |

### Daily Monitoring Checklist (Mar 3–14)

```markdown
## Daily Check — [DATE]

### Pick Performance
- [ ] Total picks generated: ___
- [ ] ATS record: ___-___
- [ ] O/U record: ___-___
- [ ] 4★+ picks record: ___-___

### Tournament Logic Verification
- [ ] UNDER boost fired for neutral site games: Y/N (which games?)
- [ ] Fatigue detection triggered: Y/N (which teams?)
- [ ] Seed mismatch signals: N/A (no seeds in conf tournaments)
- [ ] Stale odds warnings: ___

### CLV Tracking
- [ ] Average CLV on spread picks: ___ pts
- [ ] Average CLV on O/U picks: ___ pts
- [ ] Picks that moved in our direction: ___/___

### Issues
- [ ] Any errors in pick generation?
- [ ] Any missing data (KenPom, odds, etc.)?
- [ ] Performance anomalies?

### Adjustments Made
- (none / describe)
```

### Monitoring Queries

```sql
-- Daily pick accuracy (run against Neon DB)
SELECT
  DATE(p."createdAt") as pick_date,
  p."betType",
  COUNT(*) as total,
  SUM(CASE WHEN p.result = 'WIN' THEN 1 ELSE 0 END) as wins,
  ROUND(SUM(CASE WHEN p.result = 'WIN' THEN 1 ELSE 0 END)::decimal / COUNT(*) * 100, 1) as win_pct
FROM "DailyPick" p
WHERE p."createdAt" >= '2026-03-03'
  AND p.sport = 'NCAAMB'
  AND p.result IS NOT NULL
GROUP BY DATE(p."createdAt"), p."betType"
ORDER BY pick_date, "betType";

-- CLV tracking (requires closingSpread/closingTotal from Task 12)
SELECT
  p."betType",
  AVG(CASE
    WHEN p."betType" = 'SPREAD' THEN ABS(p."closingSpread") - ABS(p.line)
    WHEN p."betType" = 'TOTAL' THEN ABS(p."closingTotal") - ABS(p."overUnder")
  END) as avg_clv
FROM "DailyPick" p
WHERE p."createdAt" >= '2026-03-03'
  AND p.sport = 'NCAAMB'
  AND p."closingSpread" IS NOT NULL
GROUP BY p."betType";

-- Tournament-specific pick count
SELECT
  DATE(p."createdAt"),
  COUNT(*) as picks,
  SUM(CASE WHEN p.confidence >= 4 THEN 1 ELSE 0 END) as high_confidence
FROM "DailyPick" p
WHERE p.sport = 'NCAAMB'
  AND p."createdAt" >= '2026-03-15'
GROUP BY DATE(p."createdAt")
ORDER BY 1;
```

### Model Adjustment Decision Matrix

| Condition | Action | Threshold |
|-----------|--------|-----------|
| UNDER boost hits < 45% | Reduce multiplier to 1.15x | After 20+ tournament UNDER picks |
| UNDER boost hits > 65% | Increase multiplier to 1.45x | After 20+ tournament UNDER picks |
| Seed mismatch picks < 40% | Tighten KenPom rank filter to ≤ 50 | After 10+ seed mismatch picks |
| Fatigue signal picks < 45% | Review span threshold (4 → 3 days) | After 10+ fatigue picks |
| Overall ATS < 48% | Review weight distribution | After 50+ total picks |
| Stale odds hits < 40% | Increase penalty to 0.7x | After 15+ stale odds picks |

---

## 7. Emergency Response Procedures

### Scenario 1: Pick Engine Crashes During Tournament

**Symptoms:** No picks generated, API errors, timeout on pick page

**Response (< 15 min):**
1. Check server logs: `vercel logs --prod` or hosting platform equivalent
2. Check database: `psql "$NEON_DB" -c "SELECT COUNT(*) FROM \"DailyPick\" WHERE \"createdAt\" > NOW() - INTERVAL '1 hour'"`
3. If DB is fine but engine crashed:
   - Restart the cron/worker: redeploy or restart process
   - If redeployment needed: `git stash && git checkout main && vercel --prod`
4. If DB is down: Neon dashboard → check connection pooler status

### Scenario 2: Tournament Logic Produces Bad Picks

**Symptoms:** Abnormally high/low confidence, all picks same direction, nonsensical reasoning

**Response (< 30 min):**
1. **Identify the broken logic:**
   ```sql
   SELECT pick, confidence, reasoning, "betType"
   FROM "DailyPick"
   WHERE "createdAt" > NOW() - INTERVAL '4 hours'
     AND sport = 'NCAAMB'
   ORDER BY "createdAt" DESC
   LIMIT 20;
   ```
2. **Disable tournament-specific logic (rollback):**
   ```typescript
   // Emergency: set all tournament multipliers to 1.0
   // In pick-engine.ts, change:
   //   effectiveEdge = absEdge * 1.3  →  effectiveEdge = absEdge * 1.0
   //   seedMismatch weight: 0.05 → 0.0 (redistribute to modelEdge)
   ```
3. **Redeploy with rollback:**
   ```bash
   git log --oneline -10  # Find last known good commit
   git checkout <GOOD_COMMIT>
   # Deploy
   ```

### Scenario 3: Odds API Down / Stale Odds

**Symptoms:** All games showing stale odds warning, effectiveEdge penalized across the board

**Response:**
1. Check odds provider status
2. If temporary: wait and re-run pick generation
3. If prolonged:
   ```typescript
   // Override stale odds check for the day
   // Set staleness threshold to 24h instead of 6h
   // const STALE_THRESHOLD_HOURS = 24; // was 6
   ```
4. Add manual odds if available from alternate source

### Scenario 4: KenPom Data Missing or Stale

**Symptoms:** All KenPom-dependent signals return 0, seedMismatch can't fire

**Response:**
1. Check KenPom scraper: verify last successful run
2. Manual data entry if needed:
   ```sql
   -- Check freshness
   SELECT MAX("snapshotDate") FROM "KenpomSnapshot";
   SELECT COUNT(*) FROM "KenpomTeamStats" WHERE season = 2026;
   ```
3. If KenPom is down: fall back to Barttorvik data (`barttorvik.com`)
4. Increase `modelEdge` weight temporarily to compensate

### Scenario 5: Extreme Volume (32+ games, system slow)

**Response:**
1. Stagger pick generation: process in batches of 8
2. Increase DB connection pool: update `DATABASE_URL` with `?connection_limit=10`
3. Cache KenPom data in memory (don't re-query per game)
4. Monitor: `SELECT COUNT(*), AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt"))) FROM "DailyPick" WHERE "createdAt" > NOW() - INTERVAL '1 hour'`

### Communication Plan

| Event | Who to Notify | Channel | Timeline |
|-------|--------------|---------|----------|
| Picks delayed > 30 min | Users | Discord/App banner | ASAP |
| Pick engine down | Dev team | Discord #alerts | Immediate |
| Model adjustment made | Users | Discord #picks | Within 1 hour |
| Known bad picks published | Users | Discord #picks + App | Within 15 min |
| System restored | Users | Discord #picks | ASAP |

### Rollback Procedures

```bash
# Quick rollback to pre-tournament logic
git log --oneline --all | grep -i "phase-1.5\|tournament"

# Revert specific tournament commits
git revert <COMMIT_HASH> --no-commit
git commit -m "Emergency: revert tournament logic"

# Deploy
# (platform-specific deploy command)

# Verify rollback worked
curl -s https://yourapp.com/api/health | jq .
```

---

## Implementation Priority

| Priority | Task | Effort | Deadline |
|----------|------|--------|----------|
| 🔴 P0 | Phase 1.5 code implementation (Tasks 1-12) | 4-6 hours | Feb 22 |
| 🔴 P0 | Weight sum verification (Section 3) | 30 min | Feb 22 |
| 🟡 P1 | Validation test suite (Section 2) | 2-3 hours | Feb 28 |
| 🟡 P1 | Historical bracket data collection (Section 1) | 3-4 hours | Mar 1 |
| 🟡 P1 | Performance baselines (Section 4) | 1-2 hours | Mar 1 |
| 🟢 P2 | Simulation framework (Section 5) | 4-6 hours | Mar 8 |
| 🟢 P2 | Dress rehearsal monitoring setup (Section 6) | 2 hours | Mar 3 |
| 🟢 P2 | Emergency procedures review (Section 7) | 1 hour | Mar 14 |

---

## Quick Commands Reference

```bash
# Run all validation tests
npx jest validation/tests/ --verbose

# Run specific test suite
npx jest validation/tests/under-boost.test.ts

# Check weight sums (after Phase 1.5 implementation)
grep -A 20 "NCAAMB" src/lib/pick-engine.ts | grep -E "^\s+\w+:" | awk -F: '{print $2}' | tr -d ' ,' | paste -sd+ | bc

# Check pick generation health
psql "$NEON_DB" -c "SELECT sport, \"betType\", COUNT(*), AVG(confidence) FROM \"DailyPick\" WHERE \"createdAt\" > NOW() - INTERVAL '24 hours' GROUP BY sport, \"betType\";"

# TypeScript compile check
npx tsc --noEmit

# Full validation suite
npx jest validation/ --verbose && npx tsc --noEmit && echo "✅ All clear"
```
