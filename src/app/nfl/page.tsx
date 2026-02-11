import Link from "next/link";

const NFL_TEAMS = [
  { division: "AFC East", teams: ["Buffalo Bills", "Miami Dolphins", "New England Patriots", "New York Jets"] },
  { division: "AFC North", teams: ["Baltimore Ravens", "Cincinnati Bengals", "Cleveland Browns", "Pittsburgh Steelers"] },
  { division: "AFC South", teams: ["Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Tennessee Titans"] },
  { division: "AFC West", teams: ["Denver Broncos", "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers"] },
  { division: "NFC East", teams: ["Dallas Cowboys", "New York Giants", "Philadelphia Eagles", "Washington Commanders"] },
  { division: "NFC North", teams: ["Chicago Bears", "Detroit Lions", "Green Bay Packers", "Minnesota Vikings"] },
  { division: "NFC South", teams: ["Atlanta Falcons", "Carolina Panthers", "New Orleans Saints", "Tampa Bay Buccaneers"] },
  { division: "NFC West", teams: ["Arizona Cardinals", "Los Angeles Rams", "San Francisco 49ers", "Seattle Seahawks"] },
];

const QUICK_QUERIES = [
  { label: "Home underdogs", query: "NFL home underdogs" },
  { label: "Primetime favorites", query: "NFL favorites in primetime" },
  { label: "After bye week", query: "NFL teams after bye week" },
  { label: "Cold weather games", query: "NFL cold weather games" },
  { label: "Playoff underdogs", query: "NFL playoff underdogs" },
  { label: "Short week", query: "NFL short week games" },
  { label: "Division games", query: "NFL conference games" },
  { label: "Road favorites", query: "NFL away favorites" },
];

export default function NFLPage() {
  return (
    <div className="py-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">NFL Trends</h1>
        <p className="mt-2 text-sm text-muted-foreground/70">
          Every game since 1966. Search by team, situation, or explore
          auto-discovered angles.
        </p>
      </div>

      {/* Quick Queries */}
      <div className="mb-10">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
          Popular Searches
        </h2>
        <div className="flex flex-wrap gap-2 stagger-in">
          {QUICK_QUERIES.map((q) => (
            <Link
              key={q.label}
              href={`/search?q=${encodeURIComponent(q.query)}`}
              className="rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            >
              {q.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Discover Angles CTA */}
      <div className="mb-10 rounded-xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold tracking-tight">Auto-Discover NFL Angles</h2>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Let our engine scan 45+ templates to find the most profitable NFL
              trends right now.
            </p>
          </div>
          <Link
            href="/trends?sport=NFL"
            className="shrink-0 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Discover
          </Link>
        </div>
      </div>

      {/* Teams by Division */}
      <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Browse by Team
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-in">
        {NFL_TEAMS.map((div) => (
          <div
            key={div.division}
            className="gradient-border rounded-xl border border-border/60 bg-card p-5"
          >
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
              {div.division}
            </h3>
            <div className="space-y-1">
              {div.teams.map((team) => (
                <Link
                  key={team}
                  href={`/search?q=${encodeURIComponent(`${team} trends`)}`}
                  className="block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {team}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
