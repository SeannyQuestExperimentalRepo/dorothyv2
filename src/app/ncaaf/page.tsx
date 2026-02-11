import Link from "next/link";

const CONFERENCES = [
  { name: "SEC", teams: ["Alabama", "Arkansas", "Auburn", "Florida", "Georgia", "Kentucky", "LSU", "Mississippi State", "Missouri", "Ole Miss", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Texas A&M", "Vanderbilt"] },
  { name: "Big Ten", teams: ["Illinois", "Indiana", "Iowa", "Maryland", "Michigan", "Michigan State", "Minnesota", "Nebraska", "Northwestern", "Ohio State", "Oregon", "Penn State", "Purdue", "Rutgers", "UCLA", "USC", "Washington", "Wisconsin"] },
  { name: "Big 12", teams: ["Arizona", "Arizona State", "BYU", "Baylor", "Cincinnati", "Colorado", "Houston", "Iowa State", "Kansas", "Kansas State", "Oklahoma State", "TCU", "Texas Tech", "UCF", "Utah", "West Virginia"] },
  { name: "ACC", teams: ["Boston College", "Clemson", "Duke", "Florida State", "Georgia Tech", "Louisville", "Miami", "NC State", "North Carolina", "Pittsburgh", "SMU", "Stanford", "Syracuse", "Virginia", "Virginia Tech", "Wake Forest"] },
];

const QUICK_QUERIES = [
  { label: "Ranked vs unranked", query: "NCAAF ranked vs unranked" },
  { label: "Top 10 as favorites", query: "NCAAF top 10 favorites" },
  { label: "Bowl games", query: "NCAAF bowl games" },
  { label: "Conference games", query: "NCAAF conference games" },
  { label: "Home underdogs", query: "NCAAF home underdogs" },
  { label: "Rivalry games", query: "NCAAF rivalry games" },
];

export default function NCAAFPage() {
  return (
    <div className="py-10">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">NCAAF Trends</h1>
        <p className="mt-2 text-sm text-muted-foreground/70">
          FBS games since 2005. Conference matchups, rankings, bowl games, and more.
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
            <h2 className="font-semibold tracking-tight">Auto-Discover NCAAF Angles</h2>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Scan for the most significant college football trends.
            </p>
          </div>
          <Link
            href="/trends?sport=NCAAF"
            className="shrink-0 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Discover
          </Link>
        </div>
      </div>

      {/* Teams by Conference */}
      <h2 className="mb-5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Browse by Conference
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 stagger-in">
        {CONFERENCES.map((conf) => (
          <div
            key={conf.name}
            className="gradient-border rounded-xl border border-border/60 bg-card p-5"
          >
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
              {conf.name}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {conf.teams.map((team) => (
                <Link
                  key={team}
                  href={`/search?q=${encodeURIComponent(`${team} NCAAF`)}`}
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
