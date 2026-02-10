export default function NCAAFLoading() {
  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded-lg bg-muted" />
      </div>
      {/* Quick queries */}
      <div className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-32 animate-pulse rounded-full bg-muted"
          />
        ))}
      </div>
      {/* CTA */}
      <div className="mb-8 h-24 animate-pulse rounded-xl bg-card" />
      {/* Conference grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-card p-4">
            <div className="mb-3 h-4 w-20 animate-pulse rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="mb-1.5 h-8 animate-pulse rounded-md bg-muted"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
