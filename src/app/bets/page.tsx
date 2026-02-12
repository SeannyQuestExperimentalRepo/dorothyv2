"use client";

import { useState } from "react";
import {
  useBets,
  useBetStats,
  useCreateBet,
  useDeleteBet,
  useGradeBet,
} from "@/hooks/use-bets";
import type { Bet, CreateBetInput } from "@/hooks/use-bets";

const SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"] as const;
const BET_TYPES = [
  "SPREAD",
  "OVER_UNDER",
  "MONEYLINE",
  "PLAYER_PROP",
  "PARLAY",
  "TEASER",
] as const;
const SPORTSBOOKS = [
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "Caesars",
  "ESPN BET",
  "Other",
] as const;

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatOdds(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function resultColor(result: string): string {
  if (result === "WIN") return "text-emerald-400";
  if (result === "LOSS") return "text-red-400";
  if (result === "PUSH") return "text-yellow-400";
  return "text-muted-foreground";
}

function profitColor(profit: number | null): string {
  if (profit === null) return "text-muted-foreground";
  if (profit > 0) return "text-emerald-400";
  if (profit < 0) return "text-red-400";
  return "text-muted-foreground";
}

// ─── Stats Summary ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subtext,
  colorClass,
}: {
  label: string;
  value: string;
  subtext?: string;
  colorClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${colorClass || ""}`}>{value}</p>
      {subtext && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
      )}
    </div>
  );
}

// ─── Add Bet Form ─────────────────────────────────────────────────────────

function AddBetForm({ onClose }: { onClose: () => void }) {
  const createBet = useCreateBet();
  const [form, setForm] = useState<Partial<CreateBetInput>>({
    sport: "NFL",
    betType: "SPREAD",
    oddsValue: -110,
    stake: 100,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.sport ||
      !form.betType ||
      !form.gameDate ||
      !form.homeTeam ||
      !form.awayTeam ||
      !form.pickSide ||
      !form.stake
    )
      return;

    await createBet.mutateAsync(form as CreateBetInput);
    onClose();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border/60 bg-card p-4"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Add Bet</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Sport
          </span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.sport}
            onChange={(e) => setForm({ ...form, sport: e.target.value })}
          >
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Bet Type
          </span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.betType}
            onChange={(e) => setForm({ ...form, betType: e.target.value })}
          >
            {BET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Game Date
          </span>
          <input
            type="date"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.gameDate || ""}
            onChange={(e) => setForm({ ...form, gameDate: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Home Team
          </span>
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="e.g. Chiefs"
            value={form.homeTeam || ""}
            onChange={(e) => setForm({ ...form, homeTeam: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Away Team
          </span>
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="e.g. Bills"
            value={form.awayTeam || ""}
            onChange={(e) => setForm({ ...form, awayTeam: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Pick Side
          </span>
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="home / away / over / under"
            value={form.pickSide || ""}
            onChange={(e) => setForm({ ...form, pickSide: e.target.value })}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Line</span>
          <input
            type="number"
            step="0.5"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.line ?? ""}
            onChange={(e) =>
              setForm({ ...form, line: e.target.value ? parseFloat(e.target.value) : undefined })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Odds</span>
          <input
            type="number"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.oddsValue ?? -110}
            onChange={(e) =>
              setForm({ ...form, oddsValue: parseInt(e.target.value) || -110 })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Stake ($)
          </span>
          <input
            type="number"
            step="1"
            min="1"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.stake ?? 100}
            onChange={(e) =>
              setForm({ ...form, stake: parseFloat(e.target.value) || 0 })
            }
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Sportsbook
          </span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            value={form.sportsbook || ""}
            onChange={(e) =>
              setForm({ ...form, sportsbook: e.target.value || undefined })
            }
          >
            <option value="">Select...</option>
            {SPORTSBOOKS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-2 block sm:col-span-1">
          <span className="mb-1 block text-xs text-muted-foreground">
            Notes
          </span>
          <input
            type="text"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="Optional notes"
            value={form.notes || ""}
            onChange={(e) =>
              setForm({ ...form, notes: e.target.value || undefined })
            }
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={createBet.isPending}
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {createBet.isPending ? "Saving..." : "Add Bet"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      {createBet.isError && (
        <p className="mt-2 text-sm text-red-400">
          {(createBet.error as Error).message}
        </p>
      )}
    </form>
  );
}

// ─── Bet Row ──────────────────────────────────────────────────────────────

function BetRow({
  bet,
  onGrade,
  onDelete,
}: {
  bet: Bet;
  onGrade: (id: string, result: string) => void;
  onDelete: (id: string) => void;
}) {
  const matchup = `${bet.awayTeam} @ ${bet.homeTeam}`;
  const lineLabel =
    bet.betType === "OVER_UNDER"
      ? `${bet.pickSide === "over" ? "Over" : "Under"} ${bet.line}`
      : bet.betType === "MONEYLINE"
        ? `${bet.pickSide} ML`
        : `${bet.pickSide} ${bet.line != null ? (bet.line > 0 ? "+" : "") + bet.line : ""}`;

  return (
    <tr className="border-b border-border/30 hover:bg-muted/20">
      <td className="px-3 py-2 text-sm">{formatDate(bet.gameDate)}</td>
      <td className="px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">{bet.sport}</span>
        <br />
        {matchup}
      </td>
      <td className="px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">
          {bet.betType.replace("_", " ")}
        </span>
        <br />
        {lineLabel}
      </td>
      <td className="px-3 py-2 text-sm text-right">
        {formatOdds(bet.oddsValue)}
      </td>
      <td className="px-3 py-2 text-sm text-right">
        {formatCurrency(bet.stake)}
      </td>
      <td className={`px-3 py-2 text-sm font-medium ${resultColor(bet.result)}`}>
        {bet.result === "PENDING" ? (
          <div className="flex gap-1">
            <button
              onClick={() => onGrade(bet.id, "WIN")}
              className="rounded bg-emerald-700/30 px-1.5 py-0.5 text-xs text-emerald-400 hover:bg-emerald-700/50"
            >
              W
            </button>
            <button
              onClick={() => onGrade(bet.id, "LOSS")}
              className="rounded bg-red-700/30 px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-700/50"
            >
              L
            </button>
            <button
              onClick={() => onGrade(bet.id, "PUSH")}
              className="rounded bg-yellow-700/30 px-1.5 py-0.5 text-xs text-yellow-400 hover:bg-yellow-700/50"
            >
              P
            </button>
          </div>
        ) : (
          bet.result
        )}
      </td>
      <td className={`px-3 py-2 text-sm text-right font-mono ${profitColor(bet.profit)}`}>
        {bet.profit != null
          ? (bet.profit >= 0 ? "+" : "") + formatCurrency(bet.profit)
          : "—"}
      </td>
      <td className="px-3 py-2 text-sm">
        <button
          onClick={() => onDelete(bet.id)}
          className="text-muted-foreground/50 hover:text-red-400"
          title="Delete bet"
        >
          ×
        </button>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function BetsPage() {
  const [showForm, setShowForm] = useState(false);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [resultFilter, setResultFilter] = useState<string>("");

  const { data: betsData, isLoading: betsLoading } = useBets({
    sport: sportFilter || undefined,
    result: resultFilter || undefined,
    limit: 100,
  });
  const { data: stats, isLoading: statsLoading } = useBetStats({
    sport: sportFilter || undefined,
  });
  const gradeBet = useGradeBet();
  const deleteBet = useDeleteBet();

  const bets = betsData?.bets || [];

  const handleGrade = (id: string, result: string) => {
    gradeBet.mutate({ id, result });
  };

  const handleDelete = (id: string) => {
    deleteBet.mutate(id);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bet Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track, grade, and analyze your bets
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Add Bet
        </button>
      </div>

      {/* Add Bet Form */}
      {showForm && (
        <div className="mb-6">
          <AddBetForm onClose={() => setShowForm(false)} />
        </div>
      )}

      {/* Stats Summary */}
      {stats && !statsLoading && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard
            label="Record"
            value={`${stats.wins}-${stats.losses}-${stats.pushes}`}
            subtext={`${(stats.winRate * 100).toFixed(1)}% win rate`}
          />
          <StatCard
            label="ROI"
            value={`${(stats.roi * 100).toFixed(1)}%`}
            colorClass={stats.roi >= 0 ? "text-emerald-400" : "text-red-400"}
            subtext={`${formatCurrency(stats.totalStaked)} staked`}
          />
          <StatCard
            label="Profit"
            value={
              (stats.totalProfit >= 0 ? "+" : "") +
              formatCurrency(stats.totalProfit)
            }
            colorClass={
              stats.totalProfit >= 0 ? "text-emerald-400" : "text-red-400"
            }
          />
          <StatCard
            label="Streak"
            value={
              stats.currentStreak.type === "none"
                ? "—"
                : `${stats.currentStreak.count}${stats.currentStreak.type}`
            }
            colorClass={
              stats.currentStreak.type === "W"
                ? "text-emerald-400"
                : stats.currentStreak.type === "L"
                  ? "text-red-400"
                  : ""
            }
          />
          <StatCard
            label="Total Bets"
            value={stats.totalBets.toString()}
            subtext={`${stats.pendingBets} pending`}
          />
          <StatCard
            label="Best Day"
            value={
              stats.bestDay
                ? (stats.bestDay.profit >= 0 ? "+" : "") +
                  formatCurrency(stats.bestDay.profit)
                : "—"
            }
            subtext={stats.bestDay?.date}
            colorClass="text-emerald-400"
          />
        </div>
      )}

      {/* By Sport breakdown */}
      {stats && Object.keys(stats.bySport).length > 1 && (
        <div className="mb-6 rounded-lg border border-border/60 bg-card p-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            By Sport
          </h3>
          <div className="flex flex-wrap gap-4">
            {Object.entries(stats.bySport).map(([sport, data]) => {
              const roi =
                data.staked > 0
                  ? ((data.profit / data.staked) * 100).toFixed(1)
                  : "0.0";
              return (
                <div key={sport} className="text-sm">
                  <span className="font-medium">{sport}</span>{" "}
                  <span className="text-muted-foreground">
                    {data.w}-{data.l}-{data.p}
                  </span>{" "}
                  <span
                    className={
                      data.profit >= 0 ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {data.profit >= 0 ? "+" : ""}
                    {formatCurrency(data.profit)} ({roi}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="rounded border border-border bg-card px-2 py-1 text-sm"
          value={sportFilter}
          onChange={(e) => setSportFilter(e.target.value)}
        >
          <option value="">All Sports</option>
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-border bg-card px-2 py-1 text-sm"
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
        >
          <option value="">All Results</option>
          <option value="PENDING">Pending</option>
          <option value="WIN">Win</option>
          <option value="LOSS">Loss</option>
          <option value="PUSH">Push</option>
        </select>
      </div>

      {/* Bets Table */}
      {betsLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          Loading bets...
        </div>
      ) : bets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-12 text-center">
          <p className="text-muted-foreground">No bets yet</p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Click &quot;+ Add Bet&quot; to start tracking
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Matchup</th>
                <th className="px-3 py-2">Pick</th>
                <th className="px-3 py-2 text-right">Odds</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <BetRow
                  key={bet.id}
                  bet={bet}
                  onGrade={handleGrade}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
