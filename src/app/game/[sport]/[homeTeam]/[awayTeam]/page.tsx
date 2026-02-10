"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useMatchup } from "@/hooks/use-matchup";
import { MatchupHeader } from "@/components/matchup/matchup-header";
import { TeamComparison } from "@/components/matchup/team-comparison";
import { HeadToHead } from "@/components/matchup/head-to-head";
import { TrendAngles } from "@/components/matchup/trend-angles";
import { RecentGamesTable } from "@/components/matchup/recent-games-table";

interface MatchupData {
  upcoming: {
    gameDate: string;
    spread: number | null;
    overUnder: number | null;
    moneylineHome: number | null;
    moneylineAway: number | null;
  } | null;
  context: {
    headToHead: {
      totalGames: number;
      homeTeamWins: number;
      awayTeamWins: number;
      homeAtsRecord: string;
      avgTotalPoints: number;
      overPct: number;
      lastMeeting: {
        date: string;
        homeScore: number;
        awayScore: number;
        homeTeam: string;
        awayTeam: string;
      } | null;
    };
    situationalAngles: {
      description: string;
      favors: "home" | "away" | "over" | "under" | "neutral";
      record: string;
      rate: number;
      sampleSize: number;
      significance: {
        strength: "strong" | "moderate" | "weak" | "noise";
        label: string;
        pValue: number;
        observedRate: number;
        baselineRate: number;
        confidenceInterval: [number, number];
        zScore: number;
        sampleSize: number;
        isSignificant: boolean;
      };
    }[];
    insight: string;
  } | null;
  homeRecent: {
    gameDate: string;
    opponent: string;
    isHome: boolean;
    score: string;
    result: "W" | "L" | "T";
    spread: number | null;
    spreadResult: string | null;
    ouResult: string | null;
  }[];
  awayRecent: {
    gameDate: string;
    opponent: string;
    isHome: boolean;
    score: string;
    result: "W" | "L" | "T";
    spread: number | null;
    spreadResult: string | null;
    ouResult: string | null;
  }[];
  homeSeasonStats: {
    season: number;
    record: string;
    wins: number;
    losses: number;
    winPct: number;
    atsRecord: string;
    atsCovered: number;
    atsLost: number;
    atsPct: number;
    ouRecord: string;
    overs: number;
    unders: number;
    overPct: number;
    avgPointsFor: number;
    avgPointsAgainst: number;
    avgMargin: number;
    homeRecord: string;
    awayRecord: string;
  };
  awaySeasonStats: {
    season: number;
    record: string;
    wins: number;
    losses: number;
    winPct: number;
    atsRecord: string;
    atsCovered: number;
    atsLost: number;
    atsPct: number;
    ouRecord: string;
    overs: number;
    unders: number;
    overPct: number;
    avgPointsFor: number;
    avgPointsAgainst: number;
    avgMargin: number;
    homeRecord: string;
    awayRecord: string;
  };
  additionalTrends: {
    label: string;
    description: string;
    record: string;
    rate: number;
    sampleSize: number;
    strength: "strong" | "moderate" | "weak" | "noise";
    favors: "home" | "away" | "over" | "under" | "neutral";
  }[];
}

export default function GameMatchupPage() {
  const params = useParams();
  const sport = (params.sport as string)?.toUpperCase();
  const homeTeam = decodeURIComponent(params.homeTeam as string);
  const awayTeam = decodeURIComponent(params.awayTeam as string);

  const { data: matchupResult, isLoading: loading, error: queryError } = useMatchup(sport, homeTeam, awayTeam);
  const data: MatchupData | null = matchupResult?.data ?? null;
  const durationMs: number | null = matchupResult?.durationMs ?? null;
  const error = queryError ? (queryError as Error).message : null;

  if (loading) {
    return (
      <div className="py-8">
        <div className="mb-6">
          <div className="h-4 w-32 animate-pulse rounded bg-secondary/50" />
        </div>
        <div className="space-y-4">
          <div className="h-48 animate-pulse rounded-xl border border-border/40 bg-secondary/30" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-64 animate-pulse rounded-xl border border-border/40 bg-secondary/30" />
            <div className="h-64 animate-pulse rounded-xl border border-border/40 bg-secondary/30" />
          </div>
          <div className="h-48 animate-pulse rounded-xl border border-border/40 bg-secondary/30" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8">
        <Link
          href={`/${sport.toLowerCase()}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to {sport}
        </Link>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="py-8">
      {/* Back navigation */}
      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/${sport.toLowerCase()}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          &larr; Back to {sport}
        </Link>
        {durationMs !== null && (
          <span className="text-xs text-muted-foreground/60">
            {durationMs}ms
          </span>
        )}
      </div>

      <div className="space-y-6">
        {/* Matchup Header with odds */}
        <MatchupHeader
          sport={sport}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          gameDate={data.upcoming?.gameDate ?? null}
          spread={data.upcoming?.spread ?? null}
          overUnder={data.upcoming?.overUnder ?? null}
          moneylineHome={data.upcoming?.moneylineHome ?? null}
          moneylineAway={data.upcoming?.moneylineAway ?? null}
        />

        {/* Insight */}
        {data.context?.insight && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm leading-relaxed text-primary">
              {data.context.insight}
            </p>
          </div>
        )}

        {/* Season Comparison */}
        {data.homeSeasonStats && data.awaySeasonStats && (
          <TeamComparison
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeStats={data.homeSeasonStats}
            awayStats={data.awaySeasonStats}
          />
        )}

        {/* Head-to-Head */}
        {data.context?.headToHead && (
          <HeadToHead
            h2h={data.context.headToHead}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
          />
        )}

        {/* Trend Angles */}
        <TrendAngles
          situationalAngles={data.context?.situationalAngles}
          additionalTrends={data.additionalTrends}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />

        {/* Recent Games */}
        <div className="grid gap-6 lg:grid-cols-2">
          <RecentGamesTable team={homeTeam} games={data.homeRecent} />
          <RecentGamesTable team={awayTeam} games={data.awayRecent} />
        </div>

        {/* Quick search links */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Explore More
          </h3>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/search?q=${encodeURIComponent(`${homeTeam} ${sport}`)}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {homeTeam} trends
            </Link>
            <Link
              href={`/search?q=${encodeURIComponent(`${awayTeam} ${sport}`)}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {awayTeam} trends
            </Link>
            <Link
              href={`/search?q=${encodeURIComponent(`${homeTeam} home ${sport}`)}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {homeTeam} at home
            </Link>
            <Link
              href={`/search?q=${encodeURIComponent(`${awayTeam} away ${sport}`)}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {awayTeam} on road
            </Link>
            <Link
              href={`/search?q=${encodeURIComponent(`${homeTeam} vs ${awayTeam} ${sport}`)}`}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              Head-to-head history
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
