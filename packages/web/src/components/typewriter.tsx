"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Rate presets (chars/second) — per viewer-experience-spec.md §1.3
// ---------------------------------------------------------------------------

const RATES: Record<TypewriterRate, number> = {
  agent: 65,       // LOBBY, RUMOR, COUNCIL dialogue — fast, creates energy
  intro: 45,       // INTRODUCTION phase — slightly slower for first impressions
  "last-words": 28,// Elimination last words — slow and deliberate, emotional weight
  house: 50,       // House narration / system messages — clear, authoritative
  diary: 35,       // Diary Room entries — intimate, slower, confessional feel
  spectacle: 18,   // Immersive spectacle mode — 300 baud modem feel
};

export type TypewriterRate = "agent" | "intro" | "last-words" | "house" | "diary" | "spectacle";

export interface TypewriterProps {
  /** The complete text to animate. Always animate from the full string — never partial. */
  text: string;
  /** Character-per-second rate preset. */
  rate: TypewriterRate;
  /** Called once when the animation completes (or immediately in speedrun mode). */
  onComplete?: () => void;
  /**
   * Skip animation entirely and render full text immediately.
   * Used for speed-run game mode (admin/dev/testing).
   */
  speedrun?: boolean;
  /** Multiplier for typing speed (e.g. 2 = twice as fast). Defaults to 1. */
  speedMultiplier?: number;
  /** Optional className forwarded to the wrapping span. */
  className?: string;
}

/**
 * Typewriter — animates text character-by-character at configurable speeds.
 *
 * - Buffers the complete message and animates from the start.
 * - In `speedrun` mode, renders full text immediately (no animation).
 * - Resets and re-animates whenever `text` or `rate` changes.
 * - Calls `onComplete` once when done.
 */
export function Typewriter({ text, rate, onComplete, speedrun = false, speedMultiplier = 1, className }: TypewriterProps) {
  const [displayed, setDisplayed] = useState(() => (speedrun ? text : ""));
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (speedrun) {
      setDisplayed(text);
      onCompleteRef.current?.();
      return;
    }

    // Reset for new text
    setDisplayed("");

    if (!text) {
      onCompleteRef.current?.();
      return;
    }

    const mul = Math.max(0.1, speedMultiplier);
    const intervalMs = 1000 / (RATES[rate] * mul);
    let index = 0;

    const id = setInterval(() => {
      index++;
      setDisplayed(text.slice(0, index));
      if (index >= text.length) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [text, rate, speedrun, speedMultiplier]);

  return <span className={className}>{displayed}</span>;
}
