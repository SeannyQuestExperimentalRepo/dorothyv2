import "server-only";

import * as fs from "fs";
import * as path from "path";
import { prisma } from "./db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NFLTeamEPAData {
  team: string;
  season: number;
  week: number;
  offEpaPerPlay: number;
  defEpaPerPlay: number;
  passEpa: number;
  rushEpa: number;
  successRate: number;
  cpoe: number;
  redZoneTdPct: number;
  thirdDownPct: number;
  explosivePlayRate: number;
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;
  confidence: number;
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
}

// ─── CSV Caching ────────────────────────────────────────────────────────────

const CACHE_DIR = "/tmp/nflverse";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function getCachePath(season: number): string {
  return path.join(CACHE_DIR, `team_stats_${season}.csv`);
}

function isCacheFresh(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function downloadCSV(season: number): Promise<string> {
  const cachePath = getCachePath(season);

  if (isCacheFresh(cachePath)) {
    return fs.readFileSync(cachePath, "utf-8");
  }

  const url = `https://github.com/nflverse/nflverse-data/releases/download/stats/team_stats_${season}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download nflverse CSV: ${res.status} ${url}`);

  const text = await res.text();

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, text, "utf-8");

  return text;
}

// ─── CSV Parsing ────────────────────────────────────────────────────────────

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function num(v: string | undefined): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? 0 : n;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function aggregateTeamStats(rows: Record<string, string>[]): Map<string, NFLTeamEPAData> {
  const teamMap = new Map<string, NFLTeamEPAData>();

  // The nflverse team_stats CSV has one row per team per week
  // We want the latest week's cumulative stats per team
  for (const row of rows) {
    const team = row["recent_team"] ?? row["team"] ?? "";
    const season = parseInt(row["season"] ?? "0");
    const week = parseInt(row["week"] ?? "0");
    if (!team || !season) continue;

    const existing = teamMap.get(team);
    // Keep the latest week
    if (existing && existing.week >= week) continue;

    // Map CSV columns to our structure
    // nflverse team_stats columns vary; use available fields
    const offEpa = num(row["offense_epa"]) || num(row["passing_epa"]) + num(row["rushing_epa"]);
    const plays = num(row["plays"]) || num(row["passing_attempts"]) + num(row["rushing_attempts"]) || 1;

    teamMap.set(team, {
      team,
      season,
      week,
      offEpaPerPlay: offEpa / plays || num(row["offense_epa_per_play"]) || 0,
      defEpaPerPlay: num(row["defense_epa_per_play"]) || num(row["defense_epa"]) / plays || 0,
      passEpa: num(row["passing_epa"]) || 0,
      rushEpa: num(row["rushing_epa"]) || 0,
      successRate: num(row["success_rate"]) || num(row["offense_success_rate"]) || 0,
      cpoe: num(row["cpoe"]) || num(row["passing_cpoe"]) || 0,
      redZoneTdPct: num(row["red_zone_td_pct"]) || 0,
      thirdDownPct: num(row["third_down_pct"]) || 0,
      explosivePlayRate: num(row["explosive_play_rate"]) ||
        num(row["passing_explosive_rate"]) || 0,
    });
  }

  return teamMap;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get NFL team EPA data for a season. Downloads & caches CSV from nflverse.
 */
export async function getNFLTeamEPA(
  season?: number
): Promise<Map<string, NFLTeamEPAData>> {
  const s = season ?? new Date().getFullYear();
  const csv = await downloadCSV(s);
  const rows = parseCSV(csv);
  return aggregateTeamStats(rows);
}

/**
 * Sync NFL team EPA data into the database (NFLTeamEPA table).
 */
export async function syncNFLTeamEPA(): Promise<void> {
  const season = new Date().getFullYear();
  const teamEPA = await getNFLTeamEPA(season);

  // Resolve team abbreviation → team ID
  const teams = await prisma.team.findMany({
    where: { sport: "NFL" },
    select: { id: true, abbreviation: true, name: true },
  });

  const abbrMap = new Map<string, number>();
  for (const t of teams) {
    abbrMap.set(t.abbreviation, t.id);
    abbrMap.set(t.name, t.id);
  }

  for (const [teamKey, epa] of Array.from(teamEPA)) {
    const teamId = abbrMap.get(teamKey);
    if (!teamId) {
      console.warn(`[nflverse] No team ID for "${teamKey}"`);
      continue;
    }

    await prisma.nFLTeamEPA.upsert({
      where: {
        teamId_season_week: {
          teamId,
          season: epa.season,
          week: epa.week,
        },
      },
      update: {
        offEpaPerPlay: epa.offEpaPerPlay,
        defEpaPerPlay: epa.defEpaPerPlay,
        passEpa: epa.passEpa,
        rushEpa: epa.rushEpa,
        successRate: epa.successRate,
        cpoe: epa.cpoe,
        redZoneTdPct: epa.redZoneTdPct,
        thirdDownPct: epa.thirdDownPct,
        explosivePlayRate: epa.explosivePlayRate,
      },
      create: {
        teamId,
        season: epa.season,
        week: epa.week,
        offEpaPerPlay: epa.offEpaPerPlay,
        defEpaPerPlay: epa.defEpaPerPlay,
        passEpa: epa.passEpa,
        rushEpa: epa.rushEpa,
        successRate: epa.successRate,
        cpoe: epa.cpoe,
        redZoneTdPct: epa.redZoneTdPct,
        thirdDownPct: epa.thirdDownPct,
        explosivePlayRate: epa.explosivePlayRate,
      },
    });
  }

  console.log(`[nflverse] Synced ${teamEPA.size} teams for season ${season}`);
}

// ─── EPA Signals ────────────────────────────────────────────────────────────

/**
 * Generate spread + O/U signals from EPA data.
 *
 * Spread: composite = offEPA * 0.6 + (-defEPA) * 0.4
 *   predicted margin = (homeComposite - awayComposite) * scaleFactor + 2.5 HCA
 *   signal direction based on comparison to market spread
 *
 * O/U: combined offensive vs defensive EPA, factor success rate + explosive plays
 */
export function signalNFLEPA(
  homeEPA: NFLTeamEPAData,
  awayEPA: NFLTeamEPAData,
  spread: number,
  overUnder: number
): { spread: SignalResult; ou: SignalResult } {
  // ─── Spread Signal ──────────────────────────────────────────────────
  const homeComposite = homeEPA.offEpaPerPlay * 0.6 + (-homeEPA.defEpaPerPlay) * 0.4;
  const awayComposite = awayEPA.offEpaPerPlay * 0.6 + (-awayEPA.defEpaPerPlay) * 0.4;

  // Scale EPA differential to points (rough: 0.1 EPA/play diff ≈ 7 points)
  const scaleFactor = 70;
  const HCA = 2.5;
  const predictedMargin = (homeComposite - awayComposite) * scaleFactor + HCA;

  // Spread is negative when home is favored
  // Edge = predicted margin vs spread (positive = home should cover)
  const spreadEdge = predictedMargin - (-spread);
  const absSpreadEdge = Math.abs(spreadEdge);

  const spreadMagnitude = Math.min(10, absSpreadEdge / 1.5);
  const spreadConfidence = Math.min(1, absSpreadEdge / 10);

  const spreadStrength: SignalResult["strength"] =
    spreadMagnitude >= 5 ? "strong" : spreadMagnitude >= 3 ? "moderate" :
    spreadMagnitude >= 1 ? "weak" : "noise";

  const spreadSignal: SignalResult = {
    category: "nflEPA",
    direction: spreadEdge > 0 ? "home" : spreadEdge < 0 ? "away" : "neutral",
    magnitude: Math.round(spreadMagnitude * 10) / 10,
    confidence: Math.round(spreadConfidence * 100) / 100,
    label: `EPA model: predicted margin ${predictedMargin > 0 ? "+" : ""}${predictedMargin.toFixed(1)} vs spread ${spread > 0 ? "+" : ""}${spread}`,
    strength: spreadStrength,
  };

  // ─── O/U Signal ─────────────────────────────────────────────────────
  // Higher combined offensive EPA + lower combined defensive EPA → over lean
  const combinedOffEPA = homeEPA.offEpaPerPlay + awayEPA.offEpaPerPlay;
  const combinedDefEPA = homeEPA.defEpaPerPlay + awayEPA.defEpaPerPlay; // lower = better D

  // Success rate and explosive play rate modifiers
  const avgSuccessRate = (homeEPA.successRate + awayEPA.successRate) / 2;
  const avgExplosive = (homeEPA.explosivePlayRate + awayEPA.explosivePlayRate) / 2;

  // Predicted total: baseline 45 + EPA adjustments
  const baseTotal = 45;
  const offAdjust = combinedOffEPA * scaleFactor; // positive EPA → more points
  const defAdjust = combinedDefEPA * scaleFactor; // positive defEPA = bad D → more points
  const successAdj = (avgSuccessRate - 0.45) * 20; // above avg success → more scoring
  const explosiveAdj = (avgExplosive - 0.08) * 30; // above avg explosive → more scoring

  const predictedTotal = baseTotal + offAdjust + defAdjust + successAdj + explosiveAdj;
  const ouEdge = predictedTotal - overUnder;
  const absOUEdge = Math.abs(ouEdge);

  const ouMagnitude = Math.min(10, absOUEdge / 2);
  const ouConfidence = Math.min(1, absOUEdge / 12);

  const ouStrength: SignalResult["strength"] =
    ouMagnitude >= 5 ? "strong" : ouMagnitude >= 3 ? "moderate" :
    ouMagnitude >= 1 ? "weak" : "noise";

  const ouSignal: SignalResult = {
    category: "nflEPA",
    direction: ouEdge > 0 ? "over" : ouEdge < 0 ? "under" : "neutral",
    magnitude: Math.round(ouMagnitude * 10) / 10,
    confidence: Math.round(ouConfidence * 100) / 100,
    label: `EPA model: predicted total ${predictedTotal.toFixed(1)} vs O/U ${overUnder}`,
    strength: ouStrength,
  };

  return { spread: spreadSignal, ou: ouSignal };
}
