"use client";

import { useState } from "react";
import { ConfidenceStars } from "./confidence-stars";
import { SignificanceBadge } from "@/components/trends/significance-badge";

interface ReasoningEntry {
  angle: string;
  weight: number;
  strength: "strong" | "moderate" | "weak" | "noise";
  record?: string;
}

interface PropPick {
  id: number;
  homeTeam: string;
  awayTeam: string;
  gameDate: string;
  pickLabel: string;
  playerName: string | null;
  propStat: string | null;
  propLine: number | null;
  trendScore: number;
  confidence: number;
  headline: string;
  reasoning: ReasoningEntry[];
  result: string;
  actualValue: number | null;
}

interface PropPickCardProps {
  pick: PropPick;
}

export function PropPickCard({ pick }: PropPickCardProps) {
  const [expanded, setExpanded] = useState(false);

  const resultBadge =
    pick.result === "WIN"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : pick.result === "LOSS"
        ? "bg-red-500/15 text-red-400 border-red-500/30"
        : "";

  // Extract hit rate from headline (e.g. "67% hit rate...")
  const hitRateMatch = pick.headline.match(/(\d+)%/);
  const hitRate = hitRateMatch ? parseInt(hitRateMatch[1]) : null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{pick.pickLabel}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {pick.awayTeam} @ {pick.homeTeam}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ConfidenceStars confidence={pick.confidence} />
          {hitRate !== null && (
            <span
              className={`font-mono text-2xl font-bold tabular-nums ${
                hitRate >= 55
                  ? "text-emerald-400"
                  : hitRate < 45
                    ? "text-red-400"
                    : "text-foreground"
              }`}
            >
              {hitRate}%
            </span>
          )}
        </div>
      </div>

      <div className="mt-1 text-xs text-muted-foreground">{pick.headline}</div>

      {pick.result !== "PENDING" && (
        <div className="mt-2 flex items-center gap-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${resultBadge}`}>
            {pick.result}
          </span>
          {pick.actualValue !== null && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Actual: {pick.actualValue}
            </span>
          )}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {expanded ? "Hide details ▴" : "Show details ▾"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
          {pick.reasoning.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <SignificanceBadge strength={r.strength} size="sm" />
              <span className="text-muted-foreground">{r.angle}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
