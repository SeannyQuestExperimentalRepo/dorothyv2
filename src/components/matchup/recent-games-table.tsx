"use client";

interface RecentGame {
  gameDate: string;
  opponent: string;
  isHome: boolean;
  score: string;
  result: "W" | "L" | "T";
  spread: number | null;
  spreadResult: string | null;
  ouResult: string | null;
}

interface RecentGamesTableProps {
  team: string;
  games: RecentGame[];
}

export function RecentGamesTable({ team, games }: RecentGamesTableProps) {
  if (games.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="border-b border-border/40 px-4 py-3">
        <h3 className="text-sm font-medium">{team} — Recent Games</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left text-xs uppercase tracking-wider text-muted-foreground/70">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Matchup</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2">Result</th>
              <th className="px-4 py-2">ATS</th>
              <th className="px-4 py-2">O/U</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g, i) => (
              <tr
                key={i}
                className="border-b border-border/30 hover:bg-muted/30"
              >
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">
                  {g.gameDate}
                </td>
                <td className="px-4 py-2">
                  {g.isHome ? (
                    <>
                      <span className="text-muted-foreground">vs</span>{" "}
                      <span>{g.opponent}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">@</span>{" "}
                      <span>{g.opponent}</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-2 font-mono tabular-nums">{g.score}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      g.result === "W"
                        ? "font-semibold text-emerald-400"
                        : g.result === "L"
                          ? "text-red-400"
                          : "text-muted-foreground"
                    }
                  >
                    {g.result}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {g.spreadResult === "COVERED" && (
                    <span className="text-emerald-400">W</span>
                  )}
                  {g.spreadResult === "LOST" && (
                    <span className="text-red-400">L</span>
                  )}
                  {g.spreadResult === "PUSH" && (
                    <span className="text-muted-foreground">P</span>
                  )}
                  {!g.spreadResult && (
                    <span className="text-muted-foreground/50">-</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {g.ouResult === "OVER" && (
                    <span className="text-blue-400">O</span>
                  )}
                  {g.ouResult === "UNDER" && (
                    <span className="text-amber-400">U</span>
                  )}
                  {g.ouResult === "PUSH" && (
                    <span className="text-muted-foreground">P</span>
                  )}
                  {!g.ouResult && (
                    <span className="text-muted-foreground/50">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
