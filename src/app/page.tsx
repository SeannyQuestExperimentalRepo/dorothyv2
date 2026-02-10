"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStats } from "@/hooks/use-stats";

const EXAMPLE_QUERIES = [
  { label: "Home underdogs primetime NFL", icon: "\ud83c\udfc8" },
  { label: "Chiefs as favorites since 2020", icon: "\ud83d\udcc8" },
  { label: "Away teams after bye week NFL", icon: "\u23f0" },
  { label: "Ranked vs unranked NCAAF", icon: "\ud83c\udfc6" },
];

const FEATURES = [
  {
    title: "Natural Language Search",
    desc: "Just type what you want to know \u2014 our engine parses plain English into structured trend queries.",
    icon: (
      <svg
        className="h-6 w-6 text-primary"
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
    ),
  },
  {
    title: "Statistical Significance",
    desc: "Every trend includes p-values, confidence intervals, and strength ratings. Know when a trend is real vs noise.",
    icon: (
      <svg
        className="h-6 w-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
        />
      </svg>
    ),
  },
  {
    title: "Auto-Discover Angles",
    desc: "Our reverse lookup engine scans 45+ templates to find the most profitable angles automatically.",
    icon: (
      <svg
        className="h-6 w-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
        />
      </svg>
    ),
  },
  {
    title: "Player Props",
    desc: "Analyze historical prop hit rates \u2014 passing yards, rushing TDs, and more with stat-specific breakdowns.",
    icon: (
      <svg
        className="h-6 w-6 text-primary"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
        />
      </svg>
    ),
  },
];

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: stats } = useStats();

  const handleSearch = () => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const sportCards = [
    {
      sport: "NFL",
      games: stats?.nfl.totalGames,
      years: stats?.nfl.seasons
        ? `${stats.nfl.seasons[0]} \u2013 ${stats.nfl.seasons[1]}`
        : "",
      href: "/search?q=NFL home favorites",
      available: true,
    },
    {
      sport: "NCAAF",
      games: stats?.ncaaf.totalGames,
      years: stats?.ncaaf.seasons
        ? `${stats.ncaaf.seasons[0]} \u2013 ${stats.ncaaf.seasons[1]}`
        : "",
      href: "/search?q=NCAAF ranked teams",
      available: (stats?.ncaaf.totalGames || 0) > 0,
    },
    {
      sport: "NCAAMB",
      games: stats?.ncaamb.totalGames,
      years: stats?.ncaamb.seasons
        ? `${stats.ncaamb.seasons[0]} \u2013 ${stats.ncaamb.seasons[1]}`
        : "",
      href: "/search?q=NCAAMB favorites",
      available: (stats?.ncaamb.totalGames || 0) > 0,
    },
  ];

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="mx-auto flex max-w-4xl flex-col items-center px-4 pb-16 pt-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          <span className="text-primary">Trend</span>Line
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Find statistically significant betting trends across NFL, NCAAF, and
          NCAAMB. Powered by{" "}
          <span className="font-medium text-foreground">
            {stats
              ? `${stats.total.toLocaleString()} games`
              : "149,000+ games"}
          </span>{" "}
          of historical data.
        </p>

        {/* Search Bar */}
        <div className="mt-8 w-full max-w-xl">
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
              type="text"
              placeholder='Try: "Home underdogs in primetime NFL"'
              className="flex-1 bg-transparent px-2 py-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={!query.trim()}
              className="mr-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Search
            </button>
          </div>
        </div>

        {/* Example Chips */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {EXAMPLE_QUERIES.map((eq) => (
            <Link
              key={eq.label}
              href={`/search?q=${encodeURIComponent(eq.label)}`}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span className="mr-1">{eq.icon}</span>
              {eq.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Sport Cards */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {sportCards.map((item) => (
              <Link
                key={item.sport}
                href={item.available ? item.href : "#"}
                className={`group rounded-xl border border-border bg-card p-6 transition-all ${
                  item.available
                    ? "hover:border-primary/40 hover:shadow-md"
                    : "opacity-60"
                }`}
              >
                <h3 className="text-lg font-semibold">{item.sport}</h3>
                <p className="mt-1 text-3xl font-bold tabular-nums text-primary">
                  {item.games != null
                    ? item.games.toLocaleString()
                    : "\u2014"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {item.games != null ? `games \u00b7 ${item.years}` : "Loading..."}
                </p>
                {item.available && (
                  <p className="mt-2 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Explore trends \u2192
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold">
          More Than Just Win/Loss Records
        </h2>
        <p className="mb-10 text-center text-muted-foreground">
          Every trend comes with statistical rigor so you know what&apos;s real.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border bg-card p-6"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                {f.icon}
              </div>
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-16 text-center">
          <h2 className="text-2xl font-bold">Start Finding Edges</h2>
          <p className="mt-2 text-muted-foreground">
            Search across decades of historical data with natural language
            queries.
          </p>
          <Link
            href="/search"
            className="mt-6 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Search Trends
          </Link>
        </div>
      </section>
    </div>
  );
}
