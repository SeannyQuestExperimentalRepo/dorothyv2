# Prompt 10: Add Unique Constraint to PlayerGameLog

**Priority:** 🟡 P2 — Duplicate stats corrupt prop analysis  
**Audit:** Data Quality (MEDIUM)  
**Impact:** No unique constraint means re-running ingestion creates duplicate rows, double-counting yards/TDs in prop trends.

---

## Copy-paste this into Claude:

```
Add a unique constraint to the PlayerGameLog model in Prisma to prevent duplicate stat rows.

**File:** `prisma/schema.prisma` — PlayerGameLog model

Add this to the model:
```prisma
@@unique([playerId, season, week, seasonType])
```

Then run:
```bash
# First, check for existing duplicates
npx prisma db execute --stdin <<EOF
SELECT "playerId", season, week, "seasonType", COUNT(*) as cnt
FROM "PlayerGameLog"
GROUP BY "playerId", season, week, "seasonType"
HAVING COUNT(*) > 1;
EOF

# If duplicates exist, deduplicate before migration:
# Keep the row with the latest id, delete others
npx prisma db execute --stdin <<EOF
DELETE FROM "PlayerGameLog" a
USING "PlayerGameLog" b
WHERE a.id < b.id
  AND a."playerId" = b."playerId"
  AND a.season = b.season
  AND a.week = b.week
  AND a."seasonType" = b."seasonType";
EOF

# Then generate and apply the migration
npx prisma migrate dev --name add-player-game-log-unique
```

Also consider adding to the ingestion code (wherever PlayerGameLog rows are created):
- Use `upsert` instead of `create` 
- Or use `createMany({ skipDuplicates: true })`
```
