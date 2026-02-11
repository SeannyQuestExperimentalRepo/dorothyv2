"use client";

interface MatchupHeaderProps {
  sport: string;
  homeTeam: string;
  awayTeam: string;
  gameDate: string | null;
  spread: number | null;
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
}

function formatGameDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}

function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

function formatML(ml: number | null): string {
  if (ml == null) return "-";
  if (ml > 0) return `+${ml}`;
  return `${ml}`;
}

export function MatchupHeader({
  sport,
  homeTeam,
  awayTeam,
  gameDate,
  spread,
  overUnder,
  moneylineHome,
  moneylineAway,
}: MatchupHeaderProps) {
  const favored = spread !== null ? (spread < 0 ? homeTeam : spread > 0 ? awayTeam : null) : null;
  const spreadAbs = spread !== null ? Math.abs(spread) : null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-6">
      {/* Sport + Date */}
      <div className="mb-4 flex items-center gap-3">
        <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
          {sport}
        </span>
        {gameDate && (
          <span className="font-mono text-sm text-muted-foreground">
            {formatGameDate(gameDate)}
          </span>
        )}
      </div>

      {/* Teams */}
      <div className="flex items-center justify-center gap-4 sm:gap-8">
        {/* Away Team */}
        <div className="flex-1 text-center">
          <p className="text-xl font-bold sm:text-2xl">{awayTeam}</p>
          <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
            Away
          </p>
        </div>

        {/* VS / Spread */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold text-muted-foreground/40">@</span>
          {favored && spreadAbs !== null && (
            <div className="rounded-md bg-primary/10 px-3 py-1 text-center">
              <p className="text-xs text-muted-foreground">Spread</p>
              <p className="text-sm font-bold text-primary">
                {favored === homeTeam ? homeTeam : awayTeam} -{spreadAbs}
              </p>
            </div>
          )}
        </div>

        {/* Home Team */}
        <div className="flex-1 text-center">
          <p className="text-xl font-bold sm:text-2xl">{homeTeam}</p>
          <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
            Home
          </p>
        </div>
      </div>

      {/* Odds Row */}
      {(spread !== null || overUnder !== null || moneylineHome !== null) && (
        <div className="mt-5 flex items-center justify-center gap-6 border-t border-border/40 pt-4">
          {spread !== null && (
            <div className="text-center">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Spread
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {formatSpread(spread)}
              </p>
            </div>
          )}
          {overUnder !== null && (
            <div className="text-center">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                O/U
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                {overUnder}
              </p>
            </div>
          )}
          {moneylineHome !== null && moneylineAway !== null && (
            <>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  ML Away
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                  {formatML(moneylineAway)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  ML Home
                </p>
                <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                  {formatML(moneylineHome)}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
