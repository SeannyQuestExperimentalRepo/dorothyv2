import { enrichNCAAMBGamesWithKenpom } from "../../src/lib/espn-sync";

async function main() {
  console.log("=== Phase 0: Enrich 2026 KenPom Data ===");
  console.log(`Date: ${new Date().toISOString()}`);

  console.log("\n--- Enriching season 2026 ---");
  const result2026 = await enrichNCAAMBGamesWithKenpom(2026);
  console.log(`Season 2026 - Enriched: ${result2026.enriched}, Not matched: ${result2026.notMatched}`);

  console.log("\n--- Enriching season 2025 (fill any gaps) ---");
  const result2025 = await enrichNCAAMBGamesWithKenpom(2025);
  console.log(`Season 2025 - Enriched: ${result2025.enriched}, Not matched: ${result2025.notMatched}`);

  console.log("\nDone.");
}

main().catch(console.error);
