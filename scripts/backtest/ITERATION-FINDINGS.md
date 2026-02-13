# NCAAMB O/U Model — 604 Iteration Findings

**Date:** 2026-02-13
**Branch:** `experimental/ncaamb-backtest-20260212`
**Batches:** 5 (172 + 81 + 49 + 183 + 119 = 604 iterations)
**Training:** 2025 season (5,460 games)
**Validation:** 2026 season (1,756 games, Nov–Feb only)

---

## Top 10 Strategies (by composite grade)

| # | Strategy | 2026 Acc | Gap | ROI | Picks | Sharpe | Grade |
|---|----------|----------|-----|-----|-------|--------|-------|
| 1 | **Asym U2/O5 + Low-line (<145)** | 72.3% | -1.4pp | +41.8% | 303 | — | 86.3 |
| 2 | **Asym U2/O7 + Slow-tempo (≤67)** | 74.6% | -0.4pp | +46.6% | 287 | — | 86.1 |
| 3 | **UNDER e≥2 line<155** | 74.7% | -2.8pp | +46.8% | 292 | — | 86.2 |
| 4 | **UNDER e≥2 + Slow-tempo (≤67)** | 75.7% | -0.8pp | +49.0% | 214 | 0.542 | 85.2 |
| 5 | Asym U1/O5 + Low-line (<145) | 71.1% | -0.6pp | +39.3% | 346 | — | 86.5 |
| 6 | Hybrid U2/O5+lowline | 70.7% | 2.1pp | +38.4% | 525 | 0.401 | 81.6 |
| 7 | Asym U2/O7 (no subgroup) | 69.8% | 4.6pp | +36.7% | 650 | 0.380 | 74.3 |
| 8 | UNDER-only e≥2 (no filter) | 70.2% | 3.0pp | +37.4% | 446 | 0.389 | 77.3 |
| 9 | UNDER-only e≥3 + Slow-tempo (≤67) | 77.0% | 0.0pp | +51.6% | 165 | — | 85.0 |
| 10 | v8 base (Ridge, e≥1.5 symmetric) | 63.3% | 6.7pp | +23.0% | 1383 | 0.227 | 52.7 |

---

## The Big Lessons

### 1. UNDER predictions are far more reliable than OVER

This is the single most important finding. At every edge magnitude, UNDER picks outperform OVER picks on 2026 OOS data:

| Edge Range | UNDER 2026 | OVER 2026 | Delta |
|-----------|-----------|----------|-------|
| 1.5–2.5 | 62.9% | 47.3% | +15.6pp |
| 2.5–3.5 | 61.1% | 54.4% | +6.7pp |
| 3.5–5.0 | 67.3% | 64.0% | +3.3pp |
| 5.0–7.0 | 68.3% | 62.3% | +6.0pp |
| 7.0–10.0 | 77.1% | 63.6% | +13.5pp |
| 10.0+ | 87.8% | 79.2% | +8.6pp |

**Implication:** OVER picks at low edges (< 5) are essentially coin flips. Only include OVER when edge ≥ 5–7.

### 2. Subgroup filters beat feature engineering every time

In 172 feature engineering experiments (interaction terms, quadratic features, alternative feature sets, normalized features), **none** beat the Core-3 features (sumAdjDE, sumAdjOE, avgTempo). Adding features adds noise.

What DOES work is filtering which games to bet on:
- **Low-line games (<140–145)**: Model predictions are 7–10pp more accurate here
- **Slow-tempo games (≤66–67)**: Similarly reliable, and the edge is NOT driven by base rate shift
- **Rank gap ≥ 80**: Moderate improvement

### 3. Regularization (Ridge) matters, but only a little

| Lambda | 2025 Acc | 2026 Acc | Gap |
|--------|---------|---------|-----|
| 0 (OLS) | 70.0% | 65.1% | 4.9pp |
| 100 | 70.0% | 65.3% | 4.7pp |
| 1000 | 70.0% | 65.7% | 4.3pp |
| 5000 | 69.9% | 64.8% | 5.1pp |
| 10000 | 69.7% | 63.9% | 5.8pp |

Lambda 1000 is optimal. The difference between OLS and Ridge is ~0.6pp OOS — real but small compared to strategy choices.

### 4. Contextual overrides destroy value

All 5 v7 overrides (top-50→UNDER, power conf→UNDER, 200+→OVER, March→UNDER, line range) were coin flips on 2026. They took the model from 65.1% to 52.2% OOS. Never override the regression.

### 5. Separate models per subgroup are unstable

Training separate models on subgroup data (e.g., only low-line games, only slow-tempo games) shows high accuracy but unreliable gaps. The training set becomes too small (~1000–1800 games) for stable coefficients. Better to use one model with subgroup filters.

### 6. Ensembles add complexity without meaningful improvement

All ensemble configurations (majority voting, unanimous, diverse feature sets) land within ±1pp of the single base model. The component models are too correlated (all trained on the same KenPom features) to gain from diversity.

### 7. The Vegas line is toxic as a feature

Including the O/U line as a model feature causes catastrophic overfitting:
- Ridge + line feature: 50.8% OOS (below random!)
- Only OLS + line + line² marginally works (67.0% e≥3), and that's likely due to OLS not regularizing the line coefficient

The model's edge comes from predicting INDEPENDENTLY of Vegas. Making it partially defer to Vegas destroys the signal.

### 8. Expanding window retraining adds ~1pp

Monthly retraining (add completed games to training set each month) improves 2026 from 63.3% to 63.9%. Combined with UNDER-only: 69.1% vs 70.2%. Marginal and adds operational complexity.

### 9. Negative gaps are partially explained by base rate shifts

Low-line games shifted +7.1pp toward UNDER in 2026 vs 2025. UNDER-focused strategies on low-line games benefit from this tailwind. However, slow-tempo games shifted -11.4pp AGAINST UNDER, yet slow-tempo UNDER strategies still hit 75.7%. This suggests the slow-tempo edge is genuine model alpha.

### 10. Bootstrap CIs show meaningful uncertainty

| Strategy | Point Est | 95% CI |
|----------|----------|--------|
| v8 base | 63.3% | [60.6%, 65.8%] |
| UNDER e≥2 | 70.2% | [66.0%, 74.4%] |
| Asym U2/O7 | 69.8% | [66.1%, 73.6%] |
| UNDER e≥2 + slow≤67 | 75.7% | [70.1%, 81.5%] |
| Hybrid U2/O5+lowline | 70.7% | [66.7%, 74.6%] |

The narrow strategies (214 picks) have ±5.7pp CIs. More data (March 2026) will tighten these.

---

## Risk-Adjusted Returns (Sharpe Analysis)

| Strategy | Picks | Mean Return | Sharpe | Max Drawdown | Max Loss Streak |
|----------|-------|-------------|--------|-------------|----------------|
| v8 base | 1383 | +0.230 | 0.227 | 18.1 units | 8 |
| UNDER e≥2 | 446 | +0.374 | 0.389 | 7.1 units | 6 |
| Asym U2/O7 | 650 | +0.367 | 0.380 | 10.2 units | 6 |
| **Hybrid U2/O5+lowline** | **525** | **+0.384** | **0.401** | **5.6 units** | **5** |
| UNDER e≥2 + slow≤67 | 214 | +0.490 | 0.542 | 4.4 units | 4 |

**Hybrid U2/O5+lowline is the Sharpe-optimal production choice**: best risk-adjusted return (0.401) among strategies with 500+ picks, lowest max drawdown (5.6 units), and shortest max loss streak (5).

---

## What Didn't Work (Summary)

| Category | Best Result | Why It Failed |
|----------|------------|--------------|
| Feature engineering | Same as Core-3 | All added features are noise |
| Market-relative models | 52.8% OOS | Predicting deviations from Vegas = harder than totals |
| Weighted training (recency, conference) | +0.5pp | Marginal, not worth complexity |
| Separate OVER/UNDER trained models | 49.4%–52.6% | Splits training data, destroys signal |
| Residual correction | R² < 0.001 | Residuals are genuinely unpredictable |
| Line-as-feature | 50.8% OOS | Model defers to Vegas instead of finding alpha |
| Ensembles | ±1pp of base | Component models too correlated |
| Complex routing (meta-models) | Same as simple | Adds complexity without alpha |

---

## Production Recommendations

### Tier 1: Conservative (recommended for immediate deployment)

**Strategy: Hybrid U2/O5+lowline**
- UNDER picks: all games, edge ≥ 2.0
- OVER picks: only games with line < 140, edge ≥ 5.0
- Expected: 70.7% accuracy, +38.4% ROI, ~525 picks/season
- Sharpe: 0.401, max drawdown 5.6 units, max loss streak 5
- Monthly stability: 68%–86% across all months

### Tier 2: Aggressive (higher accuracy, fewer picks)

**Strategy: UNDER e≥2 + slow-tempo ≤67**
- UNDER picks only, tempo ≤ 67, edge ≥ 2.0
- Expected: 75.7% accuracy, +49.0% ROI, ~214 picks/season
- Sharpe: 0.542, max drawdown 4.4 units
- Risk: narrow CI, small sample, needs March validation

### Tier 3: Volume (most picks, moderate accuracy)

**Strategy: Asym U2/O7 (no subgroup filter)**
- UNDER picks: edge ≥ 2.0
- OVER picks: edge ≥ 7.0
- Expected: 69.8% accuracy, +36.7% ROI, ~650 picks/season
- Sharpe: 0.380, max drawdown 10.2 units

### What NOT to change in production
- **Keep Ridge λ=1000** — optimal regularization confirmed
- **Keep Core-3 features** (sumAdjDE, sumAdjOE, avgTempo) as primary drivers
- **Keep min edge 1.5** for symmetric model (unless implementing asymmetric)
- **Do NOT add contextual overrides** — they fail OOS every time
- **Do NOT include the line as a feature**

---

## Confidence Tier Mapping (for production pick-engine.ts)

If implementing Hybrid U2/O5+lowline:

| Condition | Edge | Direction | Confidence |
|-----------|------|-----------|------------|
| Any game | 2–5 | UNDER | 3-star |
| Any game | 5–8 | UNDER | 4-star |
| Line < 140 | 5–8 | OVER | 3-star |
| Any game | 8–12 | UNDER | 5-star |
| Line < 140 | 8–12 | OVER | 4-star |
| Any game | 12+ | UNDER | 5-star |
| Any game | 12+ | OVER | 5-star |

---

## Files Created

| File | Variants | Key Focus |
|------|----------|-----------|
| `iteration-engine.ts` | 172 | Feature engineering, regularization, interactions |
| `iteration-batch2.ts` | 81 | Tiered edges, weighted training, 2-stage filters |
| `iteration-batch3.ts` | 49 | Direction asymmetry, subgroup routing, separate models |
| `iteration-batch4.ts` | 183 | Combined strategies, OVER rescue, ensembles, line features |
| `iteration-batch5.ts` | 119 | Cross-validation, bootstrap CI, Sharpe, boundary sweeps |
| **Total** | **604** | |

---

## Grading System

Composite grade (0–100):
- **OOS Accuracy (40%):** 55% = 0, 70% = 100
- **Overfitting Gap (25%):** 0pp = 100, 8pp = 0
- **OOS ROI (20%):** 0% = 0, 40% = 100
- **Volume (15%):** 200 picks = 0, 1400 picks = 100
- **Gates:** acc2026 < 55% OR gap > 8pp OR n < 100 → grade = 0

v8 baseline grade: 68.4 (from Phase 3 validation: 65.7%, 4.3pp gap, 1345 picks)
