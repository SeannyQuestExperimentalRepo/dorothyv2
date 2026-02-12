import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SavedTrend {
  id: number;
  name: string;
  sport: string;
  query: Record<string, unknown>;
  description: string | null;
  lastResult: unknown;
  lastTriggered: string | null;
  notifyEmail: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

async function fetchSavedTrends(): Promise<SavedTrend[]> {
  const res = await fetch("/api/trends/saved");
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch saved trends");
  return data.trends;
}

async function saveTrend(input: {
  name: string;
  sport: string;
  query: Record<string, unknown>;
  description?: string;
}): Promise<SavedTrend> {
  const res = await fetch("/api/trends/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to save trend");
  return data.trend;
}

async function deleteSavedTrend(id: number): Promise<void> {
  const res = await fetch(`/api/trends/saved?id=${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to delete trend");
}

export function useSavedTrends() {
  return useQuery({
    queryKey: ["saved-trends"],
    queryFn: fetchSavedTrends,
    staleTime: 60 * 1000,
  });
}

export function useSaveTrend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveTrend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-trends"] });
    },
  });
}

export function useDeleteSavedTrend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSavedTrend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-trends"] });
    },
  });
}

async function updateSavedTrend(input: { id: number; notifyEmail?: boolean; isPublic?: boolean }): Promise<SavedTrend> {
  const res = await fetch("/api/trends/saved", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to update trend");
  return data.trend;
}

export function useUpdateSavedTrend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSavedTrend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-trends"] });
    },
  });
}
