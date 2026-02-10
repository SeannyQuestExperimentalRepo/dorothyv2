# Phase 5: Runtime UX Optimization

You are optimizing a Next.js 14 app's runtime performance (TanStack Query caching, Suspense streaming, prefetching). Make ONE targeted change per iteration.

## STRICT RULES

- ONLY modify existing files inside `src/`
- DO NOT create new files unless adding a Suspense boundary requires a loading component
- Make exactly ONE optimization per iteration
- Run `npm run build` after your change to verify it compiles
- If build fails, revert immediately with `git checkout -- .`
- Write a one-line summary of what you changed

## TARGETS (pick ONE per iteration)

### 1. Increase TanStack Query staleTime to 10 minutes

File: `src/app/providers.tsx` (23 lines)

Current config (around line 10):
```
staleTime: 5 * 60 * 1000   // 5 minutes
gcTime: 10 * 60 * 1000     // 10 minutes
retry: 1
```

Change to:
```
staleTime: 10 * 60 * 1000  // 10 minutes — data only changes on daily cron
gcTime: 30 * 60 * 1000     // 30 minutes
retry: 1
refetchOnWindowFocus: false // data doesn't change during a session
```

This is safe because game data only updates via a daily cron job, not in real-time.

### 2. Set refetchOnWindowFocus: false on specific hooks

Check hook files in `src/hooks/` for TanStack Query hooks (useQuery calls). For any that fetch game/trend data, add `refetchOnWindowFocus: false` to the query options if not already set.

Files to check:
- `src/hooks/*.ts` — look for `useQuery` calls

### 3. Increase gcTime on trend-specific queries

Trend data is expensive to compute and rarely changes. For any useQuery hooks that fetch from `/api/trends/*`, increase `gcTime` to 30 minutes:
```
gcTime: 30 * 60 * 1000
```

### 4. Add explicit cache config to matchup and upcoming hooks

Look for hooks that call `/api/games/matchup` or `/api/games/upcoming` and ensure they have explicit:
```
staleTime: 10 * 60 * 1000,
gcTime: 30 * 60 * 1000,
refetchOnWindowFocus: false,
```

### 5. Add Suspense boundary to homepage

File: `src/app/page.tsx` or `src/components/home/home-content.tsx`

If the homepage fetches database stats at render time, wrap the data-dependent section in a `<Suspense fallback={...}>` boundary to enable streaming. The fallback can be a simple loading skeleton.

### 6. Add prefetch hints for common navigation

Check if Link components on the homepage or nav use `prefetch={true}` (or rely on default prefetching). For the most-visited routes (/nfl, /search, /trends), ensure prefetching is enabled.

## ALREADY DONE (do NOT repeat)

{{BLOCKLIST}}

## CONTEXT

{{CONTEXT}}
