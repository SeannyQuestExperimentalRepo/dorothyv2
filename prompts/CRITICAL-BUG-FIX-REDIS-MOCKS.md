# CRITICAL BUG FIX: Redis Module Import Failure in Tests

## Context Management
- **Project:** Dorothy v2 (Trendline)
- **Bug ID:** BUG-003 from BUG-REPORT-POST-PHASE2.md
- **Severity:** 🔴 Critical
- **File:** `tests/redis-rate-limit.test.ts`

## Problem

Test execution fails with:

    Cannot find module '@upstash/redis'

The Jest mock for `@upstash/redis` isn't being applied before the module is imported. With ESM + `@jest/globals`, `jest.mock()` is NOT automatically hoisted like it is in CommonJS Jest. The mock must be set up before any import that triggers `@upstash/redis` resolution.

## Task

### 1. Create a manual mock at `__mocks__/@upstash/redis.ts`

This is the most reliable approach for ESM. Create the directory structure and mock file:

    mkdir -p __mocks__/@upstash

Create `__mocks__/@upstash/redis.ts`:

    // Manual mock for @upstash/redis
    // Used by Jest when tests import from '@upstash/redis'

    export class Redis {
        private store: Map<string, string>;

        constructor(_config?: unknown) {
            this.store = new Map();
        }

        async get(key: string): Promise<string | null> {
            return this.store.get(key) ?? null;
        }

        async set(key: string, value: string, _opts?: unknown): Promise<string> {
            this.store.set(key, value);
            return 'OK';
        }

        async incr(key: string): Promise<number> {
            const current = parseInt(this.store.get(key) ?? '0', 10);
            const next = current + 1;
            this.store.set(key, String(next));
            return next;
        }

        async expire(_key: string, _seconds: number): Promise<number> {
            return 1;
        }

        async del(...keys: string[]): Promise<number> {
            let deleted = 0;
            for (const key of keys) {
                if (this.store.delete(key)) deleted++;
            }
            return deleted;
        }

        async eval(_script: string, _keys: string[], _args: unknown[]): Promise<unknown> {
            return null;
        }
    }

    export const Ratelimit = {
        slidingWindow: (_maxRequests: number, _window: string) => ({
            limit: async (_identifier: string) => ({
                success: true,
                limit: 10,
                remaining: 9,
                reset: Date.now() + 60000,
            }),
        }),
    };

Add any additional methods your rate limiting code actually calls on the Redis client. Check `src/lib/` for how `@upstash/redis` is imported and what methods are used.

### 2. Update jest.config.js for module mapping

Add `@upstash/redis` to the `moduleNameMapper` in your Jest config:

    // In jest.config.js / jest.config.ts
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@upstash/redis$': '<rootDir>/__mocks__/@upstash/redis.ts',
    },

This ensures Jest resolves the import to the manual mock regardless of whether `@upstash/redis` is installed in node_modules.

### 3. Fix mock setup order in `tests/redis-rate-limit.test.ts`

The test file should follow this exact pattern:

    // 1. Jest imports FIRST
    import { describe, it, expect, jest, beforeEach } from '@jest/globals';

    // 2. jest.unstable_mockModule BEFORE importing the module under test
    jest.unstable_mockModule('@upstash/redis', () => ({
        Redis: jest.fn().mockImplementation(() => ({
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            del: jest.fn().mockResolvedValue(1),
        })),
    }));

    // 3. THEN dynamic import of the module under test
    const { rateLimiter } = await import('../src/lib/rate-limit');
    // (adjust path to wherever the rate limiting module lives)

**Key point:** In ESM, use `jest.unstable_mockModule()` instead of `jest.mock()`. The `jest.mock()` hoisting trick does NOT work with ESM.

### 4. Alternative: If `jest.unstable_mockModule` isn't available

If you're on an older ts-jest that doesn't support `unstable_mockModule`, the manual mock approach (step 1) combined with the moduleNameMapper (step 2) is sufficient. Jest will automatically use the manual mock when it resolves `@upstash/redis`.

In that case, the test file just needs:

    import { describe, it, expect, jest, beforeEach } from '@jest/globals';
    import { rateLimiter } from '../src/lib/rate-limit'; // or wherever

No explicit mock call needed — the moduleNameMapper handles it.

### 5. Verify the fix

Run the specific test:

    npx jest tests/redis-rate-limit.test.ts --verbose

Expected: No `Cannot find module '@upstash/redis'` error. Tests should execute (pass or fail on assertions, not on import errors).

Then run all tests:

    npx jest --verbose 2>&1 | tail -20

## Success Criteria

- `tests/redis-rate-limit.test.ts` no longer throws `Cannot find module '@upstash/redis'`
- Redis mock properly intercepts all Redis calls in tests (no real network requests)
- Rate limiting logic is testable with controlled mock responses
- Mock can simulate both "rate limit OK" and "rate limit exceeded" scenarios
- Other test files are not affected by the mock (it's scoped to tests that import it)
