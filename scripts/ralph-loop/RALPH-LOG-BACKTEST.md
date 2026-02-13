# Ralph Loop — NCAAMB Backtest Log

**Started:** 2026-02-12
**Branch:** experimental/ncaamb-backtest-20260212
**Goal:** Find models with ≥55% accuracy and <5pp overfitting gap

---

## Phase 0: Data Preparation & Validation

### Phase 0 / Iteration 1
**Experiment**: Data coverage and quality audit
**Hypothesis**: 2026 KenPom data gap needs fixing; data quality may have issues
**Result**:
- **2025 bettable games: 5,523** — 100% KenPom, 96.4% FanMatch, 0% moneyline
- **2026 bettable games: 1,781** — 98.6% KenPom (1,756/1,781), 2.7% FanMatch (48), 3.0% moneyline (54)
- **Data quality: PERFECT** — 0 duplicates, 0 missing results, 0 O/U inconsistencies
- 2026 bettable date range: Nov 4, 2025 to Feb 12, 2026 (Nov-Feb only, no March yet)

**Baselines established:**

| Baseline | 2025 | 2026 |
|----------|------|------|
| Random | 50.0% | 50.0% |
| Always UNDER | 49.5% (2701/5460 excl push) | 51.9% (924/1781) |
| Always HOME COVERS | 47.7% (2578/5409 excl push) | 48.1% (857/1781) |
| Vegas within ±3 of O/U | 15.6% | 13.8% |
| v7 O/U | 69.6% | 52.2% |
| v7 Spread | 56.0% | 54.3% |

**Key findings**:
1. KenPom gap is already fixed — 98.6% coverage on 2026 bettable games (25 missing are name-match failures for minor schools)
2. **FanMatch is essentially unavailable for 2026** (2.7% coverage). Any model using fmTotal trains on real data (2025) but gets zeros at test time (2026). This is likely a contributor to overfitting.
3. 2026 has a slight UNDER lean (51.9%) vs 2025 near-50/50 (49.5%). "Always UNDER" beats random on 2026.
4. No moneyline data for 2025 — cannot evaluate ML edge signal at all.
5. 2026 only covers Nov-Feb (1,781 games). Full 2025 has 5,523 with March Madness.

**Next step**: Phase 1 — diagnose why v7 O/U model fails out-of-sample

---

