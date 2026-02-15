# Prompt 01: Fix FanMatch Predictions Assigned to Wrong Games

**Priority:** 🔴 P0 — Actively corrupting pick engine inputs  
**Audit:** Data Quality (HIGH) + Pick Engine (CRITICAL)  
**Impact:** FanMatch predictions are matched by date only, not by team. Wrong predictions feed into wrong games. Also, the moneyline edge lookup uses raw ESPN names against KenPom names — silently broken for most teams.

---

## Copy-paste this into Claude:

```
I need to fix two related FanMatch bugs in the Trendline codebase:

## Bug 1: FanMatch predictions assigned to wrong games (data pipeline)

**File:** `src/app/api/cron/daily-sync/route.ts` (around line 115-138, step 1.6)

The FanMatch capture currently updates ALL UpcomingGame rows matching the date with `fmHomePred: null`, regardless of which teams the FanMatch prediction is for. There's no homeTeam/awayTeam filter.

**Fix:** Add team name matching to the updateMany WHERE clause. FanMatch uses KenPom-native names, so we need to resolve them to canonical names before matching against UpcomingGame.

Steps:
1. Find the FanMatch capture section (step 1.6 in daily-sync)
2. For each FanMatch prediction, resolve Home and Visitor through the team resolver
3. Add `homeTeam` and `awayTeam` to the updateMany WHERE clause
4. Handle the case where team resolution fails (log warning, skip that prediction)

## Bug 2: Moneyline edge lookup uses wrong names (pick engine)

**File:** `src/lib/pick-engine.ts` (around line 2497)

The moneyline edge FanMatch lookup does:
```typescript
const gameFM = kenpomFanMatch?.find(
  (f) => f.Home.toLowerCase() === game.homeTeam.toLowerCase() && ...
)
```

`game.homeTeam` is ESPN format ("Michigan State"), `f.Home` is KenPom format ("Michigan St."). They'll never match for dozens of teams.

**Fix:** Use `canonHome`/`canonAway` (already resolved earlier in the function) instead of `game.homeTeam`/`game.awayTeam`. But also note that FanMatch names are KenPom-native, so you need to compare canonical-to-canonical. The KenPom ratings map is already re-keyed to canonical names at fetch time (in kenpom.ts), but kenpomFanMatch is NOT re-keyed.

Options (pick one):
- Option A: Re-key FanMatch data through resolveTeamName at fetch time in getKenpomFanMatch(), same pattern as getKenpomRatings()
- Option B: Resolve the FanMatch names inline in the lookup

Option A is cleaner. In `src/lib/kenpom.ts`, modify `getKenpomFanMatch` to return an array where Home and Visitor are resolved to canonical names.

## Testing:
- After fix, log a few FanMatch lookups to verify they match correctly
- Check that moneyline edge signal is no longer always null
- Verify neutral site games still match (check reverse home/away)
```
