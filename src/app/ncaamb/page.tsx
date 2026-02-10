import Link from "next/link";

const CONFERENCES = [
  { name: "SEC", teams: ["Alabama", "Arkansas", "Auburn", "Florida", "Georgia", "Kentucky", "LSU", "Mississippi State", "Missouri", "Ole Miss", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Texas A&M", "Vanderbilt"] },
  { name: "Big Ten", teams: ["Illinois", "Indiana", "Iowa", "Maryland", "Michigan", "Michigan State", "Minnesota", "Nebraska", "Northwestern", "Ohio State", "Oregon", "Penn State", "Purdue", "Rutgers", "UCLA", "USC", "Washington", "Wisconsin"] },
  { name: "Big 12", teams: ["Arizona", "Arizona State", "BYU", "Baylor", "Cincinnati", "Colorado", "Houston", "Iowa State", "Kansas", "Kansas State", "Oklahoma State", "TCU", "Texas Tech", "UCF", "Utah", "West Virginia"] },
  { name: "Big East", teams: ["Butler", "Connecticut", "Creighton", "DePaul", "Georgetown", "Marquette", "Providence", "Seton Hall", "St. John's", "Villanova", "Xavier"] },
];

const QUICK_QUERIES = [
  { label: "March Madness underdogs", query: "NCAAMB tournament underdogs" },
  { label: "Top 25 favorites", query: "NCAAMB ranked favorites" },
  { label: "Conference tournaments", query: "NCAAMB conference tournament" },
  { label: "Home teams", query: "NCAAMB home teams" },
  { label: "High-tempo games", query: "NCAAMB high tempo" },
  { label: "KenPom upsets", query: "NCAAMB KenPom upset" },
];

export default function NCAAMBPage() {
  return (
    <div className="py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">NCAAMB Trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          120,000+ Division I games with KenPom ratings, tournament data, and spread proxies.
        </p>
      </div>

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

      <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Auto-Discover NCAAMB Angles</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Scan for the most significant college basketball trends.
            </p>
          </div>
          <Link
            href="/trends?sport=NCAAMB"
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Discover
          </Link>
        </div>
      </div>

      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Browse by Conference
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {CONFERENCES.map((conf) => (
          <div
            key={conf.name}
            className="rounded-xl border border-border bg-card p-4"
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
              {conf.name}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {conf.teams.map((team) => (
                <Link
                  key={team}
                  href={`/search?q=${encodeURIComponent(`${team} NCAAMB`)}`}
                  className="rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
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
