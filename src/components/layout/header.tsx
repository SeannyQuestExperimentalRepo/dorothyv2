"use client";

import Link from "next/link";
import { useState } from "react";

const sports = [
  { name: "NFL", href: "/nfl" },
  { name: "NCAAF", href: "/ncaaf" },
  { name: "NCAAMB", href: "/ncaamb" },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-bold tracking-tight">
            <span className="text-primary">Trend</span>
            <span className="text-foreground">Line</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {sports.map((sport) => (
              <Link
                key={sport.name}
                href={sport.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {sport.name}
              </Link>
            ))}
            <Link
              href="/trends"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Trends
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/search"
            className="hidden rounded-md bg-secondary px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Search trends...
          </Link>
          <button className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Sign in
          </button>

          <button
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <svg
              className="h-6 w-6 text-foreground"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              {mobileMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav className="border-t border-border px-4 py-3 md:hidden">
          {sports.map((sport) => (
            <Link
              key={sport.name}
              href={sport.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              {sport.name}
            </Link>
          ))}
          <Link
            href="/trends"
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
          >
            Trends
          </Link>
          <Link
            href="/search"
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
          >
            Search
          </Link>
        </nav>
      )}
    </header>
  );
}
