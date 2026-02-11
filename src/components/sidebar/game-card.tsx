"use client";

import Link from "next/link";

interface GameCardProps {
  homeTeam: string;
  awayTeam: string;
  gameDate: string; // ISO string
  spread: number | null;
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
  sport: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSpread(spread: number | null): string {
  if (spread == null) return "\u2014";
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

function formatML(ml: number | null): string {
  if (ml == null) return "\u2014";
  if (ml > 0) return `+${ml}`;
  return `${ml}`;
}

function teamSlug(name: string): string {
  return encodeURIComponent(name);
}

export default function GameCard({
  homeTeam,
  awayTeam,
  gameDate,
  spread,
  overUnder,
  moneylineHome,
  moneylineAway,
  sport,
}: GameCardProps) {
  const gameUrl = `/game/${sport.toLowerCase()}/${teamSlug(homeTeam)}/${teamSlug(awayTeam)}`;

  return (
    <Link
      href={gameUrl}
      className="group block rounded-lg border border-border/50 bg-card p-3 transition-all hover:border-primary/25 hover:shadow-sm hover:shadow-primary/5"
    >
      {/* Time */}
      <div className="mb-2 text-[11px] font-mono text-muted-foreground">
        {formatTime(gameDate)}
      </div>

      {/* Teams + Spread */}
      <div className="space-y-1.5">
        {/* Away team */}
        <div className="flex items-center justify-between">
          <span className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
            {awayTeam}
          </span>
          <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
            {spread != null ? formatSpread(-spread) : ""}
          </span>
        </div>

        {/* Home team */}
        <div className="flex items-center justify-between">
          <span className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
            {homeTeam}
          </span>
          <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
            {spread != null ? formatSpread(spread) : ""}
          </span>
        </div>
      </div>

      {/* O/U and Moneylines */}
      <div className="mt-2.5 flex items-center gap-3 border-t border-border/40 pt-2">
        {overUnder != null && (
          <span className="font-mono text-[11px] text-muted-foreground/70">
            O/U {overUnder}
          </span>
        )}
        {moneylineHome != null && moneylineAway != null && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
            ML {formatML(moneylineAway)} / {formatML(moneylineHome)}
          </span>
        )}
      </div>
    </Link>
  );
}
