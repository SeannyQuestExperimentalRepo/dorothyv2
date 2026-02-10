# Phase 1: Bundle Reduction

You are optimizing a Next.js 14 app (App Router, Prisma/PostgreSQL, TanStack Query). Make ONE targeted change per iteration to reduce client bundle size.

## STRICT RULES

- ONLY modify existing files inside `src/` or config files at the repo root
- DO NOT create new files, Dockerfiles, or scripts
- Make exactly ONE optimization per iteration
- Run `npm run build` after your change to verify it compiles
- If build fails, revert immediately with `git checkout -- .`
- Write a one-line summary of what you changed

## TARGETS (pick ONE per iteration)

### 1. Add Prisma `select` to game queries in db-trend-loader.ts

File: `src/lib/db-trend-loader.ts`

Three `findMany` calls load ALL fields when only a subset is needed:

- **Line ~90**: `nFLGame.findMany()` — add `select` excluding: `source`, `createdAt`, `updatedAt`, `weatherRaw`, `kickoffTime`
- **Line ~180**: `nCAAFGame.findMany()` — same select optimization
- **Line ~268**: `nCAAMBGame.findMany()` — same select optimization

NOTE: `team.findMany` at line ~31 ALREADY has a select clause. Do NOT touch it.

### 2. Add Prisma `select` to upcoming games route

File: `src/app/api/games/upcoming/route.ts`

- **Lines ~37-41**: `upcomingGame.findMany()` has no `select` — add one with only the fields the frontend needs (id, sport, homeTeam, awayTeam, gameDate, spread, overUnder, homeRecord, awayRecord)

### 3. Add Prisma `select` to matchup route

File: `src/app/api/games/matchup/route.ts`

- **Line ~129**: `upcomingGame.findFirst()` has no `select` — add one
- **Line ~141**: `upcomingGame.findFirst()` (fallback query) has no `select` — add one

### 4. Remove `"use client"` from pure presentational components

These components use NO hooks (useState, useEffect, etc.) and can be server components:

- `src/components/trends/significance-badge.tsx` (58 lines, "use client" on line 1)
- `src/components/trends/streak-dots.tsx` (38 lines, "use client" on line 1)

Check each file first — only remove "use client" if the component truly has no hooks or browser APIs.

### 5. Remove dead code: ncaaf-conferences.ts

File: `src/lib/ncaaf-conferences.ts` (321 lines)

This file is NOT imported anywhere in the codebase. Verify with `grep -r "ncaaf-conferences" src/` — if no imports found, delete the file entirely.

### 6. Import optimization in large lib files

Files over 300 lines in `src/lib/`:
- `nlp-query-parser.ts` (41.6 KB)
- `trend-engine.ts` (32.5 KB)
- `reverse-lookup-engine.ts` (24.2 KB)

Look for broad imports that pull in more than needed (e.g., importing an entire module when only one function is used).

## ALREADY DONE (do NOT repeat)

{{BLOCKLIST}}

## CONTEXT

{{CONTEXT}}
