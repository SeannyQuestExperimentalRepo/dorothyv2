"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useTrendQuery } from "@/hooks/use-trend-query";

const TrendResults = dynamic(
  () =>
    import("@/components/trends/trend-results").then(
      (mod) => mod.TrendResults,
    ),
  { ssr: false },
);

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
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const hasRunInitial = useRef(false);

  const { data, isLoading: loading, error: queryError } = useTrendQuery(
    submittedQuery ? { query: submittedQuery } : null,
  );

  const result = data?.result ?? null;
  const interpretation = data?.interpretation ?? null;
  const error = queryError ? (queryError as Error).message : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-search if ?q= param is present
  useEffect(() => {
    if (initialQuery && !hasRunInitial.current) {
      hasRunInitial.current = true;
      setQuery(initialQuery);
      setSubmittedQuery(initialQuery);
    }
  }, [initialQuery]);

  const handleSearch = (searchQuery?: string) => {
    const q = (searchQuery || query).trim();
    if (!q) return;
    setSubmittedQuery(q);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Search Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Search Trends</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask a question in plain English about historical betting trends
        </p>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card shadow-lg transition-all focus-within:border-primary/40 focus-within:shadow-[0_0_20px_hsl(168_80%_45%/0.1)]">
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
            className="flex-1 bg-transparent px-2 py-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            disabled={loading}
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className="mr-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40"
          >
            {loading ? (
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
      {!result && !loading && !error && (
        <div className="mt-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
            Try these examples
          </p>
          <div className="stagger-in flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((eq) => (
              <button
                key={eq}
                onClick={() => {
                  setQuery(eq);
                  handleSearch(eq);
                }}
                className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
              >
                {eq}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mt-16 flex flex-col items-center gap-4">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Analyzing trends across thousands of games...
          </p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="mt-8 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="mt-8">
          <TrendResults
            data={result.data}
            meta={result.meta}
            interpretation={interpretation || undefined}
          />
        </div>
      )}
    </div>
  );
}
