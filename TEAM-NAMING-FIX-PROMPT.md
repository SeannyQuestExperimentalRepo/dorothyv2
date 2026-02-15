# Implementation Prompt: NCAAMB Team Naming Unification

> **Use this prompt with a coding agent (Claude Code, Cursor, etc.) pointed at the dorothyv2 repo.**

---

## Context

You are working on `dorothyv2`, a Next.js 14 sports betting pick engine. The NCAAMB (college basketball) team naming system is broken — fragmented across 5 mapping files, 3 resolution functions, and a polluted database. This prompt fixes it permanently.

### The Problem

1. **DB Pollution:** The `Team` table has **1,683 NCAAMB teams** when NCAA Division I only has ~364. The extras are D-II/D-III/NAIA teams and duplicates with mascots appended (e.g., "Adams State" AND "Adams State Grizzlies", "Arcadia ARCADIA").
   - 694 teams have ≤ 3 games (non-D-I noise)
   - 308 teams have mascot names appended

2. **Name Fragmentation:** Each data source uses different naming conventions:
   - **KenPom:** "Connecticut", "St. John's", "N.C. State", "Mississippi" (for Ole Miss)
   - **ESPN:** "UConn", "St. John's", "NC State", "Ole Miss"
   - **Odds API:** "Connecticut Huskies", "St. John's Red Storm", "NC State Wolfpack"
   - **Barttorvik:** "Connecticut", "St. John's", "N.C. State" (matches KenPom mostly)
   - **CFBD:** "Connecticut", "North Carolina State" (for NCAAF)
   - **DB Team table:** Mix of all of the above depending on which source created the team

3. **Resolution Chaos:** 5 mapping files (5,194 lines total) + 3 resolution functions all operating independently:
   - `src/lib/team-name-mapping.ts` (196 lines) — NFL mappings
   - `src/lib/ncaaf-team-name-mapping.ts` (1,093 lines) — NCAAF mappings
   - `src/lib/ncaamb-team-name-mapping.ts` (3,470 lines) — NCAAMB mappings (largest)
   - `src/lib/espn-team-mapping.ts` (205 lines) — ESPN display name → DB name
   - `src/lib/odds-api-team-mapping.ts` (230 lines) — Odds API name → DB name
   - `resolveCanonicalName()` in pick-engine.ts — DB lookup + NAME_ALIASES + variant generation
   - `resolveOddsApiName()` — progressive mascot stripping
   - `matchNormalized()` — st/state/saint equivalence

4. **22 Manual Mappings:** The `TeamNameMapping` DB table has 22 manually-entered KenPom↔ESPN mappings, proving the problem was known but only partially addressed.

### The Goal

**One canonical name per team. One resolution path. Clean database.**

- **Canonical standard = KenPom names** (387 known teams in KenpomSnapshot table)
- Every data source maps TO KenPom names via a single resolver
- Non-D-I junk teams are flagged/archived (not deleted — they have game history)
- Duplicate team records are merged (games reassigned to canonical team ID)

---

## Database State (Current)

```
Team table:     1,683 NCAAMB teams
KenpomSnapshot: 387 distinct teamName values (the real D-I universe)
TeamNameMapping: 22 rows (kenpomName ↔ espnName ↔ teamId)
NCAAMBGame:     125,169 games (referencing homeTeamId/awayTeamId)
BarttovikSnapshot: 358 rows (just synced today)
EloRating:      1,683 NCAAMB rows
```

### Known KenPom↔DB Mismatches (22 that don't exact-match a Team.name)

These KenPom names have no exact match in the Team table:
```
Arkansas Little Rock, Cal St. Northridge, College of Charleston,
Detroit, Dixie St., Fort Wayne, Houston Baptist, IPFW, IUPUI,
LIU Brooklyn, Louisiana Lafayette, McNeese St., New Haven,
Nicholls St., Queens, SIUE, Southeast Missouri, St. Bonaventure,
St. Francis PA, Texas A&M Commerce
```

(Plus ~2 more — the TeamNameMapping table has manual fixes for these 22.)

### Schema Reference

```prisma
model Team {
  id    Int    @id @default(autoincrement())
  name  String
  sport Sport  // enum: NFL, NCAAF, NCAAMB, NBA
  // Relations: homeGames, awayGames, kenpomSnapshots, barttovikSnapshots, eloRatings, etc.
  @@unique([name, sport])
}

model TeamNameMapping {
  id         Int    @id @default(autoincrement())
  kenpomName String
  espnName   String
  teamId     Int
  confidence String // "manual" | "auto"
  createdAt  DateTime @default(now())
}

enum Sport {
  NFL
  NCAAF
  NCAAMB
  NBA
}
```

---

## Task 1: Build the Canonical Team Resolver (`src/lib/team-resolver.ts`)

Create a **single, authoritative** team name resolution module that replaces all existing mapping files and resolution functions.

### Design

```typescript
import "server-only";

type DataSource = "espn" | "odds" | "kenpom" | "barttorvik" | "cfbd" | "db" | "unknown";

interface ResolvedTeam {
  canonicalName: string;  // KenPom name (source of truth)
  teamId: number | null;  // DB Team.id if matched
  source: DataSource;     // Which source provided the raw name
  confidence: "exact" | "alias" | "fuzzy" | "unmatched";
}

/**
 * Resolve any raw team name from any source to the canonical KenPom name.
 * 
 * Resolution order:
 * 1. Exact match against canonical names
 * 2. Source-specific alias lookup (ESPN "UConn" → "Connecticut")
 * 3. Normalization (strip mascots, st./state/saint equivalence, hyphen/space)
 * 4. Fuzzy match (Levenshtein or similar)
 * 5. Return unmatched with warning
 */
export async function resolveTeamName(
  rawName: string,
  sport: string,
  source?: DataSource,
): Promise<ResolvedTeam>
```

### Source-Specific Alias Maps

Build comprehensive alias maps by combining knowledge from ALL existing mapping files. Read each one and consolidate:

```typescript
// ESPN aliases → KenPom canonical
const ESPN_TO_CANONICAL: Record<string, string> = {
  "UConn": "Connecticut",
  "Ole Miss": "Mississippi",
  "NC State": "N.C. State",
  "Saint Bonaventure": "St. Bonaventure",
  "CSUN": "Cal St. Northridge",
  "McNeese": "McNeese St.",
  "Nicholls": "Nicholls St.",
  "Detroit Mercy": "Detroit",
  "Kansas City": "UMKC",
  "Houston Christian": "Houston Baptist",
  "LIU": "LIU Brooklyn",
  // ... extract ALL mappings from espn-team-mapping.ts and ncaamb-team-name-mapping.ts
};

// Odds API aliases → KenPom canonical
const ODDS_TO_CANONICAL: Record<string, string> = {
  "Connecticut Huskies": "Connecticut",
  "St. John's Red Storm": "St. John's",
  // ... extract ALL from odds-api-team-mapping.ts
  // Also handle the progressive mascot stripping pattern
};

// Barttorvik aliases → KenPom canonical
// Barttorvik mostly matches KenPom, but document any differences
const BARTTORVIK_TO_CANONICAL: Record<string, string> = {
  // Fill in any differences found
};

// Generic aliases (works for any source)
const GENERIC_ALIASES: Record<string, string> = {
  "Hawai'i": "Hawaii",
  "UConn": "Connecticut",
  "Ole Miss": "Mississippi",
  // ... common abbreviations and variants
};
```

### Normalization Functions

```typescript
/**
 * Strip mascot from team name.
 * "Connecticut Huskies" → "Connecticut"
 * "St. John's Red Storm" → "St. John's"
 */
function stripMascot(name: string): string

/**
 * Normalize St./State/Saint equivalence.
 * "Saint Bonaventure" → "St. Bonaventure"
 * "Indiana State" → "Indiana St."
 */
function normalizeStState(name: string): string

/**
 * Full normalization pipeline.
 * Lowercases, strips mascots, normalizes st/state, removes hyphens, etc.
 */
function normalize(name: string): string
```

### Caching

- Load the full KenPom team list once (from KenpomSnapshot distinct teamNames)
- Load the Team table ID mapping once
- Cache in module-level Map, invalidate on `clearTeamResolverCache()`

### Exports

```typescript
export async function resolveTeamName(rawName: string, sport: string, source?: DataSource): Promise<ResolvedTeam>
export async function resolveTeamId(rawName: string, sport: string, source?: DataSource): Promise<number | null>
export async function getCanonicalName(rawName: string, sport: string, source?: DataSource): Promise<string>
export function clearTeamResolverCache(): void

// Bulk resolution (for cron jobs)
export async function resolveMany(names: string[], sport: string, source?: DataSource): Promise<Map<string, ResolvedTeam>>
```

---

## Task 2: Build the Canonical Names Reference List

Create `src/data/canonical-teams.ts` — a static, curated list of all ~364 D-I NCAAMB teams with their KenPom canonical name and known aliases from each source.

### How to Build It

1. Query all distinct `teamName` from `KenpomSnapshot` table (387 values — includes some historical teams that may have changed names)
2. Cross-reference with Barttorvik scrape (365 current teams)
3. For each team, document known aliases from ESPN, Odds API, and DB Team table
4. Include the `teamId` from the Team table where matched

```typescript
export interface CanonicalTeam {
  kenpomName: string;      // Source of truth
  teamId: number | null;   // DB Team.id
  conference: string;      // Current conference
  aliases: {
    espn?: string[];       // Known ESPN names
    oddsApi?: string[];    // Known Odds API names  
    barttorvik?: string;   // Barttorvik name (usually matches KenPom)
    cfbd?: string;         // CFBD name
    other?: string[];      // Any other known variants
  };
}

export const NCAAMB_CANONICAL_TEAMS: CanonicalTeam[] = [
  {
    kenpomName: "Connecticut",
    teamId: null, // Will be filled by migration
    conference: "Big East",
    aliases: {
      espn: ["UConn", "Connecticut Huskies"],
      oddsApi: ["Connecticut Huskies"],
      barttorvik: "Connecticut",
    },
  },
  // ... all 364+ teams
];
```

**Important:** To build this list accurately, you must:
1. Read `src/lib/ncaamb-team-name-mapping.ts` (3,470 lines) — it has the most comprehensive alias data
2. Read `src/lib/espn-team-mapping.ts` — ESPN-specific mappings
3. Read `src/lib/odds-api-team-mapping.ts` — Odds API mappings
4. Query `TeamNameMapping` table — 22 manual KenPom↔ESPN mappings
5. Query `KenpomSnapshot` for distinct team names
6. Query `Team` table for current NCAAMB team names and IDs

---

## Task 3: Database Migration Script (`scripts/fix-team-names.ts`)

Create a migration script that cleans up the Team table. **This is destructive — must be run carefully.**

### Step 3a: Flag Non-D-I Teams

```typescript
// Mark teams that are NOT in the canonical list
// Don't delete — they have game history. Add a flag or move to separate table.

// Option A: Add an `isActive` or `division` column to Team
// Option B: Create a separate "ArchivedTeam" table
// Option C: Just keep them but ensure the resolver never returns them

// Recommended: Option C for now (least schema change). 
// The resolver only matches against canonical names, so non-D-I teams 
// are naturally excluded from pick generation.
```

### Step 3b: Merge Duplicate Teams

Find teams that are the same school with different name variants and merge them:

```typescript
// Example: If DB has both "Adams State" (id: 100) and "Adams State Grizzlies" (id: 4773)
// 1. Identify the canonical one (the one matching KenPom, or the one with more games)
// 2. Update all NCAAMBGame rows: homeTeamId/awayTeamId from duplicate → canonical
// 3. Update all KenpomSnapshot, BarttovikSnapshot, EloRating rows similarly
// 4. Update TeamNameMapping if referenced
// 5. Delete the duplicate Team row (or mark inactive)
```

**Algorithm:**
1. For each canonical KenPom name, find ALL Team rows that could match (exact, case-insensitive, with/without mascot, st/state variants)
2. If multiple Team rows match the same canonical name → merge into one (keep the one with more game references)
3. Reassign all foreign keys from merged team IDs to the survivor
4. Log every merge for audit trail

### Step 3c: Rename Teams to Canonical Names

```typescript
// For teams that exist but have wrong names:
// UPDATE "Team" SET name = 'Connecticut' WHERE id = 1234 AND name = 'UConn' AND sport = 'NCAAMB';
```

### Step 3d: Update TeamNameMapping Table

Expand the `TeamNameMapping` table from 22 rows to cover ALL known aliases:

```typescript
// For each canonical team, insert mappings for every known alias
// This makes the DB queryable for name resolution without code changes
```

### Safety

- **DRY RUN MODE:** The script must have a `--dry-run` flag that logs all changes without executing them
- **TRANSACTION:** Wrap all changes in a database transaction — all or nothing
- **BACKUP:** Log the full before/after state for each merged team
- **VERIFY:** After migration, run validation:
  - Every NCAAMBGame should have valid homeTeamId/awayTeamId
  - Every KenpomSnapshot.teamName should match a Team.name
  - No orphaned foreign keys
  - Team count should be ~364-400 (D-I teams + a few historical/renamed)

---

## Task 4: Update All Consumers to Use team-resolver.ts

### 4a: Update `src/lib/pick-engine.ts`

Replace `resolveCanonicalName()` and `NAME_ALIASES` with the new resolver:

```typescript
// BEFORE:
const NAME_ALIASES: Record<string, string> = { ... };
async function resolveCanonicalName(name: string, sport: string): Promise<string> { ... }

// AFTER:
import { getCanonicalName } from "./team-resolver";
// Delete NAME_ALIASES and resolveCanonicalName entirely
// Replace all calls to resolveCanonicalName() with getCanonicalName()
```

### 4b: Update `src/lib/espn-sync.ts` (or wherever ESPN data is ingested)

When creating/matching teams from ESPN data:
```typescript
import { resolveTeamName } from "./team-resolver";
const resolved = await resolveTeamName(espnTeamName, "NCAAMB", "espn");
// Use resolved.canonicalName and resolved.teamId
```

### 4c: Update Odds API ingestion

When matching teams from The Odds API:
```typescript
const resolved = await resolveTeamName(oddsApiTeamName, "NCAAMB", "odds");
```

### 4d: Update `src/lib/kenpom.ts`

KenPom names ARE the canonical names, so resolution should be identity:
```typescript
const resolved = await resolveTeamName(kenpomTeamName, "NCAAMB", "kenpom");
// This should always be exact match
```

### 4e: Update `src/lib/barttorvik.ts`

```typescript
const resolved = await resolveTeamName(barttovikTeamName, "NCAAMB", "barttorvik");
```

### 4f: Update `src/lib/nba-stats.ts`, `src/lib/nflverse.ts`, `src/lib/cfbd.ts`

Apply the same pattern for NBA, NFL, and NCAAF teams. The resolver should handle all sports, not just NCAAMB. For NFL/NBA the naming is simpler (fewer variants) but should still go through the resolver for consistency.

---

## Task 5: Delete Old Mapping Files

After the new resolver is working and all consumers are updated:

1. **Delete** `src/lib/ncaamb-team-name-mapping.ts` (3,470 lines)
2. **Delete** `src/lib/espn-team-mapping.ts` (205 lines)
3. **Delete** `src/lib/odds-api-team-mapping.ts` (230 lines)
4. **Keep** `src/lib/team-name-mapping.ts` (NFL) — merge into team-resolver.ts, then delete
5. **Keep** `src/lib/ncaaf-team-name-mapping.ts` (NCAAF) — merge into team-resolver.ts, then delete
6. Remove all imports of deleted files throughout the codebase
7. Verify `npx tsc --noEmit` passes with zero errors

**Net result:** 5,194 lines of mapping files replaced by ~500-800 lines in team-resolver.ts + canonical-teams.ts

---

## Task 6: Validation & Testing

### Create `scripts/validate-team-names.ts`

A validation script that checks:

```typescript
// 1. Every KenpomSnapshot.teamName matches a Team.name
// 2. Every BarttovikSnapshot has valid teamId → Team
// 3. Every NCAAMBGame has valid homeTeamId/awayTeamId → Team
// 4. No duplicate canonical names in Team table
// 5. Team count for NCAAMB is between 360-400
// 6. All 22 TeamNameMapping entries still resolve correctly
// 7. Spot-check: "UConn" resolves to "Connecticut", "Ole Miss" → "Mississippi", etc.
// 8. Every team in the canonical list has a valid teamId

// Run this after migration and after any team-related code changes
```

### Spot-Check List

These are the trickiest name resolution cases. All must pass:

| Raw Name (Source) | Expected Canonical | Notes |
|---|---|---|
| UConn (ESPN) | Connecticut | Common abbreviation |
| Ole Miss (ESPN) | Mississippi | Historical name |
| NC State (ESPN) | N.C. State | Period placement |
| Saint Bonaventure (ESPN) | St. Bonaventure | Saint → St. |
| Connecticut Huskies (Odds) | Connecticut | Strip mascot |
| St. John's Red Storm (Odds) | St. John's | Strip mascot with apostrophe |
| CSUN (ESPN) | Cal St. Northridge | Abbreviation |
| Detroit Mercy (ESPN) | Detroit | Name change |
| Kansas City (ESPN) | UMKC | Different common name |
| Houston Christian (ESPN) | Houston Baptist | Name change |
| LIU (ESPN) | LIU Brooklyn | Shortened name |
| McNeese (ESPN) | McNeese St. | Missing St. |
| Nicholls (ESPN) | Nicholls St. | Missing St. |
| Miami (FL) (ESPN) | Miami FL | Disambiguator format |
| Miami (OH) (ESPN) | Miami OH | Disambiguator format |
| Texas A&M-Corpus Christi (ESPN) | Texas A&M Corpus Chris | Hyphen removal + truncation |
| Hawai'i (ESPN) | Hawaii | Special character |
| Stephen F. Austin (Barttorvik) | Stephen F. Austin | Should be identity |

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/team-resolver.ts` | **Create** | Single authoritative resolver for all team names |
| `src/data/canonical-teams.ts` | **Create** | Static reference list of all D-I teams + aliases |
| `scripts/fix-team-names.ts` | **Create** | DB migration: merge dupes, clean names, expand mappings |
| `scripts/validate-team-names.ts` | **Create** | Post-migration validation |
| `src/lib/pick-engine.ts` | **Modify** | Replace resolveCanonicalName with team-resolver |
| `src/lib/barttorvik.ts` | **Modify** | Use team-resolver for name matching |
| `src/lib/nba-stats.ts` | **Modify** | Use team-resolver |
| `src/lib/nflverse.ts` | **Modify** | Use team-resolver |
| `src/lib/kenpom.ts` | **Modify** | Use team-resolver |
| `src/lib/espn-sync.ts` | **Modify** | Use team-resolver |
| `src/lib/ncaamb-team-name-mapping.ts` | **Delete** | Replaced by team-resolver |
| `src/lib/espn-team-mapping.ts` | **Delete** | Replaced by team-resolver |
| `src/lib/odds-api-team-mapping.ts` | **Delete** | Replaced by team-resolver |
| `src/lib/team-name-mapping.ts` | **Delete** | Merged into team-resolver |
| `src/lib/ncaaf-team-name-mapping.ts` | **Delete** | Merged into team-resolver |

### Order of Implementation

1. **Build canonical-teams.ts** — must be first (reference data for everything else)
2. **Build team-resolver.ts** — the new resolver using canonical-teams.ts
3. **Build fix-team-names.ts** — migration script (run in dry-run first!)
4. **Run migration** — execute fix-team-names.ts against dev DB branch
5. **Update all consumers** — pick-engine, barttorvik, kenpom, espn-sync, etc.
6. **Delete old mapping files** — remove the 5 legacy files
7. **Build validate-team-names.ts** — validation script
8. **Run validation** — ensure everything is clean
9. **Test** — `tsc --noEmit`, `next build`, spot-check name resolution

---

## Important Notes

1. **Read ALL existing mapping files first** — they contain years of accumulated knowledge about name variants. Don't lose any mappings when consolidating.
2. **The 3,470-line ncaamb-team-name-mapping.ts is the most comprehensive source** — it likely has every ESPN↔DB mapping discovered over time. Extract ALL of them.
3. **Barttorvik names closely match KenPom** — only a few differences expected. Document any found.
4. **Don't delete non-D-I teams** — they have game history (NCAAMBGame foreign keys). Flag them or leave them, but the resolver should only match D-I canonical teams.
5. **Test the migration on the dev branch first** — `ep-long-feather-aivl5dc8` (Neon dev branch). Only run on prod after validation passes.
6. **Transaction safety** — the fix-team-names.ts script must wrap all changes in a single transaction. If anything fails, rollback everything.
7. **NFL and NBA naming is simpler** — NFL has 32 stable team names, NBA has 30. Still route through the resolver for consistency but they need minimal alias work.
8. **NCAAF naming** — the 1,093-line NCAAF mapping file has similar issues. Apply the same pattern but with CFBD as the canonical source for NCAAF.

---

## Database Connection

- **Dev branch (test here first):** `postgresql://neondb_owner:npg_q1J2nAExTsmO@ep-long-feather-aivl5dc8-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require`
- **Prod (apply after validation):** `postgresql://neondb_owner:npg_q1J2nAExTsmO@ep-patient-sea-aisxwpbp-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require`
- **Direct endpoint (for DDL/migrations, remove -pooler):** swap `-pooler` for direct connection

---

## Expected Outcome

**Before:**
- 1,683 NCAAMB teams in DB
- 5 mapping files (5,194 lines)
- 3 resolution functions
- 22 manual TeamNameMapping rows
- Frequent name mismatches in pick generation

**After:**
- ~364-400 canonical NCAAMB teams in DB (D-I only, clean names)
- 1 resolver module (~500-800 lines)
- 1 canonical reference file
- Full TeamNameMapping coverage for all known aliases
- Zero name mismatches in pick generation
- Every data source (KenPom, ESPN, Odds API, Barttorvik, CFBD) resolves correctly
