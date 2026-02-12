import Link from "next/link";

const DIVISIONS = [
  {
    name: "Atlantic",
    teams: ["Boston Celtics", "Brooklyn Nets", "New York Knicks", "Philadelphia 76ers", "Toronto Raptors"],
  },
  {
    name: "Central",
    teams: ["Chicago Bulls", "Cleveland Cavaliers", "Detroit Pistons", "Indiana Pacers", "Milwaukee Bucks"],
  },
  {
    name: "Southeast",
    teams: ["Atlanta Hawks", "Charlotte Hornets", "Miami Heat", "Orlando Magic", "Washington Wizards"],
  },
  {
    name: "Northwest",
    teams: ["Denver Nuggets", "Minnesota Timberwolves", "Oklahoma City Thunder", "Portland Trail Blazers", "Utah Jazz"],
  },
  {
    name: "Pacific",
    teams: ["Golden State Warriors", "LA Clippers", "Los Angeles Lakers", "Phoenix Suns", "Sacramento Kings"],
  },
  {
    name: "Southwest",
    teams: ["Dallas Mavericks", "Houston Rockets", "Memphis Grizzlies", "New Orleans Pelicans", "San Antonio Spurs"],
  },
];

const QUICK_QUERIES = [
  { label: "Home favorites", query: "NBA home favorites" },
  { label: "Road underdogs", query: "NBA road underdogs" },
  { label: "Back-to-back games", query: "NBA back to back" },
  { label: "Over trends", query: "NBA over trends" },
  { label: "Playoff teams", query: "NBA playoff teams" },
  { label: "Division rivalries", query: "NBA division rivals" },
];

export default function NBAPage() {
  return (
    <div className="py-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">NBA Trends</h1>
        <p className="mt-2 text-sm text-muted-foreground/70">
          Professional basketball trends, odds, and betting angles across all 30 teams.
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
            <h2 className="font-semibold tracking-tight">Auto-Discover NBA Angles</h2>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Scan for the most significant pro basketball trends.
            </p>
          </div>
          <Link
            href="/trends?sport=NBA"
            className="shrink-0 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Discover
          </Link>
        </div>
      </div>

      {/* Teams by Division */}
      <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Browse by Division
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger-in">
        {DIVISIONS.map((div) => (
          <div
            key={div.name}
            className="gradient-border rounded-xl border border-border/60 bg-card p-5"
          >
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
              {div.name}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {div.teams.map((team) => (
                <Link
                  key={team}
                  href={`/search?q=${encodeURIComponent(`${team} NBA`)}`}
                  className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
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
