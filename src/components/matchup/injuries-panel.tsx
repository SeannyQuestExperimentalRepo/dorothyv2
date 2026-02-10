"use client";

import type { Injury, InjuryStatus } from "@/lib/espn-injuries";

interface InjuriesPanelProps {
  homeTeam: string;
  awayTeam: string;
  homeInjuries: Injury[];
  awayInjuries: Injury[];
  lastUpdated: string;
  isLoading?: boolean;
}

const STATUS_COLORS: Record<InjuryStatus, string> = {
  Out: "bg-red-500/20 text-red-400",
  "Injured Reserve": "bg-red-500/20 text-red-400",
  Doubtful: "bg-orange-500/20 text-orange-400",
  Questionable: "bg-yellow-500/20 text-yellow-400",
  Probable: "bg-emerald-500/20 text-emerald-400",
  "Day-To-Day": "bg-emerald-500/20 text-emerald-400",
};

function InjuryRow({ injury }: { injury: Injury }) {
  return (
    <div className="group flex items-start gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{injury.playerName}</span>
          {injury.position && (
            <span className="text-xs text-muted-foreground">
              {injury.position}
            </span>
          )}
        </div>
        {injury.shortComment && (
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            {injury.shortComment}
          </p>
        )}
      </div>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[injury.status] ?? "bg-secondary text-muted-foreground"}`}
      >
        {injury.status}
      </span>
    </div>
  );
}

function TeamInjuryList({
  team,
  injuries,
}: {
  team: string;
  injuries: Injury[];
}) {
  return (
    <div className="min-w-0 flex-1">
      <h4 className="mb-2 text-sm font-bold">{team}</h4>
      {injuries.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground/60">
          No reported injuries
        </p>
      ) : (
        <div className="divide-y divide-border/20">
          {injuries.map((injury) => (
            <InjuryRow
              key={`${injury.playerName}-${injury.status}`}
              injury={injury}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function InjuriesPanel({
  homeTeam,
  awayTeam,
  homeInjuries,
  awayInjuries,
  lastUpdated,
  isLoading,
}: InjuriesPanelProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/40 bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-4 w-28 animate-pulse rounded bg-secondary/50" />
          <div className="h-3 w-24 animate-pulse rounded bg-secondary/30" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded bg-secondary/40" />
            <div className="h-3 w-full animate-pulse rounded bg-secondary/30" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-secondary/30" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-secondary/30" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-32 animate-pulse rounded bg-secondary/40" />
            <div className="h-3 w-full animate-pulse rounded bg-secondary/30" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-secondary/30" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-secondary/30" />
          </div>
        </div>
      </div>
    );
  }

  // Don't render at all if both teams have no injuries
  if (homeInjuries.length === 0 && awayInjuries.length === 0) {
    return null;
  }

  const updatedDate = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Injury Report
        </h3>
        {updatedDate && (
          <span className="text-xs text-muted-foreground/50">
            Updated {updatedDate}
          </span>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TeamInjuryList team={homeTeam} injuries={homeInjuries} />
        <TeamInjuryList team={awayTeam} injuries={awayInjuries} />
      </div>
    </div>
  );
}
