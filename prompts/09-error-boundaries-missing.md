# Prompt 09: Add Missing Error Boundaries (14 Routes)

**Priority:** 🟡 P2 — Users see raw Next.js error screens  
**Audit:** Frontend (CRITICAL)  
**Impact:** 14 routes have no error.tsx — API failures show ugly default error pages instead of graceful fallbacks.

---

## Copy-paste this into Claude:

```
Add error.tsx files to all routes that are missing them. Currently only 4 routes have error boundaries (bets, game, odds, today, trends). The rest show the default Next.js error screen when something goes wrong.

**Routes needing error.tsx:**
1. src/app/ncaamb/error.tsx
2. src/app/nfl/error.tsx
3. src/app/ncaaf/error.tsx
4. src/app/nba/error.tsx
5. src/app/search/error.tsx
6. src/app/login/error.tsx
7. src/app/signup/error.tsx
8. src/app/pricing/error.tsx
9. src/app/parlays/error.tsx
10. src/app/props/error.tsx
11. src/app/community/error.tsx
12. src/app/gate/error.tsx
13. src/app/admin/error.tsx
14. src/app/trends/saved/error.tsx

Use the existing error boundary pattern from `src/app/bets/error.tsx` or `src/app/error.tsx` as the template. Each error.tsx should:

1. Be a client component (`"use client"`)
2. Accept `error` and `reset` props
3. Show a user-friendly message (not the raw error)
4. Include a "Try Again" button that calls `reset()`
5. Match the app's existing dark theme styling
6. Log the error to Sentry via `trackError` from `src/lib/error-tracking.ts`

Template:
```tsx
"use client";

import { useEffect } from "react";
import { trackError } from "@/lib/error-tracking";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    trackError(error, { route: "PAGE_NAME" });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">
        We couldn't load this page. Please try again.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
      >
        Try Again
      </button>
    </div>
  );
}
```

Replace PAGE_NAME with the actual route name in each file. Check the existing error.tsx files first to match the exact styling pattern used.
```
