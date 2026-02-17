# 🏀 March 15 Deployment Checklist — Selection Sunday Launch

> **Trendline Tournament Launch — The Big Day**
> This is the single most important day for the product. Every item below is mandatory unless marked (optional).

---

## Phase 1: Pre-Launch (March 10–14)

### Monday, March 10 — Code Freeze & Final Deploys

- [ ] **Code freeze** main branch at 6:00 PM CT — no non-critical merges after this
- [ ] Deploy final production build
  ```bash
  git tag v1.0.0-tournament && git push origin v1.0.0-tournament
  # Deploy via your CI/CD pipeline
  ```
- [ ] Verify all critical bug fixes are merged and deployed:
  - [ ] NFL week calculation fix (no off-by-one on week boundaries)
  - [ ] Jest test suite passes cleanly: `npm test -- --ci`
  - [ ] Redis mock compatibility verified: `npm test -- --testPathPattern=redis`
- [ ] Run full test suite against production build:
  ```bash
  npm run test:ci
  npm run test:e2e
  ```
- [ ] Confirm all environment variables set for production (spot-check):
  ```bash
  # Verify critical env vars exist (don't print values)
  for var in DATABASE_URL REDIS_URL API_KEY ODDS_API_KEY; do
    [ -z "${!var}" ] && echo "MISSING: $var" || echo "OK: $var"
  done
  ```

### Tuesday, March 11 — Database & Backups

- [ ] Run pending database migrations against staging, then production:
  ```bash
  npx prisma migrate status
  npx prisma migrate deploy
  ```
- [ ] Full database backup:
  ```bash
  pg_dump "$NEON_DB" -Fc -f backup-pre-tournament-$(date +%Y%m%d).dump
  ```
- [ ] Verify backup restores cleanly (test on a scratch DB):
  ```bash
  createdb restore_test
  pg_restore -d restore_test backup-pre-tournament-*.dump
  # Spot-check row counts
  psql restore_test -c "SELECT count(*) FROM \"NCAAMBGame\";"
  dropdb restore_test
  ```
- [ ] Document rollback procedure and test it:
  ```bash
  # Rollback: revert to tagged release + restore DB
  git checkout v0.9.x-last-stable
  pg_restore -d "$NEON_DB" --clean backup-pre-tournament-*.dump
  ```
- [ ] Verify Neon DB branch/snapshot exists for point-in-time recovery

### Wednesday, March 12 — Performance & Load Testing

- [ ] Simulate tournament-level load (32+ simultaneous game pick generations):
  ```bash
  # Use k6, artillery, or ab
  k6 run --vus 50 --duration 60s load-test-picks.js
  ```
- [ ] Verify pick generation completes in **< 20 seconds** for 32 games
- [ ] Check database query performance under load:
  ```sql
  -- Slow query check
  SELECT query, mean_exec_time, calls
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC LIMIT 10;
  ```
- [ ] Verify API response times **< 500ms** on all endpoints:
  ```bash
  curl -o /dev/null -s -w "%{time_total}\n" https://api.trendline.app/picks
  ```
- [ ] Confirm rate limiting is operational:
  ```bash
  # Hit endpoint rapidly, expect 429 after threshold
  for i in $(seq 1 100); do
    curl -s -o /dev/null -w "%{http_code}\n" https://api.trendline.app/picks
  done | sort | uniq -c
  ```
- [ ] Redis cache warm-up and eviction policy confirmed

### Thursday, March 13 — Monitoring & Alerts

- [ ] Monitoring dashboard configured and accessible (Vercel Analytics / custom):
  - [ ] API error rate panel
  - [ ] Response time (p50, p95, p99)
  - [ ] Pick generation duration
  - [ ] Database connection pool utilization
  - [ ] Redis hit/miss ratio
- [ ] Alert thresholds configured:
  - [ ] Error rate > 1% → immediate alert
  - [ ] API p95 > 500ms → warning
  - [ ] Pick generation > 30s → critical
  - [ ] Database connections > 80% pool → warning
- [ ] Test alert delivery (send test alert, confirm receipt on phone/Slack/Discord)
- [ ] Error tracking (Sentry or equivalent) confirmed active with proper source maps
- [ ] Uptime monitoring on critical endpoints

### Friday, March 14 — Tournament Validation & Final Check

- [ ] Run tournament-specific validation suite:
  ```bash
  npm run test:tournament-validation
  ```
- [ ] Verify weight configurations sum to 1.0:
  ```bash
  # In your config/weights file, validate:
  node -e "
    const w = require('./config/weights');
    const sum = Object.values(w.tournament).reduce((a,b) => a+b, 0);
    console.log('Sum:', sum, sum === 1.0 ? '✅' : '❌ FAIL');
  "
  ```
- [ ] Verify tournament logic fires correctly with test bracket data:
  ```bash
  npm run test:tournament-logic
  ```
- [ ] CLV tracking functional — generate test pick, verify CLV recorded:
  ```sql
  SELECT pick_id, clv_value, created_at
  FROM "DailyPick"
  WHERE sport = 'NCAAMB' AND created_at > NOW() - INTERVAL '1 hour';
  ```
- [ ] Odds API returning tournament lines (may not be available until Selection Sunday):
  ```bash
  curl -s "https://api.the-odds-api.com/v4/sports/basketball_ncaab/odds/?apiKey=$ODDS_API_KEY&regions=us" | jq '.[] | .commence_time' | head -5
  ```
- [ ] **Go/No-Go decision** by 8:00 PM CT — all items above green ✅
- [ ] Team contact info and escalation chain documented and shared

---

## Phase 2: Launch Day — Sunday, March 15

### Morning (8:00 AM – 12:00 PM CT)

- [ ] **8:00 AM** — Team check-in. Confirm everyone is available and online
- [ ] **8:30 AM** — Fresh database backup:
  ```bash
  pg_dump "$NEON_DB" -Fc -f backup-launch-day-morning.dump
  ```
- [ ] **9:00 AM** — Verify all systems nominal:
  - [ ] API responding: `curl -s https://api.trendline.app/health | jq .`
  - [ ] Database connected and performant
  - [ ] Redis connected and caching
  - [ ] Monitoring dashboard live
- [ ] **9:30 AM** — Pre-stage social media posts (do not publish yet)
- [ ] **10:00 AM** — Warm caches with latest KenPom and team data:
  ```bash
  npm run refresh:kenpom
  npm run refresh:team-stats
  ```

### Selection Show (5:00 PM – 7:00 PM CT)

> CBS Selection Show typically starts at 5:00 PM CT. Bracket released progressively.

- [ ] **5:00 PM** — All hands on deck. Monitoring dashboard on screen
- [ ] **5:00–6:30 PM** — As bracket is revealed, begin ingesting tournament data:
  ```bash
  # Automated or manual trigger as matchups are announced
  npm run ingest:tournament-bracket
  ```
- [ ] **~6:30 PM** — Full bracket available. Verify complete ingestion:
  ```sql
  SELECT round, COUNT(*) as games
  FROM "NCAAMBGame"
  WHERE season_type = 'tournament' AND season = 2026
  GROUP BY round ORDER BY round;
  -- Expect: First Four (4), R64 (32), R32 (16), S16 (8), E8 (4), F4 (2), Championship (1)
  ```
- [ ] Verify all 68 teams mapped correctly (no name mismatches):
  ```sql
  SELECT g.home_team, t.id
  FROM "NCAAMBGame" g
  LEFT JOIN "Team" t ON g.home_team = t.name
  WHERE g.season_type = 'tournament' AND t.id IS NULL;
  -- Should return 0 rows
  ```

### Pick Generation (6:30 PM – 8:00 PM CT)

- [ ] **6:30 PM** — Trigger tournament pick generation:
  ```bash
  time npm run generate:tournament-picks
  ```
- [ ] Verify completion in **< 20 seconds** for 32+ First Round games
- [ ] Spot-check pick quality:
  ```sql
  SELECT team_name, confidence_stars, edge, sport
  FROM "DailyPick"
  WHERE sport = 'NCAAMB' AND created_at > NOW() - INTERVAL '1 hour'
  ORDER BY confidence_stars DESC LIMIT 10;
  ```
- [ ] Verify star ratings distribution looks reasonable (not all 5★ or all 1★)
- [ ] Confirm CLV values are being recorded for tournament picks
- [ ] Verify picks are accessible via API:
  ```bash
  curl -s https://api.trendline.app/picks?sport=NCAAMB&type=tournament | jq '.picks | length'
  ```

### Go Live & Communication (7:00 PM – 9:00 PM CT)

- [ ] **7:00 PM** — Publish tournament picks on platform
- [ ] **7:15 PM** — Social media posts go live:
  - [ ] Twitter/X: Bracket picks thread
  - [ ] (Optional) Discord announcement
  - [ ] (Optional) Email newsletter
- [ ] **7:30 PM** — Monitor real-time traffic:
  - [ ] API error rate < 1%
  - [ ] Response times < 500ms
  - [ ] No 5xx errors in logs
- [ ] **9:00 PM** — First hour post-launch status check. Document any issues

### Evening Wrap-Up

- [ ] Post-launch database backup:
  ```bash
  pg_dump "$NEON_DB" -Fc -f backup-launch-day-evening.dump
  ```
- [ ] Document any issues encountered and resolutions
- [ ] Confirm next day's schedule (First Four games typically Tuesday/Wednesday March 17-18)

---

## Phase 3: Post-Launch (March 16–22)

### Daily Routine (Each Day)

- [ ] Morning health check (8:00 AM):
  ```bash
  curl -s https://api.trendline.app/health | jq .
  ```
- [ ] Generate picks for that day's games (if any)
- [ ] Track pick accuracy:
  ```sql
  SELECT
    DATE(created_at) as date,
    confidence_stars,
    COUNT(*) as total,
    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
    ROUND(100.0 * SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) / COUNT(*), 1) as win_pct
  FROM "DailyPick"
  WHERE sport = 'NCAAMB' AND season_type = 'tournament'
  GROUP BY DATE(created_at), confidence_stars
  ORDER BY date, confidence_stars DESC;
  ```
- [ ] Monitor CLV:
  ```sql
  SELECT
    DATE(created_at) as date,
    ROUND(AVG(clv_value), 3) as avg_clv,
    COUNT(*) as picks
  FROM "DailyPick"
  WHERE sport = 'NCAAMB' AND season_type = 'tournament' AND clv_value IS NOT NULL
  GROUP BY DATE(created_at) ORDER BY date;
  ```
- [ ] Review error logs for any new issues
- [ ] Check API performance (response times, error rates)

### March 17–18 — First Four

- [ ] Generate First Four picks
- [ ] Monitor game results and record outcomes
- [ ] Verify automatic result ingestion works

### March 20–21 — Round of 64 (First Full Weekend)

- [ ] **This is the highest-volume period** — 32 games over 2 days
- [ ] Extra monitoring during game windows (11:00 AM – 11:00 PM CT)
- [ ] Performance check under peak load
- [ ] Accuracy tracking after each session of games
- [ ] If 5★ accuracy < 50% after 10+ picks, investigate model inputs

### March 22 — Round of 32

- [ ] Continue monitoring and pick generation
- [ ] First week retrospective:
  - [ ] Overall accuracy by star rating
  - [ ] CLV performance
  - [ ] System reliability metrics
  - [ ] User feedback summary
- [ ] Model calibration adjustments if needed (with extreme caution)

### User Feedback & Response

- [ ] Monitor support channels for user-reported issues
- [ ] Track common questions/complaints
- [ ] Prepare FAQ if patterns emerge
- [ ] Respond to feedback within 4 hours during tournament

---

## Phase 4: Emergency Procedures

### If Pick Generation Fails

```bash
# 1. Check logs
npm run logs:picks -- --tail 100

# 2. Verify data sources
curl -s "$ODDS_API_URL" | jq '.[] | .id' | head

# 3. Manual regeneration
npm run generate:tournament-picks -- --force --verbose

# 4. If data source is down, use cached data
npm run generate:tournament-picks -- --use-cache
```

### If API Goes Down

```bash
# 1. Check deployment status
vercel ls --prod

# 2. Check database connectivity
psql "$NEON_DB" -c "SELECT 1;"

# 3. Redeploy from last known good
git checkout v1.0.0-tournament
vercel --prod --force

# 4. If DB issue, restore from backup
pg_restore -d "$NEON_DB" --clean backup-launch-day-morning.dump
```

### If Accuracy Is Terrible (< 40% on 5★)

1. **Do NOT panic** — small sample variance is real
2. Review pick reasoning for obvious errors
3. Check if odds data was stale at generation time
4. Check weight configuration wasn't accidentally changed
5. If systematic issue found, fix and regenerate future picks (do NOT retroactively change published picks)

---

## Technical Verification Checklist (Final Sign-Off)

| Check | Command / Method | Expected | Status |
|---|---|---|---|
| Weight configs sum to 1.0 | Config validation script | `1.0` | ☐ |
| Tournament logic fires | `npm run test:tournament-logic` | All pass | ☐ |
| CLV tracking functional | Query DailyPick for clv_value | Non-null values | ☐ |
| Error monitoring active | Trigger test error, check Sentry | Alert received | ☐ |
| Rate limiting operational | Rapid-fire curl test | 429 after threshold | ☐ |
| DB performance acceptable | `pg_stat_statements` review | No query > 200ms avg | ☐ |
| API response times < 500ms | `curl -w "%{time_total}"` on all endpoints | < 0.5s | ☐ |
| Pick generation < 20s for 32 games | `time npm run generate:tournament-picks` | < 20s | ☐ |

---

## Success Criteria

| Metric | Target | Measurement |
|---|---|---|
| Pick generation speed | < 20 seconds for 32+ games | Timed during generation |
| 5★ pick accuracy (first weekend) | > 54% | SQL query on results |
| Critical system failures | Zero | Error monitoring |
| Endpoint error rate | < 1% | Monitoring dashboard |
| CLV on tournament picks | Positive | SQL query on CLV values |
| API p95 response time | < 500ms | Monitoring dashboard |

---

## Contacts & Escalation

| Role | Person | Contact |
|---|---|---|
| Lead Developer | — | — |
| Data/Model | — | — |
| Infrastructure | — | — |

> **Fill in before March 14.**

---

*Last updated: February 15, 2026*
*Next review: March 10, 2026 (code freeze day)*
