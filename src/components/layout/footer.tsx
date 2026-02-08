import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <p className="text-sm text-muted-foreground">
          TrendLine &copy; {new Date().getFullYear()}
        </p>
        <nav className="flex gap-4">
          <Link
            href="/about"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            About
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
