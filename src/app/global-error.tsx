"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center">
          <div className="mx-auto max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <h2 className="mb-2 text-lg font-semibold">
              Something went wrong
            </h2>
            <p className="mb-4 text-sm text-gray-400">
              {error.message || "A critical error occurred."}
            </p>
            <button
              onClick={reset}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
