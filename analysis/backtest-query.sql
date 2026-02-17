-- Quick 10-Day Backtest Query
-- Get picks from last 10 days and analyze performance

-- Set the date range (last 10 days)
\set start_date '''2026-02-05'''
\set end_date '''2026-02-15'''

\echo '🏀 Trendline 10-Day Backtest Report'
\echo '====================================='
\echo ''

-- Overall summary
\echo '📊 OVERALL PERFORMANCE'
SELECT 
  COUNT(*) as total_picks,
  COUNT(CASE WHEN result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'LOSS' THEN 1 END) as losses,
  COUNT(CASE WHEN result = 'PUSH' THEN 1 END) as pushes,
  ROUND(
    COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
    NULLIF(COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END), 0), 
    1
  ) as win_rate_pct,
  CASE 
    WHEN COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END) > 0 THEN
      ROUND(
        (COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
         COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END)) - 52.38,
        1
      )
    ELSE NULL
  END as roi_vs_breakeven
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL;

\echo ''
\echo '⭐ PERFORMANCE BY CONFIDENCE TIER'
SELECT 
  confidence as tier,
  COUNT(*) as total_picks,
  COUNT(CASE WHEN result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'LOSS' THEN 1 END) as losses,
  ROUND(
    COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
    NULLIF(COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END), 0), 
    1
  ) as win_rate_pct
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL
GROUP BY confidence
ORDER BY confidence DESC;

\echo ''
\echo '🏆 PERFORMANCE BY SPORT'
SELECT 
  sport,
  COUNT(*) as total_picks,
  COUNT(CASE WHEN result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'LOSS' THEN 1 END) as losses,
  ROUND(
    COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
    NULLIF(COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END), 0), 
    1
  ) as win_rate_pct
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL
GROUP BY sport
ORDER BY total_picks DESC;

\echo ''
\echo '🎯 PERFORMANCE BY PICK TYPE'
SELECT 
  "pickType",
  COUNT(*) as total_picks,
  COUNT(CASE WHEN result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'LOSS' THEN 1 END) as losses,
  ROUND(
    COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
    NULLIF(COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END), 0), 
    1
  ) as win_rate_pct
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL
GROUP BY "pickType"
ORDER BY total_picks DESC;

\echo ''
\echo '📅 DAILY BREAKDOWN'
SELECT 
  "gameDate"::date as date,
  COUNT(*) as total_picks,
  COUNT(CASE WHEN result = 'WIN' THEN 1 END) as wins,
  COUNT(CASE WHEN result = 'LOSS' THEN 1 END) as losses,
  ROUND(
    COUNT(CASE WHEN result = 'WIN' THEN 1 END) * 100.0 / 
    NULLIF(COUNT(CASE WHEN result IN ('WIN', 'LOSS') THEN 1 END), 0), 
    1
  ) as win_rate_pct
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL
GROUP BY "gameDate"::date
ORDER BY "gameDate"::date;

-- CLV Analysis if available
\echo ''
\echo '💰 CLOSING LINE VALUE (CLV)'
SELECT 
  COUNT(CASE WHEN clv IS NOT NULL THEN 1 END) as clv_sample_size,
  CASE 
    WHEN COUNT(CASE WHEN clv IS NOT NULL THEN 1 END) > 0 THEN
      ROUND(AVG(clv), 2)
    ELSE NULL
  END as avg_clv,
  CASE 
    WHEN COUNT(CASE WHEN clv IS NOT NULL THEN 1 END) > 0 THEN
      ROUND(
        COUNT(CASE WHEN clv > 0 THEN 1 END) * 100.0 / 
        COUNT(CASE WHEN clv IS NOT NULL THEN 1 END),
        1
      )
    ELSE NULL
  END as positive_clv_rate_pct
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL;

\echo ''
\echo '📋 RAW DATA SAMPLE (Last 20 picks)'
SELECT 
  "gameDate"::date,
  sport,
  "homeTeam",
  "awayTeam", 
  "pickType",
  "pickSide",
  confidence,
  result,
  COALESCE(clv, 0) as clv
FROM "DailyPick" 
WHERE "gameDate" >= DATE(:start_date)
  AND "gameDate" <= DATE(:end_date)
  AND result IS NOT NULL
ORDER BY "gameDate" DESC, id DESC
LIMIT 20;