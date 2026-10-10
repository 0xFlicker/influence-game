export function WatchWaiting({ label = "Waiting for the next scene…" }: { label?: string }) {
  return <div role="status" className="grid min-h-40 flex-1 place-items-center bg-[radial-gradient(ellipse_at_center,#232520,#080a08)] p-8 text-center text-sm text-white/65"><span className="motion-safe:animate-pulse">{label}</span></div>;
}
