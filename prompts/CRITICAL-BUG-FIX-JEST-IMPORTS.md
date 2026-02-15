# CRITICAL BUG FIX: Jest Test Framework — Missing Imports

## Context Management
- **Project:** Dorothy v2 (Trendline)
- **Bug ID:** BUG-002 + BUG-004 from BUG-REPORT-POST-PHASE2.md
- **Severity:** 🔴 Critical
- **Files:** `tests/performance.test.ts`, `tests/redis-rate-limit.test.ts`, `tests/team-resolver.test.ts`

## Problem

Multiple test files use `jest.spyOn()` and `jest.mock()` without importing `jest` from `@jest/globals`. All affected tests fail with:

    ReferenceError: jest is not defined

The project uses ESM with `@jest/globals` (not the legacy Jest global injection). Every test file must explicitly import what it needs.

## Task

### 1. Fix all affected test files

Add the standardized import to the TOP of each file (before any other imports):

**`tests/performance.test.ts`:**

    import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

**`tests/redis-rate-limit.test.ts`:**

    import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

**`tests/team-resolver.test.ts`:**

    import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

Only import the specific functions each file actually uses. The above is the maximal set — trim to what's needed. For example, if a file doesn't use `beforeEach`, don't import it.

### 2. Audit ALL test files for consistency

Run this to find any other non-compliant files:

    grep -rL "@jest/globals" tests/*.test.ts

For every file returned, add the appropriate `@jest/globals` import. Also check:

    grep -rn "jest\." tests/*.test.ts | grep -v "@jest/globals" | grep -v node_modules

This catches files that reference `jest.` without the import.

### 3. Verify jest.config.js / jest.config.ts

Ensure the Jest configuration supports ESM + @jest/globals. The config should include:

    // jest.config.js or jest.config.ts
    export default {
        preset: 'ts-jest/presets/default-esm',
        testEnvironment: 'node',
        extensionsToTreatAsEsm: ['.ts'],
        moduleNameMapper: {
            '^(\\.{1,2}/.*)\\.js$': '$1',
        },
        transform: {
            '^.+\\.tsx?$': [
                'ts-jest',
                {
                    useESM: true,
                },
            ],
        },
    };

If a jest config already exists, verify it has `useESM: true` and `extensionsToTreatAsEsm`. Don't overwrite other settings — merge what's missing.

### 4. Check tsconfig for test compatibility

Ensure `tsconfig.json` (or a `tsconfig.test.json` if one exists) includes:

    {
        "compilerOptions": {
            "module": "ESNext",
            "moduleResolution": "bundler",
            "esModuleInterop": true,
            "types": ["@jest/globals"]
        }
    }

The `types: ["@jest/globals"]` ensures TypeScript recognizes the Jest types without needing ambient declarations.

### 5. Run tests to verify

After making changes:

    npx jest --verbose 2>&1 | head -50

All three previously-failing test files should now at least get past the import phase. (They may still fail for other reasons like BUG-003 Redis mocks — that's a separate fix.)

## Success Criteria

- `grep -rL "@jest/globals" tests/*.test.ts` returns NO results (all files have the import)
- `npx jest tests/performance.test.ts` no longer throws `ReferenceError: jest is not defined`
- `npx jest tests/team-resolver.test.ts` no longer throws `ReferenceError: jest is not defined`
- All `jest.spyOn()` and `jest.mock()` calls resolve properly
- No mixed import patterns across test files
