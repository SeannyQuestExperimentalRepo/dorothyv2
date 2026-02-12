/**
 * Line Movement Detection
 *
 * Analyzes OddsSnapshot data to detect significant line moves:
 * - Spread move > 1.0 point = significant
 * - Total move > 2.0 points = significant
 * - Reverse line movement (line moves against expected direction) = notable
 */

export interface SignificantMove {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  type: "spread" | "total";
  openingValue: number;
  currentValue: number;
  delta: number;
  direction: string; // e.g., "toward home", "toward away", "total dropped"
  isReverse: boolean;
  severity: "major" | "notable";
  detectedAt: string; // ISO string
}

interface SnapshotData {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  bestSpread: number | null;
  bestTotal: number | null;
  fetchedAt: Date;
}

const SPREAD_SIGNIFICANT_THRESHOLD = 1.0;
const SPREAD_MAJOR_THRESHOLD = 2.0;
const TOTAL_SIGNIFICANT_THRESHOLD = 2.0;
const TOTAL_MAJOR_THRESHOLD = 3.5;

export function detectSignificantMoves(
  snapshots: SnapshotData[],
): SignificantMove[] {
  if (snapshots.length < 2) return [];

  // Group by game
  const gameKey = (s: SnapshotData) => `${s.sport}|${s.homeTeam}|${s.awayTeam}`;
  const grouped = new Map<string, SnapshotData[]>();

  for (const s of snapshots) {
    const key = gameKey(s);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  const moves: SignificantMove[] = [];

  grouped.forEach((gameSnaps) => {
    if (gameSnaps.length < 2) return;

    const sorted = gameSnaps.sort((a: SnapshotData, b: SnapshotData) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    // Spread movement
    if (first.bestSpread != null && last.bestSpread != null) {
      const delta = last.bestSpread - first.bestSpread;
      const absDelta = Math.abs(delta);

      if (absDelta >= SPREAD_SIGNIFICANT_THRESHOLD) {
        const direction = delta < 0
          ? "toward home (home became more favored)"
          : "toward away (away became more favored)";

        moves.push({
          homeTeam: first.homeTeam,
          awayTeam: first.awayTeam,
          sport: first.sport,
          type: "spread",
          openingValue: first.bestSpread,
          currentValue: last.bestSpread,
          delta,
          direction,
          isReverse: false, // Would need public betting % to determine
          severity: absDelta >= SPREAD_MAJOR_THRESHOLD ? "major" : "notable",
          detectedAt: last.fetchedAt.toISOString(),
        });
      }
    }

    // Total movement
    if (first.bestTotal != null && last.bestTotal != null) {
      const delta = last.bestTotal - first.bestTotal;
      const absDelta = Math.abs(delta);

      if (absDelta >= TOTAL_SIGNIFICANT_THRESHOLD) {
        const direction = delta > 0 ? "total increased" : "total decreased";

        moves.push({
          homeTeam: first.homeTeam,
          awayTeam: first.awayTeam,
          sport: first.sport,
          type: "total",
          openingValue: first.bestTotal,
          currentValue: last.bestTotal,
          delta,
          direction,
          isReverse: false,
          severity: absDelta >= TOTAL_MAJOR_THRESHOLD ? "major" : "notable",
          detectedAt: last.fetchedAt.toISOString(),
        });
      }
    }
  });

  // Sort by severity (major first), then absolute delta
  return moves.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "major" ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
}
