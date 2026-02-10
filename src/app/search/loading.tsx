export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-muted" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded-lg bg-muted" />
      </div>
      {/* Search bar placeholder */}
      <div className="h-12 w-full animate-pulse rounded-lg bg-card" />
      {/* Example chips */}
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-48 animate-pulse rounded-full bg-muted"
          />
        ))}
      </div>
      {/* Results placeholder */}
      <div className="mt-12 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl bg-card"
          />
        ))}
      </div>
    </div>
  );
}
