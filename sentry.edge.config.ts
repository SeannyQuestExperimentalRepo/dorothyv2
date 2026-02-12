import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Only send errors when DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
