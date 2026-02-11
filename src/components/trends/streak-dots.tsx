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
    <div className="flex items-center gap-2.5">
      {label && (
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1">
        {visible.map((hit, i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full transition-colors ${
              hit
                ? "bg-emerald-400 shadow-[0_0_6px_hsl(142_71%_45%/0.4)]"
                : "bg-red-400/80 shadow-[0_0_6px_hsl(0_80%_58%/0.3)]"
            }`}
            title={`Game ${i + 1}: ${hit ? "Hit" : "Miss"}`}
          />
        ))}
      </div>
      {dots.length > max && (
        <span className="text-[11px] font-mono text-muted-foreground">
          +{dots.length - max}
        </span>
      )}
    </div>
  );
}
