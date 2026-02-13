export default function SavedTrendsLoading() {
  return (
    <div className="py-8">
      <div className="mb-6 h-8 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />
        ))}
      </div>
    </div>
  );
}
