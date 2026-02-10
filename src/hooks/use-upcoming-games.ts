import { useQuery } from "@tanstack/react-query";

interface UpcomingGame {
  id: number;
  sport: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  spread: number | null;
  overUnder: number | null;
  moneylineHome: number | null;
  moneylineAway: number | null;
}

interface UpcomingGamesData {
  games: UpcomingGame[];
  lastUpdated: string | null;
}

async function fetchUpcomingGames(
  sport?: string | null,
): Promise<UpcomingGamesData> {
  const url = sport
    ? `/api/games/upcoming?sport=${sport}`
    : `/api/games/upcoming`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success)
    throw new Error(data.error || "Failed to fetch upcoming games");
  return {
    games: data.data.games,
    lastUpdated: data.data.lastUpdated,
  };
}

export function useUpcomingGames(sport?: string | null) {
  return useQuery({
    queryKey: ["upcoming", sport ?? "all"],
    queryFn: () => fetchUpcomingGames(sport),
  });
}
