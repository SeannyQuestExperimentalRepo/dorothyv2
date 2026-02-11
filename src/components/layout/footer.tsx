import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            <span className="text-primary">Trend</span>
            <span className="text-foreground">Line</span>
          </Link>
          <span className="text-xs text-muted-foreground/40">&copy; {new Date().getFullYear()}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground/50">
          <span>149K+ games</span>
          <span className="hidden sm:inline">&middot;</span>
          <span className="hidden sm:inline">NFL &middot; NCAAF &middot; NCAAMB</span>
        </div>
      </div>
    </footer>
  );
}
