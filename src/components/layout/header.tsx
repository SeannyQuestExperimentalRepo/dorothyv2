"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { UserMenu } from "@/components/auth/user-menu";

const navItems = [
  { name: "Today", href: "/today" },
  { name: "Trends", href: "/trends" },
  { name: "Props", href: "/props" },
  { name: "Odds", href: "/odds" },
  { name: "Parlays", href: "/parlays" },
  { name: "Bets", href: "/bets" },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          {/* Logo with glow */}
          <Link href="/" className="group flex items-center gap-1.5">
            <div className="relative">
              <span className="text-xl font-bold tracking-tight text-primary">
                Trend
              </span>
              <span className="text-xl font-bold tracking-tight text-foreground">
                Line
              </span>
              <div className="absolute -bottom-0.5 left-0 h-px w-full bg-gradient-to-r from-primary/60 via-primary/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </Link>

          {/* Desktop nav with active indicator */}
          <nav className="hidden items-center gap-0.5 md:flex">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.name}
                  {isActive && (
                    <span className="absolute -bottom-[9px] left-1/2 h-px w-4 -translate-x-1/2 bg-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Search button */}
          <Link
            href="/search"
            className="hidden items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground sm:flex"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <span className="hidden lg:inline">Search trends...</span>
          </Link>

          <UserMenu />

          {/* Mobile menu toggle */}
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

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <nav className="border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur-xl md:hidden">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.name}
              </Link>
            );
          })}
          <Link
            href="/search"
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
          >
            Search
          </Link>
          <Link
            href="/login"
            className="block rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => setMobileMenuOpen(false)}
          >
            Sign in
          </Link>
        </nav>
      )}
    </header>
  );
}
