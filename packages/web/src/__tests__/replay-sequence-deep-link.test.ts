import { describe, expect, it } from "bun:test";
import { findPresentationCueIndexForSequence } from "../app/games/[slug]/components/presentation-sequence";
import type { ClassicPresentationCue, PresentationCue } from "../app/games/[slug]/components/types";
import {
  gameReplayHref,
  gameReplaySequenceHref,
  parseReplaySequenceParam,
} from "../lib/game-links";
import { shouldShowSiteFooter } from "../components/site-footer";

function classicCue(
  sequence: number | null,
  key: string,
): ClassicPresentationCue {
  return {
    source: "classic",
    key,
    canonicalSequence: sequence,
    round: 1,
    phase: "MINGLE",
    kind: "classic_transcript",
    stage: "done",
    baseDurationMs: 100,
    sceneIndex: 0,
    messageIndex: 0,
  };
}

function sequencedCue(sequence: number, key: string): PresentationCue {
  return classicCue(sequence, key);
}

describe("replay sequence path deep-links", () => {
  it("builds /games/:slug/replay/:sequence path URLs (not query strings)", () => {
    expect(gameReplaySequenceHref("young-ruby-isle", 42)).toBe(
      "/games/young-ruby-isle/replay/42",
    );
    expect(gameReplaySequenceHref("edge smoke/dusk", 7)).toBe(
      "/games/edge%20smoke%2Fdusk/replay/7",
    );
    expect(gameReplaySequenceHref("young-ruby-isle", 42)).not.toContain("?");
    expect(gameReplayHref("young-ruby-isle")).toBe("/games/young-ruby-isle/replay");
  });

  it("parses safe non-negative integer sequence path segments", () => {
    expect(parseReplaySequenceParam("0")).toBe(0);
    expect(parseReplaySequenceParam("42")).toBe(42);
    expect(parseReplaySequenceParam("0007")).toBe(7);
    expect(parseReplaySequenceParam("")).toBeUndefined();
    expect(parseReplaySequenceParam(undefined)).toBeUndefined();
    expect(parseReplaySequenceParam("abc")).toBeUndefined();
    expect(parseReplaySequenceParam("-1")).toBeUndefined();
    expect(parseReplaySequenceParam("1.5")).toBeUndefined();
    expect(parseReplaySequenceParam("12e3")).toBeUndefined();
  });

  it("hides the site footer on sequence deep-link replay paths", () => {
    expect(shouldShowSiteFooter("/games/cold-navy-horn/replay/42")).toBe(false);
    expect(shouldShowSiteFooter("/games/cold-navy-horn/replay")).toBe(false);
  });
});

describe("findPresentationCueIndexForSequence", () => {
  const cues: PresentationCue[] = [
    classicCue(null, "classic-null"),
    classicCue(10, "classic-10-typing"),
    classicCue(10, "classic-10-done"),
    sequencedCue(20, "seq-20"),
    classicCue(30, "classic-30"),
    sequencedCue(40, "seq-40"),
  ];

  it("lands on the first cue with an exact sequence match", () => {
    expect(findPresentationCueIndexForSequence(cues, 10)).toBe(1);
    expect(findPresentationCueIndexForSequence(cues, 20)).toBe(3);
  });

  it("falls forward to the next cue at or after the requested sequence", () => {
    expect(findPresentationCueIndexForSequence(cues, 15)).toBe(3);
    expect(findPresentationCueIndexForSequence(cues, 1)).toBe(1);
  });

  it("clamps past-the-end sequences to the last cue", () => {
    expect(findPresentationCueIndexForSequence(cues, 999)).toBe(5);
  });

  it("returns 0 for an empty cue list", () => {
    expect(findPresentationCueIndexForSequence([], 10)).toBe(0);
  });
});
