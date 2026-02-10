import { useQuery } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchMatchup(sport: string, homeTeam: string, awayTeam: string): Promise<any> {
  const url = `/api/games/matchup?sport=${encodeURIComponent(sport)}&home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(awayTeam)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to load matchup data");
  return { data: json.data, durationMs: json.meta.durationMs };
}

export function useMatchup(sport: string, homeTeam: string, awayTeam: string) {
  return useQuery({
    queryKey: ["matchup", sport, homeTeam, awayTeam],
    queryFn: () => fetchMatchup(sport, homeTeam, awayTeam),
    enabled: !!(sport && homeTeam && awayTeam),
    staleTime: 10 * 60 * 1000, // 10 min — data only changes on daily cron
    gcTime: 30 * 60 * 1000, // 30 min
    refetchOnWindowFocus: false,
  });
}
