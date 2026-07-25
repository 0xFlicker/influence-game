import { describe, expect, test } from "bun:test";
import type { CanonicalGameEvent } from "../canonical-events";
import { resolveGameKernel } from "../game-kernel";

function event(type: CanonicalGameEvent["type"], round = 1): CanonicalGameEvent {
  return {
    type,
    phase: null,
    round,
    gameId: "game-1",
    source: "engine",
    payload: {},
    sequence: 1,
    timestamp: "2026-07-25T00:00:00.000Z",
    visibility: "public",
    payloadVersion: 1,
    sourcePointers: [],
  } as CanonicalGameEvent;
}

describe("resolveGameKernel", () => {
  test("stored format wins without reading events", () => {
    const result = resolveGameKernel({
      stored: "format",
      events: [],
    });
    expect(result).toEqual({ kernel: "format", source: "stored" });
  });

  test("stored classic wins even if format events present", () => {
    const result = resolveGameKernel({
      stored: "classic",
      events: [event("format.selected")],
    });
    expect(result).toEqual({ kernel: "classic", source: "stored" });
  });

  test("null stored + format evidence infers format", () => {
    const result = resolveGameKernel({
      stored: null,
      events: [event("format.menu_offered")],
    });
    expect(result).toEqual({ kernel: "format", source: "inferred" });
  });

  test("missing stored + classic-only events infers classic", () => {
    const result = resolveGameKernel({
      stored: undefined,
      events: [event("vote.empowered_set")],
    });
    expect(result).toEqual({ kernel: "classic", source: "inferred" });
  });

  test("invalid stored falls through to inference", () => {
    const result = resolveGameKernel({
      stored: "werewolf",
      events: [event("format.resolved")],
    });
    expect(result).toEqual({ kernel: "format", source: "inferred" });
  });

  test("empty events with null stored infers classic", () => {
    const result = resolveGameKernel({ stored: null, events: [] });
    expect(result).toEqual({ kernel: "classic", source: "inferred" });
  });
});
