import { useQuery } from "@tanstack/react-query";

export interface BookOdds {
  book: string;
  bookTitle: string;
  spread: number | null;
  spreadOdds: number | null;
  total: number | null;
  totalOverOdds: number | null;
  totalUnderOdds: number | null;
  homeML: number | null;
  awayML: number | null;
}

export interface GameOdds {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  books: BookOdds[];
  bestSpread: { value: number; book: string; odds: number } | null;
  bestTotal: { value: number; book: string } | null;
}

async function fetchOdds(sport: string): Promise<GameOdds[]> {
  const res = await fetch(`/api/odds?sport=${sport}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch odds");
  return data.games;
}

export function useOdds(sport: string) {
  return useQuery({
    queryKey: ["odds", sport],
    queryFn: () => fetchOdds(sport),
    staleTime: 5 * 60 * 1000, // 5 minutes (matches API cache)
    enabled: !!sport,
  });
}
