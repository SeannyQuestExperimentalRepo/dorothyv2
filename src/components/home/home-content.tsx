"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DatasetStats {
  nfl: { totalGames: number; seasons: [number, number] | null };
  ncaaf: { totalGames: number; seasons: [number, number] | null };
  ncaamb: { totalGames: number; seasons: [number, number] | null };
  total: number;
}

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
        className="h-5 w-5"
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
        className="h-5 w-5"
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
        className="h-5 w-5"
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
        className="h-5 w-5"
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
  {
    title: "Live Odds Comparison",
    desc: "Compare lines across DraftKings, FanDuel, BetMGM, and more. Find the best price on every bet.",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
    ),
  },
  {
    title: "Bet Tracking & P/L",
    desc: "Track every wager with auto-grading. See ROI by sport, bet type, and month with cumulative P&L charts.",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
        />
      </svg>
    ),
  },
];

const SPORT_ICONS: Record<string, React.ReactNode> = {
  NFL: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 0 1 9 14.437V9.564Z" />
    </svg>
  ),
  NCAAF: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
    </svg>
  ),
  NCAAMB: (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0 1 16.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 0 1-3.77 1.522m0 0a6.003 6.003 0 0 1-3.77-1.522" />
    </svg>
  ),
};

export function HomeContent({ stats }: { stats: DatasetStats | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

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
      {/* ===== HERO SECTION ===== */}
      <section className="hero-mesh noise-overlay relative overflow-hidden">
        <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 pb-20 pt-24 text-center">
          {/* Decorative top line */}
          <div className="mb-8 flex items-center gap-3">
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/40" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Sports Betting Intelligence
            </span>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/40" />
          </div>

          {/* Headline */}
          <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
            <span className="bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              Trend
            </span>
            <span className="text-foreground">Line</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Find statistically significant betting trends across NFL, NCAAF, and
            NCAAMB. Powered by{" "}
            <span className="font-mono text-sm font-medium text-foreground">
              {stats
                ? `${stats.total.toLocaleString()} games`
                : "149,000+ games"}
            </span>{" "}
            of historical data.
          </p>

          {/* ===== SEARCH BAR ===== */}
          <div className="mt-10 w-full max-w-xl">
            <div className="group relative rounded-xl border border-border/60 bg-card/80 shadow-lg shadow-black/20 backdrop-blur-sm transition-all duration-300 focus-within:border-primary/40 focus-within:glow-primary">
              <div className="flex items-center gap-2">
                <svg
                  className="ml-4 h-5 w-5 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary"
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
                  className="flex-1 bg-transparent px-2 py-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <button
                  onClick={handleSearch}
                  disabled={!query.trim()}
                  className="mr-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
                >
                  Search
                </button>
              </div>
            </div>
          </div>

          {/* ===== EXAMPLE QUERY CHIPS ===== */}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {EXAMPLE_QUERIES.map((eq) => (
              <Link
                key={eq.label}
                href={`/search?q=${encodeURIComponent(eq.label)}`}
                className="gradient-border rounded-full border border-border/40 bg-secondary/60 px-3.5 py-1.5 text-xs text-muted-foreground backdrop-blur-sm transition-all duration-200 hover:bg-secondary hover:text-foreground"
              >
                <span className="mr-1.5">{eq.icon}</span>
                {eq.label}
              </Link>
            ))}
          </div>

          {/* ===== TODAY'S SHEET CTA ===== */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/today"
              className="group/cta relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl border border-accent/25 bg-accent/[0.07] px-6 py-3 text-sm font-semibold text-accent transition-all duration-300 hover:border-accent/40 hover:bg-accent/[0.12] hover:shadow-lg hover:shadow-accent/10"
            >
              <span className="text-base transition-transform duration-300 group-hover/cta:scale-110">
                &#9733;
              </span>
              <span>Today&apos;s Sheet</span>
              <span className="hidden text-xs font-normal text-accent/50 sm:inline">
                &mdash; AI-powered daily picks
              </span>
              <svg
                className="h-4 w-4 text-accent/40 transition-transform duration-300 group-hover/cta:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
            <Link
              href="/odds"
              className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/60 px-5 py-3 text-sm font-medium text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground"
            >
              Live Odds
            </Link>
            <Link
              href="/parlays"
              className="inline-flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/60 px-5 py-3 text-sm font-medium text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground"
            >
              Parlay Builder
            </Link>
          </div>
        </div>
      </section>

      {/* ===== SPORT CARDS ===== */}
      <section className="relative border-t border-border/40">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-border/60 to-transparent" />
            <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Coverage
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-border/60 to-transparent" />
          </div>

          <div className="stagger-in grid grid-cols-1 gap-4 sm:grid-cols-3">
            {sportCards.map((item) => (
              <Link
                key={item.sport}
                href={item.available ? item.href : "#"}
                className={`gradient-border group relative rounded-xl border border-border/50 bg-card/80 p-6 backdrop-blur-sm transition-all duration-300 ${
                  item.available
                    ? "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5"
                    : "pointer-events-none opacity-50"
                }`}
              >
                {/* Sport header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {SPORT_ICONS[item.sport]}
                    </div>
                    <h3 className="font-mono text-sm font-semibold tracking-wide text-foreground">
                      {item.sport}
                    </h3>
                  </div>
                  {item.available && (
                    <svg
                      className="h-4 w-4 text-muted-foreground/40 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-primary"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                      />
                    </svg>
                  )}
                </div>

                {/* Big number */}
                <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-primary number-reveal">
                  {item.games != null ? item.games.toLocaleString() : "\u2014"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.games != null ? (
                    <>
                      games{" "}
                      <span className="mx-1 text-border">|</span>{" "}
                      <span className="font-mono text-[11px]">{item.years}</span>
                    </>
                  ) : (
                    "Loading..."
                  )}
                </p>

                {/* Hover explore text */}
                {item.available && (
                  <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-primary/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    Explore trends
                  </p>
                )}
              </Link>
            ))}
          </div>

          {/* Total stat line */}
          {stats && (
            <div className="mt-6 flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/30 bg-secondary/40 px-4 py-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
                <span className="font-mono text-xs text-muted-foreground">
                  {stats.total.toLocaleString()} total games indexed
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== FEATURES GRID ===== */}
      <section className="relative border-t border-border/40">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <div className="mb-3 text-center">
            <span className="inline-block font-mono text-[10px] uppercase tracking-[0.3em] text-primary/70">
              Capabilities
            </span>
          </div>
          <h2 className="mb-2 text-center text-2xl font-bold tracking-tight sm:text-3xl">
            More Than Just Win/Loss Records
          </h2>
          <p className="mx-auto mb-12 max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
            Every trend comes with statistical rigor so you know what&apos;s real.
          </p>

          <div className="stagger-in grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="glass-card group rounded-xl p-6 transition-all duration-300 hover:border-primary/20"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary transition-colors group-hover:border-primary/30 group-hover:bg-primary/15">
                  {f.icon}
                </div>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section className="hero-mesh noise-overlay relative border-t border-border/40">
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <svg
              className="h-5 w-5 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Start Finding Edges
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Search across decades of historical data with natural language
            queries. Uncover the trends that sharps rely on.
          </p>
          <Link
            href="/search"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 hover:brightness-110"
          >
            Search Trends
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
              />
            </svg>
          </Link>
        </div>
      </section>
    </div>
  );
}
