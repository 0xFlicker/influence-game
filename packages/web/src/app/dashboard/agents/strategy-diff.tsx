"use client";

import { useMemo } from "react";
import { diffWordsWithSpace } from "diff";

export function StrategyDiff({
  baseline,
  working,
  baselineLabel,
}: {
  baseline: string;
  working: string;
  baselineLabel: string;
}) {
  const changes = useMemo(
    () => diffWordsWithSpace(baseline, working),
    [baseline, working],
  );
  const changed = changes.some((part) => part.added || part.removed);

  return (
    <aside
      aria-label={`Strategy changes from ${baselineLabel}`}
      className="rounded-xl bg-black/20 p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Live changes</p>
          <p className="mt-1 text-xs text-white/35">Compared with {baselineLabel.toLowerCase()}.</p>
        </div>
        <span className={`text-xs font-medium ${changed ? "text-phase" : "text-white/35"}`}>
          {changed ? "Changed" : "No changes yet"}
        </span>
      </div>
      {changed ? (
        <p className="whitespace-pre-wrap text-sm leading-7 text-white/55">
          {changes.map((part, index) => (
            <span
              key={`${index}:${part.value}`}
              className={part.added
                ? "rounded-sm bg-emerald-400/15 text-emerald-200"
                : part.removed
                  ? "rounded-sm bg-red-400/10 text-red-300 line-through decoration-red-300/70"
                  : undefined}
            >
              {part.value}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-sm leading-6 text-white/35">
          Edit Strategy to see additions and removals here.
        </p>
      )}
    </aside>
  );
}
