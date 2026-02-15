# Phase 1: All Bug Fixes (12 issues)

**Timeline:** 3 days (Feb 16-18)  
**Goal:** Fix every active bug found in the codebase audit. After this, no data corruption, no silent failures, no broken grading.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

I need you to fix 12 bugs across the Trendline codebase. Work through each one in order. For each fix, make the change, then move to the next. All files are relative to the project root.

## Fix 1: FanMatch predictions assigned to wrong games

**File:** src/app/api/cron/daily-sync/route.ts (around lines 126-151)

The FanMatch capture loop runs updateMany with NO team filter — only date + sport + fmHomePred:null. The first FanMatch prediction fills ALL unfilled NCAAMB games for that date with wrong data.

Find this code block:

    for (const fm of fanMatch) {
      try {
        const gameDate = new Date(fm.DateOfGame);
        const dateStr = gameDate.toISOString().split("T")[0];
        const result = await prisma.upcomingGame.updateMany({
          where: {
            sport: "NCAAMB",
            gameDate: {
              gte: new Date(dateStr + "T00:00:00Z"),
              lte: new Date(dateStr + "T23:59:59Z"),
            },
            fmHomePred: null,
          },

Replace the entire for loop with:

    const { resolveTeamName } = await import("@/lib/team-resolver");

    for (const fm of fanMatch) {
      try {
        const gameDate = new Date(fm.DateOfGame);
        const dateStr = gameDate.toISOString().split("T")[0];
        const canonHome = await resolveTeamName(fm.Home, "NCAAMB", "kenpom");
        const canonAway = await resolveTeamName(fm.Visitor, "NCAAMB", "kenpom");

        const result = await prisma.upcomingGame.updateMany({
          where: {
            sport: "NCAAMB",
            gameDate: {
              gte: new Date(dateStr + "T00:00:00Z"),
              lte: new Date(dateStr + "T23:59:59Z"),
            },
            homeTeam: canonHome,
            awayTeam: canonAway,
          },
          data: {
            fmHomePred: fm.HomePred,
            fmAwayPred: fm.VisitorPred,
            fmHomeWinProb: fm.HomeWP,
          },
        });

        if (result.count === 0) {
          const reverseResult = await prisma.upcomingGame.updateMany({
            where: {
              sport: "NCAAMB",
              gameDate: {
                gte: new Date(dateStr + "T00:00:00Z"),
                lte: new Date(dateStr + "T23:59:59Z"),
              },
              homeTeam: canonAway,
              awayTeam: canonHome,
            },
            data: {
              fmHomePred: fm.VisitorPred,
              fmAwayPred: fm.HomePred,
              fmHomeWinProb: 1 - fm.HomeWP,
            },
          });
          updated += reverseResult.count;
        } else {
          updated += result.count;
        }
      } catch (err) {
        console.error("[Cron] FanMatch assignment failed:", err);
      }
    }

Also in src/lib/kenpom.ts, modify getKenpomFanMatch to re-key names through the team resolver (same pattern used by getKenpomRatings). After fetching raw data, resolve Home and Visitor to canonical names:

    const { resolveTeamName } = await import("./team-resolver");
    const resolved = await Promise.all(raw.map(async (fm) => ({
      ...fm,
      Home: await resolveTeamName(fm.Home, "NCAAMB", "kenpom"),
      Visitor: await resolveTeamName(fm.Visitor, "NCAAMB", "kenpom"),
    })));

Cache and return `resolved` instead of `raw`.

Then in src/lib/pick-engine.ts around line 2497, the FanMatch moneyline edge lookup must use canonical names. Find:

    const gameFM = kenpomFanMatch?.find(
      (f) => f.Home.toLowerCase() === game.homeTeam.toLowerCase() &&
             f.Visitor.toLowerCase() === game.awayTeam.toLowerCase()
    )

Change to:

    const gameFM = kenpomFanMatch?.find(
      (f) => f.Home.toLowerCase() === canonHome.toLowerCase() &&
             f.Visitor.toLowerCase() === canonAway.toLowerCase()
    )

## Fix 2: NBA grading falls through to NCAAMBGame table

**File:** src/lib/pick-engine.ts — gradeGamePick function (around line 2670)

Find:

    const table =
      pick.sport === "NFL"
        ? "NFLGame"
        : pick.sport === "NCAAF"
          ? "NCAAFGame"
          : "NCAAMBGame";

The dynamic Prisma access below this uses `table.charAt(0).toLowerCase() + table.slice(1)` which would produce "nBAGame" for NBA — likely wrong. Replace the entire grading table lookup with an explicit switch. Find the `const games = await (prisma as any)[...]` block and replace it with:

    async function findGameForGrading(
      sport: string,
      homeTeamId: number,
      awayTeamId: number,
      dayBefore: Date,
      dayAfter: Date
    ) {
      const where = {
        homeTeamId,
        awayTeamId,
        gameDate: { gte: dayBefore, lte: dayAfter },
      };
      switch (sport) {
        case "NFL": return prisma.nFLGame.findMany({ where, take: 1 });
        case "NCAAF": return prisma.nCAAFGame.findMany({ where, take: 1 });
        case "NBA": return prisma.nBAGame.findMany({ where, take: 1 });
        case "NCAAMB": return prisma.nCAAMBGame.findMany({ where, take: 1 });
        default: return [];
      }
    }

Check the actual Prisma model accessor names by looking at the generated types or schema. The model names in schema.prisma are NFLGame, NCAAFGame, NBAGame, NCAAMBGame — Prisma lowercases the first letter, so they should be nFLGame, nCAAFGame, nBAGame, nCAAMBGame. Verify this compiles.

## Fix 3: dayOfWeek timezone bug

**File:** src/lib/espn-sync.ts — 4 locations

All dayOfWeek calculations use server timezone (UTC on Vercel) instead of ET. Find every instance. There are 4:

Line ~412: `g.gameDate.toLocaleDateString("en-US", { weekday: "long" })`
Line ~452: `g.gameDate.toLocaleDateString("en-US", { weekday: "long" })`
Line ~958: `gameDate.toLocaleDateString("en-US", { weekday: "long" })`
Line ~982: `gameDate.toLocaleDateString("en-US", { weekday: "long" })`

Add timeZone to ALL of them:

    gameDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })

Then write a one-time migration script at scripts/fix-day-of-week.ts that recalculates dayOfWeek for all existing games across all 4 game tables (NFLGame, NCAAFGame, NCAAMBGame, NBAGame) using America/New_York timezone.

## Fix 4: NFL O/U weather double-counting

**File:** src/lib/pick-engine.ts

Weather is counted twice for NFL/NCAAF O/U: once inline in signalH2HWeatherOU (around lines 1689-1710) and again via the dedicated weatherSignal pushed into ouSignals.

Fix: strip the weather logic out of signalH2HWeatherOU. Remove the entire weather section (wind, cold, rain/snow blocks) from that function. Keep only the H2H total vs line comparison and H2H O/U record logic. The dedicated signalWeather module handles weather properly.

Do the same check for NCAAF — if weatherSignal is also pushed for NCAAF, make sure the inline weather in signalH2HWeatherOU is also removed for that sport.

## Fix 5: NCAAF SP+ lookup uses raw names

**File:** src/lib/pick-engine.ts (around line 2434)

Find where computeSPEdge is called:

    computeSPEdge(
      cfbdRatings,
      game.homeTeam,
      game.awayTeam,

Change to:

    computeSPEdge(
      cfbdRatings,
      canonHome,
      canonAway,

Also check src/lib/cfbd.ts — does getCFBDRatings re-key through the team resolver? If not, add re-keying (same pattern as getKenpomRatings in kenpom.ts):

    const { resolveTeamName } = await import("./team-resolver");
    for (const team of raw) {
      const canonical = await resolveTeamName(team.school, "NCAAF", "cfbd");
      map.set(canonical, team);
    }

## Fix 6: NBA dead signal weights + rest days

**File:** src/lib/pick-engine.ts

Part A — Enable NBA rest days. In signalRestDays (around line 656), find:

    if (sport !== "NCAAMB") {
      return { category: "restDays", direction: "neutral", ...

Change to:

    if (sport !== "NCAAMB" && sport !== "NBA") {
      return { category: "restDays", direction: "neutral", ...

The existing B2B detection logic (36h lookback) works for NBA too.

Part B — Redistribute NBA weights. Find the NBA spread weights object and update:

    NBA: {
      modelEdge: 0.20,
      seasonATS: 0.20,
      trendAngles: 0.00,
      recentForm: 0.20,
      h2h: 0.05,
      situational: 0.05,
      restDays: 0.15,
      eloEdge: 0.05,
      nbaFourFactors: 0.10,
    },

Do the same for NBA O/U weights — set trendAngles to 0.00 and redistribute to active signals. Make sure they still sum to 1.00.

Part C — Fix the weight fallback. In computeConvergenceScore (around line 1898), find:

    const w = weights[signal.category] || 0.1;

Change to:

    const w = weights[signal.category] ?? 0.1;

This prevents explicit 0.0 weights from accidentally becoming 0.1.

## Fix 7: Site gate cookie bypass

**File:** src/app/api/gate/route.ts

Replace the static cookie value with an HMAC-signed value. After the password verification succeeds, change the cookie setting to:

    import crypto from "crypto";

    const timestamp = Date.now().toString();
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
    const signature = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
    const cookieValue = timestamp + ":" + signature;

    res.cookies.set("site_access", cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

**File:** src/middleware.ts

Replace the simple cookie check with HMAC verification. Replace:

    const hasAccess = req.cookies.get("site_access")?.value === "granted";

With:

    import crypto from "crypto";

    function verifySiteAccess(cookieValue: string | undefined): boolean {
      if (!cookieValue) return false;
      const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
      if (!secret) return false;
      const parts = cookieValue.split(":");
      if (parts.length !== 2) return false;
      const [timestamp, signature] = parts;
      const age = Date.now() - parseInt(timestamp);
      if (isNaN(age) || age > 30 * 24 * 60 * 60 * 1000) return false;
      const expected = crypto.createHmac("sha256", secret).update(timestamp).digest("hex");
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    }

    // Then use:
    const hasAccess = verifySiteAccess(req.cookies.get("site_access")?.value);

Note: the crypto import may need to be at the top of the file, and middleware runs in Edge runtime — verify that crypto.createHmac is available in Edge. If not, use the Web Crypto API (subtle.importKey + subtle.sign) instead.

## Fix 8: NBA aliases empty

**File:** src/lib/team-aliases.generated.ts

Find the NBA key (it's an empty object). Replace with all 30 NBA teams:

    NBA: {
      "Boston Celtics": ["BOS", "Boston"],
      "Brooklyn Nets": ["BKN", "Brooklyn", "NJ Nets", "New Jersey Nets"],
      "New York Knicks": ["NYK", "NY Knicks", "New York"],
      "Philadelphia 76ers": ["PHI", "Philadelphia", "Philly", "Sixers"],
      "Toronto Raptors": ["TOR", "Toronto"],
      "Chicago Bulls": ["CHI", "Chicago"],
      "Cleveland Cavaliers": ["CLE", "Cleveland", "Cavs"],
      "Detroit Pistons": ["DET", "Detroit"],
      "Indiana Pacers": ["IND", "Indiana"],
      "Milwaukee Bucks": ["MIL", "Milwaukee"],
      "Atlanta Hawks": ["ATL", "Atlanta"],
      "Charlotte Hornets": ["CHA", "Charlotte", "Charlotte Bobcats"],
      "Miami Heat": ["MIA", "Miami"],
      "Orlando Magic": ["ORL", "Orlando"],
      "Washington Wizards": ["WAS", "Washington", "WSH"],
      "Denver Nuggets": ["DEN", "Denver"],
      "Minnesota Timberwolves": ["MIN", "Minnesota", "Timberwolves"],
      "Oklahoma City Thunder": ["OKC", "Oklahoma City"],
      "Portland Trail Blazers": ["POR", "Portland", "Blazers", "Trail Blazers"],
      "Utah Jazz": ["UTA", "Utah"],
      "Golden State Warriors": ["GSW", "Golden State", "GS Warriors"],
      "LA Clippers": ["LAC", "Los Angeles Clippers", "Clippers"],
      "Los Angeles Lakers": ["LAL", "LA Lakers", "Lakers"],
      "Phoenix Suns": ["PHX", "Phoenix"],
      "Sacramento Kings": ["SAC", "Sacramento"],
      "Dallas Mavericks": ["DAL", "Dallas", "Mavs"],
      "Houston Rockets": ["HOU", "Houston"],
      "Memphis Grizzlies": ["MEM", "Memphis"],
      "New Orleans Pelicans": ["NOP", "New Orleans", "NO Pelicans"],
      "San Antonio Spurs": ["SAS", "San Antonio"],
    },

Cross-reference with the ESPN API and Odds API team name formats. Make sure the canonical name (the key) matches what ESPN uses since that's the primary data source.

## Fix 9: Missing error boundaries

Create error.tsx files for these 14 routes. Use the existing pattern from src/app/bets/error.tsx as the template, but also add Sentry tracking:

Routes needing error.tsx:
- src/app/ncaamb/error.tsx (label: "NCAAMB")
- src/app/nfl/error.tsx (label: "NFL")
- src/app/ncaaf/error.tsx (label: "NCAAF")
- src/app/nba/error.tsx (label: "NBA")
- src/app/search/error.tsx (label: "Search")
- src/app/login/error.tsx (label: "Login")
- src/app/signup/error.tsx (label: "Signup")
- src/app/pricing/error.tsx (label: "Pricing")
- src/app/parlays/error.tsx (label: "Parlays")
- src/app/props/error.tsx (label: "Props")
- src/app/community/error.tsx (label: "Community")
- src/app/gate/error.tsx (label: "Gate")
- src/app/admin/error.tsx (label: "Admin")
- src/app/trends/saved/error.tsx (label: "Saved Trends")

Template for each (replace LABEL and DESCRIPTION):

    "use client";

    import { useEffect } from "react";

    export default function ErrorPage({
      error,
      reset,
    }: {
      error: Error & { digest?: string };
      reset: () => void;
    }) {
      useEffect(() => {
        console.error("[LABEL Error]", error);
      }, [error]);

      return (
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="mx-auto max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Failed to load DESCRIPTION
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={reset}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

## Fix 10: PlayerGameLog unique constraint

**File:** prisma/schema.prisma

Add to the PlayerGameLog model:

    @@unique([playerId, season, week, seasonType])

Before running the migration, check for existing duplicates. If any exist, deduplicate by keeping the row with the highest id and deleting others. Then run the migration.

Also find wherever PlayerGameLog rows are created and switch to upsert or createMany with skipDuplicates: true.

## Fix 11: Replace console.error with trackError across all API routes

**File:** src/lib/error-tracking.ts

First, make sure trackError accepts context metadata. If it doesn't already, update it to:

    export function trackError(error: unknown, metadata?: Record<string, unknown>) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (metadata) {
        Sentry.setContext("custom", metadata);
      }
      Sentry.captureException(err);
      if (process.env.NODE_ENV === "development") {
        console.error(err);
      }
    }

Then do a find-and-replace across all files in src/app/api/ and the key lib files. For every console.error call, replace with trackError. There are approximately 64 console.error calls in API routes plus more in lib files.

Pattern:
- Before: console.error("[Some Route] Error:", err);
- After: trackError(err, { route: "some-route" });

Make sure to add the import at the top of each file:

    import { trackError } from "@/lib/error-tracking";

Priority files (handle money/picks): cron/daily-sync/route.ts (has ~15 console.error calls), stripe/webhook/route.ts, picks/generate/route.ts, bets/route.ts, pick-engine.ts, espn-sync.ts, odds-api-sync.ts.

## Fix 12: Stripe webhook idempotency

**File:** prisma/schema.prisma

Add a new model:

    model StripeEvent {
      id          String   @id // Stripe event ID (evt_...)
      type        String
      processedAt DateTime @default(now())

      @@index([processedAt])
    }

**File:** src/app/api/stripe/webhook/route.ts

After the event is constructed (after the constructEvent call), add an idempotency check before processing:

    // Idempotency: skip already-processed events
    const existing = await prisma.stripeEvent.findUnique({
      where: { id: event.id },
    });
    if (existing) {
      return NextResponse.json({ received: true, duplicate: true });
    }

After successful processing (before the final return), record the event:

    await prisma.stripeEvent.create({
      data: { id: event.id, type: event.type },
    });

Run the Prisma migration after updating the schema.

---

After completing all 12 fixes, run a full TypeScript check to make sure everything compiles:

    npx tsc --noEmit

Fix any type errors that come up from the changes.
