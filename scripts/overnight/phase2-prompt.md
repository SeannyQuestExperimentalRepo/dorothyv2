# Phase 2: API & Database Optimization

You are optimizing a Next.js 14 app (App Router, Prisma/PostgreSQL, TanStack Query). Make ONE targeted change per iteration to improve API response times.

## STRICT RULES

- ONLY modify existing files inside `src/`
- DO NOT create new files, Dockerfiles, or scripts
- Make exactly ONE optimization per iteration
- Run `npm run build` after your change to verify it compiles
- If build fails, revert immediately with `git checkout -- .`
- Write a one-line summary of what you changed

## TARGETS (pick ONE per iteration)

### 1. Add Cache-Control headers to API routes missing them

These routes have NO Cache-Control header set:

- **`src/app/api/games/matchup/route.ts`** (~485 lines) — Add `Cache-Control: s-maxage=300, stale-while-revalidate=600` to the NextResponse
- **`src/app/api/trends/parse/route.ts`** (~72 lines) — Add `Cache-Control: s-maxage=60, stale-while-revalidate=300` (NLP parsing is deterministic)
- **`src/app/api/trends/players/route.ts`** — Check if Cache-Control is set; add if missing
- **`src/app/api/trends/props/route.ts`** — Check if Cache-Control is set; add if missing

NOTE: `trends/route.ts` and `upcoming/route.ts` ALREADY have Cache-Control. Do NOT touch them.

### 2. Parallelize sequential queries in matchup route

File: `src/app/api/games/matchup/route.ts`

Look for sequential `await` calls that could run in parallel with `Promise.all`. For example, if there are multiple independent data-fetching calls (like loading games, getting recent stats, building trends) that don't depend on each other, wrap them in `Promise.all([...])`.

### 3. Trim response payloads

File: `src/app/api/trends/route.ts` or `src/app/api/games/matchup/route.ts`

Look for response objects that include fields the frontend doesn't use. Common wins:
- Filter out empty arrays/objects from responses
- Remove internal-only fields (like raw DB IDs) from API responses
- Omit null/undefined optional fields

### 4. Push filters to database WHERE clauses

Look for patterns where data is fetched broadly and then filtered in JavaScript. Moving the filter into the Prisma `where` clause reduces data transfer and processing.

Check `src/app/api/` routes for `.filter()` calls on query results that could be WHERE conditions instead.

### 5. Batch team name resolution queries

If multiple `team.findFirst()` calls resolve team names one at a time, batch them into a single `team.findMany({ where: { name: { in: [...] } } })` call.

## ALREADY DONE (do NOT repeat)

{{BLOCKLIST}}

## CONTEXT

{{CONTEXT}}
