# Trendline Security & Auth Audit

**Date:** 2026-02-15
**Auditor:** Automated security review
**Scope:** All API routes, auth, middleware, Stripe, cron, Prisma schema

---

## Executive Summary

The codebase demonstrates **strong security fundamentals**: timing-safe comparisons throughout, proper Stripe webhook verification, Zod validation on complex endpoints, rate limiting on all routes, and careful Prisma usage (no raw SQL). The main issues are medium/low severity — mostly around the site password gate mechanism, missing rate limits on a couple endpoints, and minor input validation gaps.

**Critical:** 0 | **High:** 1 | **Medium:** 5 | **Low:** 6

---

## [SEVERITY: HIGH] Site Password Gate Bypass — Cookie Value is Static "granted"

**File:** `src/app/api/gate/route.ts:26` + `src/middleware.ts:25`

**What:** The site gate sets `site_access=granted` as a plain cookie. The middleware checks `req.cookies.get("site_access")?.value === "granted"`. Anyone who knows (or guesses) this value can bypass the gate by manually setting the cookie — no password needed.

**Impact:** The entire site password gate can be bypassed by setting `document.cookie = "site_access=granted"` or via browser dev tools / curl. This defeats the purpose of the gate entirely.

**Fix:** Sign the cookie with an HMAC (similar to admin tokens). Store `timestamp:hmac(timestamp, SITE_PASSWORD || AUTH_SECRET)` and verify the signature in middleware. Alternatively, use a random nonce stored server-side (session-backed).

---

## [SEVERITY: MEDIUM] Notifications Subscribe Endpoint Missing Rate Limiting

**File:** `src/app/api/notifications/subscribe/route.ts`

**What:** The `POST /api/notifications/subscribe` endpoint has auth but no rate limiting. An authenticated user could spam endpoint registrations.

**Impact:** A malicious authenticated user could flood the PushSubscription table by rapidly creating subscriptions with different endpoints, causing DB bloat and potentially slowing notification sends.

**Fix:** Add `applyRateLimit(req, authLimiter, session.user.id)` after the auth check.

---

## [SEVERITY: MEDIUM] Admin Password Compared Without Normalization in auth.ts

**File:** `auth.ts:33`

**What:** The admin password comparison uses `password.trim() === adminPassword.trim()` — a simple string equality check, not a timing-safe comparison. The admin login API at `/api/admin/login` correctly uses `timingSafeEqual`, but the NextAuth credentials provider does not.

**Impact:** Theoretical timing side-channel on the NextAuth login flow for the admin account. Practical exploitability is low (bcrypt comparison for regular users dominates timing), but it's inconsistent with the otherwise careful timing-safe approach used elsewhere.

**Fix:** Use `timingSafeEqual(Buffer.from(password.trim()), Buffer.from(adminPassword.trim()))` with a length pre-check, matching the pattern in `/api/admin/login`.

---

## [SEVERITY: MEDIUM] Games Refresh Endpoint Allows Any Authenticated User to Trigger

**File:** `src/app/api/games/refresh/route.ts:30-40`

**What:** `POST /api/games/refresh` accepts either CRON_SECRET or *any* authenticated user session. This means any logged-in FREE user can trigger ESPN data refreshes at will.

**Impact:** A malicious user could hammer this endpoint to exhaust ESPN API rate limits or cause excessive DB writes. The `publicLimiter` (30/min) provides some protection, but it's still more permissive than intended.

**Fix:** Restrict to CRON_SECRET or ADMIN role: `if (!hasCronAuth && session.user.role !== 'ADMIN')`.

---

## [SEVERITY: MEDIUM] Middleware Excludes All API Routes from Auth Checks

**File:** `src/middleware.ts:53`

**What:** The middleware matcher `/((?!api|_next/static|_next/image|favicon.ico|monitoring).*)` explicitly excludes all `/api/` routes from middleware processing. This means the site password gate does NOT apply to API routes.

**Impact:** If the site gate is used to restrict pre-launch access, all API endpoints remain publicly accessible. Public data endpoints (trends, picks, odds) work without the gate password. This may be intentional (API routes have their own auth), but it means the gate only protects page views, not data access.

**Fix:** If the gate should cover API routes too, remove `api` from the matcher exclusion and add gate checks to API routes (or a shared middleware helper). If intentional, document this decision.

---

## [SEVERITY: MEDIUM] Saved Trend Deletion Not Implemented — No Way to Remove Trends

**File:** `src/app/api/trends/saved/route.ts`

**What:** The saved trends endpoint only has GET and POST. There's no DELETE handler, so users can't remove their saved trends via API. More importantly, there's no ownership check infrastructure visible for a future DELETE — make sure when added, it verifies `userId === session.user.id`.

**Impact:** Users accumulate trends they can't delete. When DELETE is added, an authorization check could be missed.

**Fix:** Add a DELETE handler (or a `DELETE /api/trends/saved/[id]` route) with ownership verification: `where: { id, userId: session.user.id }`.

---

## [SEVERITY: LOW] In-Memory Rate Limiter Resets Per Serverless Instance

**File:** `src/lib/rate-limit.ts:1-10`

**What:** The rate limiter uses an in-memory Map. On Vercel, each serverless invocation gets its own instance, so rate limits are not shared across instances. The code acknowledges this ("best effort").

**Impact:** Rate limiting is ineffective under load — a determined attacker hitting different instances bypasses limits entirely. The auth flow limiter (login/signup brute force protection) is particularly affected.

**Fix:** Migrate to `@upstash/ratelimit` + `@upstash/redis` for distributed rate limiting, especially for `authFlowLimiter`. The code comment already suggests this.

---

## [SEVERITY: LOW] Error Responses Occasionally Log Full Error Objects to Console

**File:** Multiple API routes (e.g., `src/app/api/cron/daily-sync/route.ts`, `auth.ts:42`)

**What:** Several routes `console.error` full error objects including stack traces. While these don't leak to the client (error responses are generic), they may appear in Vercel logs which could be accessed by team members.

**Impact:** Minimal — errors stay server-side. But stack traces in logs could reveal internal paths and library versions to anyone with log access.

**Fix:** Consider structured logging that redacts sensitive fields. Current client-facing error messages are already generic, which is good.

---

## [SEVERITY: LOW] No CSRF Protection on State-Changing POST Endpoints

**File:** Multiple API routes (bets, saved trends, checkout, etc.)

**What:** Next.js API routes don't have built-in CSRF protection. State-changing POSTs (create bet, save trend, checkout) rely on session cookies which could be sent by cross-origin forms.

**Impact:** Low in practice — modern browsers' SameSite=Lax cookie default mitigates most CSRF. The admin cookie uses SameSite=strict. NextAuth cookies default to Lax. JSON body requirement adds another layer (forms can't send JSON without JavaScript, and CORS blocks cross-origin fetch).

**Fix:** The current SameSite defaults + JSON-only body parsing provide adequate protection. For defense in depth, consider adding a CSRF token or checking the `Origin` header matches the app domain.

---

## [SEVERITY: LOW] Public Trends Leaks User Names and Avatar URLs

**File:** `src/app/api/trends/public/route.ts:42-46`

**What:** The public trends endpoint returns `user.name` and `user.image` for all public trends. This is likely intentional for the "community leaderboard" feature.

**Impact:** Minimal — users opt-in by marking trends as public. But it exposes their display name and avatar to unauthenticated users.

**Fix:** Consider this intentional. If privacy is a concern, allow users to set a display name separate from their account name, or anonymize by default.

---

## [SEVERITY: LOW] Picks Today Endpoint Allows Date Parameter Without Auth Boundary

**File:** `src/app/api/picks/today/route.ts:51`

**What:** The `date` query parameter allows fetching picks for any date (past or future). While picks only exist if pre-generated, there's no restriction on querying historical picks.

**Impact:** Minimal — historical picks are likely intended to be accessible (for track record). A user could enumerate all dates to scrape the full pick history.

**Fix:** Consider if historical pick access should be rate-limited more aggressively or require auth. Current `publicLimiter` (30/min) provides some protection.

---

## [SEVERITY: LOW] Admin Token HMAC Uses Only Timestamp as Input

**File:** `src/lib/admin-auth.ts:16` + `src/app/api/admin/login/route.ts:18`

**What:** The admin token is `timestamp:HMAC(timestamp, secret)`. The HMAC input is only the timestamp — there's no random nonce or session identifier. Two admin logins at the exact same millisecond would produce identical tokens.

**Impact:** Extremely low — millisecond collision is impractical. The token is unguessable without the secret. However, it means tokens can't be individually revoked (you'd have to rotate the secret to invalidate all tokens).

**Fix:** Include a random nonce in the HMAC input: `crypto.randomBytes(16).toString('hex')` + timestamp. Store nothing server-side — the HMAC is self-validating. This also enables unique tokens per login.

---

## Positive Findings (Things Done Well)

These deserve recognition — they show security-conscious development:

1. **✅ Stripe webhook signature verification** (`src/app/api/stripe/webhook/route.ts:43`) — Uses `stripe.webhooks.constructEvent()` correctly with raw body + signature header. Does NOT trust `metadata.userId` (explicit comment about this).

2. **✅ CRON_SECRET uses timing-safe comparison** (`src/lib/auth-helpers.ts`) — Proper `timingSafeEqual` with length pre-check and try/catch. Fail-closed (returns false if secret not configured).

3. **✅ Admin auth uses HMAC + timing-safe verification** (`src/lib/admin-auth.ts`) — Token expiry, proper HMAC verification, timing-safe comparison.

4. **✅ No SQL injection risk** — All database access uses Prisma ORM with parameterized queries. No `$queryRaw` or string interpolation in queries found.

5. **✅ No hardcoded secrets** — All secrets come from environment variables. `.env.example` contains only placeholders.

6. **✅ Passwords hashed with bcrypt (cost 12)** (`src/app/api/auth/signup/route.ts:37`) — Strong hashing for user passwords.

7. **✅ Signup has Zod validation** — Email, password strength (8+ chars, uppercase, number), name presence.

8. **✅ Rate limiting on all public endpoints** — Every API route applies rate limiting. Auth flow endpoints have stricter limits (10/min).

9. **✅ Bet ownership enforced** — Bets use `where: { id, userId: session.user.id }` — users can only access their own bets.

10. **✅ JWT role refresh from DB** — Role is refreshed every 5 minutes from the database, preventing stale role escalation.

11. **✅ Stripe checkout doesn't trust client metadata** — Webhook handler looks up users by `stripeCustomerId`, not by `metadata.userId`.

12. **✅ Push subscription hijack prevention** — Checks if endpoint belongs to another user before allowing upsert.

13. **✅ Generic error messages** — Client-facing errors don't leak internal details (stack traces, DB errors stay server-side).
