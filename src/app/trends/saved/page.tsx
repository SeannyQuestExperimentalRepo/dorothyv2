"use client";

import Link from "next/link";
import {
  useSavedTrends,
  useDeleteSavedTrend,
  useUpdateSavedTrend,
  type SavedTrend,
} from "@/hooks/use-saved-trends";

function TrendCard({ trend, onDelete }: { trend: SavedTrend; onDelete: () => void }) {
  const deleteMutation = useDeleteSavedTrend();
  const updateMutation = useUpdateSavedTrend();
  const isDeleting = deleteMutation.isPending;

  const handleDelete = () => {
    if (!confirm(`Delete "${trend.name}"?`)) return;
    deleteMutation.mutate(trend.id, { onSuccess: onDelete });
  };

  const handleToggleEmail = () => {
    updateMutation.mutate({ id: trend.id, notifyEmail: !trend.notifyEmail });
  };

  const handleTogglePublic = () => {
    updateMutation.mutate({ id: trend.id, isPublic: !trend.isPublic });
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{trend.name}</h3>
          {trend.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{trend.description}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground/70">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
              {trend.sport}
            </span>
            {trend.lastTriggered && (
              <span>
                Last matched:{" "}
                {new Date(trend.lastTriggered).toLocaleDateString()}
              </span>
            )}
            <span>
              Created {new Date(trend.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTogglePublic}
            disabled={updateMutation.isPending}
            title={trend.isPublic ? "Visible on community page" : "Private — only you can see"}
            className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              trend.isPublic
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                : "border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {trend.isPublic ? "Public" : "Private"}
          </button>
          <button
            onClick={handleToggleEmail}
            disabled={updateMutation.isPending}
            title={trend.notifyEmail ? "Email alerts on" : "Email alerts off"}
            className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              trend.notifyEmail
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {trend.notifyEmail ? "Email On" : "Email Off"}
          </button>
          <Link
            href={`/trends?replay=${trend.id}`}
            className="rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary"
          >
            Run
          </Link>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
          >
            {isDeleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SavedTrendsPage() {
  const { data: trends, isLoading, error, refetch } = useSavedTrends();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Saved Trends</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your bookmarked trend queries. Run anytime to see updated results.
          </p>
        </div>
        <Link
          href="/trends"
          className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Search Trends
        </Link>
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        </div>
      )}

      {!isLoading && trends && trends.length === 0 && (
        <div className="rounded-xl border border-border/40 bg-card px-6 py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            No saved trends yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground/60">
            Search for a trend and click &quot;Save&quot; to bookmark it here.
          </p>
          <Link
            href="/trends"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Explore Trends
          </Link>
        </div>
      )}

      {!isLoading && trends && trends.length > 0 && (
        <div className="space-y-3">
          {trends.map((t) => (
            <TrendCard key={t.id} trend={t} onDelete={() => refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
