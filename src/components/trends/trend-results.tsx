"use client";

import { SignificanceBadge } from "./significance-badge";
import { StreakDots } from "./streak-dots";
import { StatCard } from "./stat-card";

// Types mirroring the API response
interface TrendSummary {
  totalGames: number;
  wins: number;
  losses: number;
  winPct: number;
  atsCovered: number;
  atsLost: number;
  atsPush: number;
  atsPct: number;
  atsRecord: string;
  overs: number;
  unders: number;
  ouPush: number;
  overPct: number;
  ouRecord: string;
  avgPointsFor: number;
  avgPointsAgainst: number;
  avgTotalPoints: number;
  avgMargin: number;
  avgSpread: number | null;
  avgOverUnder: number | null;
  bySeasonBreakdown: {
    season: number;
    games: number;
    wins: number;
    losses: number;
    atsCovered: number;
    atsLost: number;
  }[];
}

interface TrendSignificance {
  sampleSize: number;
  observedRate: number;
  baselineRate: number;
  zScore: number;
  pValue: number;
  isSignificant: boolean;
  confidenceInterval: [number, number];
  strength: "strong" | "moderate" | "weak" | "noise";
  label: string;
}

interface SignificanceEnrichment {
  winRate: TrendSignificance;
  ats: TrendSignificance;
  overUnder: TrendSignificance;
  notableSeasons: {
    season: number;
    ats: TrendSignificance;
    winRate: TrendSignificance;
  }[];
  topFinding: string;
}

interface TrendGame {
  sport: string;
  season: number;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  spread: number | null;
  spreadResult: string | null;
  ouResult: string | null;
  totalPoints: number;
}

interface TrendResultsProps {
  data: {
    query: {
      sport: string;
      team?: string;
      perspective?: string;
      filters: { field: string; operator: string; value: unknown }[];
    };
    summary: TrendSummary;
    significance: SignificanceEnrichment;
    games: TrendGame[];
    gameCount: number;
    computedAt: string;
  };
  meta: {
    durationMs: number;
    sport: string;
    gamesSearched: number;
  };
  interpretation?: string;
}

function getSentiment(
  pct: number,
  baseline: number = 50,
): "positive" | "negative" | "neutral" {
  if (pct >= baseline + 5) return "positive";
  if (pct <= baseline - 5) return "negative";
  return "neutral";
}

export function TrendResults({
  data,
  meta,
  interpretation,
}: TrendResultsProps) {
  const { summary, significance, games, gameCount } = data;
  const query = data.query;

  // Build recent streak dots from most recent 10 games (ATS)
  // Games arrive sorted most-recent-first from the API
  const recentGames = games.slice(0, 10);
  const atsStreak = recentGames
    .filter((g) => g.spreadResult && g.spreadResult !== "PUSH")
    .map((g) => g.spreadResult === "COVERED");

  const ouStreak = recentGames
    .filter((g) => g.ouResult && g.ouResult !== "PUSH")
    .map((g) => g.ouResult === "OVER");

  return (
    <div className="stagger-in space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {interpretation && (
            <p className="text-sm text-muted-foreground">{interpretation}</p>
          )}
          <h2 className="text-xl font-bold">
            {query.team || query.perspective || query.sport} Trends
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{gameCount.toLocaleString()}</span> games
            {query.perspective ? ` (${query.perspective})` : ""}
            {meta.durationMs ? <> · <span className="font-mono">{meta.durationMs}ms</span></> : ""}
          </p>
        </div>
        {significance.topFinding &&
          !significance.topFinding.includes("No statistically") && (
            <SignificanceBadge
              strength={significance.ats.strength}
              label={significance.topFinding}
              size="md"
            />
          )}
      </div>

      {/* Top Finding */}
      {significance.topFinding &&
        !significance.topFinding.includes("No statistically") && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-sm font-medium text-primary">
              {significance.topFinding}
            </p>
          </div>
        )}

      {/* Key Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Record"
          value={`${summary.wins}-${summary.losses}`}
          subtext={`${summary.winPct}% win rate`}
          sentiment={getSentiment(summary.winPct)}
        />
        <StatCard
          label="ATS Record"
          value={summary.atsRecord}
          subtext={`${summary.atsPct}% cover rate`}
          sentiment={getSentiment(summary.atsPct)}
        />
        <StatCard
          label="O/U Record"
          value={summary.ouRecord}
          subtext={`${summary.overPct}% overs`}
          sentiment="neutral"
        />
        <StatCard
          label="Avg Margin"
          value={
            summary.avgMargin > 0
              ? `+${summary.avgMargin.toFixed(1)}`
              : summary.avgMargin.toFixed(1)
          }
          subtext={`${summary.avgPointsFor.toFixed(1)} PF / ${summary.avgPointsAgainst.toFixed(1)} PA`}
          sentiment={summary.avgMargin > 0 ? "positive" : summary.avgMargin < 0 ? "negative" : "neutral"}
        />
      </div>

      {/* ATS & O/U Streaks */}
      {(atsStreak.length > 0 || ouStreak.length > 0) && (
        <div className="flex flex-wrap gap-6 rounded-xl border border-border/60 bg-card px-4 py-3">
          {atsStreak.length > 0 && (
            <StreakDots dots={atsStreak} label="Last 10 ATS" />
          )}
          {ouStreak.length > 0 && (
            <StreakDots dots={ouStreak} label="Last 10 O/U" />
          )}
        </div>
      )}

      {/* Significance Details */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SignificanceDetail
          title="Win Rate"
          sig={significance.winRate}
        />
        <SignificanceDetail
          title="Against the Spread"
          sig={significance.ats}
        />
        <SignificanceDetail
          title="Over/Under"
          sig={significance.overUnder}
        />
      </div>

      {/* Season Breakdown Table */}
      {summary.bySeasonBreakdown.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="border-b border-border/40 bg-card px-4 py-2.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Season Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="px-4 py-2">Season</th>
                  <th className="px-4 py-2">Games</th>
                  <th className="px-4 py-2">W-L</th>
                  <th className="px-4 py-2">Win%</th>
                  <th className="px-4 py-2">ATS</th>
                  <th className="px-4 py-2">ATS%</th>
                </tr>
              </thead>
              <tbody>
                {summary.bySeasonBreakdown
                  .slice()
                  .sort((a, b) => b.season - a.season)
                  .map((s) => {
                    const winPct =
                      s.wins + s.losses > 0
                        ? Math.round(
                            (s.wins / (s.wins + s.losses)) * 100,
                          )
                        : 0;
                    const atsTotal = s.atsCovered + s.atsLost;
                    const atsPct =
                      atsTotal > 0
                        ? Math.round((s.atsCovered / atsTotal) * 100)
                        : 0;
                    // Check if this season is notable
                    const notable = significance.notableSeasons.find(
                      (ns) => ns.season === s.season,
                    );
                    return (
                      <tr
                        key={s.season}
                        className={`border-b border-border/40 ${
                          notable
                            ? "bg-primary/5"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <td className="px-4 py-2 font-medium">
                          {s.season}
                          {notable && (
                            <span className="ml-1.5">
                              <SignificanceBadge
                                strength={
                                  notable.ats.strength !== "noise"
                                    ? notable.ats.strength
                                    : notable.winRate.strength
                                }
                              />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums">
                          {s.games}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums">
                          {s.wins}-{s.losses}
                        </td>
                        <td
                          className={`px-4 py-2 font-mono tabular-nums ${
                            winPct >= 55
                              ? "text-emerald-400"
                              : winPct <= 45
                                ? "text-red-400"
                                : ""
                          }`}
                        >
                          {winPct}%
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums">
                          {s.atsCovered}-{s.atsLost}
                        </td>
                        <td
                          className={`px-4 py-2 font-mono tabular-nums ${
                            atsPct >= 55
                              ? "text-emerald-400"
                              : atsPct <= 45
                                ? "text-red-400"
                                : ""
                          }`}
                        >
                          {atsPct}%
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Games */}
      {games.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <div className="flex items-center justify-between border-b border-border/40 bg-card px-4 py-2.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Recent Games</h3>
            <span className="font-mono text-xs text-muted-foreground/70">
              Showing {Math.min(games.length, 20)} of{" "}
              {gameCount.toLocaleString()}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Matchup</th>
                  <th className="px-4 py-2">Score</th>
                  <th className="px-4 py-2">Spread</th>
                  <th className="px-4 py-2">ATS</th>
                  <th className="px-4 py-2">O/U</th>
                </tr>
              </thead>
              <tbody>
                {games
                  .slice(0, 20)
                  .map((g, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/40 hover:bg-muted/30"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-muted-foreground">
                        {g.gameDate}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-muted-foreground">
                          {g.awayTeam}
                        </span>
                        <span className="mx-1 text-muted-foreground/50">
                          @
                        </span>
                        <span className="font-medium">{g.homeTeam}</span>
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {g.awayScore}-{g.homeScore}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
                        {g.spread !== null
                          ? g.spread > 0
                            ? `+${g.spread}`
                            : g.spread
                          : "-"}
                      </td>
                      <td className="px-4 py-2">
                        {g.spreadResult === "COVERED" && (
                          <span className="text-emerald-400">W</span>
                        )}
                        {g.spreadResult === "LOST" && (
                          <span className="text-red-400">L</span>
                        )}
                        {g.spreadResult === "PUSH" && (
                          <span className="text-muted-foreground">P</span>
                        )}
                        {!g.spreadResult && (
                          <span className="text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {g.ouResult === "OVER" && (
                          <span className="text-blue-400">O</span>
                        )}
                        {g.ouResult === "UNDER" && (
                          <span className="text-amber-400">U</span>
                        )}
                        {g.ouResult === "PUSH" && (
                          <span className="text-muted-foreground">P</span>
                        )}
                        {!g.ouResult && (
                          <span className="text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function SignificanceDetail({
  title,
  sig,
}: {
  title: string;
  sig: TrendSignificance;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/25">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {title}
        </h4>
        <SignificanceBadge strength={sig.strength} />
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Observed</span>
          <span className="font-mono font-medium tabular-nums">
            {(sig.observedRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Baseline</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {(sig.baselineRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">p-value</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {sig.pValue < 0.001
              ? "<0.001"
              : sig.pValue.toFixed(3)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">95% CI</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            [{(sig.confidenceInterval[0] * 100).toFixed(1)}%,{" "}
            {(sig.confidenceInterval[1] * 100).toFixed(1)}%]
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Sample</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            n={sig.sampleSize}
          </span>
        </div>
      </div>
    </div>
  );
}
