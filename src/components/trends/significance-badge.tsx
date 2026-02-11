"use client";

interface SignificanceBadgeProps {
  strength: "strong" | "moderate" | "weak" | "noise";
  label?: string;
  size?: "sm" | "md";
}

const strengthConfig = {
  strong: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/25",
    dot: "bg-emerald-400",
    glow: "shadow-[0_0_8px_hsl(142_71%_45%/0.3)]",
    pulse: "animate-pulse-glow",
    label: "Strong",
  },
  moderate: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/25",
    dot: "bg-blue-400",
    glow: "",
    pulse: "",
    label: "Moderate",
  },
  weak: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/25",
    dot: "bg-amber-400",
    glow: "",
    pulse: "",
    label: "Weak",
  },
  noise: {
    bg: "bg-zinc-500/8",
    text: "text-zinc-500",
    border: "border-zinc-500/20",
    dot: "bg-zinc-500",
    glow: "",
    pulse: "",
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
    size === "sm"
      ? "px-2.5 py-0.5 text-[11px] gap-1.5"
      : "px-3 py-1 text-xs gap-2";

  return (
    <span
      className={`inline-flex items-center rounded-full border backdrop-blur-sm ${config.bg} ${config.border} ${config.text} ${config.glow} ${sizeClasses} font-medium tracking-wide uppercase`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${config.pulse} shrink-0`}
      />
      {label || config.label}
    </span>
  );
}
