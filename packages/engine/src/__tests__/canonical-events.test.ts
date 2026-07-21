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

describe("endgame.speech_recorded", () => {
  it("appends public plea/accusation/defense with safe provenance and no cognitive fields", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "carol", name: "Carol" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const plea = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "I played hard.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(plea.type).toBe("endgame.speech_recorded");
    expect(plea.visibility).toBe("public");
    expect(plea.phase).toBe(Phase.PLEA);
    expect(plea.payload).toEqual({
      speechKind: "plea",
      playerId: "alice",
      text: "I played hard.",
      provenance: "agent",
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(plea.payload).not.toHaveProperty("thinking");
    expect(plea.payload).not.toHaveProperty("strategy");
    expect(canonicalEventIsVisibleTo(plea, "public")).toBe(true);

    const accusation = gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "bob",
      text: "Alice cut deals.",
      provenance: "timeout",
      phase: Phase.ACCUSATION,
      targetId: "alice",
      correlationKey: "endgame:accusation:r0:ACCUSATION:bob:talice",
    });
    expect(accusation.type).toBe("endgame.speech_recorded");
    if (accusation.type !== "endgame.speech_recorded") throw new Error("expected endgame speech");
    expect(accusation.payload.speechKind).toBe("accusation");
    expect(accusation.payload.targetId).toBe("alice");
    expect(accusation.payload.provenance).toBe("timeout");

    const defense = gs.recordEndgameSpeech({
      speechKind: "defense",
      playerId: "alice",
      text: "Those deals kept me alive.",
      provenance: "fallback",
      phase: Phase.DEFENSE,
      counterpartId: "bob",
      correlationKey: "endgame:defense:r0:DEFENSE:alice:cbob",
    });
    expect(defense.type).toBe("endgame.speech_recorded");
    if (defense.type !== "endgame.speech_recorded") throw new Error("expected endgame speech");
    expect(defense.payload.speechKind).toBe("defense");
    expect(defense.payload.counterpartId).toBe("bob");
    expect(defense.payload.provenance).toBe("fallback");
  });

  it("is idempotent for the same key and payload, and throws on conflict", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    const first = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "My plea.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    const second = gs.recordEndgameSpeech({
      speechKind: "plea",
      playerId: "alice",
      text: "My plea.",
      provenance: "agent",
      phase: Phase.PLEA,
      correlationKey: "endgame:plea:r0:PLEA:alice",
    });
    expect(second.sequence).toBe(first.sequence);
    expect(gs.getCanonicalEvents().filter((e) => e.type === "endgame.speech_recorded")).toHaveLength(1);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "plea",
        playerId: "alice",
        text: "Different plea.",
        provenance: "agent",
        phase: Phase.PLEA,
        correlationKey: "endgame:plea:r0:PLEA:alice",
      }),
    ).toThrow(/conflict/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "plea",
        playerId: "alice",
        text: "My plea.",
        provenance: "timeout",
        phase: Phase.PLEA,
        correlationKey: "endgame:plea:r0:PLEA:alice",
      }),
    ).toThrow(/conflict/);
  });

  it("keys accusations by player+target and defenses by player+counterpart", () => {
    const gs = new GameState(
      [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
        { id: "carol", name: "Carol" },
      ],
      { gameId: "game-fixed", now: () => 1_700_000_000_000 },
    );

    gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "alice",
      text: "vs bob",
      provenance: "agent",
      phase: Phase.ACCUSATION,
      targetId: "bob",
      correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tbob",
    });
    gs.recordEndgameSpeech({
      speechKind: "accusation",
      playerId: "alice",
      text: "vs carol",
      provenance: "agent",
      phase: Phase.ACCUSATION,
      targetId: "carol",
      correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tcarol",
    });
    const accusations = gs
      .getCanonicalEvents()
      .filter((e) => e.type === "endgame.speech_recorded" && e.payload.speechKind === "accusation");
    expect(accusations).toHaveLength(2);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "accusation",
        playerId: "alice",
        text: "different text same target",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        targetId: "bob",
        correlationKey: "endgame:accusation:r0:ACCUSATION:alice:tbob",
      }),
    ).toThrow(/conflict/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "accusation",
        playerId: "bob",
        text: "no target",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        correlationKey: "endgame:accusation:r0:ACCUSATION:bob",
      }),
    ).toThrow(/targetId/);

    expect(() =>
      gs.recordEndgameSpeech({
        speechKind: "defense",
        playerId: "bob",
        text: "no counterpart",
        provenance: "agent",
        phase: Phase.DEFENSE,
        correlationKey: "endgame:defense:r0:DEFENSE:bob",
      }),
    ).toThrow(/counterpartId/);
  });
});

describe("AcceptedFormalSpeech factory", () => {
  it("rejects private/cognitive construction and requires accusation target", async () => {
    const {
      createAcceptedFormalSpeech,
      buildFormalSpeechCorrelationKey,
      FORMAL_SPEECH_VOCABULARY,
    } = await import("../accepted-formal-speech");

    expect(FORMAL_SPEECH_VOCABULARY.endgameKinds).toEqual(["plea", "accusation", "defense"]);
    expect(FORMAL_SPEECH_VOCABULARY.eventTypes.endgame).toBe("endgame.speech_recorded");
    expect(FORMAL_SPEECH_VOCABULARY.eventTypes.judgment).toBe("judgment.speech_recorded");

    const speech = createAcceptedFormalSpeech({
      kind: "plea",
      playerId: "alice",
      text: "Please.",
      provenance: "agent",
      phase: Phase.PLEA,
      round: 3,
    });
    expect(speech.correlationKey).toBe(
      buildFormalSpeechCorrelationKey({
        kind: "plea",
        playerId: "alice",
        round: 3,
        phase: Phase.PLEA,
      }),
    );
    expect(speech).not.toHaveProperty("thinking");
    expect(speech).not.toHaveProperty("reasoningContext");
    expect(speech).not.toHaveProperty("strategy");

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "accusation",
        playerId: "alice",
        text: "You!",
        provenance: "agent",
        phase: Phase.ACCUSATION,
        round: 1,
      }),
    ).toThrow(/targetId/);

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "defense",
        playerId: "bob",
        text: "No.",
        provenance: "agent",
        phase: Phase.DEFENSE,
        round: 1,
      }),
    ).toThrow(/counterpartId/);

    expect(() =>
      createAcceptedFormalSpeech({
        kind: "plea",
        playerId: "alice",
        text: "",
        provenance: "agent",
        phase: Phase.PLEA,
        round: 1,
      }),
    ).toThrow(/non-empty/);
  });
});
