"use client";

import { useDailyPicks, usePickRecord } from "@/hooks/use-daily-picks";
import { useSportSelection } from "@/hooks/use-sport-selection";
import { useLiveScores } from "@/hooks/use-live-scores";
import { TrackRecordBar } from "@/components/picks/track-record-bar";
import { GamePickCard } from "@/components/picks/game-pick-card";
import { PropPickCard } from "@/components/picks/prop-pick-card";

const SPORTS = ["NCAAMB", "NBA", "NFL", "NCAAF"] as const;

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function TodayPage() {
  const { sport, setSport } = useSportSelection();
  const date = todayET();

  const { data: picksData, isLoading, error: picksError } = useDailyPicks(sport, date);
  const { data: recordData } = usePickRecord(sport, 30);
  const { scoreMap } = useLiveScores(sport, date);

  const error = picksError ? (picksError as Error).message : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picks: any[] = picksData?.picks || [];

  // Separate picks into categories
  const spreadPicks = picks.filter((p) => p.pickType === "SPREAD");
  const ouPicks = picks.filter((p) => p.pickType === "OVER_UNDER");
  const propPicks = picks.filter((p) => p.pickType === "PLAYER_PROP");

  // Group game picks by matchup
  const gameGroups = new Map<string, { spread?: typeof picks[0]; ou?: typeof picks[0] }>();
  for (const p of spreadPicks) {
    const key = `${p.awayTeam}@${p.homeTeam}`;
    if (!gameGroups.has(key)) gameGroups.set(key, {});
    gameGroups.get(key)!.spread = p;
  }
  for (const p of ouPicks) {
    const key = `${p.awayTeam}@${p.homeTeam}`;
    if (!gameGroups.has(key)) gameGroups.set(key, {});
    gameGroups.get(key)!.ou = p;
  }

  // Top plays: picks with confidence >= 4
  const topPlays = picks
    .filter((p) => p.confidence >= 4 && p.pickType !== "PLAYER_PROP")
    .sort((a, b) => b.trendScore - a.trendScore);

  // Top play matchup keys
  const topPlayKeys = new Set(
    topPlays.map((p) => `${p.awayTeam}@${p.homeTeam}`),
  );

  // Remaining game groups (3-star), sorted: live first, then scheduled, then final
  const statusOrder = { in_progress: 0, scheduled: 1, final: 2 } as const;
  const remainingGroups = Array.from(gameGroups.entries())
    .filter(([key]) => !topPlayKeys.has(key))
    .sort(([keyA], [keyB]) => {
      const statusA = scoreMap.get(keyA)?.status ?? "scheduled";
      const statusB = scoreMap.get(keyB)?.status ?? "scheduled";
      return (statusOrder[statusA] ?? 1) - (statusOrder[statusB] ?? 1);
    });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Today&apos;s Sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(date)}</p>
        </div>
        <div className="flex rounded-lg border border-border/60 bg-card">
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`px-4 py-2 text-sm font-medium transition-all first:rounded-l-lg last:rounded-r-lg ${
                sport === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Track Record */}
      {recordData && (
        <div className="mb-8">
          <h2 className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Track Record (Last 30 Days)
          </h2>
          <TrackRecordBar
            overall={recordData.overall}
            byType={recordData.byType}
            byConfidence={recordData.byConfidence}
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <p className="text-sm text-muted-foreground">
            Analyzing today&apos;s games...
          </p>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* No games */}
      {!isLoading && !error && picks.length === 0 && (
        <div className="rounded-xl border border-border/40 bg-card px-6 py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No {sport} games scheduled for today
          </p>
          <p className="mt-2 text-sm text-muted-foreground/60">
            Check back on game day for picks and analysis
          </p>
        </div>
      )}

      {/* Top Plays */}
      {!isLoading && topPlays.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Top Plays
          </h2>
          <div className="stagger-in space-y-3">
            {Array.from(
              new Map(
                topPlays.map((p) => [`${p.awayTeam}@${p.homeTeam}`, p]),
              ).keys(),
            ).map((key) => {
              const group = gameGroups.get(key);
              return (
                <GamePickCard
                  key={key}
                  spreadPick={group?.spread}
                  ouPick={group?.ou}
                  liveScore={scoreMap.get(key)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Player Props */}
      {!isLoading && propPicks.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Player Props
          </h2>
          <div className="stagger-in grid gap-3 sm:grid-cols-2">
            {propPicks.map((p) => (
              <PropPickCard key={p.id} pick={p} />
            ))}
          </div>
        </div>
      )}

      {/* All Games (remaining 3-star) */}
      {!isLoading && remainingGroups.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            All Games
          </h2>
          <div className="space-y-3">
            {remainingGroups.map(([key, group]) => (
              <GamePickCard
                key={key}
                spreadPick={group.spread}
                ouPick={group.ou}
                liveScore={scoreMap.get(key)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
