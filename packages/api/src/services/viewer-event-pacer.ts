/**
 * Viewer Event Pacer
 *
 * Buffering layer between the game engine event bus and WebSocket broadcast.
 * In "speedrun" mode, events pass through immediately.
 * In "live" mode, events are held on a schedule for dramatic pacing.
 *
 * The engine is never blocked — all holds are async on the presenter side.
 */

import type { GameStreamEvent } from "@influence/engine";
import { Phase } from "@influence/engine";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DisplayHoldConfig {
  /** Hold after VOTE ends, before POWER phase begins (ms) */
  voteEndMs: number;
  /** Hold after POWER phase, before REVEAL (ms) */
  powerRevealMs: number;
  /** Hold after COUNCIL phase ends (ms) */
  councilEndMs: number;
  /** Hold before player_eliminated events (ms) */
  eliminationMs: number;
}

export const DEFAULT_LIVE_HOLDS: DisplayHoldConfig = {
  voteEndMs: 3000,
  powerRevealMs: 2000,
  councilEndMs: 2000,
  eliminationMs: 3000,
};

const ZERO_HOLDS: DisplayHoldConfig = {
  voteEndMs: 0,
  powerRevealMs: 0,
  councilEndMs: 0,
  eliminationMs: 0,
};

// ---------------------------------------------------------------------------
// ViewerEventPacer
// ---------------------------------------------------------------------------

export class ViewerEventPacer {
  private readonly mode: "live" | "speedrun";
  private readonly broadcast: (event: GameStreamEvent) => void;
  private readonly holds: DisplayHoldConfig;

  /** Async event queue for live mode */
  private readonly queue: GameStreamEvent[] = [];
  /** Whether the drain loop is currently running */
  private draining = false;
  /** Track the current phase for context-aware hold decisions */
  private currentPhase: Phase | null = null;

  constructor(
    mode: "live" | "speedrun",
    broadcast: (event: GameStreamEvent) => void,
    holds?: Partial<DisplayHoldConfig>,
  ) {
    this.mode = mode;
    this.broadcast = broadcast;

    if (mode === "speedrun") {
      this.holds = ZERO_HOLDS;
    } else {
      this.holds = { ...DEFAULT_LIVE_HOLDS, ...holds };
    }
  }

  /**
   * Accept an event from the game engine.
   * In speedrun mode: immediate pass-through.
   * In live mode: queued and released with display holds.
   */
  emit(event: GameStreamEvent): void {
    if (this.mode === "speedrun") {
      this.updatePhaseTracking(event);
      this.broadcast(event);
      return;
    }

    this.queue.push(event);
    this.drain().catch((err) => {
      console.error("[viewer-event-pacer] Drain loop failed:", err);
    });
  }

  /** Returns the number of events currently buffered. */
  get bufferedCount(): number {
    return this.queue.length;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Determine how many milliseconds to hold BEFORE releasing this event.
   */
  private getHoldMs(event: GameStreamEvent): number {
    switch (event.type) {
      case "phase_change": {
        const phase = event.phase as Phase;

        // VOTE just ended → dramatic pause before POWER begins
        if (phase === Phase.POWER) return this.holds.voteEndMs;

        // POWER just resolved → pause before REVEAL
        if (phase === Phase.REVEAL) return this.holds.powerRevealMs;

        // Transitioning away from COUNCIL → pause after council ends
        if (
          this.currentPhase === Phase.COUNCIL &&
          phase !== Phase.COUNCIL
        ) {
          return this.holds.councilEndMs;
        }

        return 0;
      }

      case "player_eliminated":
        return this.holds.eliminationMs;

      default:
        return 0;
    }
  }

  /** Update internal phase tracking after broadcasting an event. */
  private updatePhaseTracking(event: GameStreamEvent): void {
    if (event.type === "phase_change") {
      this.currentPhase = event.phase as Phase;
    }
  }

  /**
   * Async drain loop. Processes queued events one at a time,
   * inserting holds where needed. Only one drain loop runs at a time.
   */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;

        const holdMs = this.getHoldMs(event);
        if (holdMs > 0) {
          await sleep(holdMs);
        }

        this.updatePhaseTracking(event);
        this.broadcast(event);
      }
    } finally {
      this.draining = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
