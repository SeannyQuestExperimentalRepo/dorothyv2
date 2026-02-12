"use client";

import Link from "next/link";
import { useSignificantMoves } from "@/hooks/use-significant-moves";
import type { SignificantMove } from "@/lib/line-movement";

interface SignificantMovesCardProps {
  sport: string;
}

function MoveRow({ move, sport }: { move: SignificantMove; sport: string }) {
  const isMajor = move.severity === "major";
  const formattedDelta = move.type === "spread"
    ? `${move.delta > 0 ? "+" : ""}${move.delta.toFixed(1)}`
    : `${move.delta > 0 ? "+" : ""}${move.delta.toFixed(1)}`;

  return (
    <Link
      href={`/game/${sport.toLowerCase()}/${encodeURIComponent(move.homeTeam)}/${encodeURIComponent(move.awayTeam)}`}
      className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {move.awayTeam} @ {move.homeTeam}
        </p>
        <p className="text-xs text-muted-foreground">
          {move.type === "spread" ? "Spread" : "Total"}: {move.openingValue.toFixed(1)} &rarr; {move.currentValue.toFixed(1)}
        </p>
      </div>
      <div className="ml-3 text-right">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
            isMajor
              ? "bg-rose-500/15 text-rose-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
        >
          {formattedDelta} {move.type === "spread" ? "pts" : "pts"}
        </span>
      </div>
    </Link>
  );
}

export function SignificantMovesCard({ sport }: SignificantMovesCardProps) {
  const { data: moves, isLoading } = useSignificantMoves(sport);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Significant Line Moves
        </h3>
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-lg bg-muted/30" />
          <div className="h-12 animate-pulse rounded-lg bg-muted/30" />
        </div>
      </div>
    );
  }

  if (!moves || moves.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Significant Line Moves
        </h3>
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          {moves.length} move{moves.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {moves.slice(0, 8).map((move, i) => (
          <MoveRow key={`${move.homeTeam}-${move.type}-${i}`} move={move} sport={sport} />
        ))}
      </div>
    </div>
  );
}
