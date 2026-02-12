import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Replay: capture 100% of sessions with errors, 0% otherwise (save quota)
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0,

  integrations: [Sentry.replayIntegration()],

  // Only send errors when DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
