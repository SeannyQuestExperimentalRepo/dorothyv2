# Implementation Prompt: Fix Team Name Resolution Once and For All

> **Use this prompt with a coding agent pointed at the dorothyv2 repo.**

---

## The Problem

Team name resolution in dorothyv2 is broken by design. There are **6 separate mapping systems** that don't talk to each other, each doing ad-hoc translations between different data sources. When a name doesn't match, the pick engine silently fails to look up ratings/stats and the game gets scored with incomplete data — which is a root cause of bad picks.

### Current Architecture (the mess)

```
ESPN API ──→ espn-team-mapping.ts ──→ DB canonical name
KenPom API ──→ kenpom.ts (DB_TO_KENPOM) ──→ KenPom name
Odds API ──→ odds-api-team-mapping.ts ──→ DB canonical name  
CFBD API ──→ cfbd.ts (inline normalize) ──→ CFBD name
Pick Engine ──→ pick-engine.ts (NAME_ALIASES + resolveCanonicalName) ──→ DB canonical name
General ──→ ncaamb-team-name-mapping.ts (1,738 entries) ──→ canonical name
General ──→ ncaaf-team-name-mapping.ts (744 entries) ──→ canonical name
General ──→ team-name-mapping.ts (196 entries, NFL) ──→ canonical name
```

**Six different files, six different approaches, names go in different directions:**
- ESPN → DB direction (espn-team-mapping.ts, espn overrides)
- DB → KenPom direction (kenpom.ts `DB_TO_KENPOM`)
- OddsAPI → DB direction (odds-api-team-mapping.ts)  
- DB → DB with fallbacks (pick-engine.ts `resolveCanonicalName`)
- General any → canonical (ncaamb-team-name-mapping.ts)

When you add a new source (Barttorvik, NBA.com, nflverse), you'd need to create ANOTHER mapping file. This doesn't scale.

### Database Problems

The NCAAMB `Team` table has **1,683 entries** when D-I only has ~364 teams. The rest are:
- **D-II/D-III/NAIA teams** that appeared as opponents in exhibition games (e.g., "Apprentice School Builders", "Alice Lloyd College Eagles")
- **Duplicate entries with mascots appended** (e.g., "Adams State" AND "Adams State Grizzlies", "Angelo State" AND "Angelo State Rams")
- **Inconsistent formatting** (e.g., "Arcadia ARCADIA", "Albany St (GA) Golden Rams")
- **Teams with 1 game** — over 500 teams have ≤3 games, meaning they were one-off exhibition opponents

Only ~387 teams have KenPom data. Those are the D-I teams we actually care about for picks.

### Symptoms
- KenPom lookup fails silently → `console.warn("[kenpom] Unmatched team name")`
- CFBD lookup fails silently → `console.warn("[cfbd] Unmatched team name")`
- Odds API strips mascots with heuristics that sometimes grab part of the team name
- Pick engine's `resolveCanonicalName` does a DB query per team per game (N+1)
- Adding new data sources requires creating new mapping files every time
- No way to know which teams are failing without reading logs

---

## The Solution: Single Source of Truth

### Architecture

```
                    ┌──────────────────────────┐
                    │    team-resolver.ts       │
                    │                          │
ANY SOURCE NAME ──→ │  resolve(name, sport,    │ ──→ CANONICAL DB NAME
                    │          source?)        │
                    │                          │
                    │  Uses:                   │
                    │  1. Exact match cache    │
                    │  2. Alias lookup table   │
                    │  3. Fuzzy normalization  │
                    │  4. DB fallback          │
                    │  5. Logged misses        │
                    └──────────────────────────┘
```

**One function. One file. Every source goes through it. Every miss is logged.**

---

## Task 1: Create `src/lib/team-resolver.ts`

This replaces ALL team name resolution across the entire codebase.

### Core Design

```typescript
import "server-only";
import { prisma } from "./db";
import type { Sport } from "@prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────

type DataSource = "espn" | "kenpom" | "cfbd" | "oddsapi" | "barttorvik" | "nbacom" | "nflverse" | "db" | "unknown";

interface ResolveResult {
  canonical: string;        // The DB Team.name
  teamId: number;           // The DB Team.id
  matched: boolean;         // Whether we found a match
  matchMethod: "exact" | "alias" | "normalized" | "fuzzy" | "db-query" | "unresolved";
  source: DataSource;
}

// ─── In-Memory Caches ──────────────────────────────────────────────────────

// Canonical names loaded from DB at startup
const canonicalNames: Map<string, Map<string, number>> = new Map(); // sport → (name → id)

// Resolved alias cache: "source:sport:inputName" → canonical name
const resolvedCache: Map<string, string> = new Map();

// Unresolved names log (for debugging/fixing)
const unresolvedLog: Map<string, { source: DataSource; sport: string; count: number }> = new Map();

let initialized = false;

// ─── Initialization ─────────────────────────────────────────────────────────

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  
  const teams = await prisma.team.findMany({
    where: { sport: { in: ["NFL", "NCAAF", "NCAAMB", "NBA"] } },
    select: { id: true, name: true, sport: true },
  });
  
  for (const team of teams) {
    if (!canonicalNames.has(team.sport)) {
      canonicalNames.set(team.sport, new Map());
    }
    canonicalNames.get(team.sport)!.set(team.name, team.id);
  }
  
  initialized = true;
  console.log(`[team-resolver] Loaded ${teams.length} canonical team names`);
}

// ─── Main Resolve Function ──────────────────────────────────────────────────

/**
 * Resolve ANY team name from ANY source to the canonical DB name.
 * 
 * This is the ONLY function that should be used for team name resolution
 * anywhere in the codebase.
 * 
 * @param name - The team name as it appears in the source
 * @param sport - The sport (NFL, NCAAF, NCAAMB, NBA)
 * @param source - Where this name came from (for debugging)
 * @returns The canonical DB name, or the input name if unresolved
 */
export async function resolveTeamName(
  name: string,
  sport: string,
  source: DataSource = "unknown"
): Promise<string> {
  await ensureInitialized();
  
  // 1. Check resolved cache first
  const cacheKey = `${source}:${sport}:${name}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached) return cached;
  
  // 2. Exact match against DB canonical names
  const sportNames = canonicalNames.get(sport);
  if (sportNames?.has(name)) {
    resolvedCache.set(cacheKey, name);
    return name;
  }
  
  // 3. Alias table lookup
  const aliased = ALIASES[sport]?.[name];
  if (aliased && sportNames?.has(aliased)) {
    resolvedCache.set(cacheKey, aliased);
    return aliased;
  }
  
  // 4. Normalized matching (case-insensitive, punctuation-stripped)
  const norm = normalize(name);
  if (sportNames) {
    for (const [canonical, _id] of sportNames) {
      if (normalize(canonical) === norm) {
        resolvedCache.set(cacheKey, canonical);
        return canonical;
      }
    }
  }
  
  // 5. Fuzzy matching strategies
  const fuzzyResult = fuzzyMatch(name, sport, sportNames);
  if (fuzzyResult) {
    resolvedCache.set(cacheKey, fuzzyResult);
    return fuzzyResult;
  }
  
  // 6. Unresolved — log it and return input
  const logKey = `${source}:${sport}:${name}`;
  const existing = unresolvedLog.get(logKey);
  if (existing) {
    existing.count++;
  } else {
    unresolvedLog.set(logKey, { source, sport, count: 1 });
    console.warn(`[team-resolver] UNRESOLVED: "${name}" (sport=${sport}, source=${source})`);
  }
  
  resolvedCache.set(cacheKey, name); // Cache the miss too to avoid repeated DB lookups
  return name;
}

/**
 * Batch resolve — more efficient for resolving many names at once.
 * Pre-warms cache, avoids repeated DB lookups.
 */
export async function resolveTeamNames(
  names: string[],
  sport: string,
  source: DataSource = "unknown"
): Promise<Map<string, string>> {
  await ensureInitialized();
  const result = new Map<string, string>();
  for (const name of names) {
    result.set(name, await resolveTeamName(name, sport, source));
  }
  return result;
}

/**
 * Get all unresolved team names (for debugging and fixing aliases).
 * Call this from an admin endpoint or CLI tool.
 */
export function getUnresolvedNames(): Map<string, { source: DataSource; sport: string; count: number }> {
  return new Map(unresolvedLog);
}

/**
 * Clear caches (useful for testing or after DB changes).
 */
export function clearTeamResolverCache(): void {
  resolvedCache.clear();
  canonicalNames.clear();
  initialized = false;
}

// ─── Normalization ──────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'\u2019\u2018()\-&]/g, "")  // Remove punctuation
    .replace(/\s+/g, " ")                     // Collapse whitespace
    .trim();
}

// ─── Fuzzy Matching Strategies ──────────────────────────────────────────────

function fuzzyMatch(
  name: string, 
  sport: string,
  sportNames: Map<string, number> | undefined
): string | null {
  if (!sportNames) return null;
  const norm = normalize(name);
  
  // Strategy 1: Strip mascot (last word) — "Gonzaga Bulldogs" → "Gonzaga"
  const words = name.split(" ");
  if (words.length >= 2) {
    const noMascot = words.slice(0, -1).join(" ");
    if (sportNames.has(noMascot)) return noMascot;
    
    const normNoMascot = normalize(noMascot);
    for (const [canonical] of sportNames) {
      if (normalize(canonical) === normNoMascot) return canonical;
    }
  }
  
  // Strategy 2: Strip last 2 words — "North Carolina Tar Heels" → "North Carolina"
  if (words.length >= 3) {
    const noMascot2 = words.slice(0, -2).join(" ");
    if (sportNames.has(noMascot2)) return noMascot2;
    
    const normNoMascot2 = normalize(noMascot2);
    for (const [canonical] of sportNames) {
      if (normalize(canonical) === normNoMascot2) return canonical;
    }
  }
  
  // Strategy 3: "State" ↔ "St." equivalence
  const stateVariants = [
    norm.replace(/ st$/, " state"),
    norm.replace(/ state$/, " st"),
    norm.replace(/ st /, " state "),
    norm.replace(/ state /, " st "),
  ];
  for (const variant of stateVariants) {
    for (const [canonical] of sportNames) {
      if (normalize(canonical) === variant) return canonical;
    }
  }
  
  // Strategy 4: "Saint" ↔ "St." prefix equivalence
  const saintVariants = [
    norm.replace(/^saint /, "st "),
    norm.replace(/^st /, "saint "),
  ];
  for (const variant of saintVariants) {
    for (const [canonical] of sportNames) {
      if (normalize(canonical) === variant) return canonical;
    }
  }
  
  // Strategy 5: Hyphen ↔ space — "Texas A&M-Corpus Christi" → "Texas A&M Corpus Christi"
  const dehyphenated = norm.replace(/-/g, " ");
  if (dehyphenated !== norm) {
    for (const [canonical] of sportNames) {
      if (normalize(canonical) === dehyphenated) return canonical;
    }
  }
  
  // Strategy 6: Remove "University", "College", "of" noise words
  const cleaned = norm
    .replace(/\buniversity\b/g, "")
    .replace(/\bcollege\b/g, "")
    .replace(/\bof\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned !== norm) {
    for (const [canonical] of sportNames) {
      if (normalize(canonical).replace(/\buniversity\b/g, "").replace(/\bcollege\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim() === cleaned) {
        return canonical;
      }
    }
  }
  
  return null;
}
```

### The Unified Alias Table

This is the critical part. Consolidate ALL mappings from ALL 6 existing files into one structure. The aliases are organized by sport, and each entry maps a known variant → the DB canonical name.

```typescript
// ─── Unified Alias Table ────────────────────────────────────────────────────
//
// This is THE SINGLE SOURCE OF TRUTH for all team name variants.
//
// Structure: ALIASES[sport][variant] = canonicalDbName
//
// When adding a new data source, you ONLY need to add entries here.
// No new mapping files. No new lookup functions. Just aliases.
//
// Sources consolidated:
//   - src/lib/ncaamb-team-name-mapping.ts (1,738 entries)
//   - src/lib/ncaaf-team-name-mapping.ts (744 entries)
//   - src/lib/team-name-mapping.ts (196 entries)
//   - src/lib/espn-team-mapping.ts (138 entries)
//   - src/lib/odds-api-team-mapping.ts (125 entries)
//   - src/lib/kenpom.ts DB_TO_KENPOM (87 entries)
//   - src/lib/pick-engine.ts NAME_ALIASES (12 entries)

const ALIASES: Record<string, Record<string, string>> = {
  NFL: {
    // ... merge from team-name-mapping.ts
    // All abbreviations: "ARI" → "Arizona Cardinals", "ATL" → "Atlanta Falcons", etc.
    // All historical names: "Oakland Raiders" → "Las Vegas Raiders", etc.
    // nflverse names: nflverse uses abbreviations like "ARI", "ATL", etc.
  },
  
  NCAAF: {
    // ... merge from ncaaf-team-name-mapping.ts + espn-team-mapping.ts NCAAF section
    // + CFBD name variants
    // + Odds API NCAAF variants
  },
  
  NCAAMB: {
    // ... merge from:
    //   ncaamb-team-name-mapping.ts (the big one — 1,738 entries)
    //   espn-team-mapping.ts NCAAMB section
    //   odds-api-team-mapping.ts
    //   kenpom.ts DB_TO_KENPOM (REVERSED — currently maps DB→KenPom, needs to be KenPom→DB)
    //   Barttorvik name variants (new)
    //
    // IMPORTANT: KenPom's DB_TO_KENPOM currently maps DB canonical → KenPom name.
    // We need the REVERSE: KenPom name → DB canonical.
    // Example: DB_TO_KENPOM has "UConn" → "Connecticut" 
    // But we ALSO need "Connecticut" to match the DB name "Connecticut"
    // AND "UConn Huskies" (ESPN) → "Connecticut"
    // AND "Connecticut Huskies" (Odds API) → "Connecticut"
    // AND "Connecticut" (Barttorvik) → "Connecticut"
    // All in ONE place.
  },
  
  NBA: {
    // NBA is relatively clean — 30 teams, consistent naming
    // But add variants for: abbreviations (LAL, BOS, etc.), 
    // NBA.com format, Odds API format, nba_api format
    // Historical: "New Jersey Nets" → "Brooklyn Nets", etc.
  },
};
```

**CRITICAL IMPLEMENTATION NOTE:** Do NOT manually transcribe all 3,000+ entries. Write a script (Task 5) that:
1. Reads all existing mapping files
2. Consolidates into the unified format
3. Deduplicates
4. Identifies conflicts (where two sources disagree on canonical name)
5. Outputs the final ALIASES object

---

## Task 2: Refactor All Consumers

Every file that does team name resolution must be updated to use `resolveTeamName()`.

### Files to modify:

**`src/lib/pick-engine.ts`**
- Remove `NAME_ALIASES` constant
- Remove `resolveCanonicalName()` function
- Replace all calls with `resolveTeamName(name, sport, "db")`
- Remove import of `lookupRating` from kenpom.ts — instead resolve the name first, then do a direct Map.get()

**`src/lib/kenpom.ts`**
- Remove `DB_TO_KENPOM` mapping
- Remove `normalizeToKenpom()` function
- Modify `lookupRating()` to use `resolveTeamName(teamName, "NCAAMB", "kenpom")`
- Actually: better approach — the resolver resolves TO the DB canonical name. KenPom data should be keyed by DB canonical name after fetching. In `getKenpomRatings()`, after fetching, re-key the Map using the resolver:
  ```typescript
  // After fetching raw KenPom data:
  for (const team of raw) {
    const canonical = await resolveTeamName(team.TeamName, "NCAAMB", "kenpom");
    map.set(canonical, team); // Key by DB canonical, not KenPom name
  }
  ```
  Then `lookupRating()` becomes a simple `map.get(canonicalName)` — no fuzzy matching needed at lookup time.

**`src/lib/cfbd.ts`**
- Same pattern: after fetching CFBD data, re-key by DB canonical name using resolver
- Remove `lookupCFBDRating()` fuzzy matching

**`src/lib/espn-sync.ts`**
- Use `resolveTeamName(espnName, sport, "espn")` when syncing games
- Remove dependency on `espn-team-mapping.ts`

**`src/lib/espn-api.ts`**
- Remove imports of team name mapping files (nflTeamNameMap, ncaafTeamNameMap, ncaambTeamNameMap)
- Use `resolveTeamName()` instead

**`src/lib/odds-api-sync.ts`**
- Replace `resolveOddsApiName()` and `matchOddsApiTeam()` with `resolveTeamName(name, sport, "oddsapi")`
- Remove import of odds-api-team-mapping.ts

**`src/lib/game-context-engine.ts`**
- Use resolver for any team name lookups

**New data source files (from IMPLEMENTATION-PROMPT.md):**
- `src/lib/nba-stats.ts` — Use `resolveTeamName(nbacomName, "NBA", "nbacom")`
- `src/lib/nflverse.ts` — Use `resolveTeamName(nflverseName, "NFL", "nflverse")`
- `src/lib/barttorvik.ts` — Use `resolveTeamName(barttovikName, "NCAAMB", "barttorvik")`

---

## Task 3: Fix the Database

### 3a: Identify and merge duplicate teams

The NCAAMB Team table has 1,683 entries. Many are duplicates or non-D-I noise.

**Write a migration script (`scripts/fix-team-names.ts`)** that:

1. **Identifies true D-I teams** — Teams that have KenpomSnapshot entries (387 teams) are definitely D-I. These are the canonical set.

2. **Finds duplicates** — Teams that are clearly the same:
   - "Adams State" and "Adams State Grizzlies" → keep "Adams State" (no mascot)
   - "Albany St (GA) Golden Rams" and likely a cleaner variant → merge
   - "Arcadia ARCADIA" → fix to "Arcadia"
   
3. **Merge duplicates:**
   - Pick the cleanest name as canonical (no mascots, consistent formatting)
   - Update all `NCAAMBGame` foreign keys to point to the surviving team
   - Update all `KenpomSnapshot`, `OddsSnapshot`, `DailyPick`, `UpcomingGame` foreign keys
   - Delete the duplicate Team entries
   
4. **Flag non-D-I teams** — Add an `isActive` or `division` column to Team, or just leave them (they won't match KenPom anyway). Don't delete them — they're referenced by historical games.

5. **Standardize naming convention:**
   - Use KenPom names as canonical for NCAAMB (they're the most authoritative source)
   - Use ESPN names as canonical for NFL and NBA
   - Use CFBD names or ESPN names as canonical for NCAAF
   - No mascots in canonical names (exceptions: teams where the mascot IS the name, like "Blue Devils" — but these don't exist in the DB)

### 3b: Add canonical name validation

Add a unique constraint check: `@@unique([sport, name])` is already in the schema. Good. But enforce that new team creation goes through the resolver to prevent future duplicates.

---

## Task 4: Source-Specific Name Research

Before building the alias table, we need to document exactly how each source names teams. Here are the known differences:

### NCAAMB Name Variants by Source

| DB Canonical | ESPN | KenPom | Odds API | Barttorvik | CFBD |
|---|---|---|---|---|---|
| Connecticut | UConn Huskies | Connecticut | Connecticut Huskies | Connecticut | N/A |
| N.C. State | NC State Wolfpack | NC State | North Carolina State Wolfpack | N.C. State | N/A |
| Miami FL | Miami Hurricanes | Miami FL | Miami (FL) Hurricanes | Miami FL | N/A |
| Miami OH | Miami (OH) RedHawks | Miami OH | Miami (OH) RedHawks | Miami OH | N/A |
| Mississippi | Ole Miss Rebels | Mississippi | Ole Miss Rebels | Mississippi | N/A |
| Appalachian St. | App State Mountaineers | Appalachian St. | Appalachian State Mountaineers | App State | N/A |
| Florida St. | Florida State Seminoles | Florida St. | Florida State Seminoles | Florida St. | N/A |
| Saint Mary's | Saint Mary's Gaels | Saint Mary's | Saint Mary's Gaels | St. Mary's | N/A |

### Key Naming Patterns by Source

**ESPN:** Full name + mascot ("Duke Blue Devils"), or short name ("Duke"), or abbreviation ("DUK"). Uses "State" not "St."

**KenPom:** Short name, uses "St." for State ("Florida St."), some unique names ("Connecticut" not "UConn")

**Odds API:** Full name + mascot ("Gonzaga Bulldogs"), sometimes with region qualifier ("Miami (FL) Hurricanes")

**Barttorvik:** Similar to KenPom but not identical. Some names differ (inspect live scrape to confirm).

**CFBD (NCAAF):** Full school name ("Florida State"), uses "State" not "St."

**nflverse (NFL):** 2-3 letter abbreviations ("ARI", "ATL", "BAL") or full team names

**NBA.com / nba_api:** Full city + name ("Los Angeles Lakers"), or abbreviation ("LAL")

### NFL Naming (simpler)
Only 32 teams, but variants exist:
- Abbreviations: ARI, ATL, BAL, BUF, CAR, CHI, CIN, CLE, DAL, DEN, DET, GB, HOU, IND, JAX, KC, LAC, LAR, LV, MIA, MIN, NE, NO, NYG, NYJ, PHI, PIT, SF, SEA, TB, TEN, WAS
- Historical: Oakland Raiders, San Diego Chargers, St. Louis Rams, Washington Redskins/Football Team
- nflverse: Uses same abbreviations but sometimes "LA" for Rams, "OAK" for historical

### NBA Naming (relatively clean)
30 teams, main variants:
- Abbreviations: ATL, BOS, BKN, CHA, CHI, CLE, DAL, DEN, DET, GSW, HOU, IND, LAC, LAL, MEM, MIA, MIL, MIN, NOP, NYK, OKC, ORL, PHI, PHX, POR, SAC, SAS, TOR, UTA, WAS
- NBA.com uses full "City TeamName" format
- Historical: New Jersey Nets → Brooklyn Nets, Seattle SuperSonics → OKC Thunder, etc.
- Odds API may use "LA Clippers" vs "Los Angeles Clippers"

---

## Task 5: Consolidation Script

**Write `scripts/consolidate-team-names.ts`** that:

1. Reads ALL existing mapping files:
   - `src/lib/ncaamb-team-name-mapping.ts`
   - `src/lib/ncaaf-team-name-mapping.ts`
   - `src/lib/team-name-mapping.ts`
   - `src/lib/espn-team-mapping.ts`
   - `src/lib/odds-api-team-mapping.ts`
   - `src/lib/kenpom.ts` (extract DB_TO_KENPOM)
   - `src/lib/pick-engine.ts` (extract NAME_ALIASES)

2. Reads the DB Team table to get all canonical names

3. For each mapping entry:
   - Determine the canonical DB name it maps to
   - Verify that canonical name exists in the Team table
   - Flag conflicts (where different sources map the same variant to different canonical names)

4. Outputs the unified `ALIASES` object to `src/lib/team-aliases.generated.ts`

5. Generates a report:
   - Total aliases per sport
   - Conflicts found
   - Canonical names with NO aliases (potential gaps)
   - Aliases pointing to non-existent Team entries

---

## Task 6: Add New Source Name Discovery

**Write `scripts/discover-team-names.ts`** that:

1. For each data source, fetches current team names:
   - KenPom: all TeamName values from ratings endpoint
   - CFBD: all team names from ratings endpoint
   - Odds API: fetch upcoming games, collect all team names
   - NBA.com: fetch team list
   - Barttorvik: scrape T-Rank page, collect all team names
   - nflverse: download team list CSV

2. For each name, runs it through the resolver

3. Reports:
   - ✅ Names that resolve correctly
   - ⚠️ Names that resolve via fuzzy match (might be fragile)
   - ❌ Names that don't resolve (need aliases added)

4. Outputs suggested alias additions for unresolved names

This script should be run whenever a new data source is added, at the start of each season (teams rebrand/reclassify), and periodically as a CI check.

---

## Task 7: Delete Old Mapping Files

After the consolidation is complete and verified:

1. Delete `src/lib/ncaamb-team-name-mapping.ts` (3,470 lines)
2. Delete `src/lib/ncaaf-team-name-mapping.ts` (1,093 lines)
3. Delete `src/lib/team-name-mapping.ts` (196 lines)
4. Delete `src/lib/espn-team-mapping.ts` (205 lines)
5. Delete `src/lib/odds-api-team-mapping.ts` (230 lines)
6. Remove `DB_TO_KENPOM` from `src/lib/kenpom.ts`
7. Remove `NAME_ALIASES` and `resolveCanonicalName` from `src/lib/pick-engine.ts`
8. Update all imports across the codebase

**Net effect:** ~5,200 lines of fragmented mapping code → ~1 file with a clean resolver + generated alias table.

---

## Task 8: Admin Endpoint for Monitoring

**Create `src/app/api/admin/unresolved-teams/route.ts`:**

```typescript
// GET /api/admin/unresolved-teams
// Returns all team names that failed to resolve, grouped by source
// Use this to incrementally fix gaps

import { getUnresolvedNames } from "@/lib/team-resolver";

export async function GET() {
  const unresolved = getUnresolvedNames();
  const entries = Array.from(unresolved.entries()).map(([key, val]) => ({
    name: key.split(":").slice(2).join(":"),
    source: val.source,
    sport: val.sport,
    hitCount: val.count,
  }));
  
  return Response.json({
    total: entries.length,
    entries: entries.sort((a, b) => b.hitCount - a.hitCount),
  });
}
```

---

## Implementation Order

1. **Task 5 first** — Run the consolidation script to merge all existing aliases
2. **Task 1** — Create team-resolver.ts with the generated aliases
3. **Task 6** — Run name discovery against all sources, add missing aliases
4. **Task 2** — Refactor all consumers to use the resolver (one file at a time, test after each)
5. **Task 3** — Clean up the DB (careful — this touches foreign keys)
6. **Task 8** — Add monitoring endpoint
7. **Task 7** — Delete old files (only after everything is verified working)

---

## Testing

1. **Unit test the resolver** — Feed it names from every source format and verify it returns the correct canonical name
2. **Regression test** — Run the daily-sync cron in dry-run mode and verify zero `UNRESOLVED` warnings for any D-I team
3. **Backtest** — Run pick generation for a past date and compare results before/after the refactor (should be identical or better, never worse)
4. **Source coverage test** — For each source, fetch all available team names and verify 100% resolution rate for D-I teams

---

## Expected Results

- **Before:** 6 mapping files, 5,200 lines, inconsistent behavior, silent failures
- **After:** 1 resolver + 1 generated alias file, ~1,500 lines total, logged misses, zero silent failures
- **Maintenance:** Adding a new source = run discovery script, add aliases, done. No new mapping files ever again.
- **Picks improvement:** Every game where KenPom/CFBD lookup was silently failing will now have proper data → better picks
