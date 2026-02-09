"use client";

interface StreakDotsProps {
  /** true = hit/win, false = miss/loss. Most recent first. */
  dots: boolean[];
  /** Maximum dots to show */
  max?: number;
  label?: string;
}

export function StreakDots({ dots, max = 10, label }: StreakDotsProps) {
  const visible = dots.slice(0, max);

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <div className="flex items-center gap-0.5">
        {visible.map((hit, i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full ${
              hit ? "bg-emerald-400" : "bg-red-400"
            }`}
            title={`Game ${i + 1}: ${hit ? "Hit" : "Miss"}`}
          />
        ))}
      </div>
      {dots.length > max && (
        <span className="text-xs text-muted-foreground">
          +{dots.length - max}
        </span>
      )}
    </div>
  );
}
