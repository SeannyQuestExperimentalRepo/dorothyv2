# Post-Launch Analysis Framework
## Trendline Engine — March Madness 2025 & Beyond

> **Purpose**: Measure, attribute, and optimize Trendline performance during the NCAA Tournament and establish ongoing analysis practices.
> **Timeline**: March 18 (First Four) → April 7 (Championship) + 30-day retrospective
> **Last Updated**: 2025-02-15

---

## Table of Contents

1. [Tournament Performance Analysis](#1-tournament-performance-analysis)
2. [Market Beating Analysis](#2-market-beating-analysis)
3. [Signal Attribution Analysis](#3-signal-attribution-analysis)
4. [Business Impact Measurement](#4-business-impact-measurement)
5. [Technical Performance Review](#5-technical-performance-review)
6. [Competitive Intelligence](#6-competitive-intelligence)
7. [Long-Term Success Planning](#7-long-term-success-planning)
8. [SQL Query Library](#8-sql-query-library)
9. [Analysis Scripts](#9-analysis-scripts)
10. [Success Criteria](#10-success-criteria)

---

## 1. Tournament Performance Analysis

### 1.1 Overall Win Rate by Confidence Tier

**Target Benchmarks:**
| Tier | Target Win Rate | Min Sample | Breakeven Implied |
|------|----------------|------------|-------------------|
| 5★   | 62%+           | 15 picks   | ~58% at -110      |
| 4★   | 58%+           | 40 picks   | ~55% at -110      |
| 3★   | 54%+           | 80 picks   | ~52% at -110      |

```sql
-- Win rate by confidence tier (tournament period)
SELECT
  confidence_tier,
  COUNT(*) AS total_picks,
  SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN result = 'PUSH' THEN 1 ELSE 0 END) AS pushes,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND created_at >= '2025-03-18'
  AND created_at <= '2025-04-08'
GROUP BY confidence_tier
ORDER BY confidence_tier DESC;
```

### 1.2 Performance by Tournament Round

```sql
-- Performance by round
SELECT
  tournament_round,
  confidence_tier,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND created_at >= '2025-03-18'
GROUP BY tournament_round, confidence_tier
ORDER BY
  CASE tournament_round
    WHEN 'First Four' THEN 1
    WHEN 'Round of 64' THEN 2
    WHEN 'Round of 32' THEN 3
    WHEN 'Sweet 16' THEN 4
    WHEN 'Elite 8' THEN 5
    WHEN 'Final Four' THEN 6
    WHEN 'Championship' THEN 7
  END,
  confidence_tier DESC;
```

**Key Hypotheses:**
- Early rounds (64, 32) should show higher accuracy due to larger talent gaps
- Later rounds should show stronger UNDER performance (defensive intensity)
- 5★ picks should maintain edge across all rounds

### 1.3 Performance by Pick Type

```sql
-- Performance by bet type
SELECT
  pick_type,  -- 'SPREAD', 'TOTAL', 'MONEYLINE'
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(AVG(closing_line_value)::numeric, 2) AS avg_clv,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND created_at >= '2025-03-18'
GROUP BY pick_type
ORDER BY net_units DESC;
```

### 1.4 Tournament-Specific Logic Effectiveness

#### UNDER Boost Analysis

```sql
-- UNDER boost effectiveness in tournament
SELECT
  tournament_round,
  pick_type,
  CASE WHEN pick_side LIKE '%UNDER%' THEN 'UNDER' ELSE 'OVER' END AS direction,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND pick_type = 'TOTAL'
GROUP BY tournament_round, pick_type, direction
ORDER BY tournament_round, direction;
```

#### Seed Mismatch Analysis

```sql
-- Seed mismatch performance
WITH seed_picks AS (
  SELECT
    dp.*,
    ABS(g.home_seed - g.away_seed) AS seed_diff,
    CASE
      WHEN ABS(g.home_seed - g.away_seed) >= 8 THEN 'Large (8+)'
      WHEN ABS(g.home_seed - g.away_seed) >= 4 THEN 'Medium (4-7)'
      ELSE 'Small (1-3)'
    END AS mismatch_tier
  FROM "DailyPick" dp
  JOIN "NCAAMBGame" g ON dp.game_id = g.id
  WHERE dp.sport = 'NCAAMB'
    AND dp.is_tournament = true
)
SELECT
  mismatch_tier,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM seed_picks
GROUP BY mismatch_tier
ORDER BY mismatch_tier;
```

### 1.5 Tournament vs Regular Season Comparison

```sql
-- Tournament vs regular season (same teams where possible)
SELECT
  CASE WHEN is_tournament THEN 'Tournament' ELSE 'Regular Season' END AS period,
  confidence_tier,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(AVG(closing_line_value)::numeric, 2) AS avg_clv,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND created_at >= '2024-11-01'
GROUP BY is_tournament, confidence_tier
ORDER BY period, confidence_tier DESC;
```

---

## 2. Market Beating Analysis

### 2.1 Closing Line Value (CLV) by Tier

CLV is the single most important long-term profitability indicator.

```sql
-- CLV distribution by confidence tier
SELECT
  confidence_tier,
  COUNT(*) AS picks,
  ROUND(AVG(closing_line_value)::numeric, 3) AS avg_clv,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY closing_line_value)::numeric, 3) AS median_clv,
  ROUND(STDDEV(closing_line_value)::numeric, 3) AS clv_stddev,
  SUM(CASE WHEN closing_line_value > 0 THEN 1 ELSE 0 END) AS positive_clv_count,
  ROUND(
    SUM(CASE WHEN closing_line_value > 0 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 1
  ) AS positive_clv_pct
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND closing_line_value IS NOT NULL
GROUP BY confidence_tier
ORDER BY confidence_tier DESC;
```

**Success Criteria:**
- 5★ picks: avg CLV > +1.5 points
- 4★ picks: avg CLV > +0.8 points
- 3★ picks: avg CLV > +0.3 points
- Overall positive CLV rate > 55%

### 2.2 Sharp vs Public Money Performance

```sql
-- Performance when fading public money
SELECT
  CASE
    WHEN public_bet_pct > 65 AND pick_aligns_public = false THEN 'Fading Heavy Public'
    WHEN public_bet_pct > 55 AND pick_aligns_public = false THEN 'Fading Moderate Public'
    WHEN pick_aligns_public = true THEN 'With Public'
    ELSE 'Neutral'
  END AS public_alignment,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(AVG(closing_line_value)::numeric, 3) AS avg_clv
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
GROUP BY public_alignment
ORDER BY win_pct DESC;
```

### 2.3 Line Movement & Timing Analysis

```sql
-- Early vs late line position performance
SELECT
  CASE
    WHEN hours_before_game > 12 THEN 'Early (12h+)'
    WHEN hours_before_game > 4 THEN 'Mid (4-12h)'
    ELSE 'Late (<4h)'
  END AS timing_bucket,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(AVG(closing_line_value)::numeric, 3) AS avg_clv,
  ROUND(AVG(line_movement)::numeric, 2) AS avg_line_move
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
GROUP BY timing_bucket
ORDER BY timing_bucket;
```

### 2.4 Steam Move Detection Performance

```sql
-- Performance on steam-detected picks
SELECT
  CASE WHEN steam_detected THEN 'Steam Detected' ELSE 'No Steam' END AS steam_status,
  CASE WHEN pick_follows_steam THEN 'Followed Steam' ELSE 'Faded Steam' END AS steam_action,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND steam_detected IS NOT NULL
GROUP BY steam_status, steam_action;
```

### 2.5 Book Comparison

```sql
-- Performance against different sportsbook lines
SELECT
  sportsbook,
  COUNT(*) AS picks,
  ROUND(AVG(closing_line_value)::numeric, 3) AS avg_clv,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct
FROM "DailyPick" dp
JOIN "OddsSnapshot" os ON dp.game_id = os.game_id
WHERE dp.sport = 'NCAAMB'
  AND dp.is_tournament = true
GROUP BY sportsbook
ORDER BY avg_clv DESC;
```

---

## 3. Signal Attribution Analysis

### 3.1 Signal Contribution to Wins

```sql
-- Signal presence in winning vs losing picks
SELECT
  signal_name,
  COUNT(*) AS total_fires,
  SUM(CASE WHEN dp.result = 'WIN' THEN 1 ELSE 0 END) AS in_wins,
  SUM(CASE WHEN dp.result = 'LOSS' THEN 1 ELSE 0 END) AS in_losses,
  ROUND(
    SUM(CASE WHEN dp.result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN dp.result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS signal_win_pct,
  ROUND(AVG(signal_weight)::numeric, 3) AS avg_weight,
  ROUND(AVG(dp.closing_line_value)::numeric, 3) AS avg_clv_when_present
FROM pick_signals ps
JOIN "DailyPick" dp ON ps.pick_id = dp.id
WHERE dp.sport = 'NCAAMB'
  AND dp.is_tournament = true
GROUP BY signal_name
ORDER BY signal_win_pct DESC;
```

### 3.2 Weight Optimization Recommendations

```sql
-- Signal effectiveness vs assigned weight (find over/under-weighted signals)
WITH signal_stats AS (
  SELECT
    signal_name,
    AVG(signal_weight) AS current_weight,
    SUM(CASE WHEN dp.result = 'WIN' THEN 1 ELSE 0 END)::numeric /
      NULLIF(SUM(CASE WHEN dp.result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) AS win_rate,
    AVG(dp.closing_line_value) AS avg_clv,
    COUNT(*) AS sample_size
  FROM pick_signals ps
  JOIN "DailyPick" dp ON ps.pick_id = dp.id
  WHERE dp.sport = 'NCAAMB' AND dp.is_tournament = true
  GROUP BY signal_name
  HAVING COUNT(*) >= 10
)
SELECT
  signal_name,
  ROUND(current_weight::numeric, 3) AS current_weight,
  ROUND(win_rate * 100, 2) AS win_pct,
  ROUND(avg_clv::numeric, 3) AS avg_clv,
  sample_size,
  CASE
    WHEN win_rate > 0.58 AND avg_clv > 1.0 THEN '⬆️ INCREASE weight'
    WHEN win_rate < 0.48 OR avg_clv < -0.5 THEN '⬇️ DECREASE weight'
    ELSE '➡️ Keep current'
  END AS recommendation
FROM signal_stats
ORDER BY avg_clv DESC;
```

### 3.3 Signal Decay Detection

```sql
-- Rolling signal effectiveness over time (detect decay)
SELECT
  signal_name,
  DATE_TRUNC('week', dp.created_at) AS week,
  COUNT(*) AS fires,
  ROUND(
    SUM(CASE WHEN dp.result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN dp.result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS win_pct,
  ROUND(AVG(dp.closing_line_value)::numeric, 3) AS avg_clv
FROM pick_signals ps
JOIN "DailyPick" dp ON ps.pick_id = dp.id
WHERE dp.sport = 'NCAAMB'
  AND dp.created_at >= '2024-11-01'
GROUP BY signal_name, DATE_TRUNC('week', dp.created_at)
ORDER BY signal_name, week;
```

**Decay Triggers:**
- Signal CLV drops below 0 for 3+ consecutive weeks → flag for review
- Signal win rate drops 10%+ from season average → investigate
- Signal fires on >80% of games → likely too broad, needs tightening

---

## 4. Business Impact Measurement

### 4.1 User Engagement Metrics

```sql
-- Pick adoption rate
SELECT
  DATE_TRUNC('day', dp.created_at) AS day,
  COUNT(DISTINCT dp.id) AS picks_generated,
  COUNT(DISTINCT b.pick_id) AS picks_bet,
  ROUND(
    COUNT(DISTINCT b.pick_id)::numeric / NULLIF(COUNT(DISTINCT dp.id), 0) * 100, 1
  ) AS adoption_pct
FROM "DailyPick" dp
LEFT JOIN "Bet" b ON dp.id = b.pick_id
WHERE dp.created_at >= '2025-03-18'
GROUP BY DATE_TRUNC('day', dp.created_at)
ORDER BY day;
```

```sql
-- Confidence tier preference
SELECT
  dp.confidence_tier,
  COUNT(DISTINCT dp.id) AS generated,
  COUNT(DISTINCT b.pick_id) AS bet_on,
  ROUND(
    COUNT(DISTINCT b.pick_id)::numeric / NULLIF(COUNT(DISTINCT dp.id), 0) * 100, 1
  ) AS adoption_pct
FROM "DailyPick" dp
LEFT JOIN "Bet" b ON dp.id = b.pick_id
WHERE dp.created_at >= '2025-03-18'
GROUP BY dp.confidence_tier
ORDER BY dp.confidence_tier DESC;
```

```sql
-- User retention during tournament
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) FILTER (WHERE is_new_signup) AS new_signups,
  COUNT(DISTINCT user_id) AS daily_active_users,
  COUNT(DISTINCT user_id) FILTER (WHERE last_active >= created_at - INTERVAL '1 day') AS returning_users
FROM user_activity_log
WHERE created_at >= '2025-03-01'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day;
```

### 4.2 Revenue & Cost Analysis

**Key Metrics to Track:**
| Metric | Pre-Tournament Baseline | Tournament Target | Measurement |
|--------|------------------------|-------------------|-------------|
| Active subscriptions | _baseline_ | +25% | Stripe dashboard |
| Daily active users | _baseline_ | +50% | DB query |
| Infrastructure cost/day | _baseline_ | <2x baseline | Vercel/Neon billing |
| API calls/day | _baseline_ | Track | Vercel analytics |
| Revenue per pick | _baseline_ | Track | Calculated |

```sql
-- Subscription growth during tournament
SELECT
  DATE_TRUNC('week', created_at) AS week,
  COUNT(*) AS new_subscriptions,
  SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('week', created_at)) AS cumulative_subs
FROM "User"
WHERE subscription_status = 'active'
  AND created_at >= '2025-02-01'
GROUP BY DATE_TRUNC('week', created_at)
ORDER BY week;
```

---

## 5. Technical Performance Review

### 5.1 System Reliability Checklist

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| Uptime | 99.5%+ | Vercel status / monitoring |
| Pick generation latency | <30s | Application logs |
| Odds refresh latency | <60s | Cron job logs |
| Database query P95 | <500ms | Neon metrics |
| Failed pick generations | <2% | Error logs |

```sql
-- Pick generation performance
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS picks_generated,
  ROUND(AVG(generation_time_ms)::numeric, 0) AS avg_gen_ms,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY generation_time_ms)::numeric, 0) AS p95_gen_ms,
  COUNT(*) FILTER (WHERE generation_error IS NOT NULL) AS errors
FROM pick_generation_log
WHERE created_at >= '2025-03-18'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour;
```

### 5.2 Model Evolution Tracking

```sql
-- Rolling model accuracy (7-day window)
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS picks,
  ROUND(
    SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 2
  ) AS daily_win_pct,
  ROUND(AVG(closing_line_value)::numeric, 3) AS daily_avg_clv,
  -- 7-day rolling
  ROUND(
    SUM(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)) OVER w::numeric /
    NULLIF(SUM(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END)) OVER w, 0) * 100, 2
  ) AS rolling_7d_win_pct
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND created_at >= '2025-03-01'
GROUP BY DATE_TRUNC('day', created_at)
WINDOW w AS (ORDER BY DATE_TRUNC('day', created_at) ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
ORDER BY day;
```

---

## 6. Competitive Intelligence

### Edge Persistence Tracking

```sql
-- Track if our CLV advantage decays over the tournament
SELECT
  DATE_TRUNC('day', created_at) AS day,
  ROUND(AVG(closing_line_value)::numeric, 3) AS avg_clv,
  ROUND(AVG(closing_line_value) FILTER (WHERE confidence_tier = 5)::numeric, 3) AS five_star_clv,
  COUNT(*) AS picks
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day;
```

**What to Watch:**
- CLV compression day-over-day → market adapting to similar signals
- Win rate divergence from CLV → variance or model miscalibration
- Competitor pick overlap increasing → edge commoditization

---

## 7. Long-Term Success Planning

### Post-Tournament Review Schedule

| Date | Activity | Output |
|------|----------|--------|
| Apr 8 | Tournament results compilation | Raw data export |
| Apr 10 | Signal attribution analysis | Weight adjustment recommendations |
| Apr 15 | Full performance report | Stakeholder presentation |
| Apr 22 | Model improvement planning | Research roadmap |
| May 1 | Product roadmap update | Feature priorities for 2025-26 |

### Next Season Research Directions

1. **Model Improvements**
   - Incorporate tournament-specific features (rest days, travel distance, altitude)
   - Bayesian updating during tournament (adjust priors after each round)
   - Player-level impact models for injury/absence scenarios

2. **Product Expansion**
   - Live in-game picks (halftime adjustments)
   - Parlay optimizer using correlated picks
   - Player prop integration

3. **Market Expansion Candidates**
   - NBA Playoffs (April-June)
   - NFL 2025-26 season
   - Conference tournament pre-March Madness

---

## 8. SQL Query Library

All queries above use these assumed column conventions. Adapt field names to actual schema:

```
DailyPick:
  id, sport, pick_type, pick_side, confidence_tier, result,
  units_won, closing_line_value, game_id, created_at,
  is_tournament, tournament_round, hours_before_game,
  line_movement, public_bet_pct, pick_aligns_public,
  steam_detected, pick_follows_steam, generation_time_ms

NCAAMBGame:
  id, home_seed, away_seed, home_team, away_team, game_date,
  tournament_round

OddsSnapshot:
  game_id, sportsbook, spread, total, moneyline, timestamp

Bet:
  id, pick_id, user_id, amount, created_at

pick_signals (junction):
  pick_id, signal_name, signal_weight, signal_value
```

### Quick Health Check Query

```sql
-- Run daily during tournament: overall pulse
SELECT
  'Tournament Pulse' AS report,
  COUNT(*) AS total_picks,
  ROUND(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 1) AS win_pct,
  ROUND(AVG(closing_line_value)::numeric, 2) AS avg_clv,
  ROUND(SUM(units_won)::numeric, 2) AS net_units,
  COUNT(DISTINCT DATE_TRUNC('day', created_at)) AS active_days
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND is_tournament = true
  AND created_at >= '2025-03-18';
```

---

## 9. Analysis Scripts

### Daily Tournament Report (run via cron or heartbeat)

```bash
#!/bin/bash
# daily-tournament-report.sh
# Run each morning during tournament

REPORT_DATE=$(date -d yesterday +%Y-%m-%d)

psql "$NEON_DB" <<SQL
-- Yesterday's performance
SELECT
  confidence_tier,
  COUNT(*) AS picks,
  SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) AS losses,
  ROUND(AVG(closing_line_value)::numeric, 2) AS avg_clv,
  ROUND(SUM(units_won)::numeric, 2) AS units
FROM "DailyPick"
WHERE sport = 'NCAAMB'
  AND DATE(created_at) = '${REPORT_DATE}'
GROUP BY confidence_tier
ORDER BY confidence_tier DESC;

-- Cumulative tournament
SELECT
  confidence_tier,
  COUNT(*) AS total,
  ROUND(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END)::numeric /
    NULLIF(SUM(CASE WHEN result IN ('WIN','LOSS') THEN 1 ELSE 0 END), 0) * 100, 1) AS win_pct,
  ROUND(SUM(units_won)::numeric, 2) AS net_units
FROM "DailyPick"
WHERE sport = 'NCAAMB' AND is_tournament = true
GROUP BY confidence_tier
ORDER BY confidence_tier DESC;
SQL
```

### Signal Decay Monitor

```bash
#!/bin/bash
# signal-decay-monitor.sh
# Run weekly — flags signals losing edge

psql "$NEON_DB" -t <<SQL
WITH weekly AS (
  SELECT
    signal_name,
    DATE_TRUNC('week', dp.created_at) AS week,
    AVG(dp.closing_line_value) AS avg_clv
  FROM pick_signals ps
  JOIN "DailyPick" dp ON ps.pick_id = dp.id
  WHERE dp.created_at >= NOW() - INTERVAL '8 weeks'
  GROUP BY signal_name, DATE_TRUNC('week', dp.created_at)
),
decay AS (
  SELECT
    signal_name,
    COUNT(*) FILTER (WHERE avg_clv < 0) AS negative_weeks,
    COUNT(*) AS total_weeks
  FROM weekly
  GROUP BY signal_name
)
SELECT signal_name || ': ' || negative_weeks || '/' || total_weeks || ' negative CLV weeks ⚠️'
FROM decay
WHERE negative_weeks >= 3
ORDER BY negative_weeks DESC;
SQL
```

---

## 10. Success Criteria

### Tier 1: Must Hit (Core Viability)
- [ ] Overall tournament win rate ≥ 54%
- [ ] 5★ picks win rate ≥ 58%
- [ ] Average CLV > 0 across all tiers
- [ ] System uptime ≥ 99% during tournament
- [ ] Zero missed game windows (picks generated on time)

### Tier 2: Strong Performance
- [ ] Overall tournament win rate ≥ 56%
- [ ] 5★ picks win rate ≥ 62%
- [ ] Positive CLV on ≥ 60% of picks
- [ ] Net positive units at flat betting
- [ ] UNDER boost generates measurable edge in tournament
- [ ] User adoption rate ≥ 40% of generated picks

### Tier 3: Exceptional
- [ ] Overall tournament win rate ≥ 58%
- [ ] Net +10 units over tournament (flat betting)
- [ ] Average CLV > +1.0 across all picks
- [ ] Subscription growth ≥ 25% during tournament
- [ ] Multiple signals maintain edge through championship

### Red Flags (Immediate Investigation)
- 🚨 Win rate drops below 45% for any 3-day stretch
- 🚨 CLV turns negative for 5★ picks
- 🚨 System downtime > 30 minutes during game windows
- 🚨 Pick generation failure rate > 5%
- 🚨 Any signal shows >15% win rate decline week-over-week

---

## Appendix: Visualization Configuration

### Recommended Dashboards

1. **Daily Performance Dashboard** — Win rate, CLV, units by day (line chart)
2. **Signal Heatmap** — Signal × Round matrix with win rate color coding
3. **CLV Distribution** — Histogram of CLV values by confidence tier
4. **Cumulative P&L** — Running units won chart with confidence bands
5. **User Engagement Funnel** — Generated → Viewed → Bet → Won

### Chart.js / Recharts Config Skeleton

```javascript
// Cumulative P&L chart config
const cumulativePnL = {
  type: 'line',
  data: {
    labels: [], // dates
    datasets: [
      { label: '5★', data: [], borderColor: '#10b981', tension: 0.3 },
      { label: '4★', data: [], borderColor: '#3b82f6', tension: 0.3 },
      { label: '3★', data: [], borderColor: '#8b5cf6', tension: 0.3 },
      { label: 'All', data: [], borderColor: '#f59e0b', borderWidth: 3, tension: 0.3 },
    ]
  },
  options: {
    plugins: { title: { display: true, text: 'Cumulative Units Won — March Madness 2025' } },
    scales: { y: { title: { display: true, text: 'Units' } } }
  }
};
```

---

*This framework is a living document. Update queries and criteria as schema evolves. Run the daily report script throughout the tournament and compile the full retrospective by April 15.*
