# Phase 4: Market Signals & Edge Detection

> **Context Management:** When context reaches 70%, compact the conversation and continue.
> Compaction summary should include: completed tasks, current task progress, key decisions made.

Phase 1 fixed bugs. Phase 2 added tests and architecture. Phase 3 built real regression models and CLV tracking. Phase 4 is about **beating the closing line consistently.** We build market inefficiency detection, sharp vs public money analysis, live odds monitoring, and automated alerts — turning Trendline from a model-driven picks engine into a market-aware edge detection system.

**Timeline:** Feb 28 – March 3 (target completion before conference tournaments). Market signal detection must be live for tournament betting when public money creates the biggest inefficiencies.

**Goal:** Detect market inefficiencies in real-time, exploit public betting biases, optimize bet timing via CLV, and surface high-edge opportunities through automated alerts.

**Context budget estimate:**
- This prompt: ~12k tokens
- `src/lib/pick-engine.ts`: ~25k tokens (CLV integration, signal weighting)
- `prisma/schema.prisma`: ~9k tokens (new tables for odds history, alerts)
- `src/lib/odds-api.ts` (if exists): ~3k tokens
- New files created by this phase: ~15k tokens
- **Total: ~64k tokens (~32% of 200k)**

Load files in this priority order:
1. `src/lib/pick-engine.ts` — CLV fields, signal weighting, edge calculation
2. `prisma/schema.prisma` — existing CLV schema from Phase 3
3. Any existing odds/API integration files
4. Task-specific files as needed

**Prerequisites from Phase 3:**
- CLV fields on DailyPick (`lineAtPick`, `closingLine`, `clvSpread`, `clvTotal`)
- Ridge regression models for each sport
- Signal weight system in pick engine
- Grading pipeline that captures closing lines

---

## Task 1: CLV-Based Line Movement Detection

**Why:** Closing Line Value is the single best predictor of long-term betting success. If we consistently beat the closing line, we have edge — regardless of short-term W/L variance. This task builds real-time line movement monitoring and CLV optimization loops.

**Where:** Create `src/lib/clv-engine.ts`, integrate with existing CLV fields from Phase 3.

**Schema additions:**

    // Add to prisma/schema.prisma
    model LineMovement {
        id          String   @id @default(cuid())
        gameId      String   // FK to UpcomingGame or sport-specific game
        sport       String   // NCAAMB, NBA, NFL, NCAAF
        sportsbook  String   // pinnacle, fanduel, draftkings, etc.
        marketType  String   // spread, total, moneyline
        timestamp   DateTime @default(now())
        oldLine     Float
        newLine     Float
        movement    Float    // newLine - oldLine
        velocity    Float?   // points moved per hour
        isReverse   Boolean  @default(false) // reverse line movement detected
        publicPct   Float?   // public betting % at time of move (if available)
        
        @@index([gameId, sport])
        @@index([timestamp])
        @@index([isReverse])
    }

**Core implementation:**

    // src/lib/clv-engine.ts
    
    interface LineSnapshot {
        gameId: string;
        sport: string;
        sportsbook: string;
        marketType: 'spread' | 'total' | 'moneyline';
        line: number;
        timestamp: Date;
    }
    
    interface LineMovementEvent {
        gameId: string;
        oldLine: number;
        newLine: number;
        movement: number;
        velocity: number;        // points per hour
        isSteamMove: boolean;    // rapid movement across multiple books
        isReverse: boolean;      // line moved opposite to public betting %
        publicPct: number | null;
    }
    
    // Detect significant line movements
    function detectLineMovement(
        current: LineSnapshot,
        previous: LineSnapshot
    ): LineMovementEvent | null {
        const movement = current.line - previous.line;
        if (Math.abs(movement) < 0.5) return null; // ignore sub-half-point moves
        
        const hoursDiff = (current.timestamp.getTime() - previous.timestamp.getTime()) / 3600000;
        const velocity = Math.abs(movement) / Math.max(hoursDiff, 0.01);
        
        return {
            gameId: current.gameId,
            oldLine: previous.line,
            newLine: current.line,
            movement,
            velocity,
            isSteamMove: velocity > 2.0, // >2 points/hour = steam
            isReverse: false, // set later when public % data available
            publicPct: null,
        };
    }
    
    // CLV calculation for a pick
    function calculateCLV(
        pickLine: number,
        closingLine: number,
        pickSide: 'home' | 'away' | 'over' | 'under'
    ): { clv: number; beatClosing: boolean } {
        // For spread picks: CLV = closingLine - pickLine (from pick's perspective)
        // Positive CLV = we got a better number than closing
        let clv: number;
        
        if (pickSide === 'home' || pickSide === 'over') {
            clv = closingLine - pickLine;
        } else {
            clv = pickLine - closingLine;
        }
        
        return { clv, beatClosing: clv > 0 };
    }
    
    // Aggregate CLV stats for signal evaluation
    async function getCLVStats(
        prisma: PrismaClient,
        filters: { sport?: string; signal?: string; confidenceTier?: string; dateRange?: [Date, Date] }
    ): Promise<{
        totalPicks: number;
        avgCLV: number;
        clvPositiveRate: number; // % of picks that beat closing
        clvByTier: Record<string, number>;
    }> {
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport: filters.sport,
                confidence: filters.confidenceTier ? { gte: tierMin(filters.confidenceTier) } : undefined,
                clvSpread: { not: null },
                createdAt: filters.dateRange
                    ? { gte: filters.dateRange[0], lte: filters.dateRange[1] }
                    : undefined,
            },
        });
        
        const clvValues = picks.map(p => p.clvSpread!);
        const positive = clvValues.filter(v => v > 0).length;
        
        return {
            totalPicks: picks.length,
            avgCLV: clvValues.reduce((a, b) => a + b, 0) / clvValues.length,
            clvPositiveRate: positive / picks.length,
            clvByTier: groupByTierAndAverage(picks),
        };
    }

**CLV-based signal weight adjustment:**

    // After grading, adjust signal weights based on CLV performance
    // Signals that consistently beat CLV should get higher weight
    async function adjustSignalWeightsByCLV(
        prisma: PrismaClient,
        lookbackDays: number = 30
    ): Promise<Record<string, number>> {
        const cutoff = new Date(Date.now() - lookbackDays * 86400000);
        
        // Get all graded picks with CLV data
        const picks = await prisma.dailyPick.findMany({
            where: {
                gradedAt: { gte: cutoff },
                clvSpread: { not: null },
            },
        });
        
        // Group by primary signal (the dominant factor in each pick)
        // This requires storing which signal contributed most — see Task 6
        const signalCLV: Record<string, number[]> = {};
        
        for (const pick of picks) {
            // Parse the reasoning/metadata to identify primary signal
            const primarySignal = extractPrimarySignal(pick);
            if (!signalCLV[primarySignal]) signalCLV[primarySignal] = [];
            signalCLV[primarySignal].push(pick.clvSpread!);
        }
        
        // Weight signals by CLV: positive avg CLV = boost, negative = penalize
        const weights: Record<string, number> = {};
        for (const [signal, clvs] of Object.entries(signalCLV)) {
            const avgCLV = clvs.reduce((a, b) => a + b, 0) / clvs.length;
            // Convert CLV to weight multiplier: +1 CLV avg → 1.1x, -1 → 0.9x
            weights[signal] = 1.0 + (avgCLV * 0.1);
        }
        
        return weights;
    }

**Testing approach:**
- Unit tests for CLV calculation with known spreads
- Test line movement detection with simulated snapshots
- Validate CLV stats aggregation against manual calculation
- Walk-forward test: do CLV-weighted signals outperform equal-weighted?

**Success criteria:**
- LineMovement records created for every detected move ≥ 0.5 points
- CLV calculated and stored for every graded pick
- CLV stats endpoint returns accurate aggregations
- Signal weights updated based on CLV performance (cron job or post-grading hook)

---

## Task 2: Sharp vs Public Money Detection

**Why:** The biggest market inefficiencies occur when public money pushes lines away from where sharp money has them. If 80% of bets are on Duke -7 but the line moves to Duke -6.5, sharp money is on the other side. These are the highest-edge spots in sports betting.

**Where:** Create `src/lib/sharp-money.ts`

**Core concepts:**

    // src/lib/sharp-money.ts
    
    interface MarketSentiment {
        gameId: string;
        sport: string;
        publicSpreadPct: number;     // % of bets on favorite/home
        publicTotalPct: number;      // % of bets on over
        moneySpreadPct: number;      // % of money on favorite/home (if available)
        openingLine: number;
        currentLine: number;
        lineMovement: number;        // current - opening
        isReverseLineMovement: boolean;
        sharpIndicators: SharpIndicator[];
    }
    
    interface SharpIndicator {
        type: 'reverse_line' | 'steam_move' | 'pinnacle_lead' | 'line_freeze' | 'contrarian';
        strength: number;  // 0-1
        description: string;
    }
    
    // Reverse Line Movement Detection
    // When 75%+ of bets are on one side but the line moves the other way,
    // sharp money is likely on the contrarian side
    function detectReverseLineMovement(
        publicPct: number,      // % of bets on one side
        lineMovement: number,   // positive = line moved toward that side
        threshold: number = 0.70
    ): SharpIndicator | null {
        // Public on Side A at 75%+ but line moved TOWARD Side B
        if (publicPct >= threshold && lineMovement < -0.5) {
            return {
                type: 'reverse_line',
                strength: Math.min((publicPct - threshold) / 0.25, 1.0),
                description: `${(publicPct * 100).toFixed(0)}% public on one side but line moved ${Math.abs(lineMovement).toFixed(1)} pts opposite`,
            };
        }
        return null;
    }
    
    // Steam Move Detection
    // When multiple sportsbooks move their line in the same direction within minutes,
    // a sharp bettor (or syndicate) hit the market
    function detectSteamMove(
        movements: LineMovementEvent[],
        windowMinutes: number = 15,
        minBooks: number = 3
    ): SharpIndicator | null {
        // Group movements by direction within time window
        const recentMoves = movements.filter(
            m => m.velocity > 1.0 // at least 1 pt/hr velocity
        );
        
        if (recentMoves.length >= minBooks) {
            const avgVelocity = recentMoves.reduce((s, m) => s + m.velocity, 0) / recentMoves.length;
            return {
                type: 'steam_move',
                strength: Math.min(avgVelocity / 5.0, 1.0),
                description: `Steam detected: ${recentMoves.length} books moved in ${windowMinutes}min (avg velocity: ${avgVelocity.toFixed(1)} pts/hr)`,
            };
        }
        return null;
    }
    
    // Pinnacle as sharp market reference
    // Pinnacle's closing line is the most efficient in the world.
    // When recreational books diverge from Pinnacle, that's our edge.
    function detectPinnacleDivergence(
        pinnacleLine: number,
        bookLine: number,
        sport: string
    ): SharpIndicator | null {
        const diff = Math.abs(pinnacleLine - bookLine);
        const threshold = sport === 'NFL' ? 1.0 : 1.5; // NFL lines are tighter
        
        if (diff >= threshold) {
            return {
                type: 'pinnacle_lead',
                strength: Math.min(diff / (threshold * 2), 1.0),
                description: `${diff.toFixed(1)} pt divergence from Pinnacle (sharp benchmark)`,
            };
        }
        return null;
    }

**Public team detection:**

    // Teams that attract disproportionate public action
    // These create systematic line inflation
    const PUBLIC_TEAMS: Record<string, string[]> = {
        NCAAMB: ['Duke', 'Kentucky', 'North Carolina', 'Kansas', 'UCLA', 'Michigan St'],
        NBA: ['Lakers', 'Warriors', 'Celtics', 'Knicks', 'Mavericks'],
        NFL: ['Cowboys', 'Chiefs', 'Packers', '49ers', 'Bills'],
        NCAAF: ['Alabama', 'Ohio State', 'Georgia', 'Michigan', 'Texas'],
    };
    
    function getPublicTeamBias(
        homeTeam: string,
        awayTeam: string,
        sport: string
    ): { team: string; side: 'home' | 'away'; biasPoints: number } | null {
        const publicTeams = PUBLIC_TEAMS[sport] || [];
        const homeIsPublic = publicTeams.some(t => homeTeam.includes(t));
        const awayIsPublic = publicTeams.some(t => awayTeam.includes(t));
        
        if (homeIsPublic && !awayIsPublic) {
            return { team: homeTeam, side: 'home', biasPoints: 1.0 };
        }
        if (awayIsPublic && !homeIsPublic) {
            return { team: awayTeam, side: 'away', biasPoints: 1.0 };
        }
        // Both public or neither — no clear bias
        return null;
    }
    
    // Composite sharp money score
    // Combines all indicators into a single score
    function computeSharpScore(indicators: SharpIndicator[]): number {
        if (indicators.length === 0) return 0;
        
        // Weighted average — reverse line movement is strongest signal
        const weights: Record<string, number> = {
            reverse_line: 0.35,
            steam_move: 0.30,
            pinnacle_lead: 0.25,
            contrarian: 0.10,
        };
        
        let totalWeight = 0;
        let weightedSum = 0;
        
        for (const ind of indicators) {
            const w = weights[ind.type] || 0.1;
            weightedSum += ind.strength * w;
            totalWeight += w;
        }
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }

**Integration with pick engine:**

    // In pick-engine.ts, add sharp money as a signal
    // This should be called during pick generation
    async function getSharpMoneySignal(
        gameId: string,
        sport: string,
        pickSide: 'home' | 'away'
    ): Promise<{ signal: number; indicators: SharpIndicator[] }> {
        const sentiment = await getMarketSentiment(gameId, sport);
        if (!sentiment) return { signal: 0, indicators: [] };
        
        const indicators = sentiment.sharpIndicators;
        const sharpScore = computeSharpScore(indicators);
        
        // Determine if sharp money aligns with our pick
        const sharpSide = sentiment.lineMovement < 0 ? 'away' : 'home';
        const aligned = sharpSide === pickSide;
        
        return {
            signal: aligned ? sharpScore : -sharpScore,
            indicators,
        };
    }

**Testing approach:**
- Unit tests for reverse line movement with known public % and line movements
- Test steam detection with simulated multi-book movements
- Validate public team list against historical betting % data
- Backtest: do contrarian picks against public teams have positive CLV?

**Success criteria:**
- Sharp indicators generated for every game with available data
- Reverse line movement detected when public % > 70% and line moves opposite
- Steam moves flagged when 3+ books move within 15 minutes
- Sharp score integrated as signal in pick engine confidence calculation

---

## Task 3: Live Odds Monitoring System

**Why:** Line shopping is the simplest edge in sports betting. Getting -6.5 instead of -7 at the same juice is free money. We need real-time odds from multiple books to find the best available line for every pick.

**Where:** Create `src/lib/odds-monitor.ts`, add cron job for periodic polling.

**Data source:** The Odds API (https://the-odds-api.com/) — already may be integrated via `OddsSnapshot` table.

**Schema additions:**

    model OddsHistory {
        id          String   @id @default(cuid())
        gameId      String
        sport       String
        sportsbook  String
        marketType  String   // spreads, totals, h2h
        outcome     String   // home, away, over, under
        line        Float?   // spread or total number
        price       Int      // American odds (-110, +150, etc.)
        impliedProb Float    // converted implied probability
        timestamp   DateTime @default(now())
        
        @@index([gameId, sportsbook, marketType])
        @@index([timestamp])
        @@unique([gameId, sportsbook, marketType, outcome, timestamp])
    }

**Core implementation:**

    // src/lib/odds-monitor.ts
    
    interface BookOdds {
        sportsbook: string;
        spread: { home: number; away: number; homePrice: number; awayPrice: number } | null;
        total: { line: number; overPrice: number; underPrice: number } | null;
        moneyline: { homePrice: number; awayPrice: number } | null;
    }
    
    interface BestLine {
        marketType: string;
        outcome: string;
        bestBook: string;
        bestLine: number;
        bestPrice: number;
        worstBook: string;
        worstLine: number;
        worstPrice: number;
        edgeOverWorst: number; // in points or implied prob %
    }
    
    // Find best available line across all books
    function findBestLine(
        allOdds: BookOdds[],
        side: 'home' | 'away',
        marketType: 'spread' | 'total' | 'moneyline'
    ): BestLine | null {
        if (marketType === 'spread') {
            const spreads = allOdds
                .filter(o => o.spread)
                .map(o => ({
                    book: o.sportsbook,
                    line: side === 'home' ? o.spread!.home : o.spread!.away,
                    price: side === 'home' ? o.spread!.homePrice : o.spread!.awayPrice,
                }))
                .sort((a, b) => {
                    // For the bettor: higher spread is better for home favorite
                    // Actually: more positive number = better for that side
                    return b.line - a.line;
                });
            
            if (spreads.length < 2) return null;
            
            const best = spreads[0];
            const worst = spreads[spreads.length - 1];
            
            return {
                marketType: 'spread',
                outcome: side,
                bestBook: best.book,
                bestLine: best.line,
                bestPrice: best.price,
                worstBook: worst.book,
                worstLine: worst.line,
                worstPrice: worst.price,
                edgeOverWorst: best.line - worst.line,
            };
        }
        
        // Similar for total and moneyline...
        return null;
    }
    
    // Detect arbitrage opportunities
    // Arb exists when the sum of implied probabilities across books < 100%
    function detectArbitrage(
        allOdds: BookOdds[],
        marketType: 'spread' | 'moneyline'
    ): { exists: boolean; margin: number; books: [string, string] } | null {
        if (marketType === 'moneyline') {
            let bestHome = { book: '', impliedProb: 1.0 };
            let bestAway = { book: '', impliedProb: 1.0 };
            
            for (const odds of allOdds) {
                if (!odds.moneyline) continue;
                
                const homeProb = americanToImplied(odds.moneyline.homePrice);
                const awayProb = americanToImplied(odds.moneyline.awayPrice);
                
                if (homeProb < bestHome.impliedProb) {
                    bestHome = { book: odds.sportsbook, impliedProb: homeProb };
                }
                if (awayProb < bestAway.impliedProb) {
                    bestAway = { book: odds.sportsbook, impliedProb: awayProb };
                }
            }
            
            const totalProb = bestHome.impliedProb + bestAway.impliedProb;
            
            if (totalProb < 1.0) {
                return {
                    exists: true,
                    margin: (1.0 - totalProb) * 100, // profit margin %
                    books: [bestHome.book, bestAway.book],
                };
            }
        }
        
        return null;
    }
    
    // Convert American odds to implied probability
    function americanToImplied(american: number): number {
        if (american > 0) {
            return 100 / (american + 100);
        } else {
            return Math.abs(american) / (Math.abs(american) + 100);
        }
    }
    
    // Line movement velocity — how fast is the line moving?
    function calculateVelocity(
        history: { line: number; timestamp: Date }[]
    ): number {
        if (history.length < 2) return 0;
        
        const sorted = [...history].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        
        const hours = (last.timestamp.getTime() - first.timestamp.getTime()) / 3600000;
        if (hours < 0.01) return 0;
        
        return Math.abs(last.line - first.line) / hours;
    }

**Polling cron job:**

    // src/app/api/cron/odds-monitor/route.ts
    // Run every 15 minutes for upcoming games (next 24h)
    // Run every 5 minutes for games starting within 2 hours
    
    export async function GET(req: Request) {
        // Verify cron auth
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new Response('Unauthorized', { status: 401 });
        }
        
        const sports = ['basketball_ncaab', 'basketball_nba', 'americanfootball_nfl'];
        
        for (const sport of sports) {
            const odds = await fetchOddsAPI(sport, ['spreads', 'totals', 'h2h']);
            
            for (const game of odds) {
                // Store snapshot
                await storeOddsSnapshot(game);
                
                // Detect movements from previous snapshot
                const movements = await detectMovements(game);
                
                // Check for alerts
                for (const movement of movements) {
                    if (movement.isSteamMove || movement.isReverse) {
                        await createAlert(movement);
                    }
                }
                
                // Check for arbitrage
                const arb = detectArbitrage(game.bookmakers, 'moneyline');
                if (arb?.exists) {
                    await createAlert({
                        type: 'arbitrage',
                        gameId: game.id,
                        margin: arb.margin,
                        books: arb.books,
                    });
                }
            }
        }
        
        return Response.json({ success: true, timestamp: new Date().toISOString() });
    }

**Testing approach:**
- Unit tests for best line finding with mock multi-book data
- Test arbitrage detection with known arb scenarios
- Test velocity calculation with time-series data
- Integration test: poll → store → detect movement → alert pipeline

**Success criteria:**
- Odds history populated every 15 minutes for active games
- Best line identified across all tracked sportsbooks
- Arbitrage opportunities detected when they exist (rare but valuable)
- Line movement velocity tracked and accessible for each game

---

## Task 4: Market Timing Optimization

**Why:** When you place a bet matters almost as much as what you bet. Lines are softest at open and most efficient at close. Understanding timing patterns lets us release picks when lines are most favorable.

**Where:** Create `src/lib/market-timing.ts`

**Implementation:**

    // src/lib/market-timing.ts
    
    interface TimingWindow {
        hoursBeforeGame: number;
        avgLineMovement: number;     // average absolute movement in this window
        avgCLV: number;              // average CLV for picks placed in this window
        pickCount: number;
        optimalScore: number;        // composite score (higher = better time to bet)
    }
    
    // Analyze historical line movements to find optimal betting windows
    async function analyzeTimingWindows(
        prisma: PrismaClient,
        sport: string,
        windowSizeHours: number = 4
    ): Promise<TimingWindow[]> {
        // Get all picks with both pickLine and closingLine
        const picks = await prisma.dailyPick.findMany({
            where: {
                sport,
                clvSpread: { not: null },
                lineAtPick: { not: null },
            },
            select: {
                lineAtPick: true,
                closingLine: true,
                clvSpread: true,
                createdAt: true,
                // Need game start time — join or compute
            },
        });
        
        // Bucket picks by hours-before-game
        const windows: Map<number, { clvs: number[]; movements: number[] }> = new Map();
        
        // Build windows at 4-hour intervals: 48h, 44h, 40h, ..., 4h, 0h
        for (let h = 48; h >= 0; h -= windowSizeHours) {
            windows.set(h, { clvs: [], movements: [] });
        }
        
        // ... bucket each pick into its window ...
        
        return Array.from(windows.entries()).map(([hours, data]) => ({
            hoursBeforeGame: hours,
            avgLineMovement: avg(data.movements.map(Math.abs)),
            avgCLV: avg(data.clvs),
            pickCount: data.clvs.length,
            optimalScore: avg(data.clvs) * Math.log(data.clvs.length + 1), // weight by sample size
        }));
    }
    
    // Steam move detection — rapid coordinated movement
    async function detectSteamInProgress(
        prisma: PrismaClient,
        gameId: string,
        lookbackMinutes: number = 30
    ): Promise<{
        detected: boolean;
        direction: 'home' | 'away' | null;
        magnitude: number;
        booksMoving: string[];
    }> {
        const cutoff = new Date(Date.now() - lookbackMinutes * 60000);
        
        const recentMovements = await prisma.lineMovement.findMany({
            where: {
                gameId,
                timestamp: { gte: cutoff },
                marketType: 'spread',
            },
            orderBy: { timestamp: 'desc' },
        });
        
        if (recentMovements.length < 2) {
            return { detected: false, direction: null, magnitude: 0, booksMoving: [] };
        }
        
        // Check if movements are coordinated (same direction)
        const directions = recentMovements.map(m => Math.sign(m.movement));
        const sameDirection = directions.every(d => d === directions[0]);
        
        if (sameDirection && recentMovements.length >= 3) {
            const totalMag = recentMovements.reduce((s, m) => s + Math.abs(m.movement), 0);
            return {
                detected: true,
                direction: directions[0] > 0 ? 'home' : 'away',
                magnitude: totalMag / recentMovements.length,
                booksMoving: [...new Set(recentMovements.map(m => m.sportsbook))],
            };
        }
        
        return { detected: false, direction: null, magnitude: 0, booksMoving: [] };
    }
    
    // Optimal bet timing recommendation
    function recommendBetTiming(
        windows: TimingWindow[],
        currentHoursBeforeGame: number
    ): {
        recommendation: 'bet_now' | 'wait' | 'urgent';
        reason: string;
        optimalWindow: number; // hours before game
    } {
        const bestWindow = windows.reduce((best, w) =>
            w.optimalScore > best.optimalScore ? w : best
        );
        
        const currentWindow = windows.find(w =>
            Math.abs(w.hoursBeforeGame - currentHoursBeforeGame) < 2
        );
        
        if (currentHoursBeforeGame < 1) {
            return {
                recommendation: 'urgent',
                reason: 'Game starting soon — bet now or miss it',
                optimalWindow: 0,
            };
        }
        
        if (currentWindow && currentWindow.optimalScore >= bestWindow.optimalScore * 0.8) {
            return {
                recommendation: 'bet_now',
                reason: `Current window has ${(currentWindow.avgCLV).toFixed(1)} avg CLV — near optimal`,
                optimalWindow: currentWindow.hoursBeforeGame,
            };
        }
        
        return {
            recommendation: 'wait',
            reason: `Better CLV historically at ${bestWindow.hoursBeforeGame}h before game (${bestWindow.avgCLV.toFixed(1)} avg CLV)`,
            optimalWindow: bestWindow.hoursBeforeGame,
        };
    }

**Testing approach:**
- Analyze historical CLV data by timing window
- Test steam detection with mock rapid movements
- Validate timing recommendations against known patterns (e.g., NFL lines softest Tuesday/Wednesday)

**Success criteria:**
- Timing windows computed from historical CLV data per sport
- Steam detection triggers within 30 minutes of coordinated movement
- Pick releases include timing recommendation
- Dashboard shows optimal betting windows by sport

---

## Task 5: Public Betting Bias Exploitation

**Why:** The public has systematic biases that create predictable market inefficiencies. Favorites get over-bet. Overs get over-bet. Primetime games attract casual money. These biases are well-documented and exploitable.

**Where:** Create `src/lib/public-bias.ts`

**Implementation:**

    // src/lib/public-bias.ts
    
    interface BiasSignal {
        type: BiasType;
        strength: number;        // 0-1
        direction: 'fade' | 'follow'; // fade = bet against the bias
        expectedEdge: number;    // expected CLV advantage in points
        description: string;
    }
    
    type BiasType =
        | 'favorite_bias'       // public over-bets favorites
        | 'over_bias'           // public over-bets overs
        | 'public_team'         // popular teams get inflated lines
        | 'primetime'           // national TV games attract casual money
        | 'rivalry'             // rivalry games get emotional money
        | 'playoff'             // playoff games attract new bettors
        | 'recency'             // public overweights recent results
        | 'travel_letdown';     // public fades road teams too much
    
    // Favorite bias: public bets favorites at ~65% rate
    // Fading large favorites in certain spots is profitable
    function detectFavoriteBias(
        spread: number,     // home spread (negative = home favored)
        publicPct: number,  // public % on favorite
        sport: string
    ): BiasSignal | null {
        const isBigFavorite = Math.abs(spread) >= 7;
        const publicHeavy = publicPct >= 0.70;
        
        if (isBigFavorite && publicHeavy) {
            // Historical data shows: large favorites with 70%+ public
            // action cover at ~47% rate (below the 50% needed to profit at -110)
            return {
                type: 'favorite_bias',
                strength: Math.min((publicPct - 0.65) / 0.25, 1.0),
                direction: 'fade',
                expectedEdge: 0.5 + (publicPct - 0.70) * 2, // 0.5-1.0 pts
                description: `Big favorite (${spread}) with ${(publicPct * 100).toFixed(0)}% public — fade territory`,
            };
        }
        return null;
    }
    
    // Over bias: public bets overs at ~55% rate
    // Especially pronounced in high-profile games
    function detectOverBias(
        total: number,
        publicOverPct: number,
        isPrimetime: boolean
    ): BiasSignal | null {
        const publicHeavy = publicOverPct >= 0.65;
        
        if (publicHeavy) {
            const primetimeBoost = isPrimetime ? 0.15 : 0;
            return {
                type: 'over_bias',
                strength: Math.min((publicOverPct - 0.60) / 0.30 + primetimeBoost, 1.0),
                direction: 'fade',
                expectedEdge: 0.3 + (publicOverPct - 0.65) * 1.5,
                description: `Over bet at ${(publicOverPct * 100).toFixed(0)}% — under has historical edge here`,
            };
        }
        return null;
    }
    
    // Primetime bias: games on national TV attract casual bettors
    function detectPrimetimeBias(
        gameTime: Date,
        network: string | null,
        sport: string
    ): BiasSignal | null {
        const hour = gameTime.getHours();
        const isPrimetime = (
            (sport === 'NFL' && ['NBC', 'ESPN', 'ABC'].includes(network || '')) ||
            (sport === 'NCAAMB' && hour >= 19) || // evening games
            (sport === 'NBA' && ['ESPN', 'TNT', 'ABC'].includes(network || ''))
        );
        
        if (isPrimetime) {
            return {
                type: 'primetime',
                strength: 0.3, // moderate signal
                direction: 'fade', // fade the public side in primetime
                expectedEdge: 0.3,
                description: `Primetime game (${network || 'evening'}) — casual money inflates lines`,
            };
        }
        return null;
    }
    
    // Conference tournament / March Madness bias
    // Public money floods in during tournament — biggest inefficiency window
    function detectPlayoffBias(
        isPlayoff: boolean,
        isConferenceTournament: boolean,
        publicPct: number
    ): BiasSignal | null {
        if ((isPlayoff || isConferenceTournament) && publicPct >= 0.65) {
            const strength = isConferenceTournament ? 0.5 : 0.7; // March Madness is bigger
            return {
                type: 'playoff',
                strength,
                direction: 'fade',
                expectedEdge: 0.5 + (publicPct - 0.65) * 2,
                description: `Tournament game with ${(publicPct * 100).toFixed(0)}% public — max inefficiency window`,
            };
        }
        return null;
    }
    
    // Composite bias score for a game
    function computeBiasScore(
        game: GameContext,
        publicData: PublicBettingData
    ): { totalBias: number; signals: BiasSignal[]; recommendation: string } {
        const signals: BiasSignal[] = [];
        
        const favBias = detectFavoriteBias(game.spread, publicData.spreadPct, game.sport);
        if (favBias) signals.push(favBias);
        
        const overBias = detectOverBias(game.total, publicData.overPct, game.isPrimetime);
        if (overBias) signals.push(overBias);
        
        const primeBias = detectPrimetimeBias(game.startTime, game.network, game.sport);
        if (primeBias) signals.push(primeBias);
        
        const playoffBias = detectPlayoffBias(game.isPlayoff, game.isConferenceTournament, publicData.spreadPct);
        if (playoffBias) signals.push(playoffBias);
        
        const totalBias = signals.reduce((s, sig) => s + sig.expectedEdge, 0);
        
        let recommendation = 'No significant public bias detected';
        if (totalBias >= 1.5) {
            recommendation = `STRONG FADE: ${signals.map(s => s.type).join(' + ')} — expect ${totalBias.toFixed(1)} pts of edge`;
        } else if (totalBias >= 0.5) {
            recommendation = `Moderate fade signal: ${signals[0]?.description}`;
        }
        
        return { totalBias, signals, recommendation };
    }

**Integration with pick engine:**

    // Add bias score to confidence calculation
    // In pick-engine.ts, when computing final confidence:
    
    const biasResult = computeBiasScore(gameContext, publicData);
    
    // If our model pick aligns with fading the public bias, boost confidence
    if (biasResult.totalBias > 0 && pickAlignedWithFade) {
        confidence += biasResult.totalBias * 0.05; // 5% boost per point of bias edge
        reasoning.push(`Public bias: ${biasResult.recommendation}`);
    }

**Testing approach:**
- Backtest favorite bias: ATS record of dogs when public % > 70% on favorite
- Backtest over bias: under ATS record when public over % > 65%
- Validate primetime detection with historical schedule data
- Tournament bias test: ATS record of contrarian picks in March

**Success criteria:**
- Bias signals generated for every game with available public % data
- Historical validation shows positive ROI for fade signals
- Bias score integrated into pick engine confidence
- Tournament games flagged with enhanced bias detection

---

## Task 6: CLV Optimization & Signal Attribution

**Why:** CLV is our north star metric. This task builds the feedback loop — every pick is evaluated for CLV, every signal is scored by its CLV contribution, and the entire model self-improves based on what actually beats the closing line.

**Where:** Extend `src/lib/clv-engine.ts`, add signal attribution to `pick-engine.ts`

**Signal attribution schema:**

    model PickSignalAttribution {
        id          String   @id @default(cuid())
        pickId      String   // FK to DailyPick
        signalName  String   // 'modelEdge', 'atsRecord', 'sharpMoney', 'publicBias', etc.
        signalValue Float    // raw signal value
        weight      Float    // weight used in confidence calculation
        contribution Float   // signalValue * weight = contribution to final score
        
        pick        DailyPick @relation(fields: [pickId], references: [id])
        
        @@index([pickId])
        @@index([signalName])
    }

**Implementation:**

    // Record signal contributions when generating picks
    // Modify pick engine to store attribution
    
    interface SignalContribution {
        signalName: string;
        signalValue: number;
        weight: number;
        contribution: number;
    }
    
    // During pick generation, collect all signal contributions
    function buildPickWithAttribution(
        signals: SignalContribution[]
    ): { confidence: number; attribution: SignalContribution[] } {
        const totalContribution = signals.reduce((s, sig) => s + sig.contribution, 0);
        
        // Normalize to 0-1 confidence
        const confidence = Math.max(0, Math.min(1, totalContribution));
        
        return { confidence, attribution: signals };
    }
    
    // CLV leaderboard by signal
    async function clvLeaderboard(
        prisma: PrismaClient,
        lookbackDays: number = 60
    ): Promise<{
        signalName: string;
        pickCount: number;
        avgCLV: number;
        clvPositiveRate: number;
        totalEdgeGenerated: number;
    }[]> {
        const cutoff = new Date(Date.now() - lookbackDays * 86400000);
        
        const attributions = await prisma.pickSignalAttribution.findMany({
            where: {
                pick: {
                    gradedAt: { gte: cutoff },
                    clvSpread: { not: null },
                },
            },
            include: { pick: true },
        });
        
        // Group by signal, compute CLV stats
        const bySignal = new Map<string, { clvs: number[]; contributions: number[] }>();
        
        for (const attr of attributions) {
            if (!bySignal.has(attr.signalName)) {
                bySignal.set(attr.signalName, { clvs: [], contributions: [] });
            }
            const entry = bySignal.get(attr.signalName)!;
            entry.clvs.push(attr.pick.clvSpread!);
            entry.contributions.push(attr.contribution);
        }
        
        return Array.from(bySignal.entries())
            .map(([signalName, data]) => ({
                signalName,
                pickCount: data.clvs.length,
                avgCLV: avg(data.clvs),
                clvPositiveRate: data.clvs.filter(c => c > 0).length / data.clvs.length,
                totalEdgeGenerated: sum(data.clvs),
            }))
            .sort((a, b) => b.avgCLV - a.avgCLV);
    }
    
    // Automated signal weight optimization
    // Run weekly: adjust signal weights based on CLV performance
    async function optimizeSignalWeights(
        prisma: PrismaClient
    ): Promise<Record<string, number>> {
        const leaderboard = await clvLeaderboard(prisma, 60);
        
        const weights: Record<string, number> = {};
        
        for (const entry of leaderboard) {
            if (entry.pickCount < 20) {
                // Not enough data — use default weight
                weights[entry.signalName] = 1.0;
                continue;
            }
            
            // Scale weight by CLV performance
            // avgCLV of +1.0 → weight 1.5
            // avgCLV of -1.0 → weight 0.5
            // avgCLV of 0.0  → weight 1.0
            weights[entry.signalName] = Math.max(0.2, Math.min(2.0,
                1.0 + (entry.avgCLV * 0.5)
            ));
        }
        
        // Store optimized weights
        await prisma.systemConfig.upsert({
            where: { key: 'signal_weights' },
            create: { key: 'signal_weights', value: JSON.stringify(weights) },
            update: { value: JSON.stringify(weights) },
        });
        
        return weights;
    }

**CLV trend alerting:**

    // Alert when CLV trends deteriorate
    async function checkCLVTrends(
        prisma: PrismaClient
    ): Promise<{ alert: boolean; message: string }> {
        const recent7d = await getCLVStats(prisma, {
            dateRange: [daysAgo(7), new Date()],
        });
        const previous7d = await getCLVStats(prisma, {
            dateRange: [daysAgo(14), daysAgo(7)],
        });
        
        if (recent7d.avgCLV < previous7d.avgCLV - 0.5) {
            return {
                alert: true,
                message: `⚠️ CLV declining: ${recent7d.avgCLV.toFixed(2)} (last 7d) vs ${previous7d.avgCLV.toFixed(2)} (prior 7d). Review signal weights.`,
            };
        }
        
        if (recent7d.clvPositiveRate < 0.45) {
            return {
                alert: true,
                message: `⚠️ CLV positive rate below 45%: ${(recent7d.clvPositiveRate * 100).toFixed(0)}%. Model may need recalibration.`,
            };
        }
        
        return { alert: false, message: 'CLV trends healthy' };
    }

**Testing approach:**
- Unit tests for signal attribution math
- Test CLV leaderboard with seeded pick + attribution data
- Test weight optimization produces reasonable bounds (0.2 - 2.0)
- End-to-end: generate pick → grade → compute CLV → update weights → verify next pick uses new weights

**Success criteria:**
- Every pick stores signal attribution (which signals contributed what)
- CLV leaderboard accessible via API/dashboard
- Weekly automated weight optimization runs without manual intervention
- CLV trend alerts fire when performance degrades

---

## Task 7: Market Inefficiency Alerts

**Why:** Edge is perishable. When a market inefficiency appears, we need to act fast. This builds a real-time alert system that surfaces the highest-value opportunities immediately.

**Where:** Create `src/lib/market-alerts.ts`, add Discord webhook integration.

**Schema:**

    model MarketAlert {
        id          String   @id @default(cuid())
        type        String   // steam_move, reverse_line, arbitrage, high_clv, public_extreme
        gameId      String
        sport       String
        severity    String   // info, warning, critical
        message     String
        metadata    Json     // type-specific data
        delivered   Boolean  @default(false)
        deliveredAt DateTime?
        createdAt   DateTime @default(now())
        expiresAt   DateTime // alerts are time-sensitive
        
        @@index([type, delivered])
        @@index([createdAt])
    }

**Implementation:**

    // src/lib/market-alerts.ts
    
    interface AlertConfig {
        steamMoveThreshold: number;     // min velocity (pts/hr) to alert
        reverseLineMinPublicPct: number; // min public % for RLM alert
        arbMinMargin: number;           // min arb margin % to alert
        publicExtremeThreshold: number;  // % on one side to trigger
        clvMinEdge: number;             // min CLV edge to flag
    }
    
    const DEFAULT_CONFIG: AlertConfig = {
        steamMoveThreshold: 2.0,
        reverseLineMinPublicPct: 0.70,
        arbMinMargin: 0.5,
        publicExtremeThreshold: 0.80,
        clvMinEdge: 1.5,
    };
    
    // Alert generation — called by odds monitor cron
    async function generateAlerts(
        prisma: PrismaClient,
        gameId: string,
        sport: string,
        config: AlertConfig = DEFAULT_CONFIG
    ): Promise<MarketAlert[]> {
        const alerts: MarketAlert[] = [];
        
        // 1. Steam move alert
        const steam = await detectSteamInProgress(prisma, gameId, 30);
        if (steam.detected && steam.magnitude >= config.steamMoveThreshold) {
            alerts.push({
                type: 'steam_move',
                gameId,
                sport,
                severity: steam.magnitude >= 3.0 ? 'critical' : 'warning',
                message: `🔥 Steam move detected: ${steam.booksMoving.length} books moved ${steam.direction} (${steam.magnitude.toFixed(1)} pts avg)`,
                metadata: steam,
                expiresAt: new Date(Date.now() + 2 * 3600000), // 2 hours
            });
        }
        
        // 2. Reverse line movement
        const sentiment = await getMarketSentiment(gameId, sport);
        if (sentiment) {
            const rlm = detectReverseLineMovement(
                sentiment.publicSpreadPct,
                sentiment.lineMovement,
                config.reverseLineMinPublicPct
            );
            if (rlm) {
                alerts.push({
                    type: 'reverse_line',
                    gameId,
                    sport,
                    severity: rlm.strength >= 0.7 ? 'critical' : 'warning',
                    message: `🔄 Reverse line movement: ${rlm.description}`,
                    metadata: { ...rlm, sentiment },
                    expiresAt: new Date(Date.now() + 4 * 3600000),
                });
            }
        }
        
        // 3. Public extreme
        if (sentiment && sentiment.publicSpreadPct >= config.publicExtremeThreshold) {
            alerts.push({
                type: 'public_extreme',
                gameId,
                sport,
                severity: sentiment.publicSpreadPct >= 0.85 ? 'critical' : 'info',
                message: `📊 Public extreme: ${(sentiment.publicSpreadPct * 100).toFixed(0)}% on one side — contrarian opportunity`,
                metadata: sentiment,
                expiresAt: new Date(Date.now() + 6 * 3600000),
            });
        }
        
        // 4. Arbitrage
        const allOdds = await getMultiBookOdds(prisma, gameId);
        const arb = detectArbitrage(allOdds, 'moneyline');
        if (arb?.exists && arb.margin >= config.arbMinMargin) {
            alerts.push({
                type: 'arbitrage',
                gameId,
                sport,
                severity: 'critical',
                message: `💰 Arbitrage found: ${arb.margin.toFixed(2)}% margin between ${arb.books.join(' & ')}`,
                metadata: arb,
                expiresAt: new Date(Date.now() + 30 * 60000), // 30 min — arbs close fast
            });
        }
        
        return alerts;
    }
    
    // Discord webhook delivery
    async function deliverAlerts(
        prisma: PrismaClient,
        webhookUrl: string
    ): Promise<void> {
        const pending = await prisma.marketAlert.findMany({
            where: {
                delivered: false,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'asc' },
        });
        
        for (const alert of pending) {
            const color = alert.severity === 'critical' ? 0xff0000
                : alert.severity === 'warning' ? 0xffaa00
                : 0x00aaff;
            
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeds: [{
                        title: `${alert.type.replace('_', ' ').toUpperCase()} — ${alert.sport}`,
                        description: alert.message,
                        color,
                        timestamp: alert.createdAt,
                        footer: { text: `Expires: ${alert.expiresAt.toLocaleTimeString()}` },
                    }],
                }),
            });
            
            await prisma.marketAlert.update({
                where: { id: alert.id },
                data: { delivered: true, deliveredAt: new Date() },
            });
        }
    }

**Testing approach:**
- Unit tests for each alert type trigger condition
- Test delivery with mock Discord webhook
- Test alert expiration (expired alerts not delivered)
- Integration: odds change → alert generated → webhook delivered

**Success criteria:**
- Alerts generated for all 5 types when conditions met
- Discord webhooks deliver within 1 minute of alert creation
- Alerts expire and stop delivering after expiration
- No duplicate alerts for the same event

---

## Task 8: Bookmaker Profile Analysis

**Why:** Not all sportsbooks are created equal. Pinnacle caters to sharps and has the tightest lines. FanDuel/DraftKings cater to recreational bettors and have softer lines. Understanding which books lead line movements vs follow tells us where the smart money is.

**Where:** Create `src/lib/book-profiles.ts`

**Implementation:**

    // src/lib/book-profiles.ts
    
    interface BookProfile {
        name: string;
        type: 'sharp' | 'recreational' | 'hybrid';
        avgVig: number;         // average vig/juice across markets
        lineLeadFrequency: number; // how often this book moves first (0-1)
        avgDivergenceFromConsensus: number;
        bestMarkets: string[];   // markets where this book offers best value
    }
    
    // Known book profiles (baseline — refined with data)
    const BOOK_PROFILES: Record<string, Partial<BookProfile>> = {
        pinnacle: {
            type: 'sharp',
            avgVig: 0.02,      // ~2% vig (lowest in market)
            bestMarkets: ['spreads', 'totals'],
        },
        fanduel: {
            type: 'recreational',
            avgVig: 0.045,
            bestMarkets: ['player_props', 'alt_lines'],
        },
        draftkings: {
            type: 'recreational',
            avgVig: 0.045,
            bestMarkets: ['moneyline', 'alt_lines'],
        },
        betmgm: {
            type: 'recreational',
            avgVig: 0.05,
            bestMarkets: ['moneyline'],
        },
        caesars: {
            type: 'hybrid',
            avgVig: 0.045,
            bestMarkets: ['spreads'],
        },
        bet365: {
            type: 'hybrid',
            avgVig: 0.04,
            bestMarkets: ['live_betting'],
        },
    };
    
    // Analyze which book leads line movements
    // The book that moves first is typically receiving sharp action
    async function analyzeLineLeadership(
        prisma: PrismaClient,
        lookbackDays: number = 30
    ): Promise<Record<string, number>> {
        const cutoff = new Date(Date.now() - lookbackDays * 86400000);
        
        const movements = await prisma.lineMovement.findMany({
            where: { timestamp: { gte: cutoff } },
            orderBy: [{ gameId: 'asc' }, { timestamp: 'asc' }],
        });
        
        // For each game, which book moved first?
        const leadCounts: Record<string, number> = {};
        const gameGroups = groupBy(movements, m => m.gameId);
        
        for (const [gameId, moves] of Object.entries(gameGroups)) {
            if (moves.length < 2) continue;
            
            // First mover for this game
            const leader = moves[0].sportsbook;
            leadCounts[leader] = (leadCounts[leader] || 0) + 1;
        }
        
        // Normalize to frequencies
        const total = Object.values(leadCounts).reduce((s, v) => s + v, 0);
        const frequencies: Record<string, number> = {};
        for (const [book, count] of Object.entries(leadCounts)) {
            frequencies[book] = count / total;
        }
        
        return frequencies;
    }
    
    // Find optimal book for a specific pick
    function findOptimalBook(
        allOdds: BookOdds[],
        pickSide: 'home' | 'away',
        marketType: 'spread' | 'total' | 'moneyline'
    ): {
        bestBook: string;
        bestLine: number;
        bestPrice: number;
        edgeVsPinnacle: number;
        recommendation: string;
    } | null {
        const bestLine = findBestLine(allOdds, pickSide, marketType);
        if (!bestLine) return null;
        
        // Compare against Pinnacle (sharp benchmark)
        const pinnacle = allOdds.find(o => o.sportsbook === 'pinnacle');
        let edgeVsPinnacle = 0;
        
        if (pinnacle && marketType === 'spread' && pinnacle.spread) {
            const pinnLine = pickSide === 'home' ? pinnacle.spread.home : pinnacle.spread.away;
            edgeVsPinnacle = bestLine.bestLine - pinnLine;
        }
        
        return {
            bestBook: bestLine.bestBook,
            bestLine: bestLine.bestLine,
            bestPrice: bestLine.bestPrice,
            edgeVsPinnacle,
            recommendation: edgeVsPinnacle > 0.5
                ? `📌 ${bestLine.bestBook} offers ${edgeVsPinnacle.toFixed(1)} pts better than Pinnacle — strong line shop`
                : `${bestLine.bestBook} has best line (${bestLine.bestLine})`,
        };
    }
    
    // Book-specific edge detection
    // Some books are slow to adjust — detect stale lines
    async function detectStaleLines(
        prisma: PrismaClient,
        gameId: string
    ): Promise<{
        book: string;
        staleLine: number;
        consensusLine: number;
        staleness: number; // how far behind consensus in points
    }[]> {
        const allOdds = await getMultiBookOdds(prisma, gameId);
        if (allOdds.length < 3) return [];
        
        // Calculate consensus (median) line
        const spreads = allOdds
            .filter(o => o.spread)
            .map(o => ({ book: o.sportsbook, line: o.spread!.home }));
        
        const median = getMedian(spreads.map(s => s.line));
        
        return spreads
            .filter(s => Math.abs(s.line - median) >= 1.0) // 1+ pt from consensus
            .map(s => ({
                book: s.book,
                staleLine: s.line,
                consensusLine: median,
                staleness: Math.abs(s.line - median),
            }));
    }

**Testing approach:**
- Test book profile matching with known sportsbook data
- Test line leadership analysis with mock movement data
- Validate stale line detection against known slow-moving books
- Integration: odds monitor detects stale line → alert generated → pick recommendation includes best book

**Success criteria:**
- Book profiles populated from historical data
- Line leadership shows Pinnacle/sharp books moving first
- Stale lines detected when books diverge 1+ points from consensus
- Pick output includes "Best book: X at Y" recommendation

---

## Integration Checklist

After completing all 8 tasks, verify:

    [ ] LineMovement table populated on every odds poll
    [ ] CLV calculated for every graded pick
    [ ] Signal attribution stored for every generated pick
    [ ] Sharp money indicators included in pick confidence
    [ ] Public bias signals included in pick confidence
    [ ] Market alerts firing via Discord webhook
    [ ] CLV leaderboard accessible (API or dashboard)
    [ ] Best book recommendation on every pick
    [ ] Weekly signal weight optimization running
    [ ] Odds history retained for backtesting

## Performance Targets

    - CLV positive rate: > 52% (beating closing line more than half the time)
    - Avg CLV: > +0.3 pts (meaningful edge over market)
    - Alert latency: < 2 min from line move to Discord notification
    - Odds polling: every 15 min (5 min within 2h of game time)
    - Signal weight updates: weekly automated run

## Dependencies & Data Sources

    - The Odds API: multi-book odds (already integrated via OddsSnapshot)
    - Public betting data: Action Network, DonBest, or similar
    - Pinnacle lines: via Odds API or direct
    - Discord webhook: for alert delivery
    - Existing CLV fields from Phase 3 schema

## Risk Mitigation

    - **API rate limits:** Cache aggressively, poll smart (frequent near game time, sparse otherwise)
    - **Stale data:** Every odds record timestamped, alerts expire, never act on data > 30 min old
    - **Overfitting signal weights:** Minimum 20 picks per signal before adjusting, cap weights at 0.2-2.0x
    - **False alerts:** Require minimum thresholds, suppress duplicate alerts within 30 min window
    - **Public % data quality:** Source from multiple providers, flag when sources disagree > 10%
