import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ─── Types ────────────────────────────────────────────────────────────────

export interface Bet {
  id: string;
  sport: string;
  betType: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  pickSide: string;
  line: number | null;
  oddsValue: number;
  stake: number;
  toWin: number;
  result: string;
  profit: number | null;
  sportsbook: string | null;
  playerName: string | null;
  propStat: string | null;
  propLine: number | null;
  notes: string | null;
  parlayLegs: unknown;
  teaserPoints: number | null;
  dailyPickId: number | null;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BetStats {
  totalBets: number;
  gradedBets: number;
  pendingBets: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  totalStaked: number;
  totalProfit: number;
  roi: number;
  currentStreak: { type: "W" | "L" | "P" | "none"; count: number };
  bestDay: { date: string; profit: number } | null;
  worstDay: { date: string; profit: number } | null;
  bySport: Record<
    string,
    { w: number; l: number; p: number; profit: number; staked: number }
  >;
  byBetType: Record<
    string,
    { w: number; l: number; p: number; profit: number; staked: number }
  >;
  byMonth: Array<{
    month: string;
    w: number;
    l: number;
    profit: number;
    staked: number;
  }>;
  cumulativePL: Array<{ date: string; profit: number; cumulative: number }>;
}

export interface CreateBetInput {
  sport: string;
  betType: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  pickSide: string;
  line?: number;
  oddsValue?: number;
  stake: number;
  sportsbook?: string;
  playerName?: string;
  propStat?: string;
  propLine?: number;
  notes?: string;
  dailyPickId?: number;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────

interface BetFilters {
  sport?: string;
  betType?: string;
  result?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

async function fetchBets(
  filters: BetFilters,
): Promise<{ bets: Bet[]; pagination: { total: number; hasMore: boolean } }> {
  const params = new URLSearchParams();
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.betType) params.set("betType", filters.betType);
  if (filters.result) params.set("result", filters.result);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit) params.set("limit", filters.limit.toString());
  if (filters.offset) params.set("offset", filters.offset.toString());

  const res = await fetch(`/api/bets?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch bets");
  return { bets: data.bets, pagination: data.pagination };
}

async function fetchBetStats(
  filters: { sport?: string; from?: string; to?: string } = {},
): Promise<BetStats> {
  const params = new URLSearchParams();
  if (filters.sport) params.set("sport", filters.sport);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  const res = await fetch(`/api/bets/stats?${params.toString()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch stats");
  return data.stats;
}

async function createBet(input: CreateBetInput): Promise<Bet> {
  const res = await fetch("/api/bets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to create bet");
  return data.bet;
}

async function deleteBet(id: string): Promise<void> {
  const res = await fetch(`/api/bets/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to delete bet");
}

async function gradeBet(
  id: string,
  result: string,
): Promise<Bet> {
  const res = await fetch(`/api/bets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to grade bet");
  return data.bet;
}

// ─── Hooks ────────────────────────────────────────────────────────────────

export function useBets(filters: BetFilters = {}) {
  return useQuery({
    queryKey: ["bets", filters],
    queryFn: () => fetchBets(filters),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useBetStats(
  filters: { sport?: string; from?: string; to?: string } = {},
) {
  return useQuery({
    queryKey: ["bet-stats", filters],
    queryFn: () => fetchBetStats(filters),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateBet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bets"] });
      queryClient.invalidateQueries({ queryKey: ["bet-stats"] });
    },
  });
}

export function useDeleteBet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bets"] });
      queryClient.invalidateQueries({ queryKey: ["bet-stats"] });
    },
  });
}

export function useGradeBet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, result }: { id: string; result: string }) =>
      gradeBet(id, result),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bets"] });
      queryClient.invalidateQueries({ queryKey: ["bet-stats"] });
    },
  });
}
