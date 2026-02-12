import { useQuery } from "@tanstack/react-query";
import type { SignificantMove } from "@/lib/line-movement";

interface MovesResponse {
  success: boolean;
  moves: SignificantMove[];
  count: number;
}

async function fetchSignificantMoves(sport: string): Promise<SignificantMove[]> {
  const res = await fetch(`/api/odds/significant-moves?sport=${sport}`);
  if (!res.ok) throw new Error(`Significant moves request failed (${res.status})`);
  const data: MovesResponse = await res.json();
  if (!data.success) throw new Error("Failed to fetch significant moves");
  return data.moves;
}

export function useSignificantMoves(sport: string) {
  return useQuery({
    queryKey: ["significant-moves", sport],
    queryFn: () => fetchSignificantMoves(sport),
    staleTime: 2 * 60 * 1000, // 2 minutes — games drop off as they start
    enabled: !!sport,
  });
}
