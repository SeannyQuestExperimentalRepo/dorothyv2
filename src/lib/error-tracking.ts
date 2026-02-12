/**
 * Lightweight error tracking with structured logging + Sentry integration.
 * Routes errors to Sentry when configured, always logs to console.
 */

import * as Sentry from "@sentry/nextjs";

interface ErrorContext {
  route?: string;
  userId?: string;
  sport?: string;
  action?: string;
  [key: string]: unknown;
}

interface TimingContext {
  route: string;
  method: string;
  durationMs: number;
  [key: string]: unknown;
}

/**
 * Log an error with structured context. Routes to Sentry if configured.
 */
export function trackError(error: unknown, context: ErrorContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));

  // Always log structured output
  console.error(
    JSON.stringify({
      level: "error",
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );

  // Send to Sentry with context tags
  Sentry.captureException(err, {
    tags: {
      route: context.route,
      sport: context.sport,
      action: context.action,
    },
    extra: context,
  });
}

/**
 * Log a warning with structured context. Routes to Sentry if configured.
 */
export function trackWarning(message: string, context: ErrorContext = {}): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      message,
      ...context,
      timestamp: new Date().toISOString(),
    }),
  );

  // Send to Sentry as a message at warning level
  Sentry.captureMessage(message, {
    level: "warning",
    tags: {
      route: context.route,
      sport: context.sport,
      action: context.action,
    },
    extra: context,
  });
}

/**
 * Log API response time. Warns if response is slow (>1s).
 */
export function trackTiming(context: TimingContext): void {
  const level = context.durationMs > 1000 ? "warn" : "info";
  const prefix = context.durationMs > 1000 ? "[SLOW] " : "";

  if (level === "warn") {
    console.warn(
      JSON.stringify({
        level,
        message: `${prefix}${context.method} ${context.route} took ${context.durationMs}ms`,
        ...context,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

/**
 * Track a custom metric via Sentry.
 * Uses Sentry's metrics API for dashboards and alerting.
 */
export function trackMetric(
  name: string,
  value: number,
  unit: "none" | "second" | "millisecond" = "none",
  attributes?: Record<string, string>,
): void {
  Sentry.metrics.gauge(name, value, { unit, attributes });
}

/**
 * Create a timer for measuring route duration.
 * Usage: const end = startTimer(); ... const ms = end();
 */
export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}
