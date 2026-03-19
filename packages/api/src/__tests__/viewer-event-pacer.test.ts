import { describe, it, expect } from "bun:test";
import { Phase } from "@influence/engine";
import type { GameStreamEvent } from "@influence/engine";
import { ViewerEventPacer, DEFAULT_LIVE_HOLDS } from "../services/viewer-event-pacer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phaseChange(phase: Phase, round = 1): GameStreamEvent {
  return { type: "phase_change", phase, round, alivePlayers: [{ id: "a", name: "Alice" }] };
}

function transcript(phase: Phase, text: string, scope: "system" | "public" = "system"): GameStreamEvent {
  return {
    type: "transcript_entry",
    entry: { round: 1, phase, timestamp: Date.now(), from: "House", scope, text },
  };
}

function elimination(name: string): GameStreamEvent {
  return { type: "player_eliminated", playerId: "x", playerName: name, round: 1 };
}

function gameOver(): GameStreamEvent {
  return { type: "game_over", winnerName: "Alice", winner: "a", totalRounds: 3 };
}

/** Collect events broadcast by a pacer into an array, with timestamps. */
function createCollector() {
  const received: Array<{ event: GameStreamEvent; at: number }> = [];
  const start = Date.now();
  const fn = (event: GameStreamEvent) => {
    received.push({ event, at: Date.now() - start });
  };
  return { received, fn, start: () => start };
}

/** Wait for the pacer's async queue to drain. */
function waitForDrain(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ViewerEventPacer", () => {
  describe("speedrun mode", () => {
    it("passes all events through immediately", () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("speedrun", fn);

      pacer.emit(phaseChange(Phase.VOTE));
      pacer.emit(transcript(Phase.VOTE, "votes tallied"));
      pacer.emit(phaseChange(Phase.POWER));
      pacer.emit(elimination("Bob"));
      pacer.emit(gameOver());

      // All 5 events arrive synchronously
      expect(received.length).toBe(5);
      expect(received[0]!.event.type).toBe("phase_change");
      expect(received[4]!.event.type).toBe("game_over");
    });

    it("reports zero buffered events", () => {
      const pacer = new ViewerEventPacer("speedrun", () => {});
      pacer.emit(phaseChange(Phase.LOBBY));
      expect(pacer.bufferedCount).toBe(0);
    });
  });

  describe("live mode — hold timings", () => {
    // Use short holds (50ms) so tests run fast
    const SHORT_HOLDS = {
      voteEndMs: 50,
      powerRevealMs: 50,
      councilEndMs: 50,
      eliminationMs: 50,
    };

    it("holds before POWER phase_change (vote end hold)", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, SHORT_HOLDS);

      pacer.emit(phaseChange(Phase.VOTE));
      pacer.emit(phaseChange(Phase.POWER));

      // VOTE phase_change has no hold → arrives immediately
      // POWER phase_change has a hold → not yet
      await waitForDrain(10);
      expect(received.length).toBe(1);
      expect((received[0]!.event as { phase: Phase }).phase).toBe(Phase.VOTE);

      // After hold completes, POWER arrives
      await waitForDrain(100);
      expect(received.length).toBe(2);
      expect((received[1]!.event as { phase: Phase }).phase).toBe(Phase.POWER);
    });

    it("holds before REVEAL phase_change (power reveal hold)", async () => {
      const { received, fn } = createCollector();
      // Use longer holds to make timing assertions reliable
      const pacer = new ViewerEventPacer("live", fn, {
        voteEndMs: 80,
        powerRevealMs: 80,
        councilEndMs: 80,
        eliminationMs: 80,
      });

      // Emit VOTE first to set phase context, then POWER (held), then transcript, then REVEAL (held)
      pacer.emit(phaseChange(Phase.VOTE));
      pacer.emit(phaseChange(Phase.POWER));        // voteEnd hold (80ms)
      pacer.emit(transcript(Phase.POWER, "power action: eliminate"));
      pacer.emit(phaseChange(Phase.REVEAL));        // powerReveal hold (80ms)

      await waitForDrain(10);
      // Only VOTE arrives immediately, POWER is held
      expect(received.length).toBe(1);

      // After first hold drains (~80ms), POWER + transcript arrive, REVEAL still held
      await waitForDrain(100);
      expect(received.length).toBe(3);

      // After second hold drains (~160ms total), REVEAL arrives
      await waitForDrain(100);
      expect(received.length).toBe(4);
      expect((received[3]!.event as { phase: Phase }).phase).toBe(Phase.REVEAL);
    });

    it("holds before player_eliminated events", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, SHORT_HOLDS);

      pacer.emit(transcript(Phase.COUNCIL, "ELIMINATED: Bob"));
      pacer.emit(elimination("Bob"));

      await waitForDrain(10);
      // Transcript arrives immediately, elimination held
      expect(received.length).toBe(1);
      expect(received[0]!.event.type).toBe("transcript_entry");

      await waitForDrain(100);
      expect(received.length).toBe(2);
      expect(received[1]!.event.type).toBe("player_eliminated");
    });

    it("holds after COUNCIL phase ends (council end hold)", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, SHORT_HOLDS);

      // Simulate: COUNCIL → DIARY_ROOM transition
      pacer.emit(phaseChange(Phase.COUNCIL));
      pacer.emit(transcript(Phase.COUNCIL, "council votes tallied"));
      pacer.emit(phaseChange(Phase.DIARY_ROOM));

      await waitForDrain(10);
      // COUNCIL phase_change + transcript arrive immediately
      expect(received.length).toBe(2);

      await waitForDrain(100);
      // DIARY_ROOM phase_change arrives after council end hold
      expect(received.length).toBe(3);
      expect((received[2]!.event as { phase: Phase }).phase).toBe(Phase.DIARY_ROOM);
    });

    it("does not hold for non-dramatic phase transitions", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, SHORT_HOLDS);

      pacer.emit(phaseChange(Phase.INTRODUCTION));
      pacer.emit(phaseChange(Phase.LOBBY));
      pacer.emit(phaseChange(Phase.WHISPER));
      pacer.emit(phaseChange(Phase.RUMOR));

      // All should arrive without holds — drain loop processes synchronously for 0ms holds
      await waitForDrain(10);
      expect(received.length).toBe(4);
    });

    it("game_over events pass through without holds", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, SHORT_HOLDS);

      pacer.emit(gameOver());

      await waitForDrain(10);
      expect(received.length).toBe(1);
      expect(received[0]!.event.type).toBe("game_over");
    });
  });

  describe("live mode — event ordering", () => {
    it("preserves event order through holds", async () => {
      const { received, fn } = createCollector();
      const pacer = new ViewerEventPacer("live", fn, {
        voteEndMs: 30,
        powerRevealMs: 30,
        councilEndMs: 30,
        eliminationMs: 30,
      });

      // Full round sequence
      pacer.emit(phaseChange(Phase.LOBBY));
      pacer.emit(phaseChange(Phase.WHISPER));
      pacer.emit(phaseChange(Phase.RUMOR));
      pacer.emit(phaseChange(Phase.VOTE));
      pacer.emit(phaseChange(Phase.POWER));       // hold: voteEnd
      pacer.emit(elimination("Bob"));              // hold: elimination
      pacer.emit(phaseChange(Phase.REVEAL));       // hold: powerReveal
      pacer.emit(phaseChange(Phase.COUNCIL));
      pacer.emit(elimination("Carol"));            // hold: elimination
      pacer.emit(phaseChange(Phase.DIARY_ROOM));   // hold: councilEnd

      // Wait for all holds to complete (5 holds × 30ms = 150ms, give buffer)
      await waitForDrain(300);

      expect(received.length).toBe(10);

      // Verify order is preserved
      const types = received.map((r) => {
        if (r.event.type === "phase_change") return `phase:${(r.event as { phase: Phase }).phase}`;
        return r.event.type;
      });
      expect(types).toEqual([
        "phase:LOBBY",
        "phase:WHISPER",
        "phase:RUMOR",
        "phase:VOTE",
        "phase:POWER",
        "player_eliminated",
        "phase:REVEAL",
        "phase:COUNCIL",
        "player_eliminated",
        "phase:DIARY_ROOM",
      ]);
    });
  });

  describe("default hold config", () => {
    it("uses spec-defined defaults for live mode", () => {
      expect(DEFAULT_LIVE_HOLDS.voteEndMs).toBe(3000);
      expect(DEFAULT_LIVE_HOLDS.powerRevealMs).toBe(2000);
      expect(DEFAULT_LIVE_HOLDS.councilEndMs).toBe(2000);
      expect(DEFAULT_LIVE_HOLDS.eliminationMs).toBe(3000);
    });

    it("allows partial override of hold timings", async () => {
      const { received, fn } = createCollector();
      // Only override elimination hold
      const pacer = new ViewerEventPacer("live", fn, { eliminationMs: 20 });

      pacer.emit(elimination("Bob"));

      await waitForDrain(10);
      expect(received.length).toBe(0); // hold not yet elapsed

      await waitForDrain(30);
      expect(received.length).toBe(1);
    });
  });
});
