# Prompt 11: Replace console.error with trackError Across All Routes

**Priority:** 🟡 P2 — 85 of 88 error paths skip Sentry  
**Audit:** Architecture (HIGH)  
**Impact:** Production errors invisible. Failed cron jobs, broken Stripe webhooks, pick generation failures all lost to ephemeral Vercel logs.

---

## Copy-paste this into Claude:

```
Replace all console.error calls in API routes with trackError from the existing error-tracking module. Currently only 3 of 88 error paths report to Sentry.

**Pattern to find:**
```bash
grep -rn "console.error" src/app/api/ src/lib/
```

**Replace with:**
```typescript
import { trackError } from "@/lib/error-tracking";

// Before:
console.error("[route-name] Error:", err);

// After:
trackError(err instanceof Error ? err : new Error(String(err)), {
  route: "route-name",
  context: { /* any useful metadata */ }
});
```

**File:** `src/lib/error-tracking.ts` — check that `trackError` accepts metadata/context. If not, extend it:

```typescript
export function trackError(error: Error, metadata?: Record<string, unknown>) {
  if (metadata) {
    Sentry.setContext("custom", metadata);
  }
  Sentry.captureException(error);
  // Keep console.error for local dev visibility
  if (process.env.NODE_ENV === "development") {
    console.error(error);
  }
}
```

**Priority routes to update (handle money/picks):**
1. `src/app/api/cron/daily-sync/route.ts` — cron failures
2. `src/app/api/picks/generate/route.ts` — pick generation failures
3. `src/app/api/stripe/webhook/route.ts` — payment failures
4. `src/app/api/bets/route.ts` — bet tracking failures
5. `src/lib/pick-engine.ts` — all catch blocks in generateDailyPicks
6. `src/lib/espn-sync.ts` — data sync failures
7. `src/lib/odds-api-sync.ts` — odds sync failures

Then do the rest of the routes. Don't remove console.error in development — keep it as a fallback in the trackError function.
```
