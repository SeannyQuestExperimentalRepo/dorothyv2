"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "trendline-sport";
const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];
const DEFAULT_SPORT = "NCAAMB";

export function useSportSelection(fallback?: string) {
  const [sport, setSportState] = useState<string>(() => {
    if (typeof window === "undefined") return fallback || DEFAULT_SPORT;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_SPORTS.includes(stored)) return stored;
    return fallback || DEFAULT_SPORT;
  });

  // Sync to localStorage when sport changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, sport);
    }
  }, [sport]);

  const setSport = useCallback((s: string) => {
    if (VALID_SPORTS.includes(s)) {
      setSportState(s);
    }
  }, []);

  return { sport, setSport } as const;
}
