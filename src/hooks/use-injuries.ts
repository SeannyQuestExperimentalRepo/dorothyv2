import { useQuery } from "@tanstack/react-query";
import type { Injury } from "@/lib/espn-injuries";

interface InjuriesData {
  home: Injury[];
  away: Injury[];
  lastUpdated: string;
}

async function fetchInjuries(
  sport: string,
  homeTeam: string,
  awayTeam: string,
): Promise<InjuriesData> {
  const url = `/api/games/injuries?sport=${encodeURIComponent(sport)}&home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(awayTeam)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Failed to load injury data");
  return {
    home: json.data.home,
    away: json.data.away,
    lastUpdated: json.meta.lastUpdated,
  };
}

export function useInjuries(sport: string, homeTeam: string, awayTeam: string) {
  return useQuery({
    queryKey: ["injuries", sport, homeTeam, awayTeam],
    queryFn: () => fetchInjuries(sport, homeTeam, awayTeam),
    enabled: !!(sport && homeTeam && awayTeam),
    staleTime: 15 * 60 * 1000, // 15 min — matches CDN cache
    gcTime: 30 * 60 * 1000, // 30 min
    refetchOnWindowFocus: false,
  });
}
