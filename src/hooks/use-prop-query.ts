import { useQuery } from "@tanstack/react-query";

interface PropQueryParams {
  player: string;
  stat: string;
  line: number;
  direction: "over" | "under";
  homeAway?: "home" | "away";
  favDog?: "favorite" | "underdog";
  opponent?: string;
  seasonStart?: number;
  seasonEnd?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPropData(params: PropQueryParams): Promise<any> {
  const searchParams = new URLSearchParams({
    player: params.player,
    stat: params.stat,
    line: params.line.toString(),
    direction: params.direction,
  });

  if (params.homeAway) searchParams.set("homeAway", params.homeAway);
  if (params.favDog) searchParams.set("favDog", params.favDog);
  if (params.opponent) searchParams.set("opponent", params.opponent);
  if (params.seasonStart && params.seasonEnd) {
    searchParams.set("seasonStart", params.seasonStart.toString());
    searchParams.set("seasonEnd", params.seasonEnd.toString());
  }

  const res = await fetch(`/api/trends/props?${searchParams.toString()}`);
  const data = await res.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch prop data");
  }

  return data;
}

export function usePropQuery(params: PropQueryParams | null) {
  return useQuery({
    queryKey: ["props", params],
    queryFn: () => fetchPropData(params!),
    enabled: !!params?.player && !!params?.stat && params?.line != null,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}
