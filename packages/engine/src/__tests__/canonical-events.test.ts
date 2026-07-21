import { describe, expect, it, mock } from "bun:test";
import { CanonicalEventLog } from "../canonical-event-log";
import {
  canonicalEventIsVisibleTo,
  validateCanonicalGameEvent,
  type CanonicalGameEvent,
} from "../canonical-events";
import { GameState } from "../game-state";
import { Phase, PlayerStatus } from "../types";

function sampleEvent(): CanonicalGameEvent {
  return {
    sequence: 1,
    gameId: "game-fixed",
    round: 0,
    phase: Phase.INIT,
    type: "game.roster_initialized",
    timestamp: "2026-06-11T00:00:00.000Z",
    source: "engine",
    visibility: "system",
    payloadVersion: 1,
    sourcePointers: [
      {
        kind: "agent_turn",
        sequence: 7,
        gameNumber: 1,
        actorId: "atlas",
        action: "mingle-turn",
        round: 1,
        phase: Phase.MINGLE,
      },
      {
        kind: "simulation_jsonl",
        gameNumber: 1,
        file: "game-1-turns.jsonl",
        line: 42,
      },
    ],
    payload: {
      players: [
        { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
      ],
    },
  };
}

describe("canonical event envelope", () => {
  it("validates required event envelope fields and source pointers", () => {
    const result = validateCanonicalGameEvent(sampleEvent());

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects events missing sequence, game id, visibility, or payload version", () => {
    const invalid = {
      ...sampleEvent(),
      sequence: 0,
      gameId: "",
      visibility: "hidden",
      payloadVersion: 2,
    };

    const result = validateCanonicalGameEvent(invalid);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("sequence must be a positive integer");
    expect(result.errors).toContain("gameId is required");
    expect(result.errors).toContain("visibility is invalid");
    expect(result.errors).toContain("payloadVersion must be 1");
  });

  it("rejects unknown event types before replay can silently ignore them", () => {
    const result = validateCanonicalGameEvent({ ...sampleEvent(), type: "future.event" });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("type is unsupported: future.event");
  });

  it("filters producer-only events out of player-visible query modes", () => {
    const event = { ...sampleEvent(), visibility: "producer" as const };

    expect(canonicalEventIsVisibleTo(event, "producer")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "player")).toBe(false);
    expect(canonicalEventIsVisibleTo(event, "public")).toBe(false);
  });
});

describe("canonical event log", () => {
  it("replays existing events to new subscribers and then streams new events", () => {
    const log = new CanonicalEventLog();
    log.append({
      gameId: "game-fixed",
      round: 0,
      phase: Phase.INIT,
      type: "game.roster_initialized",
      timestamp: "2026-06-11T00:00:00.000Z",
      visibility: "system",
      payload: {
        players: [
          { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
        ],
      },
    });

    const seen: number[] = [];
    log.subscribe((event) => seen.push(event.sequence), { replayExisting: true });

    log.append({
      gameId: "game-fixed",
      round: 1,
      phase: Phase.LOBBY,
      type: "round.started",
      timestamp: "2026-06-11T00:00:01.000Z",
      visibility: "system",
      payload: { round: 1 },
    });

    expect(seen).toEqual([1, 2]);
  });

  it("keeps appending events when one subscriber throws", () => {
    const originalWarn = console.warn;
    console.warn = mock(() => undefined);
    const log = new CanonicalEventLog();
    try {
      log.subscribe(() => {
        throw new Error("observer failed");
      });
      const seen: number[] = [];
      log.subscribe((event) => seen.push(event.sequence));

      log.append({
        gameId: "game-fixed",
        round: 0,
        phase: Phase.INIT,
        type: "game.roster_initialized",
        timestamp: "2026-06-11T00:00:00.000Z",
        visibility: "system",
        payload: {
          players: [
            { id: "atlas", name: "Atlas", status: PlayerStatus.ALIVE, shielded: false },
          ],
        },
      });

      expect(seen).toEqual([1]);
      expect(log.list()).toHaveLength(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("GameState canonical append timing", () => {
  it("emits vote events before the live vote tally is mutated", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "charlie", name: "Charlie" },
        { id: "dave", name: "Dave" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );
    gs.startRound();

    const tallyAtAppend: Array<Record<string, string>> = [];
    gs.subscribeCanonicalEvents((event) => {
      if (event.type === "vote.cast") {
        tallyAtAppend.push({ ...gs.currentVoteTally.empowerVotes });
      }
    });

    gs.recordVote("alice", "bob", "charlie");

    expect(tallyAtAppend).toEqual([{}]);
    expect(gs.currentVoteTally.empowerVotes.alice).toBe("bob");
  });
});

describe("judgment.speech_recorded", () => {
  it("appends a public closing speech with phase CLOSING_ARGUMENTS", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const event = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });

    expect(event.type).toBe("judgment.speech_recorded");
    expect(event.phase).toBe(Phase.CLOSING_ARGUMENTS);
    expect(event.visibility).toBe("public");
    expect(event.payload).toEqual({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
    });
    expect(canonicalEventIsVisibleTo(event, "public")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "player")).toBe(true);
    expect(canonicalEventIsVisibleTo(event, "producer")).toBe(true);
  });

  it("is idempotent for the same key and payload, and throws on conflict", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const first = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });
    const second = gs.recordJudgmentSpeech({
      speechKind: "closing_argument",
      playerId: "iris",
      text: "My game was clean.",
      provenance: "agent",
      phase: Phase.CLOSING_ARGUMENTS,
    });
    expect(second.sequence).toBe(first.sequence);
    expect(gs.getCanonicalEvents().filter((e) => e.type === "judgment.speech_recorded")).toHaveLength(1);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "iris",
        text: "Different text",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/conflict/);
  });

  it("allows multiple jury answers from the same finalist to different jurors", () => {
    const gs = new GameState(
      [
        { id: "iris", name: "Iris" },
        { id: "maya", name: "Maya" },
        { id: "juror-a", name: "JurorA" },
        { id: "juror-b", name: "JurorB" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: "iris",
      text: "Answer A",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "juror-a",
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: "iris",
      text: "Answer B",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: "juror-b",
    });

    const answers = gs
      .getCanonicalEvents()
      .filter((e) => e.type === "judgment.speech_recorded" && e.payload.speechKind === "jury_answer");
    expect(answers).toHaveLength(2);
  });

  it("rejects empty playerId, missing speech text, and jury_answer without addresseeId", () => {
    const gs = new GameState([{ id: "iris", name: "Iris" }], { gameId: "game-fixed" });

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "",
        text: "hi",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/playerId/);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "closing_argument",
        playerId: "iris",
        text: "",
        provenance: "agent",
        phase: Phase.CLOSING_ARGUMENTS,
      }),
    ).toThrow(/non-empty/);

    expect(() =>
      gs.recordJudgmentSpeech({
        speechKind: "jury_answer",
        playerId: "iris",
        text: "answer",
        provenance: "agent",
        phase: Phase.JURY_QUESTIONS,
      }),
    ).toThrow(/addresseeId/);
  });
});
