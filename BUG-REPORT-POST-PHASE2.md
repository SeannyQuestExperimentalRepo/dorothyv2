# 🐛 Dorothy v2 — Post-Phase 2 Bug Report

**Date:** February 15, 2025
**Reviewer:** Sean
**Scope:** Code review of latest trendline push (Phase 1 → Phase 2)
**Report ID:** BUG-POST-PHASE2

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 3 | Fix immediately |
| 🟡 Moderate | 2 | Fix soon |
| 🟠 Potential | 3 | Monitor |
| 🔵 Verify | 3 | Needs testing |

---

## 🔴 CRITICAL BUGS — Fix Immediately

### BUG-001: NFL Ridge Regression Using Wrong Week

| Field | Detail |
|-------|--------|
| **Severity** | 🔴 Critical |
| **File** | `src/lib/pick-engine.ts` line ~2979 |
| **Function** | `computeNflRidgeEdge()` |
| **Discovered** | 2025-02-15 |

**Description:**
`computeNflRidgeEdge()` is called with a hardcoded `week: 1` instead of computing the actual NFL week from the game date. NFL team performance varies significantly week-to-week (injuries, momentum, weather, roster changes), so using Week 1 stats for a Week 14 game produces meaningless predictions.

**Code (current):**
```typescript
computeNflRidgeEdge(
  canonHome,
  canonAway,
  currentSeason,
  1, // TODO: compute actual week from gameDate
```

**Expected:**
```typescript
const nflWeek = computeNflWeekFromDate(gameDate, currentSeason);

computeNflRidgeEdge(
  canonHome,
  canonAway,
  currentSeason,
  nflWeek,
```

**Fix:**
Implement `computeNflWeekFromDate(gameDate, season)`:
- NFL Week 1 starts ~first Thursday after Labor Day (early September)
- Regular season: Weeks 1–18
- Wild Card: Week 19, Divisional: Week 20, Conference: Week 21, Super Bowl: Week 22
- Can use a lookup table or compute from the season start date

**Impact:** All NFL spread/total predictions are using stale Week 1 data regardless of actual game week. Predictions are unreliable.

---

### BUG-002: Jest Test Framework — Missing Imports

| Field | Detail |
|-------|--------|
| **Severity** | 🔴 Critical |
| **Files** | `tests/performance.test.ts`, `tests/redis-rate-limit.test.ts`, `tests/team-resolver.test.ts` |
| **Discovered** | 2025-02-15 |

**Description:**
Multiple test files use `jest.spyOn()` and `jest.mock()` without importing `jest` from `@jest/globals`. This causes all affected tests to fail with:

```
ReferenceError: jest is not defined
```

**Fix:**
Add the following import to the top of each affected test file:

```typescript
import { jest } from '@jest/globals';
```

**Affected files:**
- [ ] `tests/performance.test.ts`
- [ ] `tests/redis-rate-limit.test.ts`
- [ ] `tests/team-resolver.test.ts`

**Impact:** Testing framework is broken. No tests can validate current functionality, leaving regressions undetected.

---

### BUG-003: Redis Module Import Failure in Tests

| Field | Detail |
|-------|--------|
| **Severity** | 🔴 Critical |
| **File** | `tests/redis-rate-limit.test.ts` |
| **Discovered** | 2025-02-15 |

**Description:**
Test execution fails with:

```
Cannot find module '@upstash/redis'
```

The Jest mock for `@upstash/redis` isn't being applied before the module is imported, causing the real module resolution to fail.

**Root Cause:** Mock setup order issue — `jest.mock()` must be hoisted above imports, but with ESM + `@jest/globals` this requires careful ordering.

**Fix:**
1. Verify `jest.config.js` has proper `moduleNameMapper` or `transformIgnorePatterns` for `@upstash/redis`
2. Ensure mock is defined before the module under test is imported
3. Consider using a manual mock in `__mocks__/@upstash/redis.ts`

**Impact:** Redis rate limiting logic is untested.

---

## 🟡 MODERATE BUGS — Fix Soon

### BUG-004: Test Import Pattern Inconsistency

| Field | Detail |
|-------|--------|
| **Severity** | 🟡 Moderate |
| **Files** | Various `tests/*.test.ts` |
| **Discovered** | 2025-02-15 |

**Description:**
Some test files correctly import from `@jest/globals`, others don't. This creates a mixed pattern where some tests pass and others fail for the same reason (missing `jest` global).

**Fix:**
Standardize all test files:

```typescript
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
```

Run a grep to find all non-compliant files:
```bash
grep -rL "@jest/globals" tests/*.test.ts
```

---

### BUG-005: Error Boundaries Potentially Unwired

| Field | Detail |
|-------|--------|
| **Severity** | 🟡 Moderate |
| **Files** | Multiple `.tsx` error boundary components |
| **Discovered** | 2025-02-15 |

**Description:**
Error boundary components have been created but may not be properly imported and wrapped around their target component trees. Without verification, runtime errors could crash the entire app instead of being caught gracefully.

**Fix:**
Verify each error boundary is:
1. Imported in the parent layout or page
2. Wrapping the correct component subtree
3. Rendering a meaningful fallback UI

---

## 🟠 POTENTIAL ISSUES — Monitor

### BUG-006: Excessive .bak Files in Repository

| Field | Detail |
|-------|--------|
| **Severity** | 🟠 Low |
| **Discovered** | 2025-02-15 |

**Description:**
Git diff shows dozens of `.bak` and `.bak2` files, suggesting turbulent development with multiple rollbacks. These add noise to the repo and may indicate code paths that were problematic.

**Action:**
- Add `*.bak` and `*.bak2` to `.gitignore`
- Remove existing backup files: `find . -name "*.bak*" -delete`
- Review any `.bak` files that might contain better implementations than current code

---

### BUG-007: Pick Engine Modularization Incomplete

| Field | Detail |
|-------|--------|
| **Severity** | 🟠 Low |
| **Discovered** | 2025-02-15 |

**Description:**
Phase 2 goal was to split `pick-engine.ts` into smaller, focused modules. Module files exist but the main functions still live in the parent file. Extraction is partial.

**Status:** Functional but not fully organized. The monolithic file works but is harder to maintain and test.

**Action:** Complete extraction in a future refactor pass. Not blocking functionality.

---

### BUG-008: Hardcoded Performance Test Thresholds

| Field | Detail |
|-------|--------|
| **Severity** | 🟠 Low |
| **File** | `tests/performance.test.ts` |
| **Discovered** | 2025-02-15 |

**Description:**
Performance tests use hardcoded timing thresholds (e.g., `expect(elapsed).toBeLessThan(100)`) that will fail intermittently on slower systems or under load.

**Fix:**
- Use relative timing (e.g., "within 3x of baseline")
- Increase thresholds with reasonable margins
- Mark performance tests as separate suite that can be skipped in CI

---

## 🔵 VERIFICATION NEEDED

### VERIFY-009: Tournament Logic Implementation

| Field | Detail |
|-------|--------|
| **Status** | Implemented, unverified |
| **Features** | UNDER boost, seed mismatch, conference tournament fatigue |

**What to test:**
- Run against historical March Madness games
- Verify UNDER boost fires for tournament games
- Verify seed mismatch logic adjusts spreads correctly
- Verify conference tournament fatigue applies to back-to-back games

**Timeline:** Must verify before March 15 tournament deadline.

---

### VERIFY-010: Weight Configuration Accuracy

| Field | Detail |
|-------|--------|
| **Status** | Spot-checked, needs full audit |

**Verified so far:**
- ✅ NCAAMB spread weights sum to 1.0
- ✅ NFL spread weights sum to 1.0

**Still needs verification:**
- [ ] NCAAMB totals weights
- [ ] NFL totals weights
- [ ] NBA spread/totals weights
- [ ] NCAAF spread/totals weights
- [ ] All other sport/bet type combinations

---

### VERIFY-011: CLV Tracking Database Schema

| Field | Detail |
|-------|--------|
| **Status** | Schema migrated, pipeline unverified |

**Migration adds:** `closingLine`, `openingLine`, `clv` fields to `DailyPick` table.

**Needs verification:**
- [ ] Grading pipeline populates `closingLine` from final odds
- [ ] `openingLine` is captured at pick creation time
- [ ] `clv` is computed correctly (`closingLine - openingLine`)
- [ ] Historical picks handle null values gracefully

---

## 📋 Recommendations

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Fix NFL week calculation (BUG-001) | 2–4 hours |
| 2 | Fix Jest imports across all test files (BUG-002, BUG-003, BUG-004) | 1–2 hours |
| 3 | Run full test suite and fix remaining failures | 2–4 hours |
| 4 | Clean up .bak files and add to .gitignore | 30 min |
| 5 | Manual tournament logic testing with March games | 4–8 hours |
| 6 | Performance baseline for tournament season (32+ games/day) | 2–4 hours |

---

## Overall Assessment

The implementation covers a massive amount of work across **Phase 1, Phase 1.5, NFL Foundation, and Phase 2**. The core pick engine functionality appears sound — weight configurations, trendline calculations, and tournament logic are all in place.

**Blocking issues:**
- NFL week calculation (BUG-001) makes all NFL predictions unreliable
- Broken test framework (BUG-002/003) means no automated quality gates

**Timeline impact:** These bugs are fixable within **1–2 days** and will not affect the **March 15 tournament deadline** if addressed promptly.

**Next steps:** Fix critical bugs → run test suite → verify tournament logic → establish performance baseline.
