"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  sentiment?: "positive" | "negative" | "neutral";
  size?: "sm" | "lg";
}

export function StatCard({
  label,
  value,
  subtext,
  sentiment = "neutral",
  size = "sm",
}: StatCardProps) {
  const sentimentColor = {
    positive: "text-emerald-400",
    negative: "text-red-400",
    neutral: "text-foreground",
  };

  return (
    <div className="glass-card gradient-border rounded-lg p-4 transition-colors">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={`${size === "lg" ? "mt-1.5 text-3xl" : "mt-1 text-2xl"} font-bold font-mono tabular-nums tracking-tight number-reveal ${sentimentColor[sentiment]}`}
      >
        {value}
      </p>
      {subtext && (
        <p className="mt-1 text-[11px] text-muted-foreground tracking-wide">
          {subtext}
        </p>
      )}
    </div>
  );
}
