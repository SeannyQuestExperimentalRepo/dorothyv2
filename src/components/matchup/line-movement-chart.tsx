"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { useOddsSnapshots, type OddsSnapshotPoint } from "@/hooks/use-odds-snapshots";

interface LineMovementChartProps {
  sport: string;
  homeTeam: string;
  awayTeam: string;
}

interface ChartPoint {
  time: string;
  timestamp: number;
  spread: number | null;
  total: number | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildChartData(snapshots: OddsSnapshotPoint[]): ChartPoint[] {
  return snapshots.map((s) => ({
    time: formatTime(s.fetchedAt),
    timestamp: new Date(s.fetchedAt).getTime(),
    spread: s.bestSpread,
    total: s.bestTotal,
  }));
}

function SpreadTooltip({ active, payload }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2 shadow-lg">
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs">
          <span className="text-muted-foreground">
            {p.dataKey === "spread" ? "Spread" : "Total"}:{" "}
          </span>
          <span className="font-mono font-semibold tabular-nums">
            {p.dataKey === "spread" && p.value > 0 ? "+" : ""}
            {p.value?.toFixed(1) ?? "—"}
          </span>
        </p>
      ))}
    </div>
  );
}

export function LineMovementChart({ sport, homeTeam, awayTeam }: LineMovementChartProps) {
  const { data: snapshots, isLoading, error } = useOddsSnapshots(sport, homeTeam, awayTeam);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Line Movement
        </h3>
        <div className="flex h-48 items-center justify-center">
          <div className="h-4 w-32 animate-pulse rounded bg-muted/50" />
        </div>
      </div>
    );
  }

  if (error || !snapshots || snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Line Movement
        </h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          {error ? "Failed to load line data" : "No line movement data available yet"}
        </p>
      </div>
    );
  }

  const chartData = buildChartData(snapshots);

  // Calculate opening vs current
  const opening = chartData[0];
  const current = chartData[chartData.length - 1];
  const spreadMoved = opening.spread != null && current.spread != null;
  const totalMoved = opening.total != null && current.total != null;
  const spreadDelta = spreadMoved ? current.spread! - opening.spread! : 0;
  const totalDelta = totalMoved ? current.total! - opening.total! : 0;

  // Domain padding for axes
  const spreads = chartData.map((d) => d.spread).filter((v): v is number => v != null);
  const totals = chartData.map((d) => d.total).filter((v): v is number => v != null);

  const spreadMin = spreads.length > 0 ? Math.min(...spreads) - 1 : -10;
  const spreadMax = spreads.length > 0 ? Math.max(...spreads) + 1 : 0;
  const totalMin = totals.length > 0 ? Math.min(...totals) - 2 : 130;
  const totalMax = totals.length > 0 ? Math.max(...totals) + 2 : 160;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Line Movement
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Opening vs Current summary */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {spreads.length > 0 && (
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Spread
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold tabular-nums">
                {current.spread! > 0 ? "+" : ""}{current.spread!.toFixed(1)}
              </span>
              {spreadMoved && spreadDelta !== 0 && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    spreadDelta < 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  ({spreadDelta > 0 ? "+" : ""}{spreadDelta.toFixed(1)})
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              opened {opening.spread! > 0 ? "+" : ""}{opening.spread!.toFixed(1)}
            </p>
          </div>
        )}
        {totals.length > 0 && (
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Total
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold tabular-nums">
                {current.total!.toFixed(1)}
              </span>
              {totalMoved && totalDelta !== 0 && (
                <span
                  className={`font-mono text-xs tabular-nums ${
                    totalDelta < 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  ({totalDelta > 0 ? "+" : ""}{totalDelta.toFixed(1)})
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              opened {opening.total!.toFixed(1)}
            </p>
          </div>
        )}
      </div>

      {/* Spread Chart */}
      {spreads.length >= 2 && (
        <div className="mb-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Spread
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[spreadMin, spreadMax]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v > 0 ? `+${v}` : String(v))}
                reversed
              />
              <Tooltip content={<SpreadTooltip />} />
              <ReferenceLine
                y={opening.spread!}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                opacity={0.4}
              />
              <Line
                type="stepAfter"
                dataKey="spread"
                stroke="#14b8a6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#14b8a6" }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Total Chart */}
      {totals.length >= 2 && (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Total (O/U)
          </p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[totalMin, totalMax]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<SpreadTooltip />} />
              <ReferenceLine
                y={opening.total!}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                opacity={0.4}
              />
              <Line
                type="stepAfter"
                dataKey="total"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Single snapshot: just show the values, no chart */}
      {snapshots.length === 1 && (
        <p className="text-center text-xs text-muted-foreground">
          Only 1 snapshot captured — chart will appear with more data points
        </p>
      )}
    </div>
  );
}
