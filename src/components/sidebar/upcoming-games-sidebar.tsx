"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import GameCard from "./game-card";
import { useUpcomingGames } from "@/hooks/use-upcoming-games";

interface UpcomingGame {
  id: number;
  sport: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  homeRank: number | null;
  awayRank: number | null;
  spread: number | null;
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
}

type SportFilter = "NFL" | "NCAAF" | "NCAAMB" | null;

/** Map URL path to sport filter */
function sportFromPath(pathname: string): SportFilter {
  if (pathname.startsWith("/nfl")) return "NFL";
  if (pathname.startsWith("/ncaaf") && !pathname.startsWith("/ncaamb")) return "NCAAF";
  if (pathname.startsWith("/ncaamb")) return "NCAAMB";
  return null; // show all sports
}

export default function UpcomingGamesSidebar() {
  const pathname = usePathname();
  const detectedSport = sportFromPath(pathname);

  const [activeSport, setActiveSport] = useState<SportFilter>(detectedSport);
  const [refreshing, setRefreshing] = useState(false);

  // Sync active sport with path changes
  useEffect(() => {
    setActiveSport(sportFromPath(pathname));
  }, [pathname]);

  const { data, isLoading: loading, error: queryError, refetch } = useUpcomingGames(activeSport);
  const games: UpcomingGame[] = data?.games ?? [];
  const lastUpdated = data?.lastUpdated ?? null;
  const error = queryError ? (queryError as Error).message : null;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Refresh all sports or just the active one
      const sports = activeSport ? [activeSport] : ["NFL", "NCAAF", "NCAAMB"];
      await Promise.all(
        sports.map((s) =>
          fetch(`/api/games/refresh?sport=${s}`, { method: "POST" }),
        ),
      );
      await refetch();
    } catch {
      // Error handled by query
    } finally {
      setRefreshing(false);
    }
  };

  const timeAgo = lastUpdated
    ? formatTimeAgo(new Date(lastUpdated))
    : null;

  // Group games by sport for display when showing all
  const showSportLabel = !activeSport;

  return (
    <div className="w-72 shrink-0">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border/40">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Upcoming
          </h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title="Refresh odds from ESPN"
          >
            {refreshing ? (
              <span className="inline-flex items-center gap-1.5">
                <RefreshSpinner />
                <span className="font-mono">Updating...</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Refresh
              </span>
            )}
          </button>
        </div>

        {/* Sport filter tabs (shown when not on a sport-specific page) */}
        {!detectedSport && (
          <div className="mb-3 flex gap-1 rounded-lg bg-muted/30 p-1">
            {(["ALL", "NFL", "NCAAF", "NCAAMB"] as const).map((tab) => {
              const isActive =
                (tab === "ALL" && activeSport === null) ||
                tab === activeSport;
              return (
                <button
                  key={tab}
                  onClick={() =>
                    setActiveSport(tab === "ALL" ? null : tab as SportFilter)
                  }
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "ALL" ? "All" : tab}
                </button>
              );
            })}
          </div>
        )}

        {/* Last updated */}
        {timeAgo && (
          <p className="mb-3 font-mono text-[11px] text-muted-foreground/70">
            Updated {timeAgo}
          </p>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-border/50 bg-card/50"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-border/60 bg-card p-4 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Try refreshing
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No upcoming games with odds
            </p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
            >
              Refresh from ESPN
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {games.map((game, i) => (
              <div key={game.id}>
                {/* Sport separator label when showing multiple sports */}
                {showSportLabel &&
                  (i === 0 || game.sport !== games[i - 1].sport) && (
                    <div className="mb-1.5 mt-4 first:mt-0">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                        {game.sport}
                      </span>
                    </div>
                  )}
                <GameCard
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  homeRank={game.homeRank}
                  awayRank={game.awayRank}
                  gameDate={game.gameDate}
                  spread={game.spread}
                  overUnder={game.overUnder}
                  moneylineHome={game.moneylineHome}
                  moneylineAway={game.moneylineAway}
                  sport={game.sport}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function RefreshSpinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
