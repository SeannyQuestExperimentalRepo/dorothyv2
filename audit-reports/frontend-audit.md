# Frontend & UX Audit — TrendLine

**Date:** 2025-02-15  
**Auditor:** Claude (automated)  
**Scope:** src/app/, src/components/, src/lib/utils.ts, tailwind.config.ts, package.json, public/

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH     | 7 |
| MEDIUM   | 12 |
| LOW      | 8 |

Overall the codebase is well-structured with consistent design patterns, good use of React Query, proper loading skeletons for major routes, and a solid dark theme. The main gaps are missing error boundaries on many routes, accessibility shortfalls, missing SEO metadata, and some mobile UX issues.

---

## [SEVERITY: CRITICAL] Missing Error Boundaries on 14 Routes

**File:** src/app/{props,parlays,community,gate,signup,login,pricing,admin,how-it-works,search,nfl,ncaaf,ncaamb,nba}/error.tsx
**What:** 14 route segments have no `error.tsx` file. If a server or client error occurs in these pages, it bubbles up to the root `error.tsx` which provides no route-specific context. The root error boundary exists but the UX is generic.
**Impact:** Users see "Something went wrong" with no context about what page failed. No route-specific retry logic. Pages like `/pricing` (payment flow) and `/signup` (onboarding) failing silently is particularly bad.
**Fix:** Add `error.tsx` to each route segment. Can use a shared factory function to reduce boilerplate:
```tsx
// lib/create-error-page.tsx
export function createErrorPage(label: string) { ... }
```

---

## [SEVERITY: HIGH] Missing Loading States on 10 Routes

**File:** src/app/{props,parlays,community,gate,signup,login,pricing,admin,how-it-works,game}/loading.tsx
**What:** These routes have no `loading.tsx` file. While most of these are client components with their own loading states via React Query, the initial JS bundle load shows nothing — users see a blank page until hydration completes.
**Impact:** On slow connections, users see empty white/dark screen for 1-3 seconds before the page renders. Particularly bad for `/game/[sport]/[homeTeam]/[awayTeam]` which has heavy dynamic imports.
**Fix:** Add skeleton `loading.tsx` files matching each page's layout structure.

---

## [SEVERITY: HIGH] No Per-Page SEO Metadata on Most Routes

**File:** src/app/{trends,props,parlays,odds,search,community,bets,today,nba,admin,gate,signup,login,pricing}/page.tsx
**What:** Only `layout.tsx` (root), `how-it-works/page.tsx`, and the sport browse pages (`nfl`, `ncaaf`, `ncaamb`, `nba`) export metadata. Client component pages (`"use client"`) cannot export metadata — they need a separate `layout.tsx` or a server component wrapper.
**Impact:** Every page shares the same title "TrendLine — Sports Betting Trends Engine". Bad for SEO, bad for browser tab management (users can't distinguish tabs), bad for social sharing.
**Fix:** For `"use client"` pages, either:
1. Add a `layout.tsx` in each route segment that exports metadata, or
2. Convert page wrappers to server components that render a client child, or
3. Use `generateMetadata` in a parent layout.

---

## [SEVERITY: HIGH] Pricing Page Uses useSearchParams Without Suspense Boundary

**File:** src/app/pricing/page.tsx:5
**What:** `useSearchParams()` is called directly in a `"use client"` page without wrapping in `<Suspense>`. In Next.js 14, this causes the entire page to opt out of static rendering and can cause hydration issues. Other pages (login, trends, search) correctly use the Suspense wrapper pattern.
**Impact:** Build warnings, potential hydration mismatch errors, degraded performance.
**Fix:** Wrap the page content in `<Suspense>` like the login and search pages do:
```tsx
export default function PricingPage() {
  return <Suspense fallback={...}><PricingPageInner /></Suspense>;
}
```

---

## [SEVERITY: HIGH] Accessibility — Missing ARIA Labels on Interactive Elements

**File:** Multiple components
**What:** Several interactive elements lack proper ARIA attributes:
- Sport tab button groups (trends, odds, today, bets) have no `role="tablist"` / `role="tab"` / `aria-selected`
- Mobile hamburger menu button in header has no `aria-label` or `aria-expanded`
- Angle cards in trends page use `onClick` on a `<div>` with no `role="button"` or keyboard handling (`onKeyDown`)
- User menu dropdown has no `aria-haspopup` or `aria-expanded`
- Toggle switches (pricing annual/monthly) have no `role="switch"` or `aria-checked`
- Filter `<select>` elements lack associated `<label>` elements (bet-filters.tsx)
**Impact:** Screen reader users cannot navigate the app. Keyboard-only users can't interact with expandable angle cards or dropdown menus.
**Fix:** Add ARIA roles and attributes. For the angle cards, add `role="button"` `tabIndex={0}` and `onKeyDown` handler for Enter/Space. Use `<label htmlFor>` for all form controls.

---

## [SEVERITY: HIGH] Keyboard Navigation — Expandable Cards Not Keyboard Accessible

**File:** src/app/trends/page.tsx:158 (AngleCard), src/components/odds/odds-comparison.tsx (GameOddsCard)
**What:** Clickable `<div>` elements with `onClick` handlers that expand/collapse content are not focusable and don't respond to keyboard events.
**Impact:** Keyboard-only users cannot expand angle details or odds comparison cards.
**Fix:** Add `tabIndex={0}`, `role="button"`, and `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}`.

---

## [SEVERITY: HIGH] Global Error Page Uses Hardcoded Colors Instead of Theme Variables

**File:** src/app/global-error.tsx:24-30
**What:** Uses `text-gray-400`, `bg-blue-600`, `hover:bg-blue-700` instead of the theme's CSS variables (`text-muted-foreground`, `bg-primary`, etc.) used everywhere else in the app.
**Impact:** Visually inconsistent error page that doesn't match the app's teal/dark theme. Users see blue buttons and gray text instead of the expected teal.
**Fix:** Replace with theme classes: `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `hover:bg-primary/90`.

---

## [SEVERITY: HIGH] Add Bet Form — Missing Client-Side Validation

**File:** src/components/bets/add-bet-form.tsx:37-50
**What:** The form submission only checks for truthy values (`!form.homeTeam`, etc.) — no validation on odds format, stake being positive, date format, or line being a valid number. The form silently does nothing if validation fails (no error messages shown).
**Impact:** Users can submit invalid data or click submit and nothing happens with no feedback about what's wrong.
**Fix:** Add Zod schema validation (already a dependency) with inline error messages, similar to the signup form pattern. Show error state on invalid fields.

---

## [SEVERITY: MEDIUM] Mobile Sidebar Hidden But No Alternative

**File:** src/app/layout.tsx:73
**What:** `UpcomingGamesSidebar` is `hidden lg:block` — it disappears entirely on mobile/tablet with no alternative way to access upcoming games.
**Impact:** Mobile users (likely a large portion for a sports betting app) lose access to the upcoming games feature entirely.
**Fix:** Either add a mobile drawer/sheet for upcoming games accessible from the header, or add a dedicated `/games` page linked in mobile nav.

---

## [SEVERITY: MEDIUM] Footer Missing NBA in Sport List

**File:** src/components/layout/footer.tsx:19
**What:** Footer shows "NFL · NCAAF · NCAAMB" but the app now supports NBA. The footer text is hardcoded.
**Impact:** Minor branding inconsistency; users may not realize NBA is supported.
**Fix:** Update to "NFL · NBA · NCAAF · NCAAMB" or make it dynamic.

---

## [SEVERITY: MEDIUM] Parlay Builder — No Validation on Required Fields

**File:** src/app/parlays/page.tsx:137-152
**What:** Parlay legs accept any input including empty strings and NaN values. The `runAnalysis` function catches errors but the input validation is minimal — `pickSide` defaults to `"Leg N"` if empty, `odds` defaults to -110 if not a number.
**Impact:** Users get confusing analysis results if they forget to fill in fields. No feedback about what's required.
**Fix:** Add visual required indicators, validate before analysis, show inline errors for incomplete legs.

---

## [SEVERITY: MEDIUM] Large Bundle — Recharts Imported for Optional Feature

**File:** package.json (recharts: ^3.7.0)
**What:** Recharts (~200KB gzipped) is a dependency but only used in line-movement-chart.tsx (matchup page) and potentially stats charts. It's dynamically imported via `next/dynamic` which is good, but it's still in the main bundle's dependency tree.
**Impact:** Increased install size. The dynamic import mitigates runtime impact but the package still adds to `node_modules` and can affect tree-shaking.
**Fix:** This is acceptable given the dynamic import. Consider lighter alternatives (e.g., uPlot, lightweight-charts) only if bundle size becomes a concern.

---

## [SEVERITY: MEDIUM] Puppeteer in devDependencies — Scraping Tools in Frontend Package

**File:** package.json:51-53
**What:** `puppeteer`, `puppeteer-extra`, and `puppeteer-extra-plugin-stealth` are in devDependencies. These are large packages (~300MB+ with Chromium) meant for scraping, not for the Next.js frontend.
**Impact:** Bloated `node_modules`, slow `npm install` for all developers, potential security surface.
**Fix:** Move scraping scripts to a separate package/workspace, or at minimum document why these are here. If only used for E2E tests, Playwright (already installed) covers that.

---

## [SEVERITY: MEDIUM] Inconsistent Sport Tab Components — Repeated Pattern Not Extracted

**File:** src/app/today/page.tsx, src/app/odds/page.tsx, src/app/trends/page.tsx, src/app/bets/page.tsx
**What:** The sport selector tabs (`SPORTS.map(s => <button>...)`) are reimplemented in 4+ places with slight variations. Same visual pattern, different state management.
**Impact:** Inconsistent tab styles across pages (some use `px-3.5`, others `px-4`; some have `first:rounded-l-lg`, etc.). Bug fixes must be applied in multiple places.
**Fix:** Extract a `<SportTabs sport={sport} onChange={setSport} sports={[...]} />` component.

---

## [SEVERITY: MEDIUM] Game Matchup Page — No Loading Skeleton

**File:** src/app/game/[sport]/[homeTeam]/[awayTeam]/page.tsx
**What:** No `loading.tsx` in `src/app/game/`. The page is a `"use client"` component that fetches data via hooks. During initial load, users see nothing.
**Impact:** Users clicking on a game from the sidebar or odds page see a blank screen until data loads.
**Fix:** Add `src/app/game/loading.tsx` with matchup header skeleton + section placeholders.

---

## [SEVERITY: MEDIUM] Props Page — NFL-Only Stat Options, No Sport Context

**File:** src/app/props/page.tsx:12-28
**What:** `STAT_OPTIONS` is hardcoded to NFL stats (passing_yards, rushing_yards, etc.) and `EXAMPLE_QUERIES` are all NFL players. There's no sport selector, yet the app supports NBA, NCAAMB, etc.
**Impact:** Users looking for NBA prop analysis (points, rebounds, assists) have no relevant stat options. The page appears NFL-only.
**Fix:** Add a sport selector and change stat options dynamically per sport. Add NBA/NCAAMB example queries.

---

## [SEVERITY: MEDIUM] Community Page — No Pagination

**File:** src/app/community/page.tsx:21
**What:** `fetchPublicTrends` fetches all public trends with no limit or pagination. As the community grows, this becomes a performance issue.
**Impact:** Slow page loads as more users share trends. Eventually could hit API/DB timeouts.
**Fix:** Add cursor-based pagination with "Load More" or infinite scroll.

---

## [SEVERITY: MEDIUM] Missing `aria-label` on Icon-Only Buttons

**File:** src/components/layout/header.tsx (search icon button), src/components/bets/add-bet-form.tsx (close "✕" button), src/app/parlays/page.tsx (remove leg "X" button)
**What:** Buttons that contain only icons or symbols (✕, search icon, remove icon) have no accessible label.
**Impact:** Screen readers announce these as "button" with no description of their function.
**Fix:** Add `aria-label="Close"`, `aria-label="Search"`, `aria-label="Remove leg"` respectively.

---

## [SEVERITY: MEDIUM] ErrorBoundary Component Exists But Is Never Used

**File:** src/components/error-boundary.tsx
**What:** A well-implemented React class-based `ErrorBoundary` component exists but is never imported or used anywhere in the app. The app relies exclusively on Next.js `error.tsx` files.
**Impact:** No wasted runtime impact, but it's dead code. Also, sub-component errors (e.g., a single card in a list crashing) take down the entire route instead of being isolated.
**Fix:** Either remove the file or use it to wrap individual sections (e.g., wrap each `GamePickCard` or `OddsComparison` in an `ErrorBoundary` for graceful degradation).

---

## [SEVERITY: LOW] `cn()` Utility Defined But Rarely Used

**File:** src/lib/utils.ts:1-5
**What:** The `cn()` helper (clsx + twMerge) is defined but most components concatenate classNames with template literals instead. This means className conflicts aren't being resolved by tailwind-merge.
**Impact:** Potential className conflicts when composing styles, though none observed currently.
**Fix:** Gradually adopt `cn()` for conditional class composition, especially in reusable components.

---

## [SEVERITY: LOW] Home Page Server Component Catches Errors Silently

**File:** src/app/page.tsx:40
**What:** `getStats()` catches all errors and returns `null`, rendering the page without stats. No logging of what went wrong.
**Impact:** If the database is down, the homepage renders fine but with placeholder data — no alert or logging.
**Fix:** Add `console.error` or Sentry capture in the catch block. Consider showing a subtle "stats unavailable" indicator.

---

## [SEVERITY: LOW] Duplicate Google OAuth SVG

**File:** src/app/signup/page.tsx:101-107, src/app/login/page.tsx:51-57
**What:** The Google logo SVG is duplicated verbatim across signup and login pages.
**Impact:** Minor code duplication, maintenance burden.
**Fix:** Extract to a `<GoogleIcon />` component or shared SVG file.

---

## [SEVERITY: LOW] Admin Page — SPORTS Array Missing NBA

**File:** src/app/admin/page.tsx:107
**What:** `const SPORTS = ["NCAAMB", "NFL", "NCAAF"]` — NBA is missing from admin quick actions.
**Impact:** Admin can't regenerate or manage NBA picks from the dashboard.
**Fix:** Add `"NBA"` to the SPORTS array.

---

## [SEVERITY: LOW] No `rel="noopener"` on External Links

**File:** Various (if any external links exist)
**What:** While Next.js `Link` component handles internal routing, any `<a>` tags with `target="_blank"` should have `rel="noopener noreferrer"`. No instances found in current code, but worth noting for future additions.
**Impact:** None currently.
**Fix:** N/A — preventive note.

---

## [SEVERITY: LOW] PWA Manifest Missing Screenshots and Shortcuts

**File:** public/manifest.json
**What:** The manifest has good basics but is missing `screenshots` (required for PWA install prompt on Android) and `shortcuts` (quick actions from home screen icon).
**Impact:** Android users may not get the "Add to Home Screen" install banner. No quick shortcuts to Today's Sheet or Search.
**Fix:** Add `screenshots` array with at least one mobile and one desktop screenshot. Add `shortcuts` for key pages.

---

## [SEVERITY: LOW] Inconsistent Date Formatting

**File:** src/app/today/page.tsx:18 vs src/components/bets/bet-row.tsx:24
**What:** Today page formats dates as "Sunday, February 15, 2026". Bet rows use "Feb 15". Saved trends use `toLocaleDateString()` with default locale. No shared date formatting utility.
**Impact:** Minor UX inconsistency.
**Fix:** Create shared date formatting utils in `src/lib/utils.ts`.

---

## [SEVERITY: LOW] Pricing Page Toggle Switch — Not a Standard Input

**File:** src/app/pricing/page.tsx:83-95
**What:** The annual/monthly toggle is a custom `<button>` styled as a switch but doesn't use `<input type="checkbox">` or proper switch semantics.
**Impact:** Reduced accessibility; screen readers don't announce the toggle state.
**Fix:** Add `role="switch"` and `aria-checked={annual}` to the button, or use a proper checkbox input.

---

## Positive Observations

1. **React Query usage is excellent** — proper staleTime/gcTime config, consistent hook patterns, good cache invalidation
2. **Loading skeletons** exist for all major data-driven routes (today, odds, bets, search, sport pages)
3. **Error boundaries** on key routes (today, odds, bets, trends, game) with Sentry integration in global-error
4. **Dynamic imports** used well for heavy components (Recharts, sidebar, matchup panels)
5. **Form validation** on signup page uses Zod with inline errors — good pattern to replicate
6. **Auth flow** handles edge cases well (open redirect prevention, auto-sign-in after signup)
7. **Design system** is consistent with CSS variables, clean dark theme, good use of tailwind
8. **PWA support** with service worker, offline banner, push notifications
9. **Open redirect prevention** in login page callbackUrl handling
