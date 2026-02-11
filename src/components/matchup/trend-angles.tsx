"use client";

import { SignificanceBadge } from "@/components/trends/significance-badge";

interface SituationalAngle {
  description: string;
  favors: "home" | "away" | "over" | "under" | "neutral";
  record: string;
  rate: number;
  sampleSize: number;
  significance: {
    strength: "strong" | "moderate" | "weak" | "noise";
    label: string;
    pValue: number;
    observedRate: number;
    baselineRate: number;
    confidenceInterval: [number, number];
    zScore: number;
    sampleSize: number;
    isSignificant: boolean;
  };
}

interface AdditionalTrend {
  label: string;
  description: string;
  record: string;
  rate: number;
  sampleSize: number;
  strength: "strong" | "moderate" | "weak" | "noise";
  favors: "home" | "away" | "over" | "under" | "neutral";
}

interface TrendAnglesProps {
  situationalAngles?: SituationalAngle[];
  additionalTrends?: AdditionalTrend[];
  homeTeam: string;
  awayTeam: string;
}

function getFavorsLabel(
  favors: string,
  homeTeam: string,
  awayTeam: string,
): string {
  switch (favors) {
    case "home":
      return homeTeam;
    case "away":
      return awayTeam;
    case "over":
      return "Over";
    case "under":
      return "Under";
    default:
      return "Neutral";
  }
}

function getFavorsColor(favors: string): string {
  switch (favors) {
    case "home":
      return "text-emerald-400";
    case "away":
      return "text-blue-400";
    case "over":
      return "text-amber-400";
    case "under":
      return "text-purple-400";
    default:
      return "text-muted-foreground";
  }
}

export function TrendAngles({
  situationalAngles,
  additionalTrends,
  homeTeam,
  awayTeam,
}: TrendAnglesProps) {
  const hasAngles = situationalAngles && situationalAngles.length > 0;
  const hasTrends = additionalTrends && additionalTrends.length > 0;

  if (!hasAngles && !hasTrends) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
        Trend Angles
      </h3>

      <div className="space-y-3">
        {/* Situational angles from the context engine */}
        {situationalAngles?.map((angle, i) => (
          <div
            key={`sit-${i}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{angle.description}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {angle.record}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({angle.rate}%)
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  n={angle.sampleSize}
                </span>
              </div>
              <p className={`mt-1 text-xs font-medium ${getFavorsColor(angle.favors)}`}>
                Favors {getFavorsLabel(angle.favors, homeTeam, awayTeam)}
              </p>
            </div>
            <SignificanceBadge strength={angle.significance.strength} />
          </div>
        ))}

        {/* Additional trend queries */}
        {additionalTrends
          ?.filter((t) => t.strength !== "noise")
          .map((trend, i) => (
            <div
              key={`add-${i}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{trend.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {trend.description}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {trend.record}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({trend.rate}%)
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    n={trend.sampleSize}
                  </span>
                </div>
                <p className={`mt-1 text-xs font-medium ${getFavorsColor(trend.favors)}`}>
                  Favors {getFavorsLabel(trend.favors, homeTeam, awayTeam)}
                </p>
              </div>
              <SignificanceBadge strength={trend.strength} />
            </div>
          ))}

        {/* If no non-noise trends */}
        {!hasAngles && additionalTrends?.every((t) => t.strength === "noise") && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No statistically significant trend angles found for this matchup.
          </p>
        )}
      </div>
    </div>
  );
}
