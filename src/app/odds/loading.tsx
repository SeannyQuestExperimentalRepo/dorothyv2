export default function OddsLoading() {
  return (
    <div className="py-8">
      {/* Header + sport tabs */}
      <div className="mb-6">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-muted" />
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
      </div>
      {/* Odds table */}
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />
        ))}
      </div>
    </div>
  );
}
