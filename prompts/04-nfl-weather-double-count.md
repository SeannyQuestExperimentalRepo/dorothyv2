# Prompt 04: Fix NFL O/U Weather Double-Counting

**Priority:** 🔴 P1 — NFL O/U picks over-weight weather by 2x  
**Audit:** Pick Engine (HIGH)  
**Impact:** Every NFL outdoor game has weather counted twice in O/U scoring, creating false under-lean in bad weather.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

Fix the weather double-counting bug in the NFL O/U pick engine.

**Problem:** For NFL O/U picks, weather effects are applied twice:
1. Inside `signalH2HWeatherOU()` — inline weather logic (wind, cold, rain/snow) at lines ~1689-1710
2. Via dedicated `weatherSignal` from `signalWeather()` pushed into ouSignals at line ~2533

Both fire for NFL outdoor games, making weather impact ~2x what it should be.

**File:** `src/lib/pick-engine.ts`

**Fix — Option A (recommended):** Strip weather logic from `signalH2HWeatherOU` and rename to `signalH2HOU`. Let the dedicated `weatherSignal` handle all weather. This is cleaner because `signalWeather()` uses real forecast data from the weather module.

In `signalH2HWeatherOU` (around line 1689-1710):
- Remove the entire weather section (wind, cold, rain/snow checks) 
- Keep only the H2H total vs line comparison and H2H O/U record
- Rename function to `signalH2HOU` to reflect it no longer includes weather
- Update the category from `"h2hWeather"` to `"h2h"` or keep as-is for weight mapping compatibility

Make sure the weight maps still reference the correct category name. Search for `h2hWeather` in the weight configs.

**Fix — Option B (simpler):** Don't push `weatherSignal` into `ouSignals` for NFL since `h2hWeather` already covers it:

    // Around line 2533
    if (weatherSignal && sport !== "NFL" && sport !== "NCAAF") {
      ouSignals.push(weatherSignal);
    }

But this is worse because the dedicated weather module likely has better data than the inline checks.

**Also check NCAAF:** The same double-counting may apply to NCAAF — `signalH2HWeatherOU` has weather logic for non-NCAAMB sports AND a dedicated `weatherSignal` is pushed for NCAAF.

Go with Option A. Update all references.
