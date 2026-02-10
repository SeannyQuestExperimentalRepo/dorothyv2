import { useQuery } from "@tanstack/react-query";

interface AngleParams {
  sport: string;
  team?: string;
  minStrength?: string;
  maxResults?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAngles(params: AngleParams): Promise<any> {
  const searchParams = new URLSearchParams({ sport: params.sport });
  if (params.team) searchParams.set("team", params.team);
  if (params.minStrength) searchParams.set("minStrength", params.minStrength);
  searchParams.set("maxResults", String(params.maxResults || 20));

  const res = await fetch(`/api/trends/angles?${searchParams}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to discover angles");
  return data.data;
}

export function useAngles(params: AngleParams, enabled = true) {
  return useQuery({
    queryKey: [
      "angles",
      params.sport,
      params.team || "",
      params.minStrength || "",
    ],
    queryFn: () => fetchAngles(params),
    enabled,
  });
}
