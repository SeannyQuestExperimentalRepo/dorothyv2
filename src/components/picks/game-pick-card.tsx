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

interface Pick {
  id: number;
  pickType: string;
  homeTeam: string;
  awayTeam: string;
  gameDate: string;
  pickSide: string;
  line: number | null;
  pickLabel: string;
  trendScore: number;
  confidence: number;
  headline: string;
  reasoning: ReasoningEntry[];
  result: string;
}

interface GamePickCardProps {
  spreadPick?: Pick;
  ouPick?: Pick;
}

function PickBox({ pick }: { pick: Pick }) {
  const [expanded, setExpanded] = useState(false);

  const resultBadge =
    pick.result === "WIN"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : pick.result === "LOSS"
        ? "bg-red-500/15 text-red-400 border-red-500/30"
        : pick.result === "PUSH"
          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
          : "";

  return (
    <div className="flex-1 rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{pick.pickLabel}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{pick.headline}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ConfidenceStars confidence={pick.confidence} />
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            Score: {pick.trendScore}
          </span>
        </div>
      </div>

      {pick.result !== "PENDING" && (
        <div className="mt-2">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${resultBadge}`}>
            {pick.result}
          </span>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {expanded ? "Hide reasoning ▴" : "Show reasoning ▾"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
          {pick.reasoning.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs"
            >
              <SignificanceBadge strength={r.strength} size="sm" />
              <span className="text-muted-foreground">{r.angle}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GamePickCard({ spreadPick, ouPick }: GamePickCardProps) {
  const pick = spreadPick || ouPick;
  if (!pick) return null;

  const gameTime = new Date(pick.gameDate).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/25">
      {/* Header */}
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-sm font-medium">
          {pick.awayTeam} <span className="text-muted-foreground">@</span> {pick.homeTeam}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
          {spreadPick?.line != null && (
            <span className="font-mono">Spread: {spreadPick.line > 0 ? "+" : ""}{spreadPick.line}</span>
          )}
          {ouPick?.line != null && <span className="font-mono">O/U: {ouPick.line}</span>}
          <span>{gameTime} ET</span>
        </div>
      </div>

      {/* Pick boxes */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {spreadPick && <PickBox pick={spreadPick} />}
        {ouPick && <PickBox pick={ouPick} />}
      </div>
    </div>
  );
}
