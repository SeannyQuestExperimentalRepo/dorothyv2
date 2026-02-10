"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignificanceBadge } from "@/components/trends/significance-badge";
import { useAngles } from "@/hooks/use-angles";

interface DiscoveredAngle {
  id: string;
  label: string;
  headline: string;
  category: string;
  sport: string;
  record: {
    wins: number;
    losses: number;
    winPct: number;
    atsCovered: number;
    atsLost: number;
    atsPush: number;
    atsPct: number;
    atsRecord: string;
    overs: number;
    unders: number;
    overPct: number;
    ouRecord: string;
    avgMargin: number;
    avgSpread: number | null;
    avgTotalPoints: number;
    totalGames: number;
  };
  atsSignificance: {
    strength: "strong" | "moderate" | "weak" | "noise";
    pValue: number;
    zScore: number;
    observedRate: number;
    label: string;
    sampleSize: number;
    confidenceInterval: [number, number];
  };
  interestScore: number;
}

type SportFilter = "NFL" | "NCAAF" | "NCAAMB";
type StrengthFilter = "all" | "strong" | "moderate" | "weak";

export default function TrendsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <TrendsPageInner />
    </Suspense>
  );
}

function TrendsPageInner() {
  const searchParams = useSearchParams();
  const sportParam = searchParams.get("sport");
  const initialSport: SportFilter =
    sportParam === "NCAAF" || sportParam === "NCAAMB" ? sportParam : "NFL";

  const [sport, setSport] = useState<SportFilter>(initialSport);
  const [minStrength, setMinStrength] = useState<StrengthFilter>("all");
  const [team, setTeam] = useState("");
  // Track submitted params separately so query only fires on Discover click
  const [submittedParams, setSubmittedParams] = useState({
    sport: initialSport as string,
    team: "",
    minStrength: undefined as string | undefined,
  });

  const { data, isLoading: loading, error: queryError, isFetched } = useAngles(submittedParams);
  const angles: DiscoveredAngle[] = data?.angles ?? [];
  const error = queryError ? (queryError as Error).message : null;

  const discover = () => {
    setSubmittedParams({
      sport,
      team: team.trim() || "",
      minStrength: minStrength !== "all" ? minStrength : undefined,
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Discover Trends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-discover the most statistically significant betting angles across
          45+ templates
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        {/* Sport */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Sport
          </label>
          <div className="flex rounded-lg border border-border">
            {(["NFL", "NCAAF", "NCAAMB"] as SportFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSport(s)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  sport === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Team */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Team (optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Kansas City Chiefs"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && discover()}
          />
        </div>

        {/* Min Strength */}
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Min Strength
          </label>
          <select
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none"
            value={minStrength}
            onChange={(e) =>
              setMinStrength(e.target.value as StrengthFilter)
            }
          >
            <option value="all">All</option>
            <option value="weak">Weak+</option>
            <option value="moderate">Moderate+</option>
            <option value="strong">Strong only</option>
          </select>
        </div>

        {/* Search */}
        <button
          onClick={discover}
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Scanning..." : "Discover"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Scanning 45+ angle templates for {sport}...
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && angles.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Found {angles.length} notable angles
          </p>
          {angles.map((angle, i) => (
            <AngleCard key={i} angle={angle} rank={i + 1} />
          ))}
        </div>
      )}

      {/* No Results */}
      {!loading && isFetched && angles.length === 0 && !error && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            No significant angles found. Try a different sport or team.
          </p>
        </div>
      )}
    </div>
  );
}

function AngleCard({
  angle,
  rank,
}: {
  angle: DiscoveredAngle;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="cursor-pointer rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        {/* Rank */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {rank}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold leading-tight">{angle.headline}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {angle.label}
              </p>
            </div>
            <SignificanceBadge
              strength={angle.atsSignificance.strength}
            />
          </div>

          {/* Key stats row */}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">ATS: </span>
              <span
                className={`font-semibold tabular-nums ${
                  angle.record.atsPct >= 55
                    ? "text-emerald-400"
                    : angle.record.atsPct <= 45
                      ? "text-red-400"
                      : ""
                }`}
              >
                {angle.record.atsRecord} ({angle.record.atsPct}%)
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Record: </span>
              <span className="font-medium tabular-nums">
                {angle.record.wins}-{angle.record.losses} (
                {angle.record.winPct}%)
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">O/U: </span>
              <span className="tabular-nums">
                {angle.record.ouRecord} ({angle.record.overPct}% over)
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">n=</span>
              <span className="tabular-nums">
                {angle.record.totalGames}
              </span>
            </div>
          </div>
        </div>

        {/* Expand arrow */}
        <svg
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m19.5 8.25-7.5 7.5-7.5-7.5"
          />
        </svg>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border/50 px-5 py-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                ATS Significance
              </h4>
              <p className="text-muted-foreground">
                {angle.atsSignificance.label}
              </p>
              <p className="mt-1 tabular-nums text-muted-foreground">
                p = {angle.atsSignificance.pValue < 0.001 ? "<0.001" : angle.atsSignificance.pValue.toFixed(3)}
                {" \u00b7 "}z = {angle.atsSignificance.zScore.toFixed(2)}
              </p>
              <p className="tabular-nums text-muted-foreground">
                95% CI: [{(angle.atsSignificance.confidenceInterval[0] * 100).toFixed(1)}
                %, {(angle.atsSignificance.confidenceInterval[1] * 100).toFixed(1)}%]
              </p>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Scoring
              </h4>
              <p className="text-muted-foreground">
                Avg margin:{" "}
                {angle.record.avgMargin > 0 ? "+" : ""}
                {angle.record.avgMargin.toFixed(1)}
              </p>
              <p className="text-muted-foreground">
                Avg total: {angle.record.avgTotalPoints.toFixed(1)}
              </p>
              {angle.record.avgSpread !== null && (
                <p className="text-muted-foreground">
                  Avg spread: {angle.record.avgSpread.toFixed(1)}
                </p>
              )}
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Category
              </h4>
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {angle.category}
              </span>
              <p className="mt-2 tabular-nums text-muted-foreground">
                Interest score:{" "}
                {Math.round(angle.interestScore)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
