"use client";

import { useState, useEffect } from "react";

/**
 * Subtle visual indicator that the current phase is winding down.
 * Shows a shrinking progress bar and "Phase complete" text,
 * giving viewers time to digest before the scene changes.
 */
export function PhaseEndingCue({
  durationMs,
  label = "Phase complete",
}: {
  durationMs: number;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Brief tick to trigger CSS fade-in
    const fadeIn = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(fadeIn);
  }, []);

  return (
    <div
      className="fixed bottom-24 md:bottom-28 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 400ms ease-in-out",
      }}
    >
      <p className="text-white/40 text-xs tracking-[0.25em] uppercase">
        {label}
      </p>
      <div className="w-48 h-0.5 bg-white/10 rounded-full overflow-hidden">
        {durationMs > 0 ? (
          <div
            className="h-full bg-white/30 rounded-full"
            style={{
              animation: `phaseEndShrink ${durationMs}ms linear forwards`,
            }}
          />
        ) : (
          <div
            className="h-full w-1/3 bg-white/30 rounded-full"
            style={{
              animation: "phaseEndPulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}
