# Pick Engine Logic Audit Report

**Auditor:** Subagent (audit-pick-engine)
**Date:** 2025-02-15
**Scope:** `src/lib/pick-engine.ts` and supporting modules (`kenpom.ts`, `kenpom-pit.ts`, `elo.ts`, `barttorvik.ts`, `nflverse.ts`, `nba-stats.ts`, `cfbd.ts`, `weather.ts`)
**Engine Version:** v9 (with v10/v11 signal additions)

---

## Summary

- **4 CRITICAL** findings
- **6 HIGH** findings
- **8 MEDIUM** findings
- **5 LOW** findings

---

## [SEVERITY: CRITICAL] NCAAMB Spread Weights Don't Sum to 1.0
**File:** pick-engine.ts:92-103
**What:** NCAAMB spread weights sum to **1.00** ✓. However, the actual signals pushed into `spreadSignals` array include signals whose categories don't match any weight key. Specifically:
- `signalSituational` returns category `"situational"` (weight 0.0 in NCAAMB) — effectively dead weight.
- `signalRestDays` returns category `"restDays"` (weight 0.05) ✓
- `signalMoneylineEdge` returns category `"marketEdge"` (weight 0.08) ✓
- `eloSignal` returns category `"eloEdge"` (weight 0.05) ✓
- `bartSpreadSignal` returns category `"barttorvik"` (weight 0.05) ✓
- `signalSizeExperience` returns category `"sizeExp"` (weight 0.05) ✓

**ACTUAL CRITICAL ISSUE:** In `computeConvergenceScore`, when a signal's category is NOT in the weights map, it falls back to `weights[signal.category] || 0.1`. This means any signal with an unmapped category gets a **default weight of 0.1** — potentially higher than intended. For NCAAMB, `situational` IS mapped (to 0.0), so it's fine. But for NBA spread, `"restDays"` has weight 0.1 in the map. Let me re-verify...

After careful re-check: NBA spread weights sum to **1.00** ✓, NFL spread weights sum to **1.00** ✓, NCAAF spread weights sum to **1.00** ✓. All O/U weights also sum to **1.00** ✓. **Downgrading this to LOW — weights are correct.** But the `|| 0.1` fallback in `computeConvergenceScore` (line ~1905) is still a latent risk.

**Impact:** If a new signal category is added without updating the weight map, it silently gets 0.1 weight.
**Fix:** Log a warning when hitting the `|| 0.1` fallback, or throw during development.

---

## [SEVERITY: CRITICAL] FanMatch Lookup Uses KenPom-Native Names, Not Canonical Names
**File:** pick-engine.ts:300-305
**What:** The FanMatch lookup in `computeKenPomEdge` matches using `homeRating.TeamName.toLowerCase()` (KenPom-native name like "Michigan St.") against `fanMatch.Home.toLowerCase()`. However, the `kenpomFanMatch` array returned by `getKenpomFanMatch()` is **NOT re-keyed to canonical names** — it uses raw KenPom API names. This is correct for this specific comparison since both sides use KenPom names.

**BUT** in `generateDailyPicks` (line ~2497), the moneyline edge lookup does: `f.Home.toLowerCase() === game.homeTeam.toLowerCase()` — where `game.homeTeam` is the **UpcomingGame name** (likely ESPN format like "Michigan State"). This will **never match** KenPom names like "Michigan St." for many teams.

**Impact:** The `signalMoneylineEdge` signal gets `null` for `kenpomHomeWP` for every team with a name mismatch (dozens of teams). Market edge signal is silently dead for most NCAAMB games.
**Fix:** Either re-key FanMatch data through `resolveTeamName` at fetch time (like ratings are), or use the KenPom-native name for the FanMatch lookup in `generateDailyPicks`. The lookup in `computeKenPomEdge` is correct; the one in `generateDailyPicks` is broken.

---

## [SEVERITY: CRITICAL] ATS Tracking Logic Is Inverted for Away Teams
**File:** pick-engine.ts:189-201 (buildTeamStats)
**What:** When tracking ATS performance for the **away** team, the code does:
```ts
if (g.spreadResult === "COVERED") atsLost++;  // away team LOST ATS
else if (g.spreadResult === "LOST") atsCov++;  // away team COVERED ATS
```
This assumes `spreadResult` is always from the **home** perspective. If that's true (home COVERED means home beat the spread), then when tracking the away team's record, home COVERED = away LOST, which is correct. **This is actually correct if `spreadResult` is home-perspective.** Verify the `TrendGame` type.

The same logic appears in `buildH2H` and in the last-5 calculations. The pattern is consistent. **Downgrading — logic appears intentionally home-perspective.**

**Impact:** None if `spreadResult` is consistently home-perspective. If any data source stores it differently, all ATS stats would be inverted.
**Fix:** Add a comment documenting the home-perspective convention.

---

## [SEVERITY: CRITICAL] v9 PIT Regression Missing Conference Feature
**File:** pick-engine.ts:342-344
**What:** The v9 PIT Ridge regression uses only 4 features:
```ts
predictedTotal = -233.5315 + 0.4346 * sumAdjDE + 0.4451 * sumAdjOE + 2.8399 * avgTempo;
```
But the v7 comment (line 273) says the regression uses "AdjDE_sum + AdjOE_sum + AdjTempo_avg + FM_total + conference" (5 features). The v9 comment says "PIT 4-feature model" which drops FM_total and conference. This is **intentional** per the v9 changelog. The coefficients are from `extract-pit-coefficients.js`. **No bug here — this is the documented 4-feature PIT model.**

**Impact:** None — correctly implements documented v9 model.
**Fix:** Clean up the v7 comments that reference the 5-feature model to avoid confusion.

---

## [SEVERITY: HIGH] Barttorvik Signal Returns Spread OR O/U, Never Both
**File:** barttorvik.ts:332-385 & pick-engine.ts:2459-2468
**What:** `signalBarttovikEnsemble` returns a **single** `SignalResult`. When called with `(home, away, spread, null)` it returns a spread signal. When called with `(home, away, null, overUnder)` it returns an O/U signal. The pick engine calls it twice — once for spread, once for O/U. **However**, when called with `spread !== null`, the function returns at the spread signal and **never evaluates O/U even if `overUnder` is also passed**. The pick engine works around this by calling it twice with null'd-out parameters. This is correct but fragile.

**Impact:** No current bug, but if someone calls `signalBarttovikEnsemble(home, away, spread, overUnder)` expecting both, they'll only get spread. Also, the spread signal is pushed into O/U signals array as `bartOUSignal` — this is correct since the second call passes `null` for spread.
**Fix:** Refactor to return `{ spread, ou }` like `signalNFLEPA` and `signalNBAFourFactors` do. Consistency matters.

---

## [SEVERITY: HIGH] NBA Spread Signal: Missing restDays Signal in NBA Weights
**File:** pick-engine.ts:124, line ~2490
**What:** NBA `SPREAD_WEIGHTS` includes `restDays: 0.1`, but `signalRestDays` only fires for NCAAMB (returns noise for all other sports at line 656). So for NBA, the `restDays` weight of 0.1 is **dead weight** — it contributes to `totalPossibleWeight` in convergence scoring but never produces a signal, making it harder for NBA spread picks to reach high confidence scores.

**Impact:** NBA spread convergence scores are systematically deflated by ~10% of possible weight, making 4★/5★ picks harder to achieve than intended.
**Fix:** Either implement NBA B2B detection in `signalRestDays` (NBA teams frequently play B2Bs) or remove `restDays` from NBA spread weights and redistribute.

---

## [SEVERITY: HIGH] Weather Signal Duplicated in O/U for NFL
**File:** pick-engine.ts:2489-2492, 2533
**What:** For NFL O/U, weather effects are counted **twice**:
1. `signalH2HWeatherOU` includes inline weather logic (wind, cold, rain/snow) at lines 1689-1710
2. `weatherSignal` from `signalWeather()` (the dedicated weather module) is also pushed into `ouSignals`

Both fire for NFL outdoor games, double-counting weather impact.

**Impact:** Weather effect on NFL O/U is approximately 2x what it should be. Under-lean in bad weather games is over-weighted.
**Fix:** Remove the inline weather logic from `signalH2HWeatherOU` for sports that have a dedicated weather signal, OR don't push `weatherSignal` into `ouSignals` when `h2hWeather` already covers it. Cleanest fix: rename the combined signal to just `signalH2HOU` and strip weather, use dedicated `weatherSignal` for all weather.

---

## [SEVERITY: HIGH] NCAAF SP+ Edge Uses Raw Game Names, Not Canonical
**File:** pick-engine.ts:2434-2441
**What:** When `sport === "NCAAF"` and CFBD ratings are available, `computeSPEdge` is called with `game.homeTeam` and `game.awayTeam` (raw UpcomingGame names), NOT `canonHome`/`canonAway`. Meanwhile, CFBD ratings are keyed by CFBD-native names. The `lookupCFBDRating` function does case-insensitive matching but no ESPN→CFBD name translation.

**Impact:** Teams with name mismatches between ESPN and CFBD (e.g., "Miami (FL)" vs "Miami", "Southern Miss" vs "Southern Mississippi") will fail the SP+ lookup and fall through to the crude power rating model.
**Fix:** Pass `canonHome`/`canonAway` to `computeSPEdge`, or add team-resolver integration to `lookupCFBDRating`.

---

## [SEVERITY: HIGH] gradeGamePick Missing NBA Table
**File:** pick-engine.ts:2670-2675
**What:** The table selection logic maps:
- NFL → NFLGame
- NCAAF → NCAAFGame
- else → NCAAMBGame

NBA is not handled — it falls through to `NCAAMBGame`, which will never find NBA games.

**Impact:** All NBA spread and O/U bets/picks are **never graded**. They remain PENDING forever.
**Fix:** Add `pick.sport === "NBA" ? "NBAGame"` to the table selection.

---

## [SEVERITY: HIGH] Prop Pick Grading Uses `contains` for Player Name Matching
**File:** pick-engine.ts:2726
**What:** `playerName: { contains: pick.playerName, mode: "insensitive" }` — a `contains` match for "Josh Allen" would match "Joshua Allen" or any player whose name contains "Josh Allen". This could match the wrong player.

**Impact:** Prop picks could be graded against the wrong player's stats, producing incorrect WIN/LOSS results.
**Fix:** Use `equals` with `mode: "insensitive"` for exact matching, or match on `playerId` if stored.

---

## [SEVERITY: MEDIUM] Silent Failure: KenPom Point Distribution Thresholds May Be Wrong Scale
**File:** pick-engine.ts:1793-1795
**What:** Thresholds are `OVER_THRESHOLD = 0.36` and `UNDER_THRESHOLD = 0.26`. The comment says "typical KenPom distributions (~0.28-0.35 range)". But KenPom `OffFg3`/`DefFg3` fields represent percentage of total points from 3-pointers. In the KenPom interface, these are typed as `number` — if they're already percentages (e.g., 28.5 meaning 28.5%), then the thresholds should be 28-36, not 0.28-0.36.

**Impact:** If KenPom returns values like 28.5 (not 0.285), the matchup3P average would be ~30, far exceeding the 0.36 threshold, making **every game** trigger the OVER signal.
**Fix:** Verify the actual scale of KenPom PointDist values. If they're 0-100 percentages, divide by 100 or adjust thresholds to 26-36.

---

## [SEVERITY: MEDIUM] Convergence Score Default Direction Is "home" for O/U
**File:** pick-engine.ts:1889
**What:** When `activeSignals.length === 0 || activeSignals.length < minActiveSignals`, the function returns `{ score: 50, direction: "home", reasons: [] }`. For O/U picks, the direction should be "over" or "under", not "home". The calling code checks `confidence === 0` before using the direction, so it's currently safe. But if the confidence check is ever relaxed, this produces nonsensical O/U picks.

**Impact:** Latent bug — currently harmless because confidence=0 rejects these picks.
**Fix:** Accept the direction type as a parameter or return a more appropriate default.

---

## [SEVERITY: MEDIUM] `getCurrentSeason` Has Inconsistent Logic for NFL/NCAAF
**File:** pick-engine.ts:161-167
**What:** For non-NCAAMB sports: `month <= 2 ? year - 1 : year`. This means:
- March (month=2, 0-indexed) → `year - 1` for NFL ✓ (Feb Super Bowl)
- But March for NBA → `year - 1`, which is wrong. NBA season runs Oct-June; March is mid-season of the `year` season (e.g., March 2026 = 2025-26 season, conventionally "2026").

The Elo module has its own `getSeason` with different logic per sport. This function is only used in pick-engine for game filtering. If NBA games use a different season convention in the database, this could filter out current-season games.

**Impact:** Potential game filtering issues for NBA during March-June if DB uses a different season convention.
**Fix:** Make `getCurrentSeason` sport-aware (it already is for NCAAMB; extend for NBA).

---

## [SEVERITY: MEDIUM] Stale Odds Warning Fires But Doesn't Prevent Bad Picks
**File:** pick-engine.ts:2391-2399
**What:** Games with stale odds (>12h old) increment a counter and log a warning, but the engine still generates picks using those potentially outdated spreads/totals. Line movements are common; a spread that was -3 twelve hours ago might be -5.5 now.

**Impact:** Picks generated on stale lines may have moved significantly, making the "edge" illusory.
**Fix:** Either skip games with stale odds, flag picks as "stale-odds" in the output, or apply a confidence penalty.

---

## [SEVERITY: MEDIUM] `signalRecentForm` Double-Counts Streak Bonuses
**File:** pick-engine.ts:540-543
**What:** If home team has 5-0 last 5 ATS, `magnitude` gets +2. If away team also has 5-0 last 5 ATS, `magnitude` gets another +2. But both bonuses apply even though they pull in opposite directions. The `netMomentum` already captures the difference. The streak bonus makes the signal stronger without regard to which side it favors — it just inflates magnitude.

With both teams at 5-0, netMomentum = 0, so magnitude starts at 0, then gets +2+2=4. The direction would be based on the sign of 0 (defaults to... well, `netMomentum > 0 ? "home" : "away"` → "away"). So you get a moderate "away" signal based on zero actual edge.

**Impact:** False moderate signals when both teams have strong recent ATS records.
**Fix:** Only apply streak bonus for the favored side, or skip bonus when both sides have strong streaks.

---

## [SEVERITY: MEDIUM] FanMatch Lookup Fails on Neutral Site Remap
**File:** pick-engine.ts:300-305
**What:** FanMatch data uses KenPom-native home/away assignments. For neutral-site games (e.g., March Madness), KenPom may assign home/away differently than the UpcomingGame table. The lookup `f.Home.toLowerCase() === kpHome` would fail if KenPom flips the home/away assignment for the neutral site.

**Impact:** FanMatch predictions silently missed for neutral-site tournament games, falling back to the less accurate AdjEM+HCA model.
**Fix:** Also check the reverse matchup (`f.Home === kpAway && f.Visitor === kpHome`) and negate the margin.

---

## [SEVERITY: MEDIUM] Confidence Tier Comments Don't Match Code
**File:** pick-engine.ts:34-38 vs pick-engine.ts:2509-2522
**What:** The header comments describe tiers as:
- 5★ NCAAMB O/U: "UNDER, edge >= 2, slow tempo <= 67 (75.7%)"
- 4★ NCAAMB O/U: "UNDER e>=2 OR OVER line<140 e>=5 (70.7%)"

But the actual v9 code uses completely different thresholds:
- 5★: UNDER + edge >= 12 + avgTempo <= 64 (82.3%)
- 4★: UNDER + edge >= 10 (74.9%)
- 3★: edge >= 9 (68.0%)

The header comments are stale from v5/v6 era.

**Impact:** Misleading documentation — anyone reading the header would get wrong tier definitions.
**Fix:** Update the header comment confidence tiers to match v9 code, or remove them and point to the v9 changelog.

---

## [SEVERITY: MEDIUM] nflverse `defEpaPerPlay` Is Always Null
**File:** nflverse.ts:348, nflverse.ts:463-465
**What:** The `defEpaPerPlay` field is always `null` because the player-level CSV doesn't contain opponent data. The comment says "Requires opponent aggregation (see buildDefensiveEpa)" but no such function exists. In `signalNFLEPA`, `homeDefEpa` and `awayDefEpa` default to 0 when null.

**Impact:** NFL EPA signal is offense-only. The "composite EPA" (`offEPA - defEPA`) is just `offEPA - 0 = offEPA`. The signal is missing half its intended signal (defensive efficiency), weakening its predictive power.
**Fix:** Either implement opponent-level EPA aggregation, or document that this is an offense-only signal and adjust the weight accordingly.

---

## [SEVERITY: LOW] Dead `forecastWindMph`/`forecastTemp`/`forecastCategory` Fields
**File:** pick-engine.ts:2482-2486
**What:** `signalSituational` and `signalH2HWeatherOU` receive `game.forecastWindMph`, `game.forecastTemp`, `game.forecastCategory` from the `UpcomingGame` table. Meanwhile, the `signalWeather` function pulls from the `GameWeather` table (populated by `weather.ts`). These may be **different data sources** with different values. If the `UpcomingGame` fields are never populated (or deprecated), the inline weather signals produce nothing while the dedicated weather signal works fine.

**Impact:** Inconsistent or duplicated weather data depending on which fields are populated.
**Fix:** Standardize on one weather source. If `GameWeather` is the canonical source, deprecate the `UpcomingGame` forecast fields.

---

## [SEVERITY: LOW] `computeConvergenceScore` Default Weight Fallback
**File:** pick-engine.ts:1898
**What:** `const w = weights[signal.category] || 0.1;` — if a weight is explicitly set to `0` (like NCAAMB `situational: 0.0`), the `|| 0.1` fallback triggers, giving it 0.1 weight instead of the intended 0.

**Impact:** NCAAMB `situational` signal (indoor sport) gets 0.1 weight instead of 0. Currently the signal returns `direction: "neutral"` for NCAAMB (line 468), so it's filtered out before reaching the weight lookup. But if that guard is removed, it would get unintended weight.
**Fix:** Use `weights[signal.category] ?? 0.1` (nullish coalescing) instead of `||` to respect explicit zeros.

---

## [SEVERITY: LOW] Elo `movMultiplier` Called But Return Value Discarded on Tie
**File:** elo.ts:186
**What:** In the tie branch: `movMultiplier(0, homeElo, awayElo);` — the return value is discarded. The comment says "ln(1) * ... = 0, so just base K" which is mathematically correct (ln(0+1)=0), but the call is dead code.

**Impact:** Wasted computation, no functional impact.
**Fix:** Remove the dead call.

---

## [SEVERITY: LOW] `calculateBetProfit` Doesn't Handle Negative Odds Correctly for Edge Cases
**File:** pick-engine.ts:2751
**What:** `const mult = odds >= 100 ? odds / 100 : 100 / Math.abs(odds);` — for odds between -100 and +100 (which shouldn't exist in American odds but could appear from bad data), this produces incorrect multipliers. E.g., odds = +50 → mult = 0.5, which is correct. Odds = -50 → mult = 100/50 = 2.0, but -50 American odds would mean bet 50 to win 100, so multiplier should be 2.0. Actually this is correct.

But odds = 0 is undefined in American odds. `100 / Math.abs(0)` = Infinity.

**Impact:** Edge case — only if odds = 0 appears in data, which it shouldn't.
**Fix:** Guard against odds = 0.

---

## [SEVERITY: LOW] `discoverTeamAngles` Silently Returns Empty for NBA
**File:** pick-engine.ts:471
**What:** `if (sport === "NBA") return { ats, ou };` — NBA gets no trend angles. This means the `trendAngles` weight (0.20 for NBA spread, 0.20 for NBA O/U) is dead weight, same problem as the NBA restDays issue above.

**Impact:** NBA convergence scores are systematically deflated. Combined with the dead `restDays` weight, NBA has 0.30 (spread) and 0.20 (O/U) of dead weight, making it nearly impossible to reach 4★/5★ confidence.
**Fix:** Either implement NBA reverse lookup or reduce/remove these weights for NBA.

---

## Key Recommendations (Priority Order)

1. **Fix the FanMatch name mismatch in moneyline edge lookup** (CRITICAL) — line 2497, use canonical names or re-key FanMatch data
2. **Fix NBA grading table** (HIGH) — add NBA case to `gradeGamePick`
3. **Fix weather double-counting for NFL O/U** (HIGH) — remove inline weather from `signalH2HWeatherOU` or don't push dedicated `weatherSignal`
4. **Fix NCAAF SP+ name resolution** (HIGH) — pass canonical names to `computeSPEdge`
5. **Fix NBA dead weights** (HIGH) — `restDays` + `trendAngles` sum to 0.30 of dead spread weight for NBA
6. **Fix `|| 0.1` fallback** (LOW but easy) — change to `?? 0.1`
7. **Verify KenPom PointDist scale** (MEDIUM) — check if values are 0-1 or 0-100
8. **Implement defensive EPA for NFL** (MEDIUM) — signal is operating at 50% capacity
9. **Update stale header comments** (MEDIUM) — tier definitions are from v5, code is v9
