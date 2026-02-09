"use client";

interface SignificanceBadgeProps {
  strength: "strong" | "moderate" | "weak" | "noise";
  label?: string;
  size?: "sm" | "md";
}

const strengthConfig = {
  strong: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
    label: "Strong",
  },
  moderate: {
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
    label: "Moderate",
  },
  weak: {
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
    label: "Weak",
  },
  noise: {
    bg: "bg-zinc-500/15",
    text: "text-zinc-400",
    border: "border-zinc-500/30",
    dot: "bg-zinc-500",
    label: "Noise",
  },
};

export function SignificanceBadge({
  strength,
  label,
  size = "sm",
}: SignificanceBadgeProps) {
  const config = strengthConfig[strength];
  const sizeClasses =
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${config.bg} ${config.border} ${config.text} ${sizeClasses} font-medium`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {label || config.label}
    </span>
  );
}
