# Prompt 02: Fix NBA Game Grading (Falls Through to NCAAMB Table)

**Priority:** 🔴 P0 — All NBA picks/bets never get graded  
**Audit:** Pick Engine (HIGH)  
**Impact:** NBA picks stay PENDING forever. NBA bet tracking shows no results.

---

## Copy-paste this into Claude:

```
Fix the NBA grading bug in pick-engine.ts. NBA games are never graded because the table selection logic doesn't handle NBA.

**File:** `src/lib/pick-engine.ts` — `gradeGamePick` function (around line 2670-2675)

Current code:
```typescript
const table =
  pick.sport === "NFL"
    ? "NFLGame"
    : pick.sport === "NCAAF"
      ? "NCAAFGame"
      : "NCAAMBGame";  // NBA falls through here — queries wrong table
```

**Fix:**
```typescript
const table =
  pick.sport === "NFL"
    ? "NFLGame"
    : pick.sport === "NCAAF"
      ? "NCAAFGame"
      : pick.sport === "NBA"
        ? "NBAGame"
        : "NCAAMBGame";
```

Also check the dynamic Prisma access on the next line:
```typescript
const games = await (prisma as any)[
  table.charAt(0).toLowerCase() + table.slice(1)
].findMany({...})
```

Verify that `nBAGame` (lowercase first char of "NBAGame") maps correctly to the Prisma model. If the Prisma client uses `nBAGame` that's wrong — it should be `nbaGame` or `nBAGame` depending on how Prisma generates the client. Check the actual Prisma client types.

The safer fix is to replace the dynamic access with an explicit switch:
```typescript
async function findGameForGrading(sport: Sport, homeTeamId: string, awayTeamId: string, dayBefore: Date, dayAfter: Date) {
  const where = {
    homeTeamId,
    awayTeamId,
    gameDate: { gte: dayBefore, lte: dayAfter },
  };
  
  switch (sport) {
    case "NFL": return prisma.nFLGame.findMany({ where, take: 1 });
    case "NCAAF": return prisma.nCAAFGame.findMany({ where, take: 1 });
    case "NBA": return prisma.nBAGame.findMany({ where, take: 1 });
    case "NCAAMB": return prisma.nCAAMBGame.findMany({ where, take: 1 });
    default: return [];
  }
}
```

Check the actual Prisma model names by looking at the generated client or running: `grep -r "export type.*Game" node_modules/.prisma/client/index.d.ts`

While you're in grading, also check that the NBAGame model in prisma/schema.prisma has the same fields used by grading (scoreDifference, spreadResult, ouResult, homeScore, awayScore).
```
