"use client";

import { useState } from "react";
import { useOdds, type GameOdds, type BookOdds } from "@/hooks/use-odds";

function formatOdds(odds: number | null): string {
  if (odds === null) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatSpread(spread: number | null): string {
  if (spread === null) return "—";
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function OddsRow({ book, highlight }: { book: BookOdds; highlight?: { spread?: boolean; total?: boolean } }) {
  return (
    <tr className="border-b border-border/30 text-xs">
      <td className="py-1.5 pr-3 font-medium">{book.bookTitle}</td>
      <td className={`py-1.5 px-2 font-mono tabular-nums text-center ${highlight?.spread ? "text-emerald-400 font-semibold" : ""}`}>
        {formatSpread(book.spread)} <span className="text-muted-foreground/60">({formatOdds(book.spreadOdds)})</span>
      </td>
      <td className={`py-1.5 px-2 font-mono tabular-nums text-center ${highlight?.total ? "text-emerald-400 font-semibold" : ""}`}>
        {book.total ?? "—"} <span className="text-muted-foreground/60">o{formatOdds(book.totalOverOdds)} u{formatOdds(book.totalUnderOdds)}</span>
      </td>
      <td className="py-1.5 px-2 font-mono tabular-nums text-center">
        {formatOdds(book.homeML)} / {formatOdds(book.awayML)}
      </td>
    </tr>
  );
}

function GameOddsCard({ game }: { game: GameOdds }) {
  const [expanded, setExpanded] = useState(false);
  const topBooks = expanded ? game.books : game.books.slice(0, 4);

  const gameTime = new Date(game.commenceTime).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">
          {game.awayTeam} <span className="text-muted-foreground">@</span> {game.homeTeam}
        </div>
        <span className="text-xs text-muted-foreground/70">{gameTime} ET</span>
      </div>

      {/* Summary line */}
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        {game.bestSpread && (
          <span>
            Best spread: <span className="font-mono text-foreground">{formatSpread(game.bestSpread.value)}</span>{" "}
            <span className="text-muted-foreground/60">({game.bestSpread.book})</span>
          </span>
        )}
        {game.bestTotal && (
          <span>
            Total: <span className="font-mono text-foreground">{game.bestTotal.value}</span>
          </span>
        )}
      </div>

      {/* Book-by-book comparison table */}
      <table className="mt-3 w-full text-left">
        <thead>
          <tr className="border-b border-border/50 text-[11px] uppercase tracking-wider text-muted-foreground/60">
            <th className="pb-1 pr-3 font-medium">Book</th>
            <th className="pb-1 px-2 text-center font-medium">Spread</th>
            <th className="pb-1 px-2 text-center font-medium">Total</th>
            <th className="pb-1 px-2 text-center font-medium">Moneyline</th>
          </tr>
        </thead>
        <tbody>
          {topBooks.map((b) => (
            <OddsRow
              key={b.book}
              book={b}
              highlight={{
                spread: game.bestSpread?.book === b.bookTitle,
              }}
            />
          ))}
        </tbody>
      </table>

      {game.books.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          {expanded ? `Show fewer ▴` : `+${game.books.length - 4} more books ▾`}
        </button>
      )}
    </div>
  );
}

export function OddsComparison({ sport }: { sport: string }) {
  const { data: games, isLoading, error } = useOdds(sport);

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <span className="text-sm text-muted-foreground">Loading odds...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">No odds available for {sport}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {games.map((g) => (
        <GameOddsCard key={g.gameId} game={g} />
      ))}
    </div>
  );
}
