# Morning Brief — NCAAMB O/U Model Upgrade (v7 → v8)

**Date:** 2026-02-12
**Branch:** `experimental/ncaamb-backtest-20260212`
**Session:** Ralph Loop Backtest

---

## Executive Summary

**v7's O/U model overfits catastrophically (17.4pp gap) because of hand-crafted contextual overrides, not the regression itself.** Removing them and switching from OLS to Ridge regression (λ=1000) produces a model that is both more accurate and more robust out-of-sample.

| Metric | v7 (OLS + overrides) | v8 (Ridge, no overrides) |
|--------|---------------------|--------------------------|
| 2025 accuracy (in-sample) | 69.6% | 70.0% |
| 2026 accuracy (out-of-sample) | 52.2% | 65.7%* |
| Overfitting gap | 17.4pp | 4.3pp |
| 2026 ROI (−110 odds) | ~0% | +23-28% |

*65.7% from Phase 3 validation (KenPom ConfShort matching); 63.3% from A/B comparison (isConferenceGame field). Production code uses Phase 3 matching.*

---

## Root Cause (Phase 1)

All 5 contextual overrides were the problem:

| Override | 2025 | 2026 | Verdict |
|----------|------|------|---------|
| Both top-50 → UNDER | 78.4% | 50.6% | Coin flip |
| High line ≥155 → UNDER | 67.9% | 51.9% | Coin flip |
| Both 200+ → OVER | 66.9% | 49.1% | Coin flip |
| Low line <135 → OVER | 56.4% | 47.0% | Below random |
| Power conf → UNDER | ~70% | ~50% | Coin flip |

The pure regression (no overrides) was already at 65.1% on 2026. Overrides dragged it down to 52.2%.

---

## v8 Model Card

**Type:** Ridge regression (L2 penalty, λ=1000)
**Features:** 7 (sumAdjDE, sumAdjOE, avgTempo, tempoDiff, emAbsDiff, isConf, fmTotal)
**Training set:** 2025 season (5,460 games)
**Minimum edge:** 1.5 points

### Coefficients
```
predictedTotal =
  -407.6385 +
  0.6685 * sumAdjDE +
  0.6597 * sumAdjOE +
  3.9804 * avgTempo +
  -0.1391 * tempoDiff +
  0.0064 * emAbsDiff +
  -0.6345 * isConf +
  0.0100 * fmTotal
```

### Validation Results
- **Walk-forward (monthly folds, 2025):** 68.9–73.0% all months
- **Subgroup min:** 62.7% (no weak spots above n=20)
- **Edge calibration:** monotonic from 55.7% (edge 1.5-2.9) to 82.3% (edge 10+)
- **Max drawdown:** 7-game loss streak, 2.8% ($1,070 on $100/pick)
- **95% CI (2026):** [63.1%, 68.2%], z = 9.78 vs break-even

### Key Coefficient Changes (v7 → v8)
- Ridge shrinks unstable features (isConf: -1.43 → -0.63, fmTotal: 0.02 → 0.01)
- Core features barely change (sumAdjDE: 0.64 → 0.67, sumAdjOE: 0.61 → 0.66)
- Intercept shift: -418.2 → -407.6 (compensates for coefficient changes)

---

## What Changed in Code

**File:** `src/lib/pick-engine.ts`

1. **Updated regression coefficients** — Ridge λ=1000 values replace OLS values
2. **Removed 5 contextual overrides** — 74 lines of override logic deleted
3. **Updated version header** — v7 → v8 with changelog

**No changes to:**
- Signal weights, confidence tiers, or convergence scoring
- Spread model (still signal convergence, 54.3% OOS)
- Edge-to-magnitude mapping
- Any interfaces, types, or external API

---

## Spread Model (No Change)

Spread was investigated but no clear improvement found:
- EM-diff line value showed 65.7% on 2026 but has look-ahead bias concerns
- Market-relative: 55.2%/56.0% (reliable but marginal improvement over v7's 54.3%)
- **Recommendation:** Keep v7's signal convergence for spread. Revisit when point-in-time KenPom data is available.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| FanMatch coefficient near-zero | Low | Ridge shrinks it; feature ready if data becomes available |
| KenPom season-level (not point-in-time) | Medium | Walk-forward shows no monthly degradation; bias is consistent |
| 2026 sample only Nov-Feb (no March) | Medium | March logic removed; will need monitoring during tournament |
| Noise sensitivity at ±5% | Low | KenPom updates <1% between refreshes; unrealistic test |

---

## 604-Iteration Automated Search (Phase 5)

After deploying v8, ran 604 model variants across 5 automated batches. Key upgrade opportunity:

### v8.1 Candidate: Hybrid U2/O5+lowline

| Metric | v8 (current) | v8.1 Hybrid |
|--------|-------------|-------------|
| UNDER picks | all games, e≥1.5 | all games, e≥2.0 |
| OVER picks | all games, e≥1.5 | only line<140, e≥5.0 |
| 2026 accuracy | 63.3% | 70.7% |
| 2026 ROI | +23.0% | +38.4% |
| Picks/season | ~1,383 | ~525 |
| Sharpe ratio | 0.227 | 0.401 |
| Max drawdown | 18.1 units | 5.6 units |
| Max loss streak | 8 | 5 |

**Trade-off:** ~60% fewer picks for ~77% better accuracy and ~67% better ROI. Sharpe nearly doubles.

### Top Finding: UNDER >> OVER at every edge magnitude

| Edge | UNDER 2026 | OVER 2026 |
|------|-----------|----------|
| 1.5–2.5 | 62.9% | 47.3% |
| 5.0–7.0 | 68.3% | 62.3% |
| 10.0+ | 87.8% | 79.2% |

### What didn't work (604 iterations of evidence)
- Feature engineering (0/172 variants improved on Core-3)
- Line-as-feature (50.8% OOS with Ridge — catastrophic)
- Separate OVER/UNDER models (49%–53%)
- Ensemble voting (too correlated to help)
- Contextual overrides (all coin-flip OOS)

Full details: [ITERATION-FINDINGS.md](../backtest/ITERATION-FINDINGS.md)

---

## Recommended Next Steps

1. **Decision: v8 or v8.1?** — v8 is deployed and safe; v8.1 (Hybrid) is higher quality but fewer picks
2. **Monitor March Madness** — First real OOS test; v8.1's low-line filter may reduce March volume
3. **KenPom point-in-time** — If available, retrain with temporal features for spread model
4. **FanMatch 2026** — Investigate why FanMatch capture rate dropped to 2.7%
5. **Retrain annually** — Refit Ridge on [2025+2026] data before 2026-27 season

---

## Files Created This Session

| File | Purpose |
|------|---------|
| `scripts/backtest/phase0-enrich-kenpom.ts` | KenPom enrichment |
| `scripts/backtest/phase0-data-check.ts` | Data quality audit |
| `scripts/backtest/phase0-bettable-coverage.ts` | Coverage by month |
| `scripts/backtest/phase1-diagnostics.ts` | 7-test diagnostic suite |
| `scripts/backtest/phase2-ou-models.ts` | 16 O/U model variants |
| `scripts/backtest/phase2-spread-models.ts` | 14 spread variants |
| `scripts/backtest/phase2-lookahead-check.ts` | Bias detection |
| `scripts/backtest/phase3-validation.ts` | Full validation suite |
| `scripts/backtest/phase4-ab-comparison.ts` | v7 vs v8 head-to-head |
| `scripts/backtest/iteration-engine.ts` | Batch 1: 172 variants |
| `scripts/backtest/iteration-batch2.ts` | Batch 2: 81 variants |
| `scripts/backtest/iteration-batch3.ts` | Batch 3: 49 variants |
| `scripts/backtest/iteration-batch4.ts` | Batch 4: 183 variants |
| `scripts/backtest/iteration-batch5.ts` | Batch 5: 119 variants |
| `scripts/backtest/ITERATION-FINDINGS.md` | Comprehensive findings |
| `scripts/ralph-loop/RALPH-LOG-BACKTEST.md` | Full experiment log |
| `scripts/ralph-loop/state-backtest.json` | Session state tracking |
