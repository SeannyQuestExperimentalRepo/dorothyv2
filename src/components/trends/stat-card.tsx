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
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`${size === "lg" ? "mt-1 text-3xl" : "mt-0.5 text-2xl"} font-bold tabular-nums ${sentimentColor[sentiment]}`}
      >
        {value}
      </p>
      {subtext && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p>
      )}
    </div>
  );
}
