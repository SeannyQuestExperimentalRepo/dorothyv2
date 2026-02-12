"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

interface PublicTrend {
  id: number;
  name: string;
  sport: string;
  description: string | null;
  lastTriggered: string | null;
  createdAt: string;
  authorName: string;
  authorImage: string | null;
}

async function fetchPublicTrends(sport?: string): Promise<PublicTrend[]> {
  const params = sport ? `?sport=${sport}` : "";
  const res = await fetch(`/api/trends/public${params}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to fetch");
  return data.trends;
}

const SPORTS = [
  { key: "", label: "All" },
  { key: "NCAAMB", label: "NCAAMB" },
  { key: "NBA", label: "NBA" },
  { key: "NFL", label: "NFL" },
  { key: "NCAAF", label: "NCAAF" },
];

export default function CommunityPage() {
  const [sport, setSport] = useState("");

  const { data: trends, isLoading, error } = useQuery({
    queryKey: ["public-trends", sport],
    queryFn: () => fetchPublicTrends(sport || undefined),
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Community Trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore trends shared by the TrendLine community. Toggle yours public from{" "}
          <Link href="/trends/saved" className="text-primary hover:underline">
            Saved Trends
          </Link>
          .
        </p>
      </div>

      {/* Sport filter tabs */}
      <div className="mb-6 flex gap-2">
        {SPORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSport(s.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              sport === s.key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/40 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {s.label}
          </button>
        ))}
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
            No public trends yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground/60">
            Be the first! Save a trend and toggle it to public.
          </p>
        </div>
      )}

      {!isLoading && trends && trends.length > 0 && (
        <div className="space-y-3">
          {trends.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/25"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{t.name}</h3>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground/70">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      {t.sport}
                    </span>
                    <span>by {t.authorName}</span>
                    {t.lastTriggered && (
                      <span>
                        Last matched:{" "}
                        {new Date(t.lastTriggered).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
