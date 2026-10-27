export function WatchWaiting({ label = "Waiting for the next scene…" }: { label?: string }) {
  return <div role="status" className="grid min-h-40 flex-1 place-items-center bg-[radial-gradient(ellipse_at_center,#232520,#080a08)] p-8 text-center text-sm text-white/65"><span className="motion-safe:animate-pulse">{label}</span></div>;
}

export function WatchBuffering() {
  return <div role="status" aria-label="Buffering" className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
    <span aria-hidden="true" className="size-10 animate-spin rounded-full border-4 border-white/25 border-t-white motion-reduce:animate-none" />
  </div>;
}
