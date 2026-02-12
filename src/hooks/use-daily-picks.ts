import { useQuery } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPicks(sport: string, date?: string): Promise<any> {
  const params = new URLSearchParams({ sport });
  if (date) params.set("date", date);

  const res = await fetch(`/api/picks/today?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch picks");
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRecord(sport?: string, days?: number): Promise<any> {
  const params = new URLSearchParams();
  if (sport) params.set("sport", sport);
  if (days) params.set("days", days.toString());

  const res = await fetch(`/api/picks/record?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch record");
  return data;
}

export function useDailyPicks(sport: string, date?: string) {
  return useQuery({
    queryKey: ["daily-picks", sport, date],
    queryFn: () => fetchPicks(sport, date),
    enabled: !!sport,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePickRecord(sport?: string, days?: number) {
  return useQuery({
    queryKey: ["pick-record", sport, days],
    queryFn: () => fetchRecord(sport, days),
    staleTime: 10 * 60 * 1000,
  });
}
