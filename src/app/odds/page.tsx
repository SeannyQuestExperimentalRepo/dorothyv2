"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { OddsComparison } from "@/components/odds/odds-comparison";

const SignificantMovesCard = dynamic(
  () => import("@/components/significant-moves-card").then((m) => m.SignificantMovesCard),
  { ssr: false }
);

const SPORTS = ["NCAAMB", "NBA", "NFL", "NCAAF"] as const;

/** Pick the sport most likely to have games today */
function defaultSport(): string {
  const m = new Date().getMonth();
  if (m >= 10 || m <= 2) return "NCAAMB";
  if (m >= 9 || m <= 5) return "NBA";
  if (m >= 8) return "NFL";
  return "NFL";
}

export default function OddsPage() {
  const [sport, setSport] = useState<string>(defaultSport);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Odds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare lines across sportsbooks
          </p>
        </div>
        <div className="flex rounded-lg border border-border/60 bg-card">
          {SPORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`px-4 py-2 text-sm font-medium transition-all first:rounded-l-lg last:rounded-r-lg ${
                sport === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <SignificantMovesCard sport={sport} />

      <div className="mt-6">
        <OddsComparison sport={sport} />
      </div>
    </div>
  );
}
