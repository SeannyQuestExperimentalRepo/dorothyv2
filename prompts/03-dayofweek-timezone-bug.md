# Prompt 03: Fix dayOfWeek Timezone Bug (UTC Instead of ET)

**Priority:** 🔴 P0 — Actively corrupting trend data for primetime games  
**Audit:** Data Quality (HIGH)  
**Impact:** Thursday Night Football stored as "Friday", Monday Night Football could be "Tuesday". All day-of-week trend angles are wrong for evening games.

---

## Copy-paste this into Claude:

```
Fix the dayOfWeek timezone bug in espn-sync.ts. Game days are calculated in UTC instead of Eastern Time, causing evening games to be tagged as the wrong day.

**File:** `src/lib/espn-sync.ts` (around line 253)

Current code:
```typescript
gameDate.toLocaleDateString("en-US", { weekday: "long" })
```

This uses the server's timezone (UTC on Vercel). A Thursday 8:20 PM ET game = Friday 01:20 UTC = stored as "Friday".

**Fix:**
```typescript
gameDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })
```

Search the entire codebase for other instances of this pattern:
```bash
grep -rn "weekday.*long\|toLocaleDateString" src/
```

Fix ALL instances to include `timeZone: "America/New_York"`.

Also check `todayET()` functions across the codebase — there are multiple implementations. Make sure they all use ET consistently:
```bash
grep -rn "todayET\|toLocaleDateString.*en-CA" src/
```

After fixing, the existing data in the database still has wrong dayOfWeek values. You'll need a migration script:

```typescript
// scripts/fix-day-of-week.ts
// For each game in NCAAMBGame, NFLGame, NCAAFGame, NBAGame:
// Recalculate dayOfWeek from gameDate using America/New_York timezone
// Update in batch
```

This is important because trend queries like "Team X on Thursdays" are returning wrong results right now.
```
