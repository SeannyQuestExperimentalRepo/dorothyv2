# Trendline Architecture & Code Quality Audit

**Date:** 2026-02-15
**Auditor:** Automated Code Audit
**Codebase:** /home/seannyquest/.openclaw/workspace/trendline

---

## Executive Summary

Trendline is a well-structured Next.js 14 sports betting analytics app with ~22K lines of library code, a comprehensive Prisma schema, and solid security fundamentals (timing-safe comparisons, rate limiting, CSP headers). The main risks are: in-memory-only rate limiting/caching that won't work across serverless instances, missing unit tests for all business logic, inconsistent error tracking (88 raw console.error calls vs 3 trackError calls in API routes), and a 3,090-line pick-engine that's the critical revenue path with zero test coverage.

---

## [SEVERITY: CRITICAL] No Unit Tests for Business Logic

**File:** tests/ (only e2e/ exists)
**What:** The entire `src/lib/` directory (22K lines) has zero unit tests. Tests are limited to 5 Playwright E2E specs that only check if pages load. The pick engine (3,090 lines), trend engine (1,130 lines), NLP parser (1,445 lines), and all financial calculation logic (odds-to-payout, profit calculation) are completely untested.
**Impact:** Regression bugs in pick generation, betting P&L calculations, or trend queries will ship silently. The duplicated `oddsToPayoutMultiplier` and `calculateProfit` functions in `api/bets/route.ts` and `api/bets/[id]/route.ts` could diverge without anyone noticing.
**Fix:** Add Jest/Vitest with unit tests for: (1) `oddsToPayoutMultiplier` / `calculateProfit`, (2) pick engine scoring logic, (3) trend engine filter predicates, (4) NLP query parser, (5) subscription tier access control. Start with pure functions — they're trivial to test.

---

## [SEVERITY: CRITICAL] In-Memory Rate Limiting Doesn't Work on Serverless

**File:** src/lib/rate-limit.ts
**What:** Rate limiting uses an in-memory `Map`. On Vercel, each serverless invocation gets its own memory space. A user hitting different instances bypasses all limits entirely. The code comments acknowledge this ("best effort") but it's deployed as the sole defense.
**Impact:** Auth brute-force attacks (10/min limit on login) are trivially bypassable. Heavy query routes (trends, picks) have no real protection against abuse. At scale, this is a DoS vector and API cost amplifier (Odds API, OpenAI calls).
**Fix:** Replace with `@upstash/ratelimit` + `@upstash/redis` (as the code comments already suggest). This is a ~30-minute swap since the `createRateLimiter` interface is already clean.

---

## [SEVERITY: CRITICAL] In-Memory Game Cache Doesn't Work on Serverless

**File:** src/lib/trend-engine.ts:1042-1096
**What:** The `sportCache` Map caches all historical games in memory. On Vercel, cold starts load everything from DB, warm instances may have stale data, and there's no TTL — data stays cached until `clearGameCache()` is called (only by the cron job). Different instances serve different data.
**Impact:** Users see inconsistent results depending on which instance they hit. After data updates (game completions, new odds), some requests return stale data until their instance happens to restart.
**Fix:** Move to Redis or Vercel KV with a TTL (e.g., 15 minutes). Alternatively, use ISR/`unstable_cache` from Next.js with revalidation tags.

---

## [SEVERITY: HIGH] Inconsistent Error Tracking — Most Errors Skip Sentry

**File:** src/app/api/**/*.ts, src/lib/error-tracking.ts
**What:** `error-tracking.ts` provides `trackError()` which routes to Sentry, but only 3 API route files use it. The other 88 error paths use bare `console.error()`, meaning errors in production are lost to ephemeral Vercel logs. Critical paths like Stripe webhooks, pick generation, and bet grading log to console only.
**Impact:** Production errors go undetected. No alerting on failed cron jobs (except the Sentry cron check-in on daily-sync), failed Stripe webhooks, or broken pick generation.
**Fix:** Replace all `console.error("[route]", err)` with `trackError(err, { route: "..." })`. A codemod or ESLint rule (`no-console` with `allow: ["warn"]`) would enforce this.

---

## [SEVERITY: HIGH] Duplicated Business Logic Across Files

**File:** src/app/api/bets/route.ts:29-38, src/app/api/bets/[id]/route.ts:19-28
**What:** `oddsToPayoutMultiplier()` and `calculateProfit()` are copy-pasted between two route files with identical implementations. `todayET()` is duplicated in at least 4 files. `VALID_SPORTS` arrays are redefined in ~10 route files (some include NBA, some don't).
**Impact:** Bug fixes or formula changes must be applied in multiple places. The inconsistent VALID_SPORTS arrays mean some routes accept NBA and others don't, creating confusing 400 errors.
**Fix:** Extract shared functions to `src/lib/utils.ts` or `src/lib/betting-math.ts`. Export `VALID_SPORTS` from `trend-engine.ts` (it already exists there) and use it everywhere.

---

## [SEVERITY: HIGH] Pick Engine is 3,090 Lines in One File

**File:** src/lib/pick-engine.ts
**What:** The single largest file combines: game loading, KenPom data fetching, spread/OU/prop pick scoring, confidence assignment, pick grading, bet grading, and daily pick orchestration. It also has the only `as any` cast in the codebase (line 2890).
**Impact:** Extremely hard to maintain, test, or review. Changes to grading logic risk breaking scoring logic. The `as any` cast at line 2890 suggests a dynamic Prisma model access pattern that bypasses type checking.
**Fix:** Split into modules: `pick-scoring.ts` (pure scoring functions), `pick-grading.ts` (result grading), `pick-orchestrator.ts` (daily generation flow). Replace `as any` with a sport-keyed lookup object that maps to typed Prisma methods.

---

## [SEVERITY: HIGH] next-auth Uses Unstable Beta Version

**File:** package.json
**What:** `next-auth: ^5.0.0-beta.30` — this is a pre-release beta. The `^` range means `npm install` could pull any beta.30+ version with breaking changes.
**Impact:** Builds could break unpredictably. Beta APIs may change. Security patches may not be backported to beta branches.
**Fix:** Pin to exact version: `"next-auth": "5.0.0-beta.30"`. Monitor for stable v5 release and upgrade when available. Alternatively, add `package-lock.json` to version control (it appears to exist).

---

## [SEVERITY: HIGH] Stripe Webhook Has No Idempotency Protection

**File:** src/app/api/stripe/webhook/route.ts
**What:** Webhook handlers for `checkout.session.completed` and `customer.subscription.deleted` don't check if the event was already processed. Stripe retries webhooks on failure.
**Impact:** Duplicate subscription activations, double role changes, or race conditions where a user's role flips between FREE and PREMIUM.
**Fix:** Store processed event IDs in a `StripeEvent` table (or check `subscriptionId` + status before updating). Use Prisma transactions for the role update.

---

## [SEVERITY: MEDIUM] Environment Variables Accessed Outside Config Module

**File:** Multiple (see grep results — 24 direct `process.env` accesses outside config.ts)
**What:** Despite having a centralized `config.ts` with validation, many files access `process.env` directly: `odds-api-sync.ts`, `kenpom.ts`, `email.ts`, `cfbd.ts`, admin routes, notification routes. These bypass the startup validation.
**Impact:** Missing env vars cause runtime crashes instead of startup failures. No single source of truth for what env vars exist.
**Fix:** Add all env vars to `config.ts` and import from there. For optional vars (VAPID keys, RESEND_API_KEY), use the non-required overload.

---

## [SEVERITY: MEDIUM] No Pagination on Several List Endpoints

**File:** src/app/api/picks/today/route.ts, src/app/api/odds/route.ts
**What:** The picks/today endpoint returns all picks for a date without pagination. The odds endpoint returns all games. As more sports are added, response sizes will grow unbounded.
**Impact:** Slow responses, high bandwidth usage on mobile, potential timeout on large result sets.
**Fix:** Add `limit` and `offset` params (the bets endpoint already has this pattern — reuse it).

---

## [SEVERITY: MEDIUM] CSP Allows unsafe-inline and unsafe-eval

**File:** next.config.mjs:20-21
**What:** The Content Security Policy includes `'unsafe-inline' 'unsafe-eval'` for scripts. This significantly weakens XSS protection.
**Impact:** XSS vulnerabilities can execute arbitrary JavaScript despite having a CSP.
**Fix:** Use nonces for inline scripts (Next.js supports this with `experimental.sri`). Remove `'unsafe-eval'` — it's likely only needed for dev mode sourcemaps.

---

## [SEVERITY: MEDIUM] Puppeteer in devDependencies — Potential Bundle Bloat

**File:** package.json (devDependencies)
**What:** `puppeteer`, `puppeteer-extra`, and `puppeteer-extra-plugin-stealth` are in devDependencies. These are 300MB+ packages. While devDeps aren't included in production builds, they slow CI installs and suggest scraping activity that may violate ToS.
**Impact:** Slow CI builds. If accidentally moved to dependencies, Vercel builds would fail (Chromium binary too large for serverless).
**Fix:** Move to a separate `scripts/package.json` for scraping scripts, or document why they're needed.

---

## [SEVERITY: MEDIUM] Cron Job Has 5-Minute Max Runtime but 300s maxDuration

**File:** src/app/api/cron/daily-sync/route.ts
**What:** `maxDuration = 300` (5 minutes) for the cron endpoint. This runs: refresh games for 3 sports, sync completed games, generate picks for all sports, grade picks, grade bets, evaluate trends, clear caches. Any single step hanging blocks all subsequent steps.
**Impact:** If ESPN API is slow or pick generation takes long for a busy day (15+ games), later steps (grading, trend evaluation) get skipped.
**Fix:** Split into independent cron jobs: (1) refresh + sync at 11 UTC, (2) generate picks at 11:30 UTC, (3) grade at 17 UTC. Use separate Vercel cron entries.

---

## [SEVERITY: MEDIUM] No Database Connection Pooling Configuration

**File:** src/lib/db.ts, prisma/schema.prisma
**What:** Prisma client uses default connection settings. On Vercel serverless with potentially hundreds of concurrent invocations, each opens its own DB connection. The schema uses Neon (PostgreSQL), which has connection limits.
**Impact:** Connection exhaustion under load. Neon free tier allows 100 connections; serverless can easily exceed this.
**Fix:** Use Neon's connection pooler URL (pgbouncer) for `DATABASE_URL` and configure `connection_limit=1` in the Prisma datasource. Ensure the pooler endpoint is being used (check if `-pooler` is in the hostname).

---

## [SEVERITY: MEDIUM] OpenAI Dependency for NLP Parser

**File:** src/lib/nlp-query-parser.ts:652, package.json
**What:** The `openai` package (6.18.0) is a production dependency used for natural language query parsing. This adds ~2MB to the bundle and makes search functionality dependent on an external API.
**Impact:** If OpenAI is down or rate-limited, search breaks. Each search query costs money. Bundle size increases for all routes.
**Fix:** Consider a fallback to the regex-based parser when OpenAI is unavailable. Tree-shake or lazy-import the OpenAI client to avoid bundle bloat in routes that don't use it.

---

## [SEVERITY: LOW] TypeScript Strict Mode is ON — Good

**File:** tsconfig.json
**What:** `"strict": true` is enabled. Only 1 `as any` cast found in the entire codebase (pick-engine.ts:2890). TypeScript config is well-configured.
**Impact:** Positive finding. Type safety is solid.
**Fix:** Address the single `as any` cast.

---

## [SEVERITY: LOW] Sentry Integration is Comprehensive

**File:** sentry.*.config.ts, src/app/api/cron/daily-sync/route.ts
**What:** Sentry is configured for client, server, and edge. Source maps are uploaded. Replay is configured for error sessions only. Cron monitoring with check-ins is set up for daily-sync. Metrics API is used for custom gauges.
**Impact:** Positive finding. Error tracking infrastructure is solid — it's the adoption in route handlers that needs work (see HIGH finding above).
**Fix:** N/A (increase adoption per the HIGH finding).

---

## [SEVERITY: LOW] E2E Tests Are Shallow

**File:** tests/e2e/*.spec.ts
**What:** 5 E2E test files exist but only verify pages load and forms render. No tests actually submit data, verify API responses, or test error states. No tests for the cron job, Stripe webhook, or pick generation.
**Impact:** E2E tests provide false confidence — they'd pass even if the backend was completely broken (as long as pages render).
**Fix:** Add API-level integration tests using Playwright's `request` context or a separate test runner (Vitest + MSW for mocking).

---

## [SEVERITY: LOW] .vercelignore Missing

**File:** (doesn't exist)
**What:** No `.vercelignore` file to exclude scripts/, docs/, tests/, and backtest data from the Vercel deployment.
**Impact:** Larger deployment artifact, slower deploys. Scripts and test files are included unnecessarily.
**Fix:** Create `.vercelignore` with: `scripts/`, `tests/`, `docs/`, `BACKTEST-RESULTS.md`, `prisma/seed-data/`.

---

## [SEVERITY: LOW] Next.js 14.2.35 — Check for Security Updates

**File:** package.json
**What:** Running Next.js 14.2.35. Next.js 15 has been out and 14.x may not receive security patches indefinitely.
**Impact:** Low risk currently, but worth monitoring.
**Fix:** Plan migration to Next.js 15 when stable. Pin current version for now.

---

## Scalability Assessment

| Users | What Breaks | Mitigation |
|-------|------------|------------|
| 100 | Nothing — current setup works fine | — |
| 1,000 | In-memory rate limits ineffective; DB connections may spike during peak (game days) | Add Redis rate limiting; use Neon pooler |
| 10,000 | Game cache inconsistency across instances; Odds API costs spike; trend queries slow (loading all historical games per request) | Move cache to Redis; add DB-level query filtering instead of loading all games; paginate aggressively |
| 50,000+ | Prisma query bottlenecks on KenPom joins; push notification fan-out blocks cron; single cron job times out | Batch push notifications; split cron into pipeline; add read replicas; pre-compute daily trends |

---

## Summary of Findings by Severity

| Severity | Count | Key Items |
|----------|-------|-----------|
| CRITICAL | 3 | No unit tests, in-memory rate limiting, in-memory caching |
| HIGH | 5 | Inconsistent error tracking, code duplication, 3K-line god file, unstable next-auth beta, Stripe idempotency |
| MEDIUM | 6 | Env var access, no pagination, CSP weakness, puppeteer bloat, cron timeout risk, DB pooling |
| LOW | 4 | TS strict (positive), Sentry (positive), shallow E2E tests, missing .vercelignore |

**Recommended Priority:**
1. Add Redis-based rate limiting (1 day)
2. Add unit tests for betting math + pick scoring (2 days)
3. Replace console.error with trackError across all routes (1 hour codemod)
4. Split pick-engine.ts into modules (1 day)
5. Move game cache to Redis/KV (1 day)
