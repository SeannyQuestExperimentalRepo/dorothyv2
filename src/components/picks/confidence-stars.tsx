"use client";

interface ConfidenceStarsProps {
  confidence: number; // 3, 4, or 5
  size?: "sm" | "md";
}

const colorMap: Record<number, { filled: string; glow: string }> = {
  5: {
    filled: "text-accent drop-shadow-[0_0_6px_hsl(45_95%_55%/0.6)]",
    glow: "shadow-[0_0_12px_hsl(45_95%_55%/0.2)]",
  },
  4: {
    filled: "text-blue-400 drop-shadow-[0_0_4px_hsl(217_91%_60%/0.4)]",
    glow: "",
  },
  3: {
    filled: "text-amber-400",
    glow: "",
  },
};

const fallback = { filled: "text-zinc-400", glow: "" };

export function ConfidenceStars({ confidence, size = "sm" }: ConfidenceStarsProps) {
  const config = colorMap[confidence] || fallback;
  const starSize = size === "sm" ? "text-sm" : "text-base";

  return (
    <span
      className={`inline-flex gap-0.5 ${starSize} ${config.glow} rounded-sm`}
      title={`${confidence}-star confidence`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={
            i < confidence
              ? `${config.filled} transition-transform hover:scale-110`
              : "text-zinc-700/50"
          }
        >
          ★
        </span>
      ))}
    </span>
  );
}
