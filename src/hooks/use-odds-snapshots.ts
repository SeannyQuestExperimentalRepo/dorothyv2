import { useQuery } from "@tanstack/react-query";

export interface OddsSnapshotPoint {
  fetchedAt: string;
  bestSpread: number | null;
  bestTotal: number | null;
  bookmakers: unknown;
}

interface SnapshotsResponse {
  success: boolean;
  snapshots: OddsSnapshotPoint[];
  count: number;
}

async function fetchSnapshots(
  sport: string,
  home: string,
  away: string,
): Promise<OddsSnapshotPoint[]> {
  const params = new URLSearchParams({ sport, home, away });
  const res = await fetch(`/api/odds/snapshots?${params}`);
  const data: SnapshotsResponse = await res.json();
  if (!data.success) throw new Error("Failed to fetch odds snapshots");
  return data.snapshots;
}

export function useOddsSnapshots(sport: string, home: string, away: string) {
  return useQuery({
    queryKey: ["odds-snapshots", sport, home, away],
    queryFn: () => fetchSnapshots(sport, home, away),
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!sport && !!home && !!away,
  });
}
