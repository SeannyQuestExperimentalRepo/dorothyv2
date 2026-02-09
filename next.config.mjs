/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Exclude the 183MB NCAAMB data file from serverless bundles.
    // NCAAMB data will be served from PostgreSQL in a future migration.
    // NFL (17MB) + NCAAF (22MB) = 39MB — well within 250MB limit.
    outputFileTracingExcludes: {
      "*": [
        "./data/ncaamb-games-final.json",
        "./data/raw",
        "./data/nfl-player-games.json",
        "./data/player-matchup-index.json",
        "./data/nfl-games-staging.json",
        "./data/ncaaf-games-staging.json",
        "./data/ncaamb-games-staging.json",
        "./data/Database.xlsx",
        "./data/nfl-games-staging.csv",
        "./data/ncaaf-games-final.csv",
        "./data/nfl-games-final.csv",
        "./data/nfl-validation-report.json",
        "./data/ncaaf-validation-report.json",
        "./data/weather-analysis-report.json",
      ],
    },
  },
};

export default nextConfig;
