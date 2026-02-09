/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // All game data (NFL, NCAAF, NCAAMB) now served from PostgreSQL.
    // Player data (nfl-player-games.json) still on disk but too large for serverless.
    // Player search will need DB migration in the future.
    // Exclude ALL data files from serverless bundles.
    outputFileTracingExcludes: {
      "*": [
        "./data",
      ],
    },
  },
};

export default nextConfig;
