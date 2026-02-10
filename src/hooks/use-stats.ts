import { useQuery } from "@tanstack/react-query";

interface DatasetStats {
  nfl: { totalGames: number; seasons: [number, number] | null };
  ncaaf: { totalGames: number; seasons: [number, number] | null };
  ncaamb: { totalGames: number; seasons: [number, number] | null };
  total: number;
}

async function fetchStats(): Promise<DatasetStats> {
  const res = await fetch("/api/trends/stats");
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch stats");
  return data.data;
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
  });
}
