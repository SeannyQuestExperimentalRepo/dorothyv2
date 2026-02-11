"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { usePropQuery } from "@/hooks/use-prop-query";

const PropResults = dynamic(
  () =>
    import("@/components/props/prop-results").then((mod) => mod.PropResults),
  { ssr: false },
);

const STAT_OPTIONS = [
  { value: "passing_yards", label: "Passing Yards" },
  { value: "passing_tds", label: "Passing TDs" },
  { value: "completions", label: "Completions" },
  { value: "attempts", label: "Pass Attempts" },
  { value: "passing_interceptions", label: "Interceptions" },
  { value: "rushing_yards", label: "Rushing Yards" },
  { value: "rushing_tds", label: "Rushing TDs" },
  { value: "carries", label: "Carries" },
  { value: "receiving_yards", label: "Receiving Yards" },
  { value: "receiving_tds", label: "Receiving TDs" },
  { value: "receptions", label: "Receptions" },
  { value: "targets", label: "Targets" },
  { value: "fantasy_points_ppr", label: "Fantasy Points (PPR)" },
  { value: "def_sacks", label: "Sacks" },
  { value: "def_tackles_solo", label: "Solo Tackles" },
  { value: "fg_made", label: "Field Goals Made" },
];

const EXAMPLE_QUERIES = [
  { label: "Mahomes Over 275.5 Pass Yds", player: "Patrick Mahomes", stat: "passing_yards", line: 275.5, direction: "over" as const },
  { label: "Kelce Over 4.5 Receptions", player: "Travis Kelce", stat: "receptions", line: 4.5, direction: "over" as const },
  { label: "Saquon Over 79.5 Rush Yds", player: "Saquon Barkley", stat: "rushing_yards", line: 79.5, direction: "over" as const },
  { label: "J. Jefferson Over 74.5 Rec Yds", player: "Justin Jefferson", stat: "receiving_yards", line: 74.5, direction: "over" as const },
  { label: "Josh Allen Under 1.5 INTs", player: "Josh Allen", stat: "passing_interceptions", line: 1.5, direction: "under" as const },
  { label: "Derrick Henry Over 0.5 Rush TDs", player: "Derrick Henry", stat: "rushing_tds", line: 0.5, direction: "over" as const },
];

export default function PropsPage() {
  const [player, setPlayer] = useState("");
  const [stat, setStat] = useState("passing_yards");
  const [line, setLine] = useState("");
  const [direction, setDirection] = useState<"over" | "under">("over");
  const [homeAway, setHomeAway] = useState<"" | "home" | "away">("");
  const [favDog, setFavDog] = useState<"" | "favorite" | "underdog">("");
  const [opponent, setOpponent] = useState("");
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");

  const [submitted, setSubmitted] = useState<{
    player: string;
    stat: string;
    line: number;
    direction: "over" | "under";
    homeAway?: "home" | "away";
    favDog?: "favorite" | "underdog";
    opponent?: string;
    seasonStart?: number;
    seasonEnd?: number;
  } | null>(null);

  const { data, isLoading: loading, error: queryError } = usePropQuery(submitted);
  const error = queryError ? (queryError as Error).message : null;

  const handleSearch = () => {
    const lineNum = parseFloat(line);
    if (!player.trim() || isNaN(lineNum)) return;

    setSubmitted({
      player: player.trim(),
      stat,
      line: lineNum,
      direction,
      homeAway: homeAway || undefined,
      favDog: favDog || undefined,
      opponent: opponent.trim() || undefined,
      seasonStart: seasonStart ? parseInt(seasonStart, 10) : undefined,
      seasonEnd: seasonEnd ? parseInt(seasonEnd, 10) : undefined,
    });
  };

  const handleExample = (ex: typeof EXAMPLE_QUERIES[0]) => {
    setPlayer(ex.player);
    setStat(ex.stat);
    setLine(ex.line.toString());
    setDirection(ex.direction);
    setHomeAway("");
    setFavDog("");
    setOpponent("");
    setSeasonStart("");
    setSeasonEnd("");
    setSubmitted({
      player: ex.player,
      stat: ex.stat,
      line: ex.line,
      direction: ex.direction,
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Prop Finder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Analyze player prop hit rates with historical data and situational splits
        </p>
      </div>

      {/* Search Form */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Player */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Player
            </label>
            <input
              type="text"
              placeholder="e.g. Patrick Mahomes"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>

          {/* Stat */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Stat
            </label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
              value={stat}
              onChange={(e) => setStat(e.target.value)}
            >
              {STAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Line */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Line
            </label>
            <input
              type="number"
              step="0.5"
              placeholder="e.g. 275.5"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>

          {/* Direction */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Direction
            </label>
            <div className="flex rounded-lg border border-border">
              <button
                onClick={() => setDirection("over")}
                className={`flex-1 rounded-l-lg px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "over"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                Over
              </button>
              <button
                onClick={() => setDirection("under")}
                className={`flex-1 rounded-r-lg px-3 py-2 text-sm font-medium transition-colors ${
                  direction === "under"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                Under
              </button>
            </div>
          </div>
        </div>

        {/* Optional Filters */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Home/Away
            </label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none"
              value={homeAway}
              onChange={(e) => setHomeAway(e.target.value as "" | "home" | "away")}
            >
              <option value="">All</option>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Fav/Dog
            </label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none"
              value={favDog}
              onChange={(e) => setFavDog(e.target.value as "" | "favorite" | "underdog")}
            >
              <option value="">All</option>
              <option value="favorite">Favorite</option>
              <option value="underdog">Underdog</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Opponent
            </label>
            <input
              type="text"
              placeholder="e.g. BUF"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Season From
            </label>
            <input
              type="number"
              placeholder="e.g. 2020"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              value={seasonStart}
              onChange={(e) => setSeasonStart(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Season To
            </label>
            <input
              type="number"
              placeholder="e.g. 2025"
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              value={seasonEnd}
              onChange={(e) => setSeasonEnd(e.target.value)}
            />
          </div>
        </div>

        {/* Search Button */}
        <div className="mt-4">
          <button
            onClick={handleSearch}
            disabled={loading || !player.trim() || !line}
            className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze Prop"}
          </button>
        </div>
      </div>

      {/* Example Queries */}
      {!submitted && (
        <div className="mb-8">
          <p className="mb-3 text-sm text-muted-foreground">Try an example:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExample(ex)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Analyzing prop history...
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && data && <PropResults data={data} />}
    </div>
  );
}
