import type { ReactNode } from "react";

/** House results framing; each game supplies its own outcome and actions. */
export function ResultsHeader({title, description, actions}: {title: string; description?: ReactNode; actions: ReactNode}) {
  return <header className="flex flex-wrap items-center justify-between gap-4">
    <div><p className="text-xs uppercase tracking-[0.18em] text-white/55">Final results</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{title}</h1>
      {description && <div className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{description}</div>}
    </div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </header>;
}
