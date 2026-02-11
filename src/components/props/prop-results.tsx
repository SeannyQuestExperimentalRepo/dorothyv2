"use client";

import { SignificanceBadge } from "@/components/trends/significance-badge";

interface PropSplit {
  label: string;
  hits: number;
  total: number;
  hitRate: number;
  significance: {
    strength: "strong" | "moderate" | "weak" | "noise";
    label: string;
  };
}

interface PropGameLog {
  gameDate: string;
  opponent: string;
  isHome: boolean | null;
  statValue: number;
  hit: boolean;
  teamScore: number | null;
  opponentScore: number | null;
  gameResult: string | null;
  season: number;
  week: number;
}

interface PropResultData {
  playerName: string;
  query: {
    stat: string;
    line: number;
    direction: "over" | "under";
    homeAway?: string;
    favDog?: string;
    opponent?: string;
  };
  overall: {
    hits: number;
    total: number;
    hitRate: number;
    significance: {
      strength: "strong" | "moderate" | "weak" | "noise";
      label: string;
      confidenceInterval: [number, number];
    };
  };
  splits: PropSplit[];
  recentTrend: {
    last5: { hits: number; total: number; hitRate: number };
    last10: { hits: number; total: number; hitRate: number };
  };
  currentStreak: number;
  avgValue: number;
  medianValue: number;
  games: PropGameLog[];
  gameCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PropResults({ data }: { data: any }) {
  const result = data?.data as PropResultData | undefined;
  if (!result) return null;

  const { overall, splits, recentTrend, currentStreak, avgValue, medianValue, games } = result;

  const statLabel = result.query.stat.replace(/_/g, " ");
  const dirLabel = result.query.direction === "over" ? "Over" : "Under";

  return (
    <div className="stagger-in space-y-6">
      {/* Hero Card */}
      <div className="rounded-xl border border-border/60 bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{result.playerName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {dirLabel} <span className="font-mono">{result.query.line}</span> {statLabel}
            </p>
          </div>
          <SignificanceBadge strength={overall.significance.strength} size="md" />
        </div>

        {/* Hit Rate */}
        <div className="mt-6 flex items-baseline gap-3">
          <span className={`font-mono text-5xl font-bold tabular-nums ${
            overall.hitRate >= 55 ? "text-emerald-400" :
            overall.hitRate <= 45 ? "text-red-400" : "text-foreground"
          }`}>
            {overall.hitRate}%
          </span>
          <span className="text-lg text-muted-foreground">
            hit rate (<span className="font-mono">{overall.hits}/{overall.total}</span>)
          </span>
        </div>

        {/* Key stats row */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatBox label="Avg" value={avgValue.toFixed(1)} />
          <StatBox label="Median" value={medianValue.toFixed(1)} />
          <StatBox
            label="Streak"
            value={
              currentStreak > 0
                ? `${currentStreak} hit`
                : currentStreak < 0
                ? `${Math.abs(currentStreak)} miss`
                : "—"
            }
            color={currentStreak > 0 ? "text-emerald-400" : currentStreak < 0 ? "text-red-400" : undefined}
          />
          <StatBox label="95% CI" value={`${(overall.significance.confidenceInterval[0] * 100).toFixed(0)}%-${(overall.significance.confidenceInterval[1] * 100).toFixed(0)}%`} />
        </div>
      </div>

      {/* Recent Trend */}
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Recent Trend
        </h3>
        <div className="flex gap-6">
          <div>
            <span className="text-sm text-muted-foreground">Last 5: </span>
            <span className={`font-mono font-semibold tabular-nums ${recentTrend.last5.hitRate >= 55 ? "text-emerald-400" : recentTrend.last5.hitRate < 45 ? "text-red-400" : ""}`}>
              {recentTrend.last5.hits}/{recentTrend.last5.total} ({recentTrend.last5.hitRate}%)
            </span>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Last 10: </span>
            <span className={`font-mono font-semibold tabular-nums ${recentTrend.last10.hitRate >= 55 ? "text-emerald-400" : recentTrend.last10.hitRate < 45 ? "text-red-400" : ""}`}>
              {recentTrend.last10.hits}/{recentTrend.last10.total} ({recentTrend.last10.hitRate}%)
            </span>
          </div>
        </div>

        {/* Visual indicators for last 10 */}
        {games.length > 0 && (
          <div className="mt-3 flex gap-1">
            {games.slice(0, 10).map((g, i) => (
              <div
                key={i}
                className={`h-6 w-6 rounded-sm text-center text-xs font-medium leading-6 ${
                  g.hit
                    ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_6px_hsl(142_71%_45%/0.4)]"
                    : "bg-red-500/20 text-red-400 shadow-[0_0_6px_hsl(0_80%_58%/0.3)]"
                }`}
                title={`${g.gameDate}: ${g.statValue} vs ${g.opponent}`}
              >
                {g.hit ? "H" : "M"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Splits */}
      {splits.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Splits
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="pb-2 pr-4">Split</th>
                  <th className="pb-2 pr-4 text-right">Hits</th>
                  <th className="pb-2 pr-4 text-right">Total</th>
                  <th className="pb-2 pr-4 text-right">Hit Rate</th>
                  <th className="pb-2">Strength</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-4 font-medium">{split.label}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">{split.hits}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-muted-foreground">{split.total}</td>
                    <td className={`py-2 pr-4 text-right font-mono font-semibold tabular-nums ${
                      split.hitRate >= 55 ? "text-emerald-400" :
                      split.hitRate <= 45 ? "text-red-400" : ""
                    }`}>
                      {split.hitRate}%
                    </td>
                    <td className="py-2">
                      <SignificanceBadge strength={split.significance.strength} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Game Log */}
      {games.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Game Log (<span className="font-mono">{result.gameCount}</span> games)
          </h3>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Opp</th>
                  <th className="pb-2 pr-3 text-right">{statLabel}</th>
                  <th className="pb-2 pr-3 text-center">Result</th>
                  <th className="pb-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                    <td className="py-1.5 pr-3 font-mono tabular-nums text-muted-foreground">
                      {g.gameDate}
                    </td>
                    <td className="py-1.5 pr-3">
                      {g.isHome === false ? "@" : ""}{g.opponent}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-mono font-semibold tabular-nums ${
                      g.hit ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {g.statValue}
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span className={`inline-block h-5 w-5 rounded-sm text-xs font-medium leading-5 ${
                        g.hit
                          ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_6px_hsl(142_71%_45%/0.4)]"
                          : "bg-red-500/20 text-red-400 shadow-[0_0_6px_hsl(0_80%_58%/0.3)]"
                      }`}>
                        {g.hit ? "H" : "M"}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {g.teamScore != null && g.opponentScore != null
                        ? `${g.teamScore}-${g.opponentScore} ${g.gameResult || ""}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No data message */}
      {result.gameCount === 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No games found matching this query. Try adjusting the player name or stat.
          </p>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className={`mt-0.5 font-mono font-semibold tabular-nums ${color || ""}`}>{value}</div>
    </div>
  );
}
