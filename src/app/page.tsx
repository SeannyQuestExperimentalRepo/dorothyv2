export default function Home() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center px-4 py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
        <span className="text-primary">Trend</span>Line
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Search historical ATS trends across NFL, college football, and college
        basketball. Powered by natural language search.
      </p>

      <div className="mt-10 w-full max-w-xl">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <svg
            className="h-5 w-5 text-muted-foreground"
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
          <span className="text-muted-foreground">
            Try: &quot;home dog primetime NFL&quot;
          </span>
        </div>
      </div>

      <div className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            sport: "NFL",
            games: "14,000+",
            years: "1966 - 2025",
          },
          {
            sport: "NCAAF",
            games: "Coming soon",
            years: "FBS",
          },
          {
            sport: "NCAAMB",
            games: "Coming soon",
            years: "Division I",
          },
        ].map((item) => (
          <div
            key={item.sport}
            className="rounded-lg border border-border bg-card p-6"
          >
            <h3 className="text-lg font-semibold">{item.sport}</h3>
            <p className="mt-1 text-2xl font-bold text-primary">
              {item.games}
            </p>
            <p className="text-sm text-muted-foreground">{item.years}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
