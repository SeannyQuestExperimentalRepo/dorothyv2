/**
 * ESPN Injuries Client
 *
 * Fetches current injury reports from ESPN's unofficial injuries endpoint.
 * No database storage — data is fetched live and cached at the CDN layer.
 *
 * Covers NFL, NCAAF, and NCAAMB.
 */

import type { Sport } from "./espn-api";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InjuryStatus =
  | "Out"
  | "Doubtful"
  | "Questionable"
  | "Probable"
  | "Injured Reserve"
  | "Day-To-Day";

export interface Injury {
  playerName: string;
  position: string;
  status: InjuryStatus;
  shortComment: string;
  date: string;
}

export interface TeamInjuries {
  team: string;
  injuries: Injury[];
}

// ─── ESPN URL Config ────────────────────────────────────────────────────────

const INJURY_URLS: Record<Sport, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/injuries",
  NCAAMB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/injuries",
};

const FETCH_TIMEOUT = 10_000;
const MAX_RETRIES = 3;

/** Severity order for sorting (lower = more severe) */
const STATUS_SEVERITY: Record<InjuryStatus, number> = {
  Out: 0,
  "Injured Reserve": 1,
  Doubtful: 2,
  Questionable: 3,
  Probable: 4,
  "Day-To-Day": 5,
};

// ─── ESPN Raw Types ─────────────────────────────────────────────────────────

interface ESPNInjuriesResponse {
  injuries?: ESPNTeamInjuries[];
}

interface ESPNTeamInjuries {
  team?: {
    displayName?: string;
  };
  injuries?: ESPNInjuryEntry[];
}

interface ESPNInjuryEntry {
  athlete?: {
    displayName?: string;
    position?: {
      abbreviation?: string;
    };
  };
  status?: string;
  date?: string;
  type?: {
    description?: string;
  };
  shortComment?: string;
}

// ─── Fetch Helper ───────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, retries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "TrendLine/1.0" },
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(`ESPN Injuries API ${res.status}: ${res.statusText}`);
        }
        throw new Error(`ESPN Injuries API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes("ESPN Injuries API 4") && !lastError.message.includes("429")) {
        throw lastError;
      }
      if (attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(
          `[ESPN Injuries] Fetch attempt ${attempt + 1}/${retries} failed, retrying in ${delay}ms:`,
          lastError.message,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("ESPN Injuries API fetch failed after retries");
}

// ─── Statuses to exclude (not actual injuries) ─────────────────────────────

const EXCLUDED_STATUSES = new Set(["Active"]);

const VALID_STATUSES = new Set<InjuryStatus>([
  "Out",
  "Doubtful",
  "Questionable",
  "Probable",
  "Injured Reserve",
  "Day-To-Day",
]);

function normalizeStatus(raw: string): InjuryStatus | null {
  if (EXCLUDED_STATUSES.has(raw)) return null;
  if (VALID_STATUSES.has(raw as InjuryStatus)) return raw as InjuryStatus;
  // Handle variants like "Injury Reserve" or lowercase
  const lower = raw.toLowerCase();
  if (lower.includes("out")) return "Out";
  if (lower.includes("doubtful")) return "Doubtful";
  if (lower.includes("questionable")) return "Questionable";
  if (lower.includes("probable")) return "Probable";
  if (lower.includes("injured reserve") || lower === "ir") return "Injured Reserve";
  if (lower.includes("day-to-day") || lower.includes("day to day")) return "Day-To-Day";
  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all injury reports for a sport from ESPN.
 */
export async function fetchInjuries(sport: Sport): Promise<TeamInjuries[]> {
  const url = INJURY_URLS[sport];

  try {
    const data = await fetchJSON<ESPNInjuriesResponse>(url);
    if (!data.injuries) return [];

    return data.injuries
      .map((teamEntry): TeamInjuries | null => {
        const teamName = teamEntry.team?.displayName;
        if (!teamName) return null;

        const injuries = (teamEntry.injuries ?? [])
          .map((entry): Injury | null => {
            const playerName = entry.athlete?.displayName;
            if (!playerName) return null;

            const rawStatus = entry.status ?? "";
            const status = normalizeStatus(rawStatus);
            if (!status) return null;

            return {
              playerName,
              position: entry.athlete?.position?.abbreviation ?? "",
              status,
              shortComment: entry.shortComment ?? entry.type?.description ?? "",
              date: entry.date ?? "",
            };
          })
          .filter((i): i is Injury => i !== null)
          .sort((a, b) => (STATUS_SEVERITY[a.status] ?? 99) - (STATUS_SEVERITY[b.status] ?? 99));

        return { team: teamName, injuries };
      })
      .filter((t): t is TeamInjuries => t !== null);
  } catch (err) {
    console.error(`[ESPN Injuries] Fetch failed for ${sport}:`, err);
    return [];
  }
}

/**
 * Get injuries for a specific team from the full injury list.
 * Uses case-insensitive substring matching to handle name differences
 * (e.g., ESPN "Kansas City Chiefs" vs our "Kansas City Chiefs").
 */
export function getInjuriesForTeam(
  allInjuries: TeamInjuries[],
  teamName: string,
): Injury[] {
  const lower = teamName.toLowerCase();

  // Try exact match first
  const exact = allInjuries.find(
    (t) => t.team.toLowerCase() === lower,
  );
  if (exact) return exact.injuries;

  // Try substring match (e.g., "Kansas City" matches "Kansas City Chiefs")
  const partial = allInjuries.find(
    (t) =>
      t.team.toLowerCase().includes(lower) ||
      lower.includes(t.team.toLowerCase()),
  );
  if (partial) return partial.injuries;

  return [];
}
