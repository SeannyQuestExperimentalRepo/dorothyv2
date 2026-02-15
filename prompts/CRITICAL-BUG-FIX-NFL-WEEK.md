# CRITICAL BUG FIX: NFL Week Calculation

## Context Management
- **Project:** Dorothy v2 (Trendline)
- **Bug ID:** BUG-001 from BUG-REPORT-POST-PHASE2.md
- **Severity:** 🔴 Critical
- **File:** `src/lib/pick-engine.ts` line ~2979
- **Function:** `computeNflRidgeEdge()`

## Problem

`computeNflRidgeEdge()` is called with a hardcoded `week: 1` instead of computing the actual NFL week from the game date. This means ALL NFL spread/total predictions use stale Week 1 data regardless of the actual game week. Current code:

    computeNflRidgeEdge(
      canonHome,
      canonAway,
      currentSeason,
      1, // TODO: compute actual week from gameDate

## Task

### 1. Create `computeNflWeekFromDate(gameDate, season)` utility function

Add this function in `src/lib/pick-engine.ts` (or a shared utils file if one exists for date helpers). The function should:

- Accept a `Date` (gameDate) and a `number` (season year, e.g. 2025)
- Return the NFL week number (1–22)
- NFL Week 1 starts on the first Thursday after Labor Day (first Monday in September)
- Regular season: Weeks 1–18 (each week is 7 days)
- Playoff schedule: Week 19 = Wild Card, Week 20 = Divisional, Week 21 = Conference Championships, Week 22 = Super Bowl
- If the date falls before Week 1, return 1 (preseason fallback)
- If the date falls after Week 22, return 22 (cap it)

Implementation:

    /**
     * Compute the NFL week number from a game date.
     * Week 1 starts on the Tuesday before the first Thursday after Labor Day.
     * Regular season: Weeks 1-18. Playoffs: Weeks 19-22.
     */
    export function computeNflWeekFromDate(gameDate: Date, season: number): number {
        // Labor Day = first Monday in September
        const sept1 = new Date(season, 8, 1); // September 1
        let laborDay = new Date(sept1);
        // Find first Monday in September
        while (laborDay.getDay() !== 1) {
            laborDay.setDate(laborDay.getDate() + 1);
        }

        // NFL Week 1 starts on the Tuesday of Labor Day week
        // (games run Thurs-Mon, week boundary is Tuesday)
        const week1Start = new Date(laborDay);
        week1Start.setDate(week1Start.getDate() + 1); // Tuesday after Labor Day

        const diffMs = gameDate.getTime() - week1Start.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        const weekNumber = Math.floor(diffDays / 7) + 1;

        // Clamp to valid range
        if (weekNumber < 1) return 1;   // preseason → fallback to week 1
        if (weekNumber > 22) return 22; // post-Super Bowl → cap at 22

        return weekNumber;
    }

### 2. Update the call site in `pick-engine.ts` (~line 2979)

Replace:

    computeNflRidgeEdge(
      canonHome,
      canonAway,
      currentSeason,
      1, // TODO: compute actual week from gameDate

With:

    const nflWeek = computeNflWeekFromDate(gameDate, currentSeason);

    computeNflRidgeEdge(
      canonHome,
      canonAway,
      currentSeason,
      nflWeek,

### 3. Verify `gameDate` is available at the call site

The variable `gameDate` should already be in scope (it's used elsewhere in the NFL pick pipeline). If it's named differently (e.g., `game.date`, `game.gameDate`), use that. Check the surrounding context at line ~2979 and use whatever Date object represents the game's scheduled time.

### 4. Edge cases to handle

- **Preseason games (August):** Should return week 1 as fallback — preseason data is sparse anyway
- **Bye weeks:** The function returns the calendar week, not the team's game count — this is correct behavior since ridge regression should use the league-wide week
- **London/international games:** Same logic applies, the game date determines the week
- **Timezone:** Ensure `gameDate` is parsed consistently (UTC or US Eastern) — if games are stored as UTC strings, parse them as UTC before passing in

### 5. Add a quick sanity test

After implementing, verify with known dates:
- 2024 season: Labor Day = Sept 2, 2024. Week 1 start = Sept 3. First game (Chiefs-Ravens) = Sept 5 (Thursday) → should return week 1
- Week 18 game ~Jan 5, 2025 → should return week 18
- Super Bowl ~Feb 9, 2025 → should return week 22

## Success Criteria

- `computeNflWeekFromDate()` returns correct week for any date in a given NFL season
- The hardcoded `1` is replaced with dynamic week calculation
- NFL predictions now use week-appropriate statistics
- No regression in other sport pipelines (NBA, NCAAM, NCAAF)
