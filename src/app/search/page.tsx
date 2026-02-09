"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TrendResults } from "@/components/trends/trend-results";

const EXAMPLE_QUERIES = [
  "Home underdogs in primetime NFL",
  "Kansas City Chiefs as favorites",
  "Away teams in cold weather NFL",
  "NFL teams after a bye week",
  "Home dogs getting 7+ points NFL",
  "Ranked vs unranked NCAAF",
  "Big 12 conference games NCAAF",
  "NFL playoffs underdogs",
];

type QueryType = "game" | "player";

interface SearchState {
  loading: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any | null;
  error: string | null;
  interpretation: string | null;
  queryType: QueryType | null;
  durationMs: number | null;
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({
    loading: false,
    result: null,
    error: null,
    interpretation: null,
    queryType: null,
    durationMs: null,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const hasRunInitial = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-search if ?q= param is present
  useEffect(() => {
    if (initialQuery && !hasRunInitial.current) {
      hasRunInitial.current = true;
      setQuery(initialQuery);
      handleSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const handleSearch = useCallback(
    async (searchQuery?: string) => {
      const q = (searchQuery || query).trim();
      if (!q) return;

      setState({
        loading: true,
        result: null,
        error: null,
        interpretation: null,
        queryType: null,
        durationMs: null,
      });

      const start = performance.now();

      try {
        // Step 1: Parse the query with NLP
        const parseRes = await fetch("/api/trends/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });

        if (parseRes.ok) {
          const parsed = await parseRes.json();
          if (parsed.success && parsed.data) {
            const { trendQuery, interpretation, queryType } = parsed.data;

            // Step 2: Execute the parsed query
            const endpoint =
              queryType === "player" ? "/api/trends/players" : "/api/trends";
            const execRes = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(trendQuery),
            });

            const execData = await execRes.json();
            const durationMs = Math.round(performance.now() - start);

            if (execData.success) {
              setState({
                loading: false,
                result: execData,
                error: null,
                interpretation,
                queryType,
                durationMs,
              });
              return;
            } else {
              setState({
                loading: false,
                result: null,
                error: execData.error || "Query returned no results",
                interpretation,
                queryType,
                durationMs,
              });
              return;
            }
          }
        }

        // Fallback: direct API call with basic params
        const directRes = await fetch(
          `/api/trends?sport=NFL&team=${encodeURIComponent(q)}`,
        );
        const directData = await directRes.json();
        const durationMs = Math.round(performance.now() - start);

        if (directData.success) {
          setState({
            loading: false,
            result: directData,
            error: null,
            interpretation: `Showing trends for "${q}"`,
            queryType: "game",
            durationMs,
          });
        } else {
          setState({
            loading: false,
            result: null,
            error:
              directData.error || "Could not interpret your query. Try something like: 'Home underdogs NFL'",
            interpretation: null,
            queryType: null,
            durationMs,
          });
        }
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        setState({
          loading: false,
          result: null,
          error:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred",
          interpretation: null,
          queryType: null,
          durationMs,
        });
      }
    },
    [query],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Search Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Search Trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a question in plain English about historical betting trends
        </p>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card shadow-lg focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30">
          <svg
            className="ml-4 h-5 w-5 shrink-0 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. Home underdogs in primetime NFL..."
            className="flex-1 bg-transparent px-2 py-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            disabled={state.loading}
          />
          <button
            onClick={() => handleSearch()}
            disabled={state.loading || !query.trim()}
            className="mr-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {state.loading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    d="M4 12a8 8 0 018-8"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="opacity-75"
                  />
                </svg>
                Searching...
              </span>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>

      {/* Example Queries */}
      {!state.result && !state.loading && !state.error && (
        <div className="mt-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Try these examples
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((eq) => (
              <button
                key={eq}
                onClick={() => {
                  setQuery(eq);
                  handleSearch(eq);
                }}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {eq}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {state.loading && (
        <div className="mt-12 flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Analyzing trends across thousands of games...
          </p>
        </div>
      )}

      {/* Error State */}
      {state.error && !state.loading && (
        <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{state.error}</p>
          {state.interpretation && (
            <p className="mt-1 text-xs text-muted-foreground">
              Interpreted as: {state.interpretation}
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {state.result && !state.loading && (
        <div className="mt-8">
          <TrendResults
            data={state.result.data}
            meta={state.result.meta}
            interpretation={state.interpretation || undefined}
          />
        </div>
      )}
    </div>
  );
}
