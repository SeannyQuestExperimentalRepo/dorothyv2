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
    <div className="py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">NFL Trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every game since 1966. Search by team, situation, or explore
          auto-discovered angles.
        </p>
      </div>

      {/* Quick Queries */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Popular Searches
        </h2>
        <div className="flex flex-wrap gap-2">
          {QUICK_QUERIES.map((q) => (
            <Link
              key={q.label}
              href={`/search?q=${encodeURIComponent(q.query)}`}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {q.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Discover Angles CTA */}
      <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Auto-Discover NFL Angles</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Let our engine scan 45+ templates to find the most profitable NFL
              trends right now.
            </p>
          </div>
          <Link
            href="/trends?sport=NFL"
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Discover
          </Link>
        </div>
      </div>

      {/* Teams by Division */}
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Browse by Team
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {NFL_TEAMS.map((div) => (
          <div
            key={div.division}
            className="rounded-xl border border-border bg-card p-4"
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {div.division}
            </h3>
            <div className="space-y-1.5">
              {div.teams.map((team) => (
                <Link
                  key={team}
                  href={`/search?q=${encodeURIComponent(`${team} trends`)}`}
                  className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
