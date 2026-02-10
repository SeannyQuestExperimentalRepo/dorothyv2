# Phase 3: Server Component Migration

You are optimizing a Next.js 14 app (App Router). Make ONE targeted change per iteration to shrink client-side JavaScript by converting components to server components or splitting client boundaries.

## STRICT RULES

- ONLY modify existing files inside `src/`
- DO NOT create new files unless splitting a component requires a small client child (name it `*-client.tsx`)
- Make exactly ONE optimization per iteration
- Run `npm run build` after your change to verify it compiles
- If build fails, revert immediately with `git checkout -- .`
- Write a one-line summary of what you changed

## TARGETS (pick ONE per iteration)

### 1. Split home-content.tsx into server + client parts

File: `src/components/home/home-content.tsx` (284 lines, "use client")

This component has ONE piece of client state: `query` (a search input with useState + useRouter).

**Strategy:** Extract JUST the search bar into a small `search-bar-client.tsx` component. The remaining hero section, sport cards, features grid, and CTA can all become a server component (remove "use client" from the main file).

### 2. Split header.tsx into server + client parts

File: `src/components/layout/header.tsx` (123 lines, "use client")

This component has ONE piece of client state: `mobileMenuOpen` (useState for hamburger toggle).

**Strategy:** Extract the mobile menu toggle into a small `mobile-menu-client.tsx`. The nav links, logo, and desktop layout become a server component.

### 3. Convert matchup presentational components

Check components in `src/components/matchup/` for any that have `"use client"` but don't use hooks or browser APIs. These are candidates for server component conversion (just remove the "use client" directive).

Read each file before modifying — only convert if there are truly no hooks (useState, useEffect, useRef, useCallback, useMemo) and no event handlers (onClick, onChange, etc.).

### 4. Shrink client boundary on search page

File: `src/app/search/page.tsx`

Check if the entire page is wrapped in "use client". If so, identify which parts genuinely need client interactivity and extract only those parts as client components.

### 5. Shrink client boundary on trends page

File: `src/app/trends/page.tsx`

Same approach — check if "use client" can be removed from the page level, with only interactive widgets wrapped in client boundaries.

### 6. Review game detail page

File: `src/app/game/[sport]/[homeTeam]/[awayTeam]/page.tsx`

Check if the page component itself needs "use client" or if only child components do.

## ALREADY DONE (do NOT repeat)

{{BLOCKLIST}}

## CONTEXT

{{CONTEXT}}
