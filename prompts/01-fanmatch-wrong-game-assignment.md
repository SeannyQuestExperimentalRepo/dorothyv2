# Prompt 01: Fix FanMatch Predictions Assigned to Wrong Games

**Priority:** 🔴 P0 — Actively corrupting pick engine inputs  
**Impact:** FanMatch predictions are matched by date only, not by team. The first FanMatch row overwrites ALL unfilled NCAAMB games for that date with the same prediction. Also, the moneyline edge lookup in pick-engine uses raw ESPN names against KenPom names.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

I need to fix two related FanMatch bugs:

## Bug 1: FanMatch predictions assigned to wrong games

**File:** src/app/api/cron/daily-sync/route.ts (lines 126-151)

The current code loops through FanMatch predictions and runs updateMany, but the WHERE clause has NO team filter — only date + sport + fmHomePred:null. So the first FanMatch prediction fills ALL unfilled games for that date with the wrong data.

Current broken code (lines 132-146):

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
            fmHomePred: null, // ← only filter is "not yet filled"
            // ❌ NO homeTeam/awayTeam filter!
          },
          data: {
            fmHomePred: fm.HomePred,
            fmAwayPred: fm.VisitorPred,
            fmHomeWinProb: fm.HomeWP,
          },
        });
        updated += result.count;
      } catch {
        // Skip individual game failures
      }
    }

**Fix:** Resolve FanMatch team names (KenPom format) to canonical names, then match against UpcomingGame team names:

    const { resolveTeamName } = await import("@/lib/team-resolver");
    
    for (const fm of fanMatch) {
      try {
        const gameDate = new Date(fm.DateOfGame);
        const dateStr = gameDate.toISOString().split("T")[0];
        
        // Resolve KenPom names to canonical DB names
        const canonHome = await resolveTeamName(fm.Home, "NCAAMB", "kenpom");
        const canonAway = await resolveTeamName(fm.Visitor, "NCAAMB", "kenpom");
        
        const result = await prisma.upcomingGame.updateMany({
          where: {
            sport: "NCAAMB",
            gameDate: {
              gte: new Date(dateStr + "T00:00:00Z"),
              lte: new Date(dateStr + "T23:59:59Z"),
            },
            homeTeam: canonHome,   // ✅ match specific game
            awayTeam: canonAway,   // ✅ match specific game
          },
          data: {
            fmHomePred: fm.HomePred,
            fmAwayPred: fm.VisitorPred,
            fmHomeWinProb: fm.HomeWP,
          },
        });
        
        if (result.count === 0) {
          // Try reverse (neutral sites may swap home/away)
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
              fmHomePred: fm.VisitorPred,   // swapped
              fmAwayPred: fm.HomePred,       // swapped
              fmHomeWinProb: 1 - fm.HomeWP,  // inverted
            },
          });
          updated += reverseResult.count;
          if (reverseResult.count === 0) {
            console.warn("[Cron] FanMatch: no match for " + fm.Home + " vs " + fm.Visitor + " on " + dateStr);
          }
        } else {
          updated += result.count;
        }
      } catch (err) {
        console.error("[Cron] FanMatch assignment failed:", err);
      }
    }

Remove the fmHomePred: null filter — we want to update even if a previous bad run already filled it with wrong data.

## Bug 2: Moneyline edge lookup uses wrong names in pick engine

**File:** src/lib/pick-engine.ts (around line 2497)

Current broken code:

    const gameFM = kenpomFanMatch?.find(
      (f) => f.Home.toLowerCase() === game.homeTeam.toLowerCase() &&
             f.Visitor.toLowerCase() === game.awayTeam.toLowerCase()
    )

game.homeTeam is ESPN format ("Michigan State"), f.Home is KenPom format ("Michigan St."). Never matches for dozens of teams.

**Fix — Part A:** Re-key FanMatch data at fetch time. In src/lib/kenpom.ts, modify getKenpomFanMatch:

    export async function getKenpomFanMatch(date: string): Promise<KenpomFanMatch[]> {
      const now = Date.now();
      const cached = fanMatchCache.get(date);
      if (cached && now - cached.fetchedAt < FANMATCH_TTL_MS) return cached.data;
    
      const raw = await fetchKenpom<KenpomFanMatch[]>({ endpoint: "fanmatch", d: date });
      
      // Re-key Home and Visitor to canonical DB names
      const { resolveTeamName } = await import("./team-resolver");
      const resolved = await Promise.all(raw.map(async (fm) => ({
        ...fm,
        Home: await resolveTeamName(fm.Home, "NCAAMB", "kenpom"),
        Visitor: await resolveTeamName(fm.Visitor, "NCAAMB", "kenpom"),
      })));
    
      fanMatchCache.set(date, { data: resolved, fetchedAt: now });
      console.log("[kenpom] Fetched " + resolved.length + " FanMatch games for " + date);
      return resolved;
    }

**Fix — Part B:** In pick-engine.ts at the moneyline edge lookup (~line 2497), use canonHome/canonAway instead of game.homeTeam/game.awayTeam:

    const gameFM = kenpomFanMatch?.find(
      (f) => f.Home.toLowerCase() === canonHome.toLowerCase() &&
             f.Visitor.toLowerCase() === canonAway.toLowerCase()
    )

Same fix needed inside computeKenPomEdge (around line 300-305) where FanMatch is looked up — those params should be canonical since the function now receives canonical names.

## Testing:
- After fix, log a few FanMatch lookups to verify they match correctly
- Check that moneyline edge signal is no longer always null
- Verify neutral site games still match (check reverse home/away)
