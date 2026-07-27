import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  buildSafetyBouncePresentationCycle,
} from "@influence/engine/viewer-presentation";
import { SafetyBounceStage } from "../app/games/[slug]/components/safety-bounce-stage";
import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatPresentationSnapshot,
} from "../app/games/[slug]/components/types";

const roster: FormatPresentationRosterPlayer[] = [
  { id: "atlas", name: "Atlas" },
  { id: "lyra", name: "Lyra" },
  { id: "echo", name: "Echo" },
  { id: "rex", name: "Rex" },
];

describe("SafetyBounceStage", () => {
  it("derives a stable presentation-only cycle that always lands on the accepted target", () => {
    const input = {
      gameId: "game-1",
      round: 2,
      canonicalSequence: 44,
      rosterPlayerIds: roster.map((player) => player.id),
      eligibleCandidateIds: ["lyra", "echo", "rex"],
      acceptedTargetId: "echo",
    };

    const first = buildSafetyBouncePresentationCycle(input);
    const second = buildSafetyBouncePresentationCycle(input);

    expect(first).toEqual(second);
    expect(first.at(-1)).toBe("echo");
    expect(first.slice(0, -1)).not.toContain("echo");
    expect(first.every((id) => input.eligibleCandidateIds.includes(id))).toBe(true);
  });

  it("fails closed when the accepted target is not an eligible canonical candidate", () => {
    expect(
      buildSafetyBouncePresentationCycle({
        gameId: "game-1",
        round: 2,
        canonicalSequence: 44,
        rosterPlayerIds: roster.map((player) => player.id),
        eligibleCandidateIds: ["lyra", "echo"],
        acceptedTargetId: "rex",
      }),
    ).toEqual([]);
  });

  it("renders every agent exactly once across center, bench, Safe, and Vulnerable", () => {
    const cue = pointerCue();
    const html = renderToString(<SafetyBounceStage cue={cue} roster={roster} />);

    for (const player of roster) {
      expect(count(html, `data-board-member="${player.id}"`)).toBe(1);
    }
    expect(html).toContain('data-center-actor="atlas"');
    expect(html).toContain('data-accepted-target="echo"');
    expect(html).toContain('data-lane="safe"');
    expect(html).toContain('data-lane="vulnerable"');
    expect(html).toContain('data-lane="bench"');
    expect(html).toContain("Accepted target");
    expect(html).toContain("Echo");
    expect(html).toContain("Vulnerable");
  });

  it("keeps intermediate presentation candidates aria-hidden and canonical target explicit", () => {
    const html = renderToString(
      <SafetyBounceStage cue={pointerCue()} roster={roster} />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-pointer-cycle-candidate="true"');
    expect(html).toContain('data-canonical-target="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("considered");
  });

  it("snaps current-state entry to the trusted next actor without duplicating a lane card", () => {
    const html = renderToString(
      <SafetyBounceStage
        cue={pointerCue()}
        roster={roster}
        currentStateEntry
      />,
    );

    expect(html).toContain('data-center-actor="echo"');
    for (const player of roster) {
      expect(count(html, `data-board-member="${player.id}"`)).toBe(1);
    }
  });
});

function pointerCue(): Extract<
  FormatPresentationCue,
  { kind: "safety_bounce_pointer" }
> {
  const before = snapshot({
    canonicalSequence: 42,
    safetyBounce: {
      starterId: "atlas",
      currentActorId: "atlas",
      safePlayerIds: ["atlas"],
      vulnerablePlayerIds: [],
      benchPlayerIds: ["lyra", "echo", "rex"],
    },
  });
  const after = snapshot({
    canonicalSequence: 44,
    safetyBounce: {
      starterId: "atlas",
      currentActorId: "echo",
      safePlayerIds: ["atlas"],
      vulnerablePlayerIds: ["echo"],
      benchPlayerIds: ["lyra", "rex"],
    },
  });
  return {
    source: "format",
    key: "game-1:44:bounce-pointer",
    canonicalSequence: 44,
    round: 2,
    phase: "FORMAT_RESOLVE",
    kind: "safety_bounce_pointer",
    baseDurationMs: 2_600,
    before,
    after,
    actorId: "atlas",
    targetId: "echo",
    classification: "vulnerable",
    pointerCandidateIds: ["lyra", "rex", "echo"],
    pacing: "early",
  };
}

function snapshot(
  overrides: Partial<FormatPresentationSnapshot>,
): FormatPresentationSnapshot {
  return {
    round: 2,
    phase: "FORMAT_RESOLVE",
    canonicalSequence: 0,
    empoweredId: "atlas",
    empoweredTally: { atlas: 3, lyra: 1, echo: 0, rex: 0 },
    offeredFormatIds: ["safety_bounce", "vote_bomb"],
    activeFormatId: "safety_bounce",
    safetyBounce: null,
    resolution: null,
    revealedBallots: [],
    eliminatedId: null,
    ...overrides,
  };
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
