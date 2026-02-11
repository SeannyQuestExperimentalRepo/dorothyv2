/**
 * Typed environment variable access with validation.
 * Throws at startup if required vars are missing.
 */

function getEnvVar(name: string, required: true): string;
function getEnvVar(name: string, required?: false): string | undefined;
function getEnvVar(name: string, required = false): string | undefined {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  // Database
  databaseUrl: getEnvVar("DATABASE_URL"),

  // NextAuth
  nextAuthSecret: getEnvVar("NEXTAUTH_SECRET"),
  nextAuthUrl: getEnvVar("NEXTAUTH_URL"),

  // Google OAuth
  googleClientId: getEnvVar("GOOGLE_CLIENT_ID"),
  googleClientSecret: getEnvVar("GOOGLE_CLIENT_SECRET"),

  // OpenAI (LLM search)
  openaiApiKey: getEnvVar("OPENAI_API_KEY"),

  // The Odds API (live odds)
  oddsApiKey: getEnvVar("THE_ODDS_API_KEY"),

  // OpenWeatherMap (weather forecasts)
  openWeatherApiKey: getEnvVar("OPENWEATHER_API_KEY"),

  // Stripe (subscription billing — inactive until flip)
  stripeSecretKey: getEnvVar("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: getEnvVar("STRIPE_WEBHOOK_SECRET"),
  stripePriceMonthly: getEnvVar("STRIPE_PRICE_MONTHLY"),
  stripePriceAnnual: getEnvVar("STRIPE_PRICE_ANNUAL"),

  // KenPom
  kenpomApiKey: getEnvVar("KENPOM_API_KEY"),

  // Cron
  cronSecret: getEnvVar("CRON_SECRET"),

  // App
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",
} as const;

/** Feature flags — flip these to enable features */
export const features = {
  SUBSCRIPTIONS_ACTIVE: false,
  EXPORT_CSV: true,
  CUSTOM_ALERTS: false,
  LLM_SEARCH: true,
  LIVE_ODDS: true,
  DAILY_PICKS: true,
} as const;
