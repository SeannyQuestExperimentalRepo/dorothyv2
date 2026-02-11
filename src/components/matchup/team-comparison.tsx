"use client";

interface SeasonStats {
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
}

interface TeamComparisonProps {
  homeTeam: string;
  awayTeam: string;
  homeStats: SeasonStats;
  awayStats: SeasonStats;
}

function CompareRow({
  label,
  homeValue,
  awayValue,
  homeHighlight,
  awayHighlight,
}: {
  label: string;
  homeValue: string | number;
  awayValue: string | number;
  homeHighlight?: boolean;
  awayHighlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex-1 text-right">
        <span
          className={`font-mono tabular-nums ${
            homeHighlight
              ? "font-semibold text-emerald-400"
              : awayHighlight
                ? "text-muted-foreground"
                : ""
          }`}
        >
          {homeValue}
        </span>
      </div>
      <div className="w-28 text-center">
        <span className="text-xs uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
      </div>
      <div className="flex-1 text-left">
        <span
          className={`font-mono tabular-nums ${
            awayHighlight
              ? "font-semibold text-emerald-400"
              : homeHighlight
                ? "text-muted-foreground"
                : ""
          }`}
        >
          {awayValue}
        </span>
      </div>
    </div>
  );
}

export function TeamComparison({
  homeTeam,
  awayTeam,
  homeStats,
  awayStats,
}: TeamComparisonProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Season Comparison
      </h3>

      {/* Team Headers */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex-1 text-right">
          <span className="text-sm font-bold">{homeTeam}</span>
        </div>
        <div className="w-28" />
        <div className="flex-1 text-left">
          <span className="text-sm font-bold">{awayTeam}</span>
        </div>
      </div>

      <div className="divide-y divide-border/30">
        <CompareRow
          label="Record"
          homeValue={homeStats.record}
          awayValue={awayStats.record}
          homeHighlight={homeStats.winPct > awayStats.winPct}
          awayHighlight={awayStats.winPct > homeStats.winPct}
        />
        <CompareRow
          label="ATS"
          homeValue={`${homeStats.atsRecord} (${homeStats.atsPct}%)`}
          awayValue={`${awayStats.atsRecord} (${awayStats.atsPct}%)`}
          homeHighlight={homeStats.atsPct > awayStats.atsPct}
          awayHighlight={awayStats.atsPct > homeStats.atsPct}
        />
        <CompareRow
          label="O/U"
          homeValue={`${homeStats.ouRecord} (${homeStats.overPct}%)`}
          awayValue={`${awayStats.ouRecord} (${awayStats.overPct}%)`}
        />
        <CompareRow
          label="Pts For"
          homeValue={homeStats.avgPointsFor.toFixed(1)}
          awayValue={awayStats.avgPointsFor.toFixed(1)}
          homeHighlight={homeStats.avgPointsFor > awayStats.avgPointsFor}
          awayHighlight={awayStats.avgPointsFor > homeStats.avgPointsFor}
        />
        <CompareRow
          label="Pts Against"
          homeValue={homeStats.avgPointsAgainst.toFixed(1)}
          awayValue={awayStats.avgPointsAgainst.toFixed(1)}
          homeHighlight={homeStats.avgPointsAgainst < awayStats.avgPointsAgainst}
          awayHighlight={awayStats.avgPointsAgainst < homeStats.avgPointsAgainst}
        />
        <CompareRow
          label="Avg Margin"
          homeValue={homeStats.avgMargin > 0 ? `+${homeStats.avgMargin.toFixed(1)}` : homeStats.avgMargin.toFixed(1)}
          awayValue={awayStats.avgMargin > 0 ? `+${awayStats.avgMargin.toFixed(1)}` : awayStats.avgMargin.toFixed(1)}
          homeHighlight={homeStats.avgMargin > awayStats.avgMargin}
          awayHighlight={awayStats.avgMargin > homeStats.avgMargin}
        />
        <CompareRow
          label="Home/Away"
          homeValue={`${homeStats.homeRecord} at home`}
          awayValue={`${awayStats.awayRecord} on road`}
        />
      </div>
    </div>
  );
}
