# Prompt 05: Fix NCAAF SP+ Lookup Using Raw Names

**Priority:** 🔴 P1 — NCAAF model edge silently missing for mismatched teams  
**Audit:** Pick Engine (HIGH)  
**Impact:** Teams with ESPN→CFBD name mismatches get no SP+ signal, falling back to crude power rating.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

Fix the NCAAF SP+ edge lookup to use canonical names instead of raw game names.

**File:** `src/lib/pick-engine.ts` (around line 2434-2441)

Current code:

    sport === "NCAAF" && cfbdRatings && cfbdRatings.size > 0
      ? computeSPEdge(
          cfbdRatings,
          game.homeTeam,   // ❌ raw ESPN name
          game.awayTeam,   // ❌ raw ESPN name
          game.spread,
          game.overUnder
        )

**Fix:** Use the already-resolved canonical names:

      ? computeSPEdge(
          cfbdRatings,
          canonHome,        // ✅ already resolved above
          canonAway,        // ✅ already resolved above
          game.spread,
          game.overUnder
        )

But there's a second issue: the CFBD ratings map in `src/lib/cfbd.ts` — check how `getCFBDRatings()` keys its map. If it uses CFBD-native names, you also need to re-key through the team resolver (same pattern as `getKenpomRatings()` in kenpom.ts).

Look at `getCFBDRatings()` in cfbd.ts:
- If it already re-keys through resolveTeamName → just passing canonHome/canonAway fixes it
- If it uses raw CFBD names → add re-keying: `const canonical = await resolveTeamName(team.school, "NCAAF", "cfbd"); map.set(canonical, team);`

Also check `lookupCFBDRating()` — if it does fuzzy matching, make sure the canonical names will match.

Common NCAAF name mismatches to verify:
- "Miami (FL)" vs "Miami"
- "Southern Miss" vs "Southern Mississippi"  
- "UL Monroe" vs "Louisiana Monroe"
- "App State" vs "Appalachian State"
- "UConn" vs "Connecticut"
