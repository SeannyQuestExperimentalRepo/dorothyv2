/**
 * Trend Evaluator — checks saved trends against today's upcoming games.
 *
 * Called from the daily-sync cron. For each saved trend, checks if any
 * upcoming game matches the trend's sport and team filters. If a match
 * is found, marks the trend as triggered with a snapshot of matching games.
 */

import { prisma } from "./db";
import type { Sport } from "@prisma/client";

interface TrendQuery {
  sport?: string;
  team?: string;
  opponent?: string;
  home?: boolean;
  [key: string]: unknown;
}

interface MatchedGame {
  homeTeam: string;
  awayTeam: string;
  gameDate: string;
  spread: number | null;
  overUnder: number | null;
}

/**
 * Evaluate all saved trends against today's upcoming games.
 * Returns count of triggered trends.
 */
export async function evaluateSavedTrends(): Promise<{
  evaluated: number;
  triggered: number;
  errors: number;
}> {
  const trends = await prisma.savedTrend.findMany();
  if (trends.length === 0) return { evaluated: 0, triggered: 0, errors: 0 };

  // Get all upcoming games
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const upcomingGames = await prisma.upcomingGame.findMany({
    where: {
      gameDate: { gte: now, lte: tomorrow },
    },
  });

  let evaluated = 0;
  let triggered = 0;
  let errors = 0;

  for (const trend of trends) {
    try {
      evaluated++;
      const query = trend.query as unknown as TrendQuery;

      // Filter upcoming games by sport
      let matches = upcomingGames.filter(
        (g) => g.sport === trend.sport,
      );

      // Filter by team if specified in the query
      if (query.team) {
        const teamLower = query.team.toLowerCase();
        matches = matches.filter(
          (g) =>
            g.homeTeam.toLowerCase().includes(teamLower) ||
            g.awayTeam.toLowerCase().includes(teamLower),
        );
      }

      // Filter by opponent if specified
      if (query.opponent) {
        const oppLower = query.opponent.toLowerCase();
        matches = matches.filter(
          (g) =>
            g.homeTeam.toLowerCase().includes(oppLower) ||
            g.awayTeam.toLowerCase().includes(oppLower),
        );
      }

      // Filter by home/away if specified
      if (query.home !== undefined && query.team) {
        const teamLower = query.team.toLowerCase();
        if (query.home) {
          matches = matches.filter((g) =>
            g.homeTeam.toLowerCase().includes(teamLower),
          );
        } else {
          matches = matches.filter((g) =>
            g.awayTeam.toLowerCase().includes(teamLower),
          );
        }
      }

      if (matches.length > 0) {
        const matchedGames: MatchedGame[] = matches.map((g) => ({
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          gameDate: g.gameDate.toISOString(),
          spread: g.spread,
          overUnder: g.overUnder,
        }));

        await prisma.savedTrend.update({
          where: { id: trend.id },
          data: {
            lastTriggered: now,
            lastResult: matchedGames as unknown as import("@prisma/client").Prisma.InputJsonValue,
          },
        });

        triggered++;
      }
    } catch (err) {
      console.error(`[trend-eval] Failed to evaluate trend ${trend.id}:`, err);
      errors++;
    }
  }

  return { evaluated, triggered, errors };
}
