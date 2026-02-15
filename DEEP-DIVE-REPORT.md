# 🌪️ DorothyV2 Deep Dive Report
### Compiled by Dorothy — February 14, 2026

---

## Executive Summary

DorothyV2 (TrendLine) is an ambitious NCAAMB-focused sports betting analytics app built with Next.js, Prisma, and KenPom data. The codebase shows impressive research depth — 604 backtest iterations, 9 signal categories, PIT regression models, and walk-forward validation. However, **the live system is losing money** (36.8% win rate vs 52.4% break-even), and the root cause is clear.

**The #1 Problem: Look-Ahead Bias in the Data Pipeline**

Your KenpomSnapshot table has beautiful point-in-time data (36,500 snapshots for 2026 alone). But your NCAAMBGame table stamps *current* KenPom ratings on *all* historical games. A November game gets February's ratings. This means your backtests are artificially inflated — the model "knows" how teams will develop months later. Fix this single issue and everything downstream changes.

---

## Part 1: Statistical Analysis (Live Performance)

### Current Pick Performance: 14-24 (36.8%)

| Tier | Type | W-L | Win% | ROI |
|------|------|-----|------|-----|
| 3★ | Spread | 2-8 | 20.0% | -56.4% |
| 3★ | O/U | 1-1 | 50.0% | -4.5% |
| 4★ | Spread | 2-1 | 66.7% | +27.3% |
| 4★ | O/U | 4-6 | 40.0% | -23.6% |
| 5★ | Spread | 0-3 | 0.0% | -100.0% |
| 5★ | O/U | 5-5 | 50.0% | -4.5% |

**Key observations:**
- 5-star spread picks are **0-3** — the confidence system is inverted for spreads
- 4-star spreads (2-1) are the only profitable tier — but 3 picks is meaningless sample
- O/U performance is basically coin-flip across all tiers
- Only 38 graded picks exist — too few for statistical significance (need ~2,900 at 55% to confirm edge)

### The Backtest vs Reality Gap

| Context | O/U Win% | Spread Win% |
|---------|----------|-------------|
| Backtest (2025 in-sample) | 69.6-75.7% | 54-56% |
| Backtest (2026 OOS) | 52.2-70.7% | 54.3% |
| **Live (Feb 2026)** | **45.5%** | **28.6%** |

The gap between backtest and live is **massive**. This is the signature of look-ahead bias.

---

## Part 2: The EOS vs PIT Smoking Gun 🚨

### What I Found in the Database

I queried NCAAMBGame directly. One team's `homeAdjEM` is **11.7398 for 15 consecutive games from November through February** — then changes to 11.7241 on the most recent date. This is not point-in-time data. It's the latest snapshot being applied retroactively to every game.

### What This Means

| Scenario | What Happens | Result |
|----------|-------------|--------|
| **Backtest with EOS data** | Model "knows" February ratings for November games | Artificially high accuracy |
| **Live prediction** | Model uses current ratings (correct PIT) | Actual model quality revealed |
| **The gap** | Backtest says 62-75%, live says 36-50% | ~20-30pp of inflated accuracy |

### Your PIT Data IS Available

```
KenpomSnapshot: 722,000+ rows across 15 seasons
2026 alone: 36,500 snapshots (365 teams × 100 daily snapshots)
```

The fix is joining KenpomSnapshot to games by date, not stamping current ratings on all games.

### What the Research Says

From our betting research: *"Point-in-time vs end-of-season ratings — this is arguably the single biggest mistake amateur modelers make. A model that looks 65% accurate in backtesting might actually be 52% with true point-in-time data."*

Your v9 pick engine comments say "PIT 4-feature model, trained on 70,303 games with point-in-time KenPom snapshots." The training may use PIT, but the **live prediction pipeline** appears to pull from NCAAMBGame KenPom fields (which are EOS). This disconnect is the bug.

---

## Part 3: Model & Algorithm Analysis

### What's Working

1. **Ridge regression (λ=1000) for O/U** — validated approach, correct regularization
2. **Core-3 features** (sumAdjDE, sumAdjOE, avgTempo) — iteration findings confirmed no added feature beats these
3. **UNDER bias exploitation** — research confirms UNDER > OVER at low edges (15.6pp gap at 1.5-2.5 edge)
4. **Removing contextual overrides** — v8/v9 correctly removed overrides that were coin-flip OOS
5. **Walk-forward validation** — the methodology in iteration-batch5 is correct
6. **Wilson intervals for significance** — statistically rigorous approach

### What's Broken or Missing

#### Model Issues

1. **EOS→PIT data pipeline gap** (discussed above) — Priority #1

2. **Spread model has no real edge** — Even in backtests, spread ATS is 54-56% (barely above break-even). The v9 engine treats spread and O/U the same, but they require fundamentally different approaches. KenPom efficiency is excellent for totals but mediocre for ATS because spreads are much more efficiently priced.

3. **Confidence tiers are miscalibrated** — v9 uses PIT-calibrated tiers for NCAAMB O/U (good) but convergence scoring for spreads (bad). The convergence system rewards signal agreement, but the iteration findings showed signal agreement HURTS spread accuracy.

4. **No Closing Line Value tracking** — CLV is the #1 predictor of long-term profitability. You track opening odds in OddsSnapshot but never compare your pick timing to closing lines.

5. **Kelly Criterion not implemented** — Flat betting at -110 ignores edge magnitude. A 5-star pick with 82% expected accuracy should get much more capital than a 3-star at 68%. Formula: `f* = (0.909 × p - q) / 0.909`. At 55% edge, bet 4.18% of bankroll.

#### Data Pipeline Issues

6. **2026 KenPom data gap on NCAAMBGame** — 88.3% of 2026 games have KenPom data, but it's EOS, not PIT. The remaining 11.7% have nothing.

7. **34.5% of historical games missing spread/O/U data** — 43,240 games with no betting lines. Can't validate model on these.

8. **Only 3 days of OddsSnapshot data** — line movement analysis is impossible with this little history.

9. **NBA is a stub** — Defined everywhere but excluded from cron. The NBA is a massive untapped market.

10. **NFL model uses crude power ratings** — EPA/play from nflfastR is free and dramatically better. Your research doc already identified this.

#### Statistical Concerns

11. **Sample size is tiny** — 38 picks is statistically meaningless. Need ~2,900+ to confirm a 55% edge at 95% confidence. Can't draw conclusions yet, but the 36.8% rate is alarming.

12. **No bootstrap confidence intervals in production** — You ran them in iteration-batch5 but don't surface them to users. A 5-star pick showing "75.7% accuracy" with CI [70.1%, 81.5%] is very different from one with CI [51%, 99%].

### Betting Research Insights

| Concept | Formula/Finding | Relevance to Dorothy |
|---------|----------------|---------------------|
| **Kelly at -110** | f* = (0.909p - q) / 0.909 | Not implemented — should size bets by edge |
| **Break-even at -110** | 52.38% | All tiers currently below this |
| **CLV** | Closing prob - Bet prob | Not tracked — should be north star metric |
| **NCAAMB market efficiency** | Softest major market | Correct sport to focus on |
| **Sample size for 54%** | ~6,400 bets needed | Way too early to judge with 38 picks |
| **Walk-forward validation** | Only correct approach for temporal data | Already doing this ✅ |
| **Features per observation** | 15-20 min | 4 features on 70K games = safe ✅ |
| **Sharpe 0.3-0.5** | Decent edge | Iteration findings show 0.40 for hybrid strategy |

---

## Part 4: Code Quality & Architecture

### 🔴 Critical Security Issues

1. **Admin password bypass** (`auth.ts:27-49`) — Admin check ignores email field. Anyone with `ADMIN_PASSWORD` logs in as admin.

2. **Timing attack on site gate** (`api/gate/route.ts:11`) — Uses `!==` instead of `timingSafeEqual`. Admin login does it correctly, gate doesn't.

3. **Inconsistent CRON_SECRET verification** (`api/games/refresh/route.ts:30`) — Uses `===` when a timing-safe helper already exists.

### 🟠 High Priority

4. **N+1 queries in pick engine** — `resolveCanonicalName()` runs 1-4 DB queries per team × 200+ games = 200-800 queries per pick generation run.

5. **Rate limiter is useless on Vercel** — In-memory rate limiting resets on every cold start. Need Redis/Upstash.

6. **Race condition on pick generation** — Two simultaneous requests both trigger `generateDailyPicks`.

7. **No input validation on bet creation** — No length limits on string fields.

### 🟡 Architecture Concerns

8. **Pick engine is 2,450 lines** — Monolithic file handling 9 signal categories, scoring, headlines, props, grading. Should split into `signals/`, `scoring.ts`, `grading.ts`, `props.ts`.

9. **Hardcoded regression coefficients** — Magic numbers inline with no version tracking or A/B mechanism.

10. **Zero unit tests** — Only 5 basic E2E smoke tests. No tests for pick engine, grading, or any business logic.

11. **Service worker has no cache invalidation** — Stale pages persist after deployments.

12. **Missing Prisma indexes** — `DailyPick.confidence`, `Bet.dailyPickId`, OddsSnapshot query patterns.

13. **NBA excluded from cron** — Dead code path.

14. **`todayET()` duplicated 5+ times** — Extract to shared util.

15. **next-auth on beta** (5.0.0-beta.30) — In production.

### ✅ What's Done Well

- Solid auth architecture with NextAuth v5 + JWT
- Good Sentry integration with cron monitoring
- Proper security headers (CSP, HSTS, X-Frame-Options)
- Stripe webhook handling done correctly
- React Query caching on frontend
- Wilson intervals for statistical rigor
- Clean rate limiter abstraction (just needs real backend)

---

## Part 5: Priority Action Plan

### 🔥 Tier 1: Fix Now (Week 1)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Fix EOS→PIT data pipeline** — Join KenpomSnapshot to live predictions by game date, not current snapshot | Fixes the core model accuracy problem | Medium |
| 2 | **Re-backtest with true PIT data** — Run honest backtest using only pre-game snapshots | Reveals true model accuracy | Medium |
| 3 | **Fix admin password bypass** | Security critical | Low |
| 4 | **Fix timing-safe comparisons** | Security critical | Low |
| 5 | **Add CLV tracking** — Compare pick timing to closing lines | Essential metric for evaluating edge | Medium |

### 📈 Tier 2: Improve Model (Weeks 2-4)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 6 | **Recalibrate confidence tiers** with honest PIT backtest results | Fixes inverted confidence | Medium |
| 7 | **Implement asymmetric O/U strategy** — UNDER edge ≥ 2, OVER only line < 140 edge ≥ 5 | Iteration findings support this | Low |
| 8 | **Add Kelly Criterion bet sizing** — Surface recommended bet size based on edge | Better bankroll management | Low |
| 9 | **Suppress tournament game picks** — 37.6% ATS in tournaments | Avoid known losing spots | Low |
| 10 | **Add seasonal weighting** — Nov/Dec higher confidence, March lower | Exploits soft early lines | Medium |

### 🛠️ Tier 3: Technical Debt (Weeks 3-6)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 11 | **Split pick engine** into modules | Testability, maintainability | Medium |
| 12 | **Add unit tests** for pick engine, grading, scoring | Prevents regressions | Medium |
| 13 | **Batch team name resolution** | Eliminates N+1 queries | Low |
| 14 | **Replace in-memory rate limiter** with Upstash Redis | Actual rate limiting on Vercel | Low |
| 15 | **Add missing Prisma indexes** | Query performance | Low |

### 🚀 Tier 4: New Features (Months 2-3)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 16 | **Build NBA model** with Four Factors + B2B detection | Biggest untapped market | High |
| 17 | **Replace NFL power ratings** with EPA/play from nflfastR | Free, dramatically better | High |
| 18 | **Add NCAAF Five Factors** from CFBD API (already connected) | Low effort, big model improvement | Medium |
| 19 | **Bootstrap confidence intervals** surfaced to users | Honest uncertainty communication | Medium |
| 20 | **OddsSnapshot line movement analysis** | Detect sharp money | Medium |

---

## Appendix: Key Formulas

**Kelly Criterion at -110:**
```
f* = (0.909 × win_probability - loss_probability) / 0.909
```

**Break-even at -110:** 52.38%

**Sample size to confirm edge (95% CI):**
```
N = (1.96² × p × (1-p)) / (p - 0.5238)²
```
- 54% edge → ~6,400 bets
- 55% edge → ~2,900 bets
- 57% edge → ~1,050 bets

**NCAAMB O/U Regression (v9 PIT):**
```
predictedTotal = -233.5315 + 0.4346 × sumAdjDE + 0.4451 × sumAdjOE + 2.8399 × avgTempo
```

**CLV Formula:**
```
CLV = closing_line_implied_probability - bet_placed_implied_probability
```
Positive CLV = you got a better number than the market settled on.

---

*This report was generated from three parallel analyses: database statistical analysis, comprehensive betting research, and full codebase review. All 100+ source files were read. All 26 database tables were queried.*
