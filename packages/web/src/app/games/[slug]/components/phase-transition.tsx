"use client";

import { useState, useEffect, useRef } from "react";
import { PHASE_TRANSITION_LABELS } from "./constants";
import type { TransitionState } from "./types";

export function PhaseTransitionOverlay({
  transition,
  onDismiss,
}: {
  transition: TransitionState;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });

  useEffect(() => {
    // Brief tick to trigger CSS fade-in transition
    const fadeIn = setTimeout(() => setVisible(true), 16);
    // Start fade-out after 2s hold
    const fadeOut = setTimeout(() => setVisible(false), 2000);
    // Unmount after fade-out completes (300ms)
    const dismiss = setTimeout(() => onDismissRef.current(), 2300);

    return () => {
      clearTimeout(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(dismiss);
    };
  }, []);

  const label =
    PHASE_TRANSITION_LABELS[transition.phase] ?? transition.phase.replace(/_/g, " ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease-in-out",
        pointerEvents: "none",
      }}
    >
      {/* Cinematic backdrop */}
      <div className="absolute inset-0 bg-black/90" />
      <div className="influence-phase-atmosphere absolute inset-0" />
      <div className="influence-phase-vignette absolute inset-0" />

      <div className="relative text-center px-8 max-w-2xl">
        <div className="influence-phase-bloom absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        <p className="text-white/20 text-sm tracking-[0.4em] uppercase mb-8">◆ ◆ ◆</p>
        <h1
          className="text-3xl md:text-4xl font-extralight tracking-[0.20em] uppercase mb-6 influence-phase-title"
        >
          {label}
        </h1>
        {transition.flavorText && (
          <p className="text-white/55 text-base md:text-lg leading-relaxed mb-8 italic">
            {transition.flavorText}
          </p>
        )}
        <p className="text-white/25 text-sm tracking-widest uppercase">
          Round {transition.round} of {transition.maxRounds}&nbsp;·&nbsp;{transition.aliveCount} alive
        </p>
      </div>
    </div>
  );
}
