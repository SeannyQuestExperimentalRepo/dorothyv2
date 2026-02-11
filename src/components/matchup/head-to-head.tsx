"use client";

interface HeadToHeadRecord {
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
}

interface HeadToHeadProps {
  h2h: HeadToHeadRecord;
  homeTeam: string;
  awayTeam: string;
}

export function HeadToHead({ h2h, homeTeam, awayTeam }: HeadToHeadProps) {
  if (h2h.totalGames === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Head-to-Head
        </h3>
        <p className="py-4 text-center text-sm text-muted-foreground">
          No head-to-head history found in the database.
        </p>
      </div>
    );
  }

  const homeWinPct =
    h2h.totalGames > 0
      ? Math.round((h2h.homeTeamWins / h2h.totalGames) * 100)
      : 0;
  const awayWinPct = 100 - homeWinPct;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Head-to-Head
      </h3>

      {/* Win bar */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">{homeTeam}</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {h2h.homeTeamWins}-{h2h.awayTeamWins} ({h2h.totalGames} games)
          </span>
          <span className="font-medium">{awayTeam}</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted/50">
          <div
            className="bg-emerald-500 transition-all duration-500"
            style={{ width: `${homeWinPct}%` }}
          />
          <div
            className="bg-blue-500 transition-all duration-500"
            style={{ width: `${awayWinPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span className="font-mono">{homeWinPct}%</span>
          <span className="font-mono">{awayWinPct}%</span>
        </div>
      </div>

      {/* H2H Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg bg-muted/30 p-3 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            H2H ATS
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
            {h2h.homeAtsRecord}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {homeTeam} side
          </p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Avg Total
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
            {h2h.avgTotalPoints.toFixed(1)}
          </p>
          <p className="text-[10px] text-muted-foreground">points/game</p>
        </div>
        <div className="rounded-lg bg-muted/30 p-3 text-center">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Over %
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold tabular-nums">
            {h2h.overPct}%
          </p>
          <p className="text-[10px] text-muted-foreground">of H2H games</p>
        </div>
      </div>

      {/* Last Meeting */}
      {h2h.lastMeeting && (
        <div className="mt-4 rounded-lg border border-border/40 bg-muted/20 p-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Last Meeting
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-sm">
              {h2h.lastMeeting.awayTeam} @ {h2h.lastMeeting.homeTeam}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {h2h.lastMeeting.awayScore}-{h2h.lastMeeting.homeScore}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {h2h.lastMeeting.date}
          </p>
        </div>
      )}
    </div>
  );
}
