# Phase 5: Polish & Launch Readiness

> **Context Management:** When context reaches 70%, compact the conversation and continue.
> Compaction summary should include: completed tasks, current task progress, key decisions made.

Phase 1 fixed bugs. Phase 2 added tests and architecture. Phase 3 built regression models and CLV tracking. Phase 4 added market signals and edge detection. Phase 5 is **the final phase before tournament launch** — polishing the user experience, hardening for 32+ game days, building monitoring, and ensuring we can deploy, rollback, and recover under tournament pressure.

**Timeline:** March 4 – March 10 (must complete 5 days before Selection Sunday on March 15). Conference tournaments start ~March 10, so monitoring and performance must be live before then.

**Goal:** Ship a tournament-ready product that handles peak load (32+ games/day), surfaces picks beautifully, monitors everything, and can recover from any failure within minutes.

**Context budget estimate:**
- This prompt: ~15k tokens
- `src/lib/pick-engine.ts`: ~25k tokens (pick generation, batching)
- `prisma/schema.prisma`: ~10k tokens (monitoring tables)
- `src/app/` UI components: ~15k tokens (tournament views)
- New files created by this phase: ~20k tokens
- **Total: ~85k tokens (~42% of 200k)**

Load files in this priority order:
1. `src/lib/pick-engine.ts` — pick generation pipeline, signal weighting
2. `prisma/schema.prisma` — existing schema for all sport models
3. `src/app/` — existing UI pages and components
4. `src/lib/clv-engine.ts` — CLV and market signal systems from Phase 4
5. Task-specific files as needed

**Prerequisites from previous phases:**
- Phase 1: Bug fixes, error boundaries, Sentry integration
- Phase 2: Test suite, Redis caching, architecture improvements
- Phase 3: Ridge regression models, CLV tracking, signal weights
- Phase 4: Line movement detection, market alerts, sharp money analysis, odds monitoring

---

## Task 1: Performance Optimization for Tournament Volume

**Why:** Tournament Thursday and Friday have 32+ games in a single day. The current pick generation pipeline processes games sequentially. At peak load, this means slow API responses, potential timeouts, and degraded UX. We need to batch pick generation, optimize queries, and add caching so the system handles tournament volume without breaking a sweat.

**Where:** `src/lib/pick-engine.ts`, `src/lib/cache.ts` (new), database query optimization across all data access layers.

**Implementation:**

    // src/lib/pick-batch.ts
    // Batched pick generation for tournament days
    
    import { prisma } from '@/lib/prisma';
    import { redis } from '@/lib/redis';
    import { generatePick } from '@/lib/pick-engine';
    
    interface BatchConfig {
        concurrency: number;      // max parallel pick generations
        batchSize: number;        // games per batch
        timeoutMs: number;        // per-pick timeout
        retryAttempts: number;    // retries on failure
    }
    
    const TOURNAMENT_CONFIG: BatchConfig = {
        concurrency: 8,
        batchSize: 16,
        timeoutMs: 30_000,
        retryAttempts: 3,
    };
    
    const REGULAR_CONFIG: BatchConfig = {
        concurrency: 4,
        batchSize: 8,
        timeoutMs: 60_000,
        retryAttempts: 2,
    };
    
    export async function generatePicksBatch(
        gameIds: string[],
        sport: string,
        config?: Partial<BatchConfig>
    ): Promise<BatchResult> {
        const cfg = {
            ...(gameIds.length > 16 ? TOURNAMENT_CONFIG : REGULAR_CONFIG),
            ...config,
        };
        
        const batches = chunk(gameIds, cfg.batchSize);
        const results: PickResult[] = [];
        const errors: PickError[] = [];
        
        for (const batch of batches) {
            const batchResults = await Promise.allSettled(
                batch.map(gameId =>
                    withTimeout(
                        withRetry(() => generatePick(gameId, sport), cfg.retryAttempts),
                        cfg.timeoutMs
                    )
                )
            );
            
            for (let i = 0; i < batchResults.length; i++) {
                const result = batchResults[i];
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    errors.push({
                        gameId: batch[i],
                        error: result.reason?.message ?? 'Unknown error',
                        timestamp: new Date(),
                    });
                }
            }
        }
        
        return { results, errors, totalGames: gameIds.length };
    }
    
    function chunk<T>(arr: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }
    
    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
            ),
        ]);
    }
    
    async function withRetry<T>(
        fn: () => Promise<T>,
        attempts: number
    ): Promise<T> {
        let lastError: Error | undefined;
        for (let i = 0; i < attempts; i++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err as Error;
                if (i < attempts - 1) {
                    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                }
            }
        }
        throw lastError;
    }

**Database query optimization — add indexes:**

    // Add to prisma/schema.prisma
    // On NCAAMBGame:
    @@index([gameDate, status])
    @@index([tournamentRound])
    
    // On DailyPick:
    @@index([sport, createdAt])
    @@index([sport, result])
    @@index([confidenceTier, sport])
    
    // On OddsSnapshot (from Phase 4):
    @@index([gameId, sport, timestamp])

**Caching layer improvements:**

    // src/lib/cache.ts
    // Multi-tier caching: in-memory (LRU) + Redis
    
    import { redis } from '@/lib/redis';
    
    const memoryCache = new Map<string, { value: unknown; expiry: number }>();
    const MAX_MEMORY_ENTRIES = 500;
    
    interface CacheOptions {
        ttlSeconds: number;
        memoryOnly?: boolean;   // skip Redis for ultra-fast reads
    }
    
    // Tournament-specific TTLs
    export const CACHE_TTL = {
        PICKS_LIST: 60,          // 1 min — picks change with new odds
        PICK_DETAIL: 300,        // 5 min — individual pick analysis
        KENPOM_STATS: 3600,      // 1 hour — KenPom updates daily
        GAME_LIST: 120,          // 2 min — game status changes
        LEADERBOARD: 300,        // 5 min — accuracy leaderboard
        BRACKET: 60,             // 1 min during games
    } as const;
    
    export async function cacheGet<T>(key: string): Promise<T | null> {
        // Check memory first
        const mem = memoryCache.get(key);
        if (mem && mem.expiry > Date.now()) {
            return mem.value as T;
        }
        memoryCache.delete(key);
        
        // Fall back to Redis
        const val = await redis.get(key);
        if (val) {
            const parsed = JSON.parse(val as string) as T;
            // Populate memory cache
            memoryCache.set(key, {
                value: parsed,
                expiry: Date.now() + 30_000, // 30s memory TTL
            });
            pruneMemoryCache();
            return parsed;
        }
        return null;
    }
    
    export async function cacheSet<T>(
        key: string,
        value: T,
        opts: CacheOptions
    ): Promise<void> {
        memoryCache.set(key, {
            value,
            expiry: Date.now() + opts.ttlSeconds * 1000,
        });
        pruneMemoryCache();
        
        if (!opts.memoryOnly) {
            await redis.set(key, JSON.stringify(value), {
                ex: opts.ttlSeconds,
            });
        }
    }
    
    export async function cacheInvalidate(pattern: string): Promise<void> {
        // Clear memory cache matching pattern
        for (const key of memoryCache.keys()) {
            if (key.includes(pattern)) memoryCache.delete(key);
        }
        // Clear Redis keys matching pattern
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    }
    
    function pruneMemoryCache(): void {
        if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
        const entries = [...memoryCache.entries()]
            .sort((a, b) => a[1].expiry - b[1].expiry);
        const toRemove = entries.slice(0, entries.length - MAX_MEMORY_ENTRIES);
        for (const [key] of toRemove) memoryCache.delete(key);
    }

**Testing & validation:**
- Load test: simulate 32 concurrent pick generations, measure p95 response time < 5s
- Cache hit rate should be > 80% on repeated page loads
- Database query time for game list endpoints < 100ms (check with `EXPLAIN ANALYZE`)
- Memory usage should stay under 512MB during peak batch processing
- Run `prisma migrate dev` after adding indexes, verify no regressions

**Success criteria:**
- 32-game batch pick generation completes in < 2 minutes
- API response times < 500ms for all list endpoints under load
- Zero timeouts during simulated tournament day traffic

---

## Task 2: User Experience Polish

**Why:** Tournament is when users engage most. The UI needs to surface picks clearly, show confidence levels visually, and work flawlessly on mobile. Users should see at a glance which games have the strongest edges, track accuracy by round, and feel the excitement of tournament betting.

**Where:** `src/app/` — tournament-specific pages and components, `src/components/` — shared UI components.

**New pages and components:**

    // src/app/tournament/page.tsx
    // Main tournament hub — bracket view with picks overlay
    
    import { getTournamentGames } from '@/lib/tournament';
    import { TournamentBracket } from '@/components/tournament/bracket';
    import { PickCard } from '@/components/picks/pick-card';
    import { AccuracyTracker } from '@/components/tournament/accuracy-tracker';
    
    export default async function TournamentPage() {
        const games = await getTournamentGames();
        const picksByRound = groupByRound(games);
        
        return (
            <div className="max-w-7xl mx-auto px-4 py-6">
                <TournamentHeader />
                <AccuracyTracker />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                    <div className="lg:col-span-2">
                        <TournamentBracket games={games} />
                    </div>
                    <div className="space-y-4">
                        <h2 className="text-xl font-bold">Today's Picks</h2>
                        {picksByRound.map(([round, picks]) => (
                            <RoundSection key={round} round={round} picks={picks} />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

**Confidence visualization component:**

    // src/components/picks/confidence-badge.tsx
    
    interface ConfidenceBadgeProps {
        tier: 'STRONG' | 'LEAN' | 'HOLD';
        confidenceScore: number;  // 0-100
        clv?: number;             // closing line value if available
    }
    
    export function ConfidenceBadge({ tier, confidenceScore, clv }: ConfidenceBadgeProps) {
        const colors = {
            STRONG: 'bg-green-500/20 text-green-400 border-green-500/30',
            LEAN: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            HOLD: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        };
        
        const barWidth = Math.min(confidenceScore, 100);
        
        return (
            <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colors[tier]}`}>
                    {tier}
                </span>
                <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full ${
                            tier === 'STRONG' ? 'bg-green-500' :
                            tier === 'LEAN' ? 'bg-yellow-500' : 'bg-gray-500'
                        }`}
                        style={{ width: `${barWidth}%` }}
                    />
                </div>
                <span className="text-xs text-gray-400">{confidenceScore}%</span>
                {clv !== undefined && (
                    <span className={`text-xs ${clv > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        CLV: {clv > 0 ? '+' : ''}{clv.toFixed(1)}
                    </span>
                )}
            </div>
        );
    }

**Historical accuracy by tournament round:**

    // src/components/tournament/accuracy-tracker.tsx
    
    export async function AccuracyTracker() {
        const accuracy = await getTournamentAccuracy();
        
        const rounds = [
            { name: 'First Four', key: 'first_four' },
            { name: 'Round of 64', key: 'round_64' },
            { name: 'Round of 32', key: 'round_32' },
            { name: 'Sweet 16', key: 'sweet_16' },
            { name: 'Elite 8', key: 'elite_8' },
            { name: 'Final Four', key: 'final_four' },
            { name: 'Championship', key: 'championship' },
        ];
        
        return (
            <div className="bg-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                    Tournament Accuracy by Round
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                    {rounds.map(round => {
                        const data = accuracy[round.key];
                        if (!data) return null;
                        const pct = data.total > 0
                            ? ((data.wins / data.total) * 100).toFixed(0)
                            : '—';
                        return (
                            <div key={round.key} className="text-center">
                                <div className="text-xs text-gray-500">{round.name}</div>
                                <div className="text-lg font-bold">
                                    {pct}{pct !== '—' ? '%' : ''}
                                </div>
                                <div className="text-xs text-gray-500">
                                    {data.wins}/{data.total}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

**Mobile optimization:**

    // Ensure all tournament pages use responsive grid
    // Key mobile considerations:
    // - Bracket collapses to vertical scroll on mobile
    // - Pick cards stack vertically
    // - Confidence bars remain visible at small sizes
    // - Touch targets >= 44px
    // - Swipe between rounds on mobile bracket view
    
    // src/components/tournament/mobile-bracket.tsx
    // Horizontal scrollable bracket for mobile
    export function MobileBracket({ games }: { games: TournamentGame[] }) {
        return (
            <div className="overflow-x-auto snap-x snap-mandatory">
                <div className="flex gap-4 min-w-max px-4 py-2">
                    {roundNames.map(round => (
                        <div
                            key={round}
                            className="snap-center w-[85vw] flex-shrink-0"
                        >
                            <RoundColumn round={round} games={filterByRound(games, round)} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

**Real-time pick updates via polling:**

    // src/hooks/use-live-picks.ts
    // Poll for pick updates during tournament games
    
    import { useEffect, useState } from 'react';
    
    export function useLivePicks(sport: string, interval = 60_000) {
        const [picks, setPicks] = useState<Pick[]>([]);
        const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
        
        useEffect(() => {
            const fetchPicks = async () => {
                const res = await fetch(`/api/picks?sport=${sport}&live=true`);
                if (res.ok) {
                    const data = await res.json();
                    setPicks(data.picks);
                    setLastUpdated(new Date());
                }
            };
            
            fetchPicks();
            const id = setInterval(fetchPicks, interval);
            return () => clearInterval(id);
        }, [sport, interval]);
        
        return { picks, lastUpdated };
    }

**Testing & validation:**
- Test bracket view at 320px, 768px, 1024px, 1440px widths
- Verify touch targets are ≥ 44px on mobile
- Test with 32+ games rendered simultaneously — no jank
- Lighthouse mobile score > 80
- Verify real-time polling doesn't cause memory leaks (check in DevTools)

**Success criteria:**
- Tournament page loads in < 2s on 3G connection
- Bracket view is usable on iPhone SE (smallest common screen)
- Confidence visualization clearly communicates pick strength at a glance
- Accuracy tracker updates after each game grades

---

## Task 3: Production Monitoring & Alerting

**Why:** During the tournament, we need to know immediately if pick generation fails, if accuracy drops, or if the system is under stress. We can't wait for users to report issues — we need proactive monitoring with Discord alerts.

**Where:** Create `src/lib/monitoring.ts`, `src/lib/alerts.ts`, integrate with existing Sentry from Phase 1.

**Schema additions:**

    // Add to prisma/schema.prisma
    model SystemMetric {
        id          String   @id @default(cuid())
        metricName  String   // pick_gen_success, pick_gen_failure, api_latency, etc.
        metricValue Float
        tags        Json?    // { sport: "NCAAMB", endpoint: "/api/picks" }
        timestamp   DateTime @default(now())
        
        @@index([metricName, timestamp])
        @@index([timestamp])
    }
    
    model AlertEvent {
        id          String   @id @default(cuid())
        alertType   String   // pick_failure, accuracy_drop, high_latency, etc.
        severity    String   // critical, warning, info
        message     String
        metadata    Json?
        resolved    Boolean  @default(false)
        resolvedAt  DateTime?
        createdAt   DateTime @default(now())
        
        @@index([alertType, resolved])
        @@index([createdAt])
    }

**Core monitoring implementation:**

    // src/lib/monitoring.ts
    
    import { prisma } from '@/lib/prisma';
    import { sendDiscordAlert } from '@/lib/alerts';
    
    export async function recordMetric(
        name: string,
        value: number,
        tags?: Record<string, string>
    ): Promise<void> {
        await prisma.systemMetric.create({
            data: {
                metricName: name,
                metricValue: value,
                tags: tags ?? undefined,
            },
        });
    }
    
    // Track pick generation outcomes
    export async function trackPickGeneration(
        sport: string,
        gameId: string,
        success: boolean,
        durationMs: number,
        error?: string
    ): Promise<void> {
        await recordMetric(
            success ? 'pick_gen_success' : 'pick_gen_failure',
            durationMs,
            { sport, gameId }
        );
        
        if (!success) {
            // Check failure rate in last hour
            const recentFailures = await prisma.systemMetric.count({
                where: {
                    metricName: 'pick_gen_failure',
                    timestamp: { gte: new Date(Date.now() - 3600_000) },
                },
            });
            
            if (recentFailures >= 5) {
                await sendDiscordAlert({
                    type: 'pick_failure',
                    severity: 'critical',
                    message: `🚨 ${recentFailures} pick generation failures in the last hour`,
                    metadata: { sport, gameId, error, recentFailures },
                });
            }
        }
    }
    
    // Track model accuracy in real-time
    export async function trackAccuracy(sport: string): Promise<void> {
        const last50 = await prisma.dailyPick.findMany({
            where: {
                sport,
                result: { not: null },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { result: true },
        });
        
        if (last50.length < 20) return;
        
        const wins = last50.filter(p => p.result === 'WIN').length;
        const accuracy = wins / last50.length;
        
        await recordMetric('model_accuracy', accuracy, { sport });
        
        // Alert if accuracy drops below 45% (worse than coin flip)
        if (accuracy < 0.45) {
            await sendDiscordAlert({
                type: 'accuracy_drop',
                severity: 'warning',
                message: `⚠️ ${sport} accuracy dropped to ${(accuracy * 100).toFixed(1)}% over last ${last50.length} picks`,
                metadata: { sport, accuracy, sampleSize: last50.length },
            });
        }
    }
    
    // Track API endpoint latency
    export function createLatencyMiddleware() {
        return async (req: Request, next: () => Promise<Response>) => {
            const start = Date.now();
            const response = await next();
            const duration = Date.now() - start;
            
            // Only record for slow requests to avoid metric explosion
            if (duration > 1000) {
                await recordMetric('api_slow_request', duration, {
                    path: new URL(req.url).pathname,
                    method: req.method,
                });
            }
            
            return response;
        };
    }

**Discord alert integration:**

    // src/lib/alerts.ts
    
    interface AlertPayload {
        type: string;
        severity: 'critical' | 'warning' | 'info';
        message: string;
        metadata?: Record<string, unknown>;
    }
    
    const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL;
    
    export async function sendDiscordAlert(payload: AlertPayload): Promise<void> {
        if (!DISCORD_WEBHOOK_URL) {
            console.warn('[alerts] No Discord webhook configured, skipping alert');
            return;
        }
        
        // Deduplicate: don't send the same alert type within 15 min
        const recentAlert = await prisma.alertEvent.findFirst({
            where: {
                alertType: payload.type,
                resolved: false,
                createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
            },
        });
        
        if (recentAlert) return;
        
        // Record alert
        await prisma.alertEvent.create({
            data: {
                alertType: payload.type,
                severity: payload.severity,
                message: payload.message,
                metadata: payload.metadata ?? undefined,
            },
        });
        
        const colors = { critical: 0xff0000, warning: 0xffaa00, info: 0x0099ff };
        
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: `${payload.severity.toUpperCase()}: ${payload.type}`,
                    description: payload.message,
                    color: colors[payload.severity],
                    fields: payload.metadata
                        ? Object.entries(payload.metadata).map(([k, v]) => ({
                            name: k,
                            value: String(v),
                            inline: true,
                        }))
                        : [],
                    timestamp: new Date().toISOString(),
                }],
            }),
        });
    }

**Health check endpoint:**

    // src/app/api/health/route.ts
    
    import { prisma } from '@/lib/prisma';
    import { redis } from '@/lib/redis';
    
    export async function GET() {
        const checks: Record<string, boolean> = {};
        
        // Database check
        try {
            await prisma.$queryRaw`SELECT 1`;
            checks.database = true;
        } catch {
            checks.database = false;
        }
        
        // Redis check
        try {
            await redis.ping();
            checks.redis = true;
        } catch {
            checks.redis = false;
        }
        
        // Recent pick generation check
        try {
            const recentPick = await prisma.dailyPick.findFirst({
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            });
            checks.recentPicks = recentPick
                ? (Date.now() - recentPick.createdAt.getTime()) < 24 * 3600_000
                : false;
        } catch {
            checks.recentPicks = false;
        }
        
        const allHealthy = Object.values(checks).every(Boolean);
        
        return Response.json(
            { status: allHealthy ? 'healthy' : 'degraded', checks },
            { status: allHealthy ? 200 : 503 }
        );
    }

**Testing & validation:**
- Trigger each alert type manually — verify Discord webhook delivery
- Simulate 5+ pick failures in an hour — verify critical alert fires
- Verify deduplication: same alert type shouldn't fire within 15 min
- Health check returns 503 when database is unreachable
- Metrics table doesn't grow unbounded — add cleanup job for metrics older than 30 days

**Success criteria:**
- All critical failures trigger Discord alerts within 60 seconds
- Health check endpoint responds in < 100ms
- Monitoring dashboard shows pick gen success rate, accuracy, and latency
- Alert deduplication prevents notification spam

---

## Task 4: Tournament Marketing & Communication

**Why:** Tournament is our showcase. We need to surface our accuracy, let users share picks, and build credibility through transparent performance tracking. This drives user acquisition and retention during the highest-traffic betting period.

**Where:** New pages in `src/app/`, API endpoints for leaderboard and sharing.

**Performance dashboard:**

    // src/app/performance/page.tsx
    // Public-facing performance dashboard
    
    export default async function PerformancePage() {
        const stats = await getPerformanceStats();
        
        return (
            <div className="max-w-4xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-2">Trendline Performance</h1>
                <p className="text-gray-400 mb-8">
                    Transparent, verifiable pick tracking. Every pick timestamped before game time.
                </p>
                
                {/* Overall stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    <StatCard label="Overall Record" value={`${stats.wins}-${stats.losses}`} />
                    <StatCard label="Win Rate" value={`${stats.winRate}%`} />
                    <StatCard label="Avg CLV" value={`+${stats.avgClv.toFixed(1)}`} positive />
                    <StatCard label="ROI" value={`${stats.roi > 0 ? '+' : ''}${stats.roi.toFixed(1)}%`} positive={stats.roi > 0} />
                </div>
                
                {/* By confidence tier */}
                <TierBreakdown tiers={stats.byTier} />
                
                {/* By sport */}
                <SportBreakdown sports={stats.bySport} />
                
                {/* Recent picks with results */}
                <RecentPicksTable picks={stats.recentPicks} />
            </div>
        );
    }

**Pick sharing for social media:**

    // src/app/api/picks/[id]/share/route.ts
    // Generate shareable pick card image (OG image)
    
    import { ImageResponse } from 'next/og';
    
    export async function GET(
        request: Request,
        { params }: { params: { id: string } }
    ) {
        const pick = await prisma.dailyPick.findUnique({
            where: { id: params.id },
        });
        
        if (!pick) return new Response('Not found', { status: 404 });
        
        return new ImageResponse(
            (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
                    width: '1200',
                    height: '630',
                    padding: '60px',
                    color: 'white',
                    fontFamily: 'system-ui',
                }}>
                    <div style={{ fontSize: '24px', color: '#888', marginBottom: '20px' }}>
                        TRENDLINE PICK
                    </div>
                    <div style={{ fontSize: '48px', fontWeight: 'bold', marginBottom: '10px' }}>
                        {pick.headline}
                    </div>
                    <div style={{
                        fontSize: '32px',
                        color: pick.confidenceTier === 'STRONG' ? '#4ade80' : '#facc15',
                        marginBottom: '20px',
                    }}>
                        {pick.confidenceTier} • {pick.sport}
                    </div>
                    <div style={{ fontSize: '20px', color: '#aaa', marginTop: 'auto' }}>
                        trendline.bet • Timestamped & Verified
                    </div>
                </div>
            ),
            { width: 1200, height: 630 }
        );
    }

**User notification system for high-confidence picks:**

    // src/lib/notifications.ts
    
    export async function notifyHighConfidencePicks(
        picks: DailyPick[]
    ): Promise<void> {
        const strongPicks = picks.filter(p => p.confidenceTier === 'STRONG');
        
        if (strongPicks.length === 0) return;
        
        // Discord notification
        const webhook = process.env.DISCORD_PICKS_WEBHOOK_URL;
        if (!webhook) return;
        
        const embeds = strongPicks.map(pick => ({
            title: `🔥 STRONG Pick: ${pick.headline}`,
            description: pick.analysis?.slice(0, 200) ?? '',
            color: 0x4ade80,
            fields: [
                { name: 'Sport', value: pick.sport, inline: true },
                { name: 'Edge', value: `${pick.edge?.toFixed(1) ?? '?'}%`, inline: true },
                { name: 'Confidence', value: `${pick.confidenceScore ?? '?'}%`, inline: true },
            ],
            timestamp: new Date().toISOString(),
        }));
        
        // Send in batches of 10 (Discord embed limit)
        for (let i = 0; i < embeds.length; i += 10) {
            await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: embeds.slice(i, i + 10) }),
            });
        }
    }

**Tournament recap API:**

    // src/app/api/tournament/recap/route.ts
    // Daily tournament recap — results, accuracy, notable picks
    
    export async function GET(request: Request) {
        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];
        
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport: 'NCAAMB',
                createdAt: {
                    gte: new Date(`${date}T00:00:00Z`),
                    lt: new Date(`${date}T23:59:59Z`),
                },
                result: { not: null },
            },
            orderBy: { confidenceScore: 'desc' },
        });
        
        const wins = picks.filter(p => p.result === 'WIN').length;
        const losses = picks.filter(p => p.result === 'LOSS').length;
        const strongPicks = picks.filter(p => p.confidenceTier === 'STRONG');
        const strongWins = strongPicks.filter(p => p.result === 'WIN').length;
        
        return Response.json({
            date,
            record: `${wins}-${losses}`,
            winRate: picks.length > 0 ? ((wins / picks.length) * 100).toFixed(1) : null,
            strongRecord: `${strongWins}-${strongPicks.length - strongWins}`,
            avgClv: picks.reduce((sum, p) => sum + (p.clvSpread ?? 0), 0) / (picks.length || 1),
            notablePicks: picks.slice(0, 5).map(p => ({
                headline: p.headline,
                result: p.result,
                tier: p.confidenceTier,
                clv: p.clvSpread,
            })),
        });
    }

**Testing & validation:**
- Performance page renders with real data from previous picks
- Share image generates correctly at 1200x630
- Discord notifications fire for STRONG picks only
- Recap endpoint returns accurate win/loss counts matching database

**Success criteria:**
- Performance dashboard is live and publicly accessible
- OG share images render correctly on Twitter/Discord/iMessage
- High-confidence pick notifications reach Discord within 5 min of generation

---

## Task 5: Edge Case Handling & Resilience

**Why:** Tournaments are chaotic. Games get postponed, players get injured before tip-off, and upsets cascade through brackets. The system must handle all of this gracefully without crashing or generating stale picks.

**Where:** `src/lib/pick-engine.ts`, `src/lib/grading.ts`, new `src/lib/game-status.ts`.

**Game status monitoring:**

    // src/lib/game-status.ts
    
    export type GameStatus = 
        | 'scheduled'
        | 'in_progress'
        | 'final'
        | 'postponed'
        | 'cancelled'
        | 'delayed'
        | 'overtime';
    
    interface GameStatusChange {
        gameId: string;
        sport: string;
        oldStatus: GameStatus;
        newStatus: GameStatus;
        reason?: string;
        timestamp: Date;
    }
    
    export async function handleStatusChange(
        change: GameStatusChange
    ): Promise<void> {
        const { gameId, sport, oldStatus, newStatus, reason } = change;
        
        switch (newStatus) {
            case 'postponed':
            case 'cancelled':
                // Void any picks for this game
                await prisma.dailyPick.updateMany({
                    where: { gameId, sport, result: null },
                    data: {
                        result: 'VOID',
                        notes: `Game ${newStatus}: ${reason ?? 'No reason given'}`,
                    },
                });
                
                // Invalidate cache
                await cacheInvalidate(`picks:${sport}`);
                
                // Alert
                await sendDiscordAlert({
                    type: 'game_status_change',
                    severity: 'warning',
                    message: `🏀 Game ${newStatus}: ${gameId} — ${reason ?? 'unknown reason'}`,
                    metadata: { gameId, sport, oldStatus, newStatus, reason },
                });
                break;
                
            case 'delayed':
                // Keep picks active but flag them
                await prisma.dailyPick.updateMany({
                    where: { gameId, sport, result: null },
                    data: { notes: `Game delayed: ${reason ?? 'unknown'}` },
                });
                break;
                
            case 'overtime':
                // No action needed — grading handles OT the same as regulation
                // Just log for tracking
                await recordMetric('game_overtime', 1, { sport, gameId });
                break;
                
            case 'final':
                // Trigger grading
                await gradeGame(gameId, sport);
                break;
        }
    }

**Last-minute lineup change handling:**

    // src/lib/lineup-monitor.ts
    
    export async function checkLineupChanges(
        gameId: string,
        sport: string
    ): Promise<LineupChange[]> {
        // Fetch latest injury report / lineup data
        // If a key player (starter or top-5 minutes) is out:
        // 1. Flag the pick with a warning
        // 2. Optionally regenerate pick with adjusted projections
        // 3. Alert via Discord
        
        const changes: LineupChange[] = [];
        
        // Get current pick for this game
        const pick = await prisma.dailyPick.findFirst({
            where: { gameId, sport, result: null },
            orderBy: { createdAt: 'desc' },
        });
        
        if (!pick) return changes;
        
        // If significant lineup change detected, flag the pick
        if (changes.length > 0) {
            const significantChange = changes.some(c => c.impact === 'high');
            
            if (significantChange) {
                await prisma.dailyPick.update({
                    where: { id: pick.id },
                    data: {
                        notes: `⚠️ Lineup change detected: ${changes.map(c => c.player).join(', ')}`,
                    },
                });
                
                await sendDiscordAlert({
                    type: 'lineup_change',
                    severity: 'warning',
                    message: `⚠️ Key lineup change for ${gameId}: ${changes.map(c => `${c.player} (${c.status})`).join(', ')}`,
                    metadata: { gameId, sport, changes },
                });
            }
        }
        
        return changes;
    }

**Resilient grading with OT handling:**

    // Update grading pipeline to handle edge cases
    // In src/lib/grading.ts
    
    export async function gradeGame(
        gameId: string,
        sport: string
    ): Promise<GradeResult> {
        const game = await fetchGameResult(gameId, sport);
        
        if (!game) {
            return { status: 'pending', reason: 'Game result not yet available' };
        }
        
        if (game.status === 'postponed' || game.status === 'cancelled') {
            return await voidPicks(gameId, sport, game.status);
        }
        
        const picks = await prisma.dailyPick.findMany({
            where: { gameId, sport, result: null },
        });
        
        for (const pick of picks) {
            try {
                const result = evaluatePick(pick, game);
                
                await prisma.dailyPick.update({
                    where: { id: pick.id },
                    data: {
                        result: result.outcome,
                        closingLine: game.closingLine,
                        clvSpread: pick.lineAtPick
                            ? pick.lineAtPick - game.closingLine
                            : null,
                        notes: game.overtime
                            ? `${result.outcome} (game went to ${game.overtimePeriods}OT)`
                            : undefined,
                    },
                });
            } catch (err) {
                await recordMetric('grading_error', 1, { sport, gameId, pickId: pick.id });
                console.error(`[grading] Failed to grade pick ${pick.id}:`, err);
            }
        }
        
        // Update accuracy tracking after grading
        await trackAccuracy(sport);
        
        return { status: 'graded', picksGraded: picks.length };
    }

**Testing & validation:**
- Simulate a postponed game — picks should be voided, alert fired
- Simulate overtime — picks should grade correctly
- Simulate a cancelled game mid-batch — other picks unaffected
- Test grading error doesn't crash the entire batch
- Verify voided picks don't count in accuracy calculations

**Success criteria:**
- Postponed/cancelled games are handled within 5 minutes of status change
- Overtime games grade correctly
- Lineup changes trigger alerts for STRONG picks
- No unhandled errors in grading pipeline

---

## Task 6: Final Model Calibration

**Why:** Conference tournaments (starting ~March 10) provide the last chance to tune models before the Big Dance. Live CLV data from Phase 3-4 can now inform weight adjustments. This is about incremental improvement, not wholesale changes — we're fine-tuning a running engine.

**Where:** `src/lib/pick-engine.ts`, signal weight configuration.

**CLV-based weight tuning:**

    // src/lib/model-calibration.ts
    
    import { prisma } from '@/lib/prisma';
    
    interface SignalPerformance {
        signalName: string;
        avgClv: number;
        winRate: number;
        sampleSize: number;
        currentWeight: number;
        suggestedWeight: number;
    }
    
    export async function analyzeSignalPerformance(
        sport: string,
        lookbackDays: number = 30
    ): Promise<SignalPerformance[]> {
        // Pull all graded picks with signal attribution
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport,
                result: { not: null },
                createdAt: { gte: new Date(Date.now() - lookbackDays * 86400_000) },
            },
            include: {
                signalAttributions: true,  // From Phase 4 PickSignalAttribution table
            },
        });
        
        // Group by signal, calculate CLV and win rate
        const signalMap = new Map<string, {
            clvs: number[];
            wins: number;
            total: number;
            weight: number;
        }>();
        
        for (const pick of picks) {
            for (const attr of pick.signalAttributions ?? []) {
                const existing = signalMap.get(attr.signalName) ?? {
                    clvs: [], wins: 0, total: 0, weight: attr.weight,
                };
                existing.clvs.push(pick.clvSpread ?? 0);
                existing.total++;
                if (pick.result === 'WIN') existing.wins++;
                signalMap.set(attr.signalName, existing);
            }
        }
        
        return Array.from(signalMap.entries()).map(([name, data]) => {
            const avgClv = data.clvs.reduce((a, b) => a + b, 0) / data.clvs.length;
            const winRate = data.wins / data.total;
            
            // Suggest weight adjustment:
            // - Increase weight for signals with positive CLV
            // - Decrease weight for signals with negative CLV
            // - Don't change by more than 20% at a time
            const clvMultiplier = avgClv > 0
                ? Math.min(1.2, 1 + avgClv * 0.1)
                : Math.max(0.8, 1 + avgClv * 0.1);
            
            return {
                signalName: name,
                avgClv,
                winRate,
                sampleSize: data.total,
                currentWeight: data.weight,
                suggestedWeight: data.weight * clvMultiplier,
            };
        });
    }
    
    // Confidence tier recalibration
    export async function recalibrateTiers(sport: string): Promise<TierThresholds> {
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport,
                result: { not: null },
                createdAt: { gte: new Date(Date.now() - 30 * 86400_000) },
            },
            select: {
                confidenceScore: true,
                confidenceTier: true,
                result: true,
            },
        });
        
        // Find the confidence score thresholds where win rate exceeds targets
        // STRONG: > 58% win rate, LEAN: > 52%, HOLD: everything else
        const sorted = picks
            .filter(p => p.confidenceScore !== null)
            .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0));
        
        let strongThreshold = 70;
        let leanThreshold = 55;
        
        // Sliding window to find optimal thresholds
        for (let threshold = 80; threshold >= 50; threshold -= 5) {
            const above = sorted.filter(p => (p.confidenceScore ?? 0) >= threshold);
            if (above.length < 10) continue;
            
            const winRate = above.filter(p => p.result === 'WIN').length / above.length;
            if (winRate >= 0.58 && above.length >= 10) {
                strongThreshold = threshold;
                break;
            }
        }
        
        return {
            strong: strongThreshold,
            lean: leanThreshold,
            updatedAt: new Date(),
        };
    }

**Tournament-specific model overrides:**

    // src/lib/tournament-overrides.ts
    // Tournament-specific adjustments
    
    export const TOURNAMENT_ADJUSTMENTS = {
        // Neutral court: zero out home court advantage
        neutralCourt: true,
        
        // Seeds matter: add seed-based adjustment
        seedWeight: 0.15,
        
        // Tournament experience: teams that have been here before perform differently
        experienceWeight: 0.10,
        
        // Pace adjustment: tournament games tend to be slower
        paceAdjustment: -2.5,
        
        // 3-point variance: higher variance in single-elimination
        varianceMultiplier: 1.15,
    };
    
    export function applyTournamentOverrides(
        baseProjection: GameProjection,
        game: TournamentGame
    ): GameProjection {
        const adj = { ...baseProjection };
        
        // Zero out HCA for neutral court
        if (TOURNAMENT_ADJUSTMENTS.neutralCourt) {
            adj.homeAdvantage = 0;
        }
        
        // Seed-based adjustment (higher seeds slightly undervalued in early rounds)
        if (game.seedDiff) {
            adj.spreadAdj += game.seedDiff * TOURNAMENT_ADJUSTMENTS.seedWeight;
        }
        
        // Increase projected variance for single-elimination
        adj.projectedVariance *= TOURNAMENT_ADJUSTMENTS.varianceMultiplier;
        
        return adj;
    }

**Testing & validation:**
- Run signal analysis on all available graded picks — output makes sense
- Verify tier recalibration doesn't create empty tiers
- Tournament overrides correctly zero out HCA
- Suggested weight changes are within ±20% bounds
- Compare model output with and without tournament overrides on historical data

**Success criteria:**
- Signal performance report identifies top and bottom performing signals
- Tier thresholds adjusted based on actual win rates
- Tournament overrides are toggleable via config
- All calibration changes are logged for rollback

---

## Task 7: Deployment & Rollback Procedures

**Why:** During the tournament, we need zero-downtime deployments and the ability to rollback in under 5 minutes if something breaks. One bad deployment during Sweet 16 could lose users permanently.

**Where:** Deployment scripts, Vercel/hosting configuration, database migration procedures.

**Deployment checklist script:**

    // scripts/deploy-check.ts
    // Run before every deployment
    
    import { execSync } from 'child_process';
    
    interface CheckResult {
        name: string;
        passed: boolean;
        message: string;
    }
    
    async function runDeployChecks(): Promise<void> {
        const checks: CheckResult[] = [];
        
        // 1. All tests pass
        try {
            execSync('npm test -- --passWithNoTests', { stdio: 'pipe' });
            checks.push({ name: 'Tests', passed: true, message: 'All tests pass' });
        } catch {
            checks.push({ name: 'Tests', passed: false, message: 'Tests failing' });
        }
        
        // 2. TypeScript compiles
        try {
            execSync('npx tsc --noEmit', { stdio: 'pipe' });
            checks.push({ name: 'TypeScript', passed: true, message: 'No type errors' });
        } catch {
            checks.push({ name: 'TypeScript', passed: false, message: 'Type errors found' });
        }
        
        // 3. No pending migrations
        try {
            const output = execSync('npx prisma migrate status', { encoding: 'utf8' });
            const hasPending = output.includes('not yet been applied');
            checks.push({
                name: 'Migrations',
                passed: !hasPending,
                message: hasPending ? 'Pending migrations exist' : 'All migrations applied',
            });
        } catch {
            checks.push({ name: 'Migrations', passed: false, message: 'Could not check migration status' });
        }
        
        // 4. Environment variables present
        const requiredEnvVars = [
            'DATABASE_URL',
            'UPSTASH_REDIS_REST_URL',
            'ODDS_API_KEY',
            'DISCORD_ALERT_WEBHOOK_URL',
        ];
        
        for (const envVar of requiredEnvVars) {
            checks.push({
                name: `Env: ${envVar}`,
                passed: !!process.env[envVar],
                message: process.env[envVar] ? 'Set' : 'Missing',
            });
        }
        
        // Report
        console.log('\n📋 Deployment Checks:\n');
        for (const check of checks) {
            console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}: ${check.message}`);
        }
        
        const allPassed = checks.every(c => c.passed);
        if (!allPassed) {
            console.log('\n❌ Deployment blocked — fix failing checks above.\n');
            process.exit(1);
        }
        
        console.log('\n✅ All checks passed — safe to deploy.\n');
    }
    
    runDeployChecks();

**Rollback procedures:**

    ## Emergency Rollback Procedure
    
    ### Vercel Rollback (< 2 minutes)
    1. Go to Vercel Dashboard → Deployments
    2. Find the last known-good deployment
    3. Click "..." → "Promote to Production"
    4. Verify health check: curl https://trendline.bet/api/health
    
    ### Database Rollback (if migration caused issues)
    1. Identify the problematic migration in prisma/migrations/
    2. Connect to Neon: psql "$NEON_DB"
    3. Check current state: SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;
    4. If migration is reversible:
       - Write a reverse migration SQL
       - Apply: psql "$NEON_DB" < reverse-migration.sql
       - Update _prisma_migrations table
    5. If not reversible: restore from Neon point-in-time recovery
       - Neon dashboard → Branch → Restore to timestamp
    
    ### Feature Flag Emergency Kill
    // src/lib/feature-flags.ts
    
    const FLAGS: Record<string, boolean> = {
        tournament_bracket: true,
        live_pick_updates: true,
        social_sharing: true,
        market_alerts: true,
        confidence_viz: true,
    };
    
    // Override via environment variable: FEATURE_FLAGS='{"tournament_bracket":false}'
    export function isFeatureEnabled(flag: string): boolean {
        const envOverrides = process.env.FEATURE_FLAGS;
        if (envOverrides) {
            try {
                const overrides = JSON.parse(envOverrides);
                if (flag in overrides) return overrides[flag];
            } catch {}
        }
        return FLAGS[flag] ?? false;
    }
    
    // Usage in components:
    // if (isFeatureEnabled('tournament_bracket')) { ... }

**Database migration safety:**

    ## Migration Safety Rules
    
    1. NEVER drop columns in production during tournament
    2. All new columns must be nullable or have defaults
    3. Add new indexes in a separate migration from schema changes
    4. Test migrations on Neon branch first:
       - Create branch: neon branches create --name test-migration
       - Apply: DATABASE_URL=<branch_url> npx prisma migrate deploy
       - Verify: run health check against branch
       - Delete branch: neon branches delete test-migration
    5. Keep migration files small — one concern per migration

**Testing & validation:**
- Run `deploy-check.ts` — all checks pass
- Simulate rollback: deploy a known-bad version, rollback, verify health
- Test feature flags: disable a feature, verify it's hidden in UI
- Verify Neon branch workflow for migration testing

**Success criteria:**
- Deployment checklist catches type errors, test failures, missing env vars
- Rollback from production can be completed in < 5 minutes
- Feature flags can disable any tournament feature without redeployment
- Migration safety rules documented and followed

---

## Task 8: Security Hardening

**Why:** High-traffic periods attract bad actors. Rate limiting prevents abuse, authentication review prevents unauthorized access, and API hardening protects our data and users.

**Where:** Middleware, API routes, environment configuration.

**Rate limiting:**

    // src/middleware.ts (or add to existing)
    
    import { Ratelimit } from '@upstash/ratelimit';
    import { redis } from '@/lib/redis';
    
    const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, '1 m'), // 60 requests per minute
        analytics: true,
    });
    
    const strictRatelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute for auth endpoints
        analytics: true,
    });
    
    export async function middleware(request: NextRequest) {
        const path = request.nextUrl.pathname;
        
        // Skip rate limiting for static assets and health check
        if (path.startsWith('/_next') || path === '/api/health') {
            return NextResponse.next();
        }
        
        const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1';
        const limiter = path.startsWith('/api/auth') ? strictRatelimit : ratelimit;
        
        const { success, remaining } = await limiter.limit(ip);
        
        if (!success) {
            return new NextResponse('Too Many Requests', {
                status: 429,
                headers: {
                    'Retry-After': '60',
                    'X-RateLimit-Remaining': '0',
                },
            });
        }
        
        const response = NextResponse.next();
        response.headers.set('X-RateLimit-Remaining', String(remaining));
        return response;
    }

**Security headers:**

    // next.config.js — add security headers
    const securityHeaders = [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.upstash.io https://*.neon.tech;",
        },
    ];
    
    // Add to next.config.js headers()
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: securityHeaders,
            },
        ];
    },

**API input validation:**

    // src/lib/validation.ts
    // Validate all API inputs to prevent injection
    
    import { z } from 'zod';
    
    export const pickQuerySchema = z.object({
        sport: z.enum(['NCAAMB', 'NBA', 'NFL', 'NCAAF']),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        tier: z.enum(['STRONG', 'LEAN', 'HOLD']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
    });
    
    // Usage in API routes:
    // const params = pickQuerySchema.safeParse(Object.fromEntries(searchParams));
    // if (!params.success) return Response.json({ error: params.error }, { status: 400 });

**Testing & validation:**
- Verify rate limiting: send 61 requests in 1 minute — 61st should return 429
- Check security headers with `curl -I https://trendline.bet`
- Test API validation: send malformed sport param — should get 400 not 500
- Run `npx next lint` — no security warnings

**Success criteria:**
- Rate limiting active on all API endpoints
- Security headers present on all responses
- All API inputs validated with Zod schemas
- No SQL injection or XSS vectors in API endpoints

---

## Task 9: Documentation & Support

**Why:** Tournament launch means new users, more questions, and higher stakes. Documentation reduces support burden and helps users get value from Trendline immediately.

**Where:** `docs/` directory, README updates, in-app help content.

**Create documentation files:**

    docs/
    ├── tournament-guide.md      # User guide for tournament features
    ├── api-reference.md         # API endpoint documentation
    ├── troubleshooting.md       # Common issues and solutions
    ├── deployment-runbook.md    # Deployment and rollback procedures
    └── faq.md                   # Frequently asked questions

**Tournament user guide outline:**

    # Tournament Guide
    
    ## How Trendline Tournament Picks Work
    - We analyze every tournament game using KenPom data, historical matchups,
      market signals, and our ridge regression models
    - Each pick gets a confidence tier: STRONG (highest edge), LEAN, or HOLD
    - Picks are timestamped before game time and tracked for CLV
    
    ## Understanding Confidence Tiers
    - **STRONG**: Our model shows significant edge (> 3 points CLV expected)
      - Historical win rate: ~58-62%
      - These are our best plays — limit your betting to these
    - **LEAN**: Moderate edge detected (1-3 points CLV expected)
      - Historical win rate: ~53-56%
      - Smaller position size recommended
    - **HOLD**: No clear edge or pick aligns with public
      - We surface these for information, not action
    
    ## Tournament-Specific Features
    - Bracket view with pick overlay
    - Real-time accuracy tracking by round
    - Neutral court adjustments (no home court advantage)
    - Seed-based model adjustments
    - Conference tournament results incorporated
    
    ## Reading Pick Analysis
    - Each pick includes a written analysis explaining the edge
    - CLV (Closing Line Value) tracks whether we beat the market
    - Positive CLV means we got a better line than the closing number
    
    ## FAQ
    - Q: Why did a STRONG pick lose?
      A: Even at 60% win rate, 4 out of 10 STRONG picks will lose.
         Focus on long-term CLV, not individual results.
    
    - Q: Why was my pick voided?
      A: Games that are postponed or cancelled result in voided picks.
    
    - Q: When are picks published?
      A: Picks are generated daily, typically by 10 AM ET for that day's games.

**API reference outline:**

    # API Reference
    
    ## GET /api/picks
    Query parameters:
    - sport: NCAAMB | NBA | NFL | NCAAF (required)
    - date: YYYY-MM-DD (optional, defaults to today)
    - tier: STRONG | LEAN | HOLD (optional filter)
    - limit: 1-100 (default 20)
    - offset: >= 0 (default 0)
    
    ## GET /api/health
    Returns system health status. No authentication required.
    
    ## GET /api/tournament/recap?date=YYYY-MM-DD
    Tournament day recap with accuracy stats.
    
    ## GET /api/picks/[id]/share
    Returns OG image (1200x630 PNG) for social sharing.

**Troubleshooting guide outline:**

    # Troubleshooting
    
    ## Picks Not Loading
    1. Check /api/health — if degraded, system may be recovering
    2. Clear browser cache and reload
    3. Check if the game date is correct in the URL
    
    ## Stale Picks Showing
    1. Picks cache refreshes every 60 seconds
    2. Force refresh: Ctrl+Shift+R
    3. If picks are older than expected, check pick generation monitoring
    
    ## Pick Was Voided
    - Game was postponed or cancelled
    - Voided picks don't affect win/loss record
    
    ## Performance Issues
    1. Tournament days (32+ games) may have slightly slower load times
    2. Use tier filter to reduce results
    3. Check system status at /api/health

**Testing & validation:**
- All documentation files created and proofread
- API examples tested with curl
- Troubleshooting steps verified against actual error scenarios
- FAQ covers top 10 user questions from beta period

**Success criteria:**
- Complete documentation set in `docs/` directory
- API reference matches actual endpoint behavior
- Troubleshooting guide covers all known failure modes
- FAQ addresses common user confusion points

---

## Launch Day Checklist (March 15)

    □ All Phase 5 tasks complete and deployed
    □ Health check passing: GET /api/health → 200
    □ Pick generation running for tournament games
    □ Discord alerts configured and tested
    □ Rate limiting active
    □ Feature flags verified (all tournament features ON)
    □ Rollback procedure documented and tested
    □ Performance dashboard live and accurate
    □ Mobile UI tested on iPhone and Android
    □ Monitoring dashboard showing metrics
    □ Team has access to Vercel, Neon, and Discord
    □ Emergency contacts documented
    □ First day picks reviewed manually before publishing
    
    ## Emergency Contacts
    □ Vercel dashboard access verified
    □ Neon database access verified
    □ Discord alert webhook tested
    □ Rollback procedure printed/bookmarked

---

## Post-Launch Monitoring (March 15-April 7)

    Week 1 (March 15-22): First/Second Rounds
    - Monitor 32-game days closely
    - Track pick generation success rate (target: 100%)
    - Review accuracy daily, adjust if CLV trends negative
    - Check system performance under peak load
    
    Week 2 (March 22-29): Sweet 16 / Elite 8
    - Fewer games but higher stakes
    - Review model calibration based on Week 1 results
    - Publish tournament recap and accuracy report
    
    Week 3 (March 29-April 7): Final Four / Championship
    - 2-3 games total — manual review of every pick
    - Season recap and performance analysis
    - Document lessons learned for next season
