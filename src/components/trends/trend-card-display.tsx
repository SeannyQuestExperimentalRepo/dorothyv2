"use client";

import { SignificanceBadge } from "./significance-badge";
import { StreakDots } from "./streak-dots";

interface TrendCardData {
  id: string;
  type: "game" | "player" | "prop";
  headline: string;
  subtitle: string;
  heroStat: {
    value: string;
    label: string;
    sentiment: "positive" | "negative" | "neutral";
  };
  supportingStats: { value: string; label: string }[];
  streakDots: boolean[];
  significance: {
    strength: "strong" | "moderate" | "weak" | "noise";
    label: string;
    confidenceRange: string;
  };
  tags: string[];
  meta: {
    sport: string;
    sampleSize: number;
    seasonRange: string;
    generatedAt: string;
    shareParam: string;
  };
}

interface TrendCardDisplayProps {
  card: TrendCardData;
  compact?: boolean;
}

const sentimentColor = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  neutral: "text-foreground",
};

const typeIcon = {
  game: "\ud83c\udfc8",
  player: "\ud83c\udfc3",
  prop: "\ud83c\udfaf",
};

export function TrendCardDisplay({
  card,
  compact = false,
}: TrendCardDisplayProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-card/80 shadow-lg">
      {/* Header */}
      <div className="border-b border-border/50 px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm">{typeIcon[card.type]}</span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {card.meta.sport} {card.type} trend
              </span>
            </div>
            <h3 className="mt-0.5 truncate text-base font-bold leading-tight">
              {card.headline}
            </h3>
            <p className="text-xs text-muted-foreground">{card.subtitle}</p>
          </div>
          <SignificanceBadge strength={card.significance.strength} />
        </div>
      </div>

      {/* Hero Stat */}
      <div className="px-5 py-4">
        <div className="text-center">
          <p
            className={`text-4xl font-black tabular-nums ${sentimentColor[card.heroStat.sentiment]}`}
          >
            {card.heroStat.value}
          </p>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.heroStat.label}
          </p>
        </div>

        {/* Supporting Stats */}
        {!compact && card.supportingStats.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {card.supportingStats.map((stat, i) => (
              <div key={i} className="text-center">
                <p className="text-lg font-bold tabular-nums">{stat.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Streak */}
        {card.streakDots.length > 0 && (
          <div className="mt-4 flex justify-center">
            <StreakDots dots={card.streakDots} label="Recent" max={10} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/50 bg-secondary/30 px-5 py-2">
        <div className="flex flex-wrap gap-1.5">
          {card.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>n={card.meta.sampleSize}</span>
          <span>{card.meta.seasonRange}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Grid of trend cards.
 */
export function TrendCardGrid({ cards }: { cards: TrendCardData[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <TrendCardDisplay key={card.id} card={card} />
      ))}
    </div>
  );
}
