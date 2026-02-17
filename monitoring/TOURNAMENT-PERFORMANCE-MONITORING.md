# Tournament Performance Monitoring Plan

> **Season Window:** March 15 – April 7, 2026
> **Stack:** Vercel (Next.js) · Neon Postgres · Sentry · Custom metrics
> **Goal:** Zero missed picks, <500ms per-game latency, real-time CLV tracking

---

## 1. Key Performance Targets

| Metric | Target | Critical Threshold |
|---|---|---|
| Pick generation (single game) | <500ms | >2s |
| Pick generation (full slate, 32 games) | <20s | >45s |
| API response (any endpoint) | <500ms | >1s |
| Database query (p95) | <100ms | >500ms |
| Error rate (all endpoints) | <1% | >5% |
| Memory usage | <60% | >80% |
| Odds staleness | <2h | >6h |
| Cold start (Vercel function) | <1s | >3s |

---

## 2. Monitoring Stack Configuration

### 2.1 Sentry Setup

```typescript
// lib/monitoring/sentry.ts
import * as Sentry from "@sentry/nextjs";

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1.0, // 100% during tournament season (revert to 0.2 after)
    profilesSampleRate: 0.5,
    integrations: [
      Sentry.prismaIntegration(),
      Sentry.nativeNodeFetchIntegration(),
    ],
    beforeSend(event) {
      // Tag tournament-related errors
      const now = new Date();
      const tournamentStart = new Date("2026-03-15");
      const tournamentEnd = new Date("2026-04-08");
      if (now >= tournamentStart && now <= tournamentEnd) {
        event.tags = { ...event.tags, tournament: "active" };
      }
      return event;
    },
  });
}
```

**Sentry Alert Rules:**

| Alert | Condition | Action |
|---|---|---|
| Pick Generation Failure | Any error in `generatePicks` | PagerDuty + Discord webhook |
| High Error Rate | >5% over 5 min window | PagerDuty |
| Slow Transactions | p95 > 2s for 10 min | Discord warning |
| Database Errors | Any Prisma/connection error | PagerDuty + Discord |

```yaml
# sentry-alerts.yml (conceptual - configure via Sentry UI)
alerts:
  - name: "Pick Generation Failure"
    conditions:
      - type: event_frequency
        value: 1
        interval: 1m
    filters:
      - type: tagged_event
        key: function
        value: generatePicks
    actions:
      - type: notify_event_service
        service: pagerduty
      - type: notify_event_service_action
        service: discord-webhook

  - name: "Error Rate Spike"
    conditions:
      - type: event_frequency_percent
        value: 5
        interval: 5m
        comparisonInterval: 1h
    actions:
      - type: notify_event_service
        service: pagerduty

  - name: "Slow Pick Generation"
    conditions:
      - type: event_frequency
        value: 3
        interval: 10m
    filters:
      - type: tagged_event
        key: measurement.duration
        match: gte
        value: 2000
    actions:
      - type: notify_event_service
        service: discord-webhook
```

### 2.2 Custom Performance Instrumentation

```typescript
// lib/monitoring/metrics.ts

interface PerformanceMetric {
  name: string;
  value: number;
  unit: "ms" | "count" | "percent" | "bytes";
  tags: Record<string, string>;
  timestamp: Date;
}

const metrics: PerformanceMetric[] = [];

export function recordMetric(metric: Omit<PerformanceMetric, "timestamp">) {
  const entry = { ...metric, timestamp: new Date() };
  metrics.push(entry);

  // Send to Sentry as custom measurement
  Sentry.metrics.distribution(metric.name, metric.value, {
    unit: metric.unit,
    tags: metric.tags,
  });

  // Log for Vercel structured logging
  console.log(JSON.stringify({
    level: "metric",
    ...entry,
  }));
}

export function timeAsync<T>(
  name: string,
  tags: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  return fn().then(
    (result) => {
      recordMetric({ name, value: performance.now() - start, unit: "ms", tags });
      return result;
    },
    (error) => {
      recordMetric({ name: `${name}.error`, value: performance.now() - start, unit: "ms", tags });
      throw error;
    }
  );
}
```

```typescript
// Usage in pick generation
import { timeAsync, recordMetric } from "@/lib/monitoring/metrics";

export async function generateTournamentPicks(games: Game[]) {
  return timeAsync("pick_generation.full_slate", { sport: "NCAAMB", phase: "tournament" }, async () => {
    const picks = [];
    for (const game of games) {
      const pick = await timeAsync(
        "pick_generation.single_game",
        { sport: "NCAAMB", gameId: game.id },
        () => generateSinglePick(game)
      );
      picks.push(pick);
    }

    recordMetric({
      name: "pick_generation.batch_size",
      value: games.length,
      unit: "count",
      tags: { sport: "NCAAMB" },
    });

    return picks;
  });
}
```

### 2.3 Vercel Analytics & Monitoring

```typescript
// middleware.ts - request timing
import { NextResponse } from "next/server";

export function middleware(request: Request) {
  const start = Date.now();
  const response = NextResponse.next();

  response.headers.set("x-request-start", start.toString());
  response.headers.set("Server-Timing", `total;dur=${Date.now() - start}`);

  return response;
}
```

**Vercel Dashboard Checks (manual, daily during tournament):**
- Function execution duration (p50, p95, p99)
- Cold start frequency and duration
- Edge function performance
- Bandwidth usage
- Error logs by function

### 2.4 Neon Database Monitoring

```sql
-- Tournament monitoring queries - run via cron or manual check

-- 1. Active connections and pool utilization
SELECT count(*) as active_connections,
       max_connections,
       round(count(*)::numeric / max_connections * 100, 1) as pool_pct
FROM pg_stat_activity
CROSS JOIN (SELECT setting::int as max_connections FROM pg_settings WHERE name = 'max_connections') s
WHERE state = 'active';

-- 2. Slow queries (>100ms) in the last hour
SELECT query,
       round(mean_exec_time::numeric, 2) as avg_ms,
       calls,
       round(total_exec_time::numeric, 2) as total_ms
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;

-- 3. Table sizes and bloat (tournament tables)
SELECT relname as table,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size,
       n_live_tup as live_rows,
       n_dead_tup as dead_rows,
       round(n_dead_tup::numeric / greatest(n_live_tup, 1) * 100, 1) as dead_pct
FROM pg_stat_user_tables
WHERE relname IN ('DailyPick', 'OddsSnapshot', 'NCAAMBGame', 'UpcomingGame', 'Bet')
ORDER BY pg_total_relation_size(relid) DESC;

-- 4. Index usage during tournament
SELECT indexrelname as index,
       idx_scan as scans,
       idx_tup_read as tuples_read,
       idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC
LIMIT 20;

-- 5. Cache hit ratio (should be >99%)
SELECT
  round(sum(heap_blks_hit)::numeric / greatest(sum(heap_blks_hit) + sum(heap_blks_read), 1) * 100, 2) as cache_hit_ratio
FROM pg_statio_user_tables;
```

```bash
# Quick health check script
#!/bin/bash
# monitoring/db-health.sh

echo "=== Neon DB Tournament Health Check ==="
echo "Time: $(date -u)"

psql "$NEON_DB" -c "
SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_conn,
  (SELECT round(sum(heap_blks_hit)::numeric / greatest(sum(heap_blks_hit) + sum(heap_blks_read), 1) * 100, 2) FROM pg_statio_user_tables) as cache_hit_pct,
  (SELECT count(*) FROM \"DailyPick\" WHERE \"createdAt\" > now() - interval '1 hour') as picks_last_hour,
  (SELECT count(*) FROM \"OddsSnapshot\" WHERE \"timestamp\" > now() - interval '2 hours') as recent_odds,
  (SELECT count(*) FROM \"NCAAMBGame\" WHERE \"tipoff\" > now() AND \"tipoff\" < now() + interval '24 hours') as games_next_24h
;"
```

---

## 3. Alert Configuration

### 3.1 Discord Webhook Alerts

```typescript
// lib/monitoring/alerts.ts

type AlertLevel = "critical" | "warning" | "info";

const DISCORD_WEBHOOK = process.env.MONITORING_DISCORD_WEBHOOK!;

const COLORS: Record<AlertLevel, number> = {
  critical: 0xff0000,
  warning: 0xffa500,
  info: 0x0099ff,
};

const EMOJI: Record<AlertLevel, string> = {
  critical: "🚨",
  warning: "⚠️",
  info: "ℹ️",
};

export async function sendAlert(
  level: AlertLevel,
  title: string,
  description: string,
  fields?: { name: string; value: string; inline?: boolean }[]
) {
  await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: `${EMOJI[level]} ${title}`,
        description,
        color: COLORS[level],
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "Dorothy Tournament Monitor" },
      }],
    }),
  });
}
```

### 3.2 Alert Definitions

```typescript
// lib/monitoring/alert-rules.ts

export const ALERT_RULES = {
  critical: [
    {
      name: "Pick Generation Failure",
      check: (metrics) => metrics.pickGenErrors > 0,
      message: "Pick generation threw an error - games may be missing picks",
    },
    {
      name: "Database Connection Lost",
      check: (metrics) => metrics.dbErrors > 0,
      message: "Cannot connect to Neon database",
    },
    {
      name: "Error Rate Spike",
      check: (metrics) => metrics.errorRate > 0.05,
      message: (m) => `Error rate at ${(m.errorRate * 100).toFixed(1)}% (threshold: 5%)`,
    },
    {
      name: "All Picks Stale",
      check: (metrics) => metrics.latestPickAge > 12 * 60 * 60 * 1000,
      message: "No picks generated in 12+ hours during tournament",
    },
  ],
  warning: [
    {
      name: "Slow Response Times",
      check: (metrics) => metrics.p95ResponseTime > 1000,
      message: (m) => `p95 response time: ${m.p95ResponseTime}ms (threshold: 1000ms)`,
    },
    {
      name: "High Memory Usage",
      check: (metrics) => metrics.memoryPct > 80,
      message: (m) => `Memory at ${m.memoryPct}% (threshold: 80%)`,
    },
    {
      name: "Stale Odds Data",
      check: (metrics) => metrics.oddsAge > 6 * 60 * 60 * 1000,
      message: "Odds data older than 6 hours - picks may use stale lines",
    },
    {
      name: "Slow Pick Generation",
      check: (metrics) => metrics.pickGenP95 > 2000,
      message: (m) => `Pick gen p95: ${m.pickGenP95}ms`,
    },
  ],
  info: [
    {
      name: "High Volume Period",
      check: (metrics) => metrics.requestsPerMin > 100,
      message: (m) => `${m.requestsPerMin} req/min - tournament load detected`,
    },
    {
      name: "CLV Extreme",
      check: (metrics) => Math.abs(metrics.avgCLV) > 5,
      message: (m) => `Average CLV: ${m.avgCLV > 0 ? "+" : ""}${m.avgCLV.toFixed(1)}%`,
    },
  ],
};
```

---

## 4. Real-Time Dashboards

### 4.1 Tournament Command Center API

```typescript
// app/api/monitoring/tournament/route.ts

import { prisma } from "@/lib/prisma";

export async function GET() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    todayPicks,
    recentPicks,
    todayGames,
    oddsHealth,
    pickAccuracy,
  ] = await Promise.all([
    // Today's pick count
    prisma.dailyPick.count({
      where: { createdAt: { gte: oneDayAgo }, sport: "NCAAMB" },
    }),

    // Recent pick generation times (from logs/metrics)
    prisma.dailyPick.findMany({
      where: { createdAt: { gte: oneHourAgo }, sport: "NCAAMB" },
      select: { createdAt: true, confidence: true, edge: true },
      orderBy: { createdAt: "desc" },
    }),

    // Games today
    prisma.nCAAMBGame.count({
      where: {
        tipoff: { gte: oneDayAgo, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      },
    }),

    // Odds freshness
    prisma.oddsSnapshot.findFirst({
      where: { sport: "NCAAMB" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    }),

    // Pick accuracy (resolved picks this tournament)
    prisma.dailyPick.groupBy({
      by: ["confidence"],
      where: {
        sport: "NCAAMB",
        result: { not: null },
        createdAt: { gte: new Date("2026-03-15") },
      },
      _count: true,
      _avg: { edge: true },
    }),
  ]);

  const oddsAgeMinutes = oddsHealth
    ? Math.round((now.getTime() - oddsHealth.timestamp.getTime()) / 60000)
    : null;

  return Response.json({
    timestamp: now.toISOString(),
    status: oddsAgeMinutes && oddsAgeMinutes > 360 ? "degraded" : "healthy",
    tournament: {
      picksToday: todayPicks,
      gamesToday: todayGames,
      oddsAgeMinutes,
      recentPickCount: recentPicks.length,
    },
    accuracy: pickAccuracy,
    system: {
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      uptime: process.uptime(),
    },
  });
}
```

### 4.2 CLV Tracking Dashboard API

```typescript
// app/api/monitoring/clv/route.ts

import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const picks = await prisma.dailyPick.findMany({
    where: {
      sport: "NCAAMB",
      createdAt: { gte: since },
      closingLine: { not: null },
    },
    select: {
      createdAt: true,
      confidence: true,
      edge: true,
      openingLine: true,
      closingLine: true,
      result: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // CLV = closing line - opening line (for spread picks, simplified)
  const clvByTier = {};
  const clvByDay = {};

  for (const pick of picks) {
    const tier = pick.confidence || "unknown";
    const day = pick.createdAt.toISOString().split("T")[0];
    const clv = (pick.closingLine || 0) - (pick.openingLine || 0);

    if (!clvByTier[tier]) clvByTier[tier] = { total: 0, count: 0, wins: 0 };
    clvByTier[tier].total += clv;
    clvByTier[tier].count++;
    if (pick.result === "WIN") clvByTier[tier].wins++;

    if (!clvByDay[day]) clvByDay[day] = { total: 0, count: 0 };
    clvByDay[day].total += clv;
    clvByDay[day].count++;
  }

  return Response.json({
    period: { since: since.toISOString(), days },
    totalPicks: picks.length,
    clvByTier: Object.entries(clvByTier).map(([tier, d]: any) => ({
      tier,
      avgCLV: (d.total / d.count).toFixed(2),
      count: d.count,
      winRate: d.count > 0 ? ((d.wins / d.count) * 100).toFixed(1) + "%" : "N/A",
    })),
    clvByDay: Object.entries(clvByDay).map(([day, d]: any) => ({
      day,
      avgCLV: (d.total / d.count).toFixed(2),
      count: d.count,
    })),
  });
}
```

---

## 5. Tournament Phase Monitoring

### Selection Sunday (March 15)

```
CHECKLIST:
□ Bracket data ingested correctly (68 teams)
□ All tournament games created in NCAAMBGame table
□ KenPom data refreshed for all tournament teams
□ Initial odds loaded for First Four + Round of 64
□ Pick generation dry run - all games produce picks
□ Alert channels tested (Discord webhook, Sentry)
□ Database connection pool sized for tournament load
```

### First Four / Round of 64 (March 18-21)

```
EXPECTED LOAD:
- 4 games (First Four) → 16 games/day (R64)
- Pick generation: 16 games × <500ms = <8s target
- Odds refresh: Every 30 min for active games
- API requests: ~10x normal daily volume

MONITORING FOCUS:
- Pick generation completes before tipoff
- Odds data stays fresh (<2h)
- No duplicate picks generated
- CLV tracking begins on first results
```

### Round of 32 (March 22-23)

```
VALIDATION CHECKPOINT:
- Review R64 pick accuracy by confidence tier
- CLV analysis: are we beating closing lines?
- Model calibration check: predicted vs actual margins
- Signal attribution: which factors drove correct/incorrect picks
- Adjust confidence thresholds if needed
```

### Sweet 16 through Championship (March 27 - April 7)

```
MONITORING FOCUS:
- Smaller game counts, higher scrutiny per pick
- Public line movement tracking (sharp vs public money)
- Increased media attention = more API traffic
- Final accuracy tallying and reporting
```

---

## 6. Emergency Procedures

### Severity Levels

| Level | Trigger | Response Time | Responder |
|---|---|---|---|
| SEV-1 | Pick generation completely down | <15 min | Owner immediate |
| SEV-2 | >50% of picks failing or stale odds | <30 min | Owner |
| SEV-3 | Degraded performance (slow but working) | <2 hours | Next available |
| SEV-4 | Non-critical (logging gaps, minor UI bugs) | Next day | Backlog |

### SEV-1: Pick Generation Down

```
1. CHECK: Vercel function logs for errors
   $ vercel logs dorothy --since 1h

2. CHECK: Database connectivity
   $ psql "$NEON_DB" -c "SELECT 1;"

3. CHECK: API key validity (odds provider)
   $ curl -s "https://api.the-odds-api.com/v4/sports/?apiKey=$ODDS_API_KEY" | head

4. IF DB down:
   - Check Neon dashboard for outage
   - Neon status: https://neonstatus.com
   - If regional outage: wait (no failover available on free tier)

5. IF function error:
   - Check Sentry for stack trace
   - Redeploy last known good: git revert HEAD && vercel --prod
   - If dependency issue: check package versions

6. IF odds API down:
   - Use cached odds (last snapshot)
   - Generate picks with stale warning flag
   - Monitor odds API status page

7. COMMUNICATE:
   - Post status to Discord monitoring channel
   - Update any affected users
```

### SEV-2: Degraded Performance

```
1. Identify bottleneck (DB query? API call? computation?)
2. Check Neon connection pool utilization
3. Review recent deployments for regression
4. If DB:
   - Run ANALYZE on hot tables
   - Check for missing indexes on tournament queries
   - Review connection count vs pool limit
5. If compute:
   - Check Vercel function memory limits
   - Look for memory leaks in recent picks
   - Consider splitting batch into smaller chunks
```

### Rollback Decision Criteria

```
ROLL BACK IF:
- New deploy causes >2% error rate increase
- Pick generation time >3x baseline
- Any data corruption detected
- Memory usage trending to OOM

DO NOT ROLL BACK IF:
- Issue is upstream (odds API, Neon outage)
- Performance degradation is <20% and non-critical
- Issue only affects non-tournament features
```

---

## 7. Pre-Tournament Checklist

Run one week before tournament (March 8):

```bash
#!/bin/bash
# monitoring/pre-tournament-check.sh

echo "=== Dorothy Pre-Tournament Readiness ==="

# 1. Database health
echo -e "\n--- Database ---"
psql "$NEON_DB" -c "
  SELECT 'Tables' as check,
    (SELECT count(*) FROM \"NCAAMBGame\") as ncaamb_games,
    (SELECT count(*) FROM \"KenpomSnapshot\" WHERE \"date\" > now() - interval '7 days') as recent_kenpom,
    (SELECT count(*) FROM \"OddsSnapshot\" WHERE \"timestamp\" > now() - interval '24 hours') as recent_odds,
    (SELECT count(*) FROM \"DailyPick\" WHERE \"createdAt\" > now() - interval '24 hours') as recent_picks;
"

# 2. API health
echo -e "\n--- API Endpoints ---"
for endpoint in "/api/picks" "/api/games" "/api/monitoring/tournament"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://dorothy.app${endpoint}")
  echo "${endpoint}: ${status}"
done

# 3. Odds API quota
echo -e "\n--- Odds API ---"
curl -s "https://api.the-odds-api.com/v4/sports/?apiKey=$ODDS_API_KEY" \
  -D - -o /dev/null 2>/dev/null | grep -i "x-requests-remaining"

# 4. Sentry health
echo -e "\n--- Sentry ---"
echo "Check: https://sentry.io/organizations/YOUR_ORG/issues/?project=dorothy"

# 5. Memory baseline
echo -e "\n--- Complete ---"
echo "Review results above. Fix any issues before March 15."
```

---

## 8. Post-Tournament Report Template

```markdown
# Tournament 2026 Performance Report

## Pick Performance
- Total picks generated: ___
- Overall accuracy: ___%
- Accuracy by confidence tier:
  - High: ___%
  - Medium: ___%
  - Low: ___%
- Average CLV: ___
- Best pick: ___
- Worst pick: ___

## System Performance
- Uptime: ___%
- Average pick generation time: ___ms
- Peak load: ___ req/min
- Total errors: ___
- SEV-1 incidents: ___
- SEV-2 incidents: ___

## Lessons Learned
1. ___
2. ___
3. ___

## Recommendations for 2027
1. ___
2. ___
3. ___
```

---

## 9. Monitoring Commands Quick Reference

```bash
# Live tail Vercel logs
vercel logs dorothy --since 5m --follow

# Database quick health
psql "$NEON_DB" -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"

# Check recent picks
psql "$NEON_DB" -c "SELECT sport, confidence, count(*), avg(edge) FROM \"DailyPick\" WHERE \"createdAt\" > now() - interval '24 hours' GROUP BY sport, confidence;"

# Odds freshness
psql "$NEON_DB" -c "SELECT sport, max(timestamp), now() - max(timestamp) as age FROM \"OddsSnapshot\" GROUP BY sport;"

# Tournament accuracy
psql "$NEON_DB" -c "
  SELECT confidence,
    count(*) as total,
    sum(CASE WHEN result='WIN' THEN 1 ELSE 0 END) as wins,
    round(sum(CASE WHEN result='WIN' THEN 1 ELSE 0 END)::numeric / count(*) * 100, 1) as win_pct
  FROM \"DailyPick\"
  WHERE sport='NCAAMB' AND \"createdAt\" >= '2026-03-15' AND result IS NOT NULL
  GROUP BY confidence
  ORDER BY confidence;
"

# Test Discord webhook
curl -X POST "$MONITORING_DISCORD_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{"embeds":[{"title":"🧪 Test Alert","description":"Monitoring webhook working","color":65280}]}'
```
