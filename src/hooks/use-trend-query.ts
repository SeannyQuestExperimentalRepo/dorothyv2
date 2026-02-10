import { useQuery } from "@tanstack/react-query";

interface TrendQueryParams {
  query: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTrendSearch(query: string): Promise<any> {
  // Step 1: Parse the query with NLP
  const parseRes = await fetch("/api/trends/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (parseRes.ok) {
    const parsed = await parseRes.json();
    if (parsed.success && parsed.data) {
      const { trendQuery, playerTrendQuery, interpretation, queryType } =
        parsed.data;

      // Step 2: Execute the parsed query
      const endpoint =
        queryType === "player" ? "/api/trends/players" : "/api/trends";
      const queryPayload =
        queryType === "player" && playerTrendQuery
          ? playerTrendQuery
          : trendQuery;
      const execRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queryPayload),
      });

      const execData = await execRes.json();

      if (execData.success) {
        return {
          result: execData,
          interpretation,
          queryType,
        };
      } else {
        throw new Error(execData.error || "Query returned no results");
      }
    }
  }

  // Fallback: direct API call with basic params
  const directRes = await fetch(
    `/api/trends?sport=NFL&team=${encodeURIComponent(query)}`,
  );
  const directData = await directRes.json();

  if (directData.success) {
    return {
      result: directData,
      interpretation: `Showing trends for "${query}"`,
      queryType: "game" as const,
    };
  }

  throw new Error(
    directData.error ||
      "Could not interpret your query. Try something like: 'Home underdogs NFL'",
  );
}

export function useTrendQuery(params: TrendQueryParams | null) {
  return useQuery({
    queryKey: ["trends", params?.query || ""],
    queryFn: () => executeTrendSearch(params!.query),
    enabled: !!params?.query,
  });
}
