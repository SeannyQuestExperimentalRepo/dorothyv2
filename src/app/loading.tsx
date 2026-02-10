export default function RootLoading() {
  return (
    <div className="flex flex-col items-center px-4 pb-16 pt-20">
      {/* Title placeholder */}
      <div className="h-12 w-64 animate-pulse rounded-xl bg-muted" />
      {/* Subtitle placeholder */}
      <div className="mt-4 h-5 w-96 max-w-full animate-pulse rounded-lg bg-muted" />
      {/* Search bar placeholder */}
      <div className="mt-8 h-12 w-full max-w-xl animate-pulse rounded-lg bg-card" />
      {/* Chips */}
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-40 animate-pulse rounded-full bg-muted"
          />
        ))}
      </div>
      {/* Sport cards */}
      <div className="mt-12 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl bg-card"
          />
        ))}
      </div>
    </div>
  );
}
