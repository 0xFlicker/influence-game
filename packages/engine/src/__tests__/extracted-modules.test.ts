/**
 * Tests for extracted game-runner modules.
 *
 * Validates TranscriptLogger, ContextBuilder, DiaryRoom, and phase utility functions.
 * No LLM calls — fully deterministic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { GameState, createUUID } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { ContextBuilder } from "../context-builder";
import { Phase } from "../types";
import type { UUID, RoomAllocation } from "../types";
import type { GameStreamEvent } from "../game-runner.types";
import { computeLobbyMessagesPerPlayer } from "../phases/lobby";
import { computeRoomCount, allocateRooms } from "../phases/mingle";
import { runJudgmentJuryQuestions } from "../phases/endgame";
import type { PhaseActor, PhaseRunnerContext } from "../phases/phase-runner-context";
import type { PhaseContext } from "../game-runner.types";
import { MockAgent } from "./mock-agent";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeGameState(names: string[]): GameState {
  return new GameState(names.map((name) => ({ id: createUUID(), name })));
}

// ---------------------------------------------------------------------------
// TranscriptLogger
// ---------------------------------------------------------------------------

describe("TranscriptLogger", () => {
  let gs: GameState;
  let logger: TranscriptLogger;

  beforeEach(() => {
    gs = makeGameState(["Alice", "Bob", "Charlie"]);
    gs.startRound();
    logger = new TranscriptLogger(gs);
  });

  it("logPublic adds to transcript and publicMessages", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Hello everyone!", Phase.LOBBY);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.from).toBe("Alice");
    expect(logger.transcript[0]!.scope).toBe("public");
    expect(logger.transcript[0]!.text).toBe("Hello everyone!");
    expect(logger.publicMessages).toHaveLength(1);
    expect(logger.publicMessages[0]!.from).toBe("Alice");
  });

  it("logPublic with anonymous metadata", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Anonymous rumor", Phase.RUMOR, { anonymous: true, displayOrder: 3 });

    expect(logger.transcript[0]!.anonymous).toBe(true);
    expect(logger.transcript[0]!.displayOrder).toBe(3);
    expect(logger.publicMessages[0]!.anonymous).toBe(true);
    expect(logger.publicMessages[0]!.displayOrder).toBe(3);
  });

  it("logMingleMessage (current room phase path) adds MINGLE transcript entry with mingle scope", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    logger.logMingleMessage(alice.id, [bob.id], "Secret message", 1);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("mingle");
    expect(logger.transcript[0]!.phase).toBe(Phase.MINGLE);
    expect(logger.transcript[0]!.from).toBe("Alice");
    expect(logger.transcript[0]!.to).toEqual(["Bob"]);
    expect(logger.transcript[0]!.roomId).toBe(1);
  });

  it("logSystem adds system transcript entry", () => {
    logger.logSystem("=== VOTE PHASE ===", Phase.VOTE);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("system");
    expect(logger.transcript[0]!.from).toBe("House");
  });

  it("returns only dialogue after a cursor without scanning non-dialogue rows", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "First", Phase.LOBBY);
    logger.logDiary("Alice", "Private");
    logger.logSystem("Second", Phase.VOTE);

    expect(logger.dialogueHead).toBe(2);
    expect(logger.dialogueEntriesAfter(1).map((entry) => entry.text)).toEqual(["Second"]);
    expect(logger.dialogueEntriesAfter(2)).toEqual([]);
  });

  it("logDiary adds diary transcript entry", () => {
    logger.logDiary("Alice", "My strategic thoughts...");

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("diary");
    expect(logger.transcript[0]!.phase).toBe(Phase.DIARY_ROOM);
  });

  it("logThinking adds thinking transcript entry", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logThinking(alice.id, "I need to be careful...", Phase.LOBBY);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.scope).toBe("thinking");
    expect(logger.transcript[0]!.from).toBe("Alice");
  });

  it("logRoomAllocation includes room metadata", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const rooms: RoomAllocation[] = [{ roomId: 1, playerIds: [alice.id, bob.id], round: 1, beat: 1 }];
    logger.logRoomAllocation("Room 1: Alice, Bob", rooms, []);

    expect(logger.transcript).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata).toBeDefined();
    expect(logger.transcript[0]!.roomMetadata!.rooms).toHaveLength(1);
    expect(logger.transcript[0]!.roomMetadata!.excluded).toEqual([]);
  });

  it("emitStream calls listener and handles errors gracefully", () => {
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    logger.logSystem("Test", Phase.LOBBY);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("transcript_entry");
  });

  it("emitStream catches listener errors", () => {
    logger.setStreamListener(() => { throw new Error("Test error"); });
    // Should not throw
    logger.logSystem("Test", Phase.LOBBY);
    expect(logger.transcript).toHaveLength(1);
  });

  it("emitPhaseChange emits phase_change event", () => {
    const events: GameStreamEvent[] = [];
    logger.setStreamListener((event) => events.push(event));
    logger.emitPhaseChange(Phase.LOBBY);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("phase_change");
  });
});

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

describe("ContextBuilder", () => {
  let gs: GameState;
  let logger: TranscriptLogger;
  let mingleInbox: Map<UUID, Array<{ from: string; text: string }>>;
  let builder: ContextBuilder;

  beforeEach(() => {
    gs = makeGameState(["Alice", "Bob", "Charlie", "Dave", "Eve"]);
    gs.startRound();
    logger = new TranscriptLogger(gs);
    mingleInbox = new Map();
    builder = new ContextBuilder(gs, logger, mingleInbox, 5);
  });

  it("buildPhaseContext returns correct basic fields", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.LOBBY);

    expect(ctx.selfId).toBe(alice.id);
    expect(ctx.selfName).toBe("Alice");
    expect(ctx.phase).toBe(Phase.LOBBY);
    expect(ctx.round).toBe(1);
    expect(ctx.alivePlayers).toHaveLength(5);
    expect(ctx.isEliminated).toBe(false);
  });

  it("reconstructs the same phase-call semantic boundary from the canonical head", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const before = builder.buildPhaseContext(alice.id, Phase.VOTE);
    const reconstructed = new ContextBuilder(gs, logger, mingleInbox, 5)
      .buildPhaseContext(alice.id, Phase.VOTE);

    expect(before.providerCallBoundaryEventSequence).toBeGreaterThan(0);
    expect(reconstructed.providerCallBoundaryEventSequence).toBe(
      before.providerCallBoundaryEventSequence,
    );
  });

  it("buildPhaseContext includes current mingle room inbox (mingleMessages)", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    mingleInbox.set(alice.id, [{ from: "Bob", text: "Secret" }]);
    const ctx = builder.buildPhaseContext(alice.id, Phase.MINGLE);

    expect(ctx.mingleMessages).toHaveLength(1);
    expect(ctx.mingleMessages[0]!.from).toBe("Bob");
  });

  it("buildPhaseContext includes extra empowered/candidates", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((p) => p.name === "Charlie")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.COUNCIL, {
      empoweredId: bob.id,
      councilCandidates: [bob.id, charlie.id],
    });

    expect(ctx.empoweredId).toBe(bob.id);
    expect(ctx.councilCandidates).toEqual([bob.id, charlie.id]);
  });

  it("buildPhaseContext includes room info", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.MINGLE, undefined, undefined, {
      roomCount: 2,
      roomMates: ["Alice", "Bob"],
    });

    expect(ctx.roomCount).toBe(2);
    expect(ctx.roomMates).toEqual(["Alice", "Bob"]);
  });

  it("buildPhaseContext hides full room allocations by default", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    builder.currentRoomAllocations = [{ roomId: 1, playerIds: [alice.id, bob.id], round: 1, beat: 1 }];
    builder.currentRoomCounts = [{ roomId: 1, count: 2 }];

    const ctx = builder.buildPhaseContext(alice.id, Phase.MINGLE);
    expect(ctx.roomAllocations).toBeUndefined();
    expect(ctx.roomCounts).toEqual([{ roomId: 1, count: 2 }]);
  });

  it("buildPhaseContext can include room allocations for compatibility when explicitly requested", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    builder.currentRoomAllocations = [{ roomId: 1, playerIds: [alice.id, bob.id], round: 1, beat: 1 }];

    const ctx = builder.buildPhaseContext(alice.id, Phase.MINGLE, undefined, undefined, {
      includeRoomAllocations: true,
    });
    expect(ctx.roomAllocations).toHaveLength(1);
    expect(ctx.roomAllocations![0]!.playerNames).toEqual(["Alice", "Bob"]);
  });

  it("buildPhaseContext detects finalists when 2 alive", () => {
    const players = gs.getAlivePlayers();
    gs.eliminatePlayer(players[2]!.id);
    gs.eliminatePlayer(players[3]!.id);
    gs.eliminatePlayer(players[4]!.id);

    const ctx = builder.buildPhaseContext(players[0]!.id, Phase.OPENING_STATEMENTS);
    expect(ctx.finalists).toBeDefined();
    expect(ctx.finalists).toHaveLength(2);
  });

  it("buildPhaseContext returns no finalists when more than 2 alive", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const ctx = builder.buildPhaseContext(alice.id, Phase.LOBBY);
    expect(ctx.finalists).toBeUndefined();
  });

  it("getActiveJury limits jury size based on player count", () => {
    // With 5 players, jury size should be limited
    const jury = builder.getActiveJury();
    expect(jury).toHaveLength(0); // No jury members initially
  });

  it("buildPhaseContext includes public messages from logger", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    logger.logPublic(alice.id, "Hello!", Phase.LOBBY);

    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const ctx = builder.buildPhaseContext(bob.id, Phase.LOBBY);
    expect(ctx.publicMessages).toHaveLength(1);
    expect(ctx.publicMessages[0]!.text).toBe("Hello!");
  });

  it("builds Judgment history and recent decisions only from canonical speech events", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;

    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: bob.id,
      text: "Why should the jury reward your game?",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: alice.id,
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: alice.id,
      text: "I controlled the decisive votes.",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: bob.id,
    });

    logger.logPublic(
      bob.id,
      "Question pour Charlie : ce display localise ne fait pas autorite.",
      Phase.JURY_QUESTIONS,
    );
    logger.logPublic(
      alice.id,
      "[ANSWER to Eve] This malformed display row is not accepted history.",
      Phase.JURY_QUESTIONS,
    );

    const aliceContext = builder.buildPhaseContext(alice.id, Phase.JURY_QUESTIONS);
    const bobContext = builder.buildPhaseContext(bob.id, Phase.JURY_QUESTIONS);

    expect(aliceContext.judgmentQuestionHistory).toEqual([{
      jurorName: "Bob",
      finalistName: "Alice",
      question: "Why should the jury reward your game?",
      answer: "I controlled the decisive votes.",
    }]);
    expect(aliceContext.recentDecisions).toContainEqual({
      round: 1,
      phase: Phase.JURY_QUESTIONS,
      label: "Judgment Answer",
      detail: 'Your Judgment answer to Bob: "I controlled the decisive votes."',
    });
    expect(bobContext.recentDecisions).toContainEqual({
      round: 1,
      phase: Phase.JURY_QUESTIONS,
      label: "Judgment Question",
      detail: 'Your Judgment question to Alice: "Why should the jury reward your game?"',
    });
    expect(
      aliceContext.recentDecisions?.some((decision) => decision.detail.includes("Eve")),
    ).toBe(false);
  });

  it("keeps juror-question and finalist-answer contexts player-scoped with canonical identity and history", () => {
    const alice = gs.getAlivePlayers().find((player) => player.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((player) => player.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((player) => player.name === "Charlie")!;

    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: bob.id,
      text: "CANONICAL_JUDGMENT_QUESTION",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: alice.id,
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: alice.id,
      text: "CANONICAL_JUDGMENT_ANSWER",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: bob.id,
    });
    logger.logSystem(
      "HOUSE_SUMMARY_CANARY",
      Phase.JURY_QUESTIONS,
      undefined,
      undefined,
      "house_summary",
    );
    logger.logDiary("Charlie", "OTHER_DIARY_CANARY");
    logger.logThinking(charlie.id, "OPERATOR_TRACE_CANARY", Phase.JURY_QUESTIONS);
    mingleInbox.set(bob.id, [{ from: "Charlie", text: "JUROR_PARTICIPANT_PRIVATE_CANARY" }]);
    mingleInbox.set(alice.id, [{ from: "Dave", text: "FINALIST_PARTICIPANT_PRIVATE_CANARY" }]);

    const jurorContext = builder.buildPhaseContextForAgentCall({
      agentId: bob.id,
      phase: Phase.JURY_QUESTIONS,
      promptClass: "ordinary_speech",
      isEliminated: true,
    });
    const finalistContext = builder.buildPhaseContextForAgentCall({
      agentId: alice.id,
      phase: Phase.JURY_QUESTIONS,
      promptClass: "ordinary_speech",
    });

    expect(jurorContext).toMatchObject({ selfId: bob.id, selfName: "Bob", isEliminated: true });
    expect(finalistContext).toMatchObject({ selfId: alice.id, selfName: "Alice", isEliminated: false });
    expect(jurorContext.judgmentQuestionHistory).toEqual([{
      jurorName: "Bob",
      finalistName: "Alice",
      question: "CANONICAL_JUDGMENT_QUESTION",
      answer: "CANONICAL_JUDGMENT_ANSWER",
    }]);
    expect(finalistContext.judgmentQuestionHistory).toEqual(jurorContext.judgmentQuestionHistory);
    expect(JSON.stringify(jurorContext)).toContain("JUROR_PARTICIPANT_PRIVATE_CANARY");
    expect(JSON.stringify(finalistContext)).toContain("FINALIST_PARTICIPANT_PRIVATE_CANARY");
    for (const context of [jurorContext, finalistContext]) {
      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain("HOUSE_SUMMARY_CANARY");
      expect(serialized).not.toContain("OTHER_DIARY_CANARY");
      expect(serialized).not.toContain("OPERATOR_TRACE_CANARY");
    }

    const endgameSource = readFileSync(
      new URL("../phases/endgame.ts", import.meta.url),
      "utf8",
    );
    const judgmentStart = endgameSource.indexOf("export async function runJudgmentJuryQuestions");
    const judgmentEnd = endgameSource.indexOf("export async function runJudgmentClosingArguments");
    const judgmentSource = endgameSource.slice(judgmentStart, judgmentEnd);
    expect(judgmentSource).toContain(
      "const jurorCtx = prepareAgentPhaseContext(ctx, jurorAgent, juror.playerId, Phase.JURY_QUESTIONS",
    );
    expect(judgmentSource).toContain(
      "const finalistCtx = prepareAgentPhaseContext(ctx, finalistAgent, targetFinalistId, Phase.JURY_QUESTIONS",
    );
    expect(judgmentSource).not.toMatch(/houseNarrative|houseSummary|notebook/i);
  });

  it("routes actual Judgment question and answer calls through the player information firewall", async () => {
    const players = gs.getAlivePlayers();
    const [alice, bob, charlie, dave, eve] = players;
    if (!alice || !bob || !charlie || !dave || !eve) throw new Error("expected five players");
    gs.setEndgameStage("judgment");
    gs.eliminatePlayer(charlie.id);
    gs.eliminatePlayer(dave.id);
    gs.eliminatePlayer(eve.id);
    logger.logSystem(
      "HOUSE_SUMMARY_CANARY",
      Phase.JURY_QUESTIONS,
      undefined,
      undefined,
      "house_summary",
    );
    logger.logDiary("Dave", "OTHER_DIARY_CANARY");
    logger.logThinking(eve.id, "OPERATOR_TRACE_CANARY", Phase.JURY_QUESTIONS);
    mingleInbox.set(charlie.id, [{ from: "Dave", text: "JUROR_PARTICIPANT_PRIVATE_CANARY" }]);
    mingleInbox.set(alice.id, [{ from: "Bob", text: "FINALIST_PARTICIPANT_PRIVATE_CANARY" }]);

    const capturedJurorContexts: PhaseContext[] = [];
    const capturedFinalistContexts: PhaseContext[] = [];
    const agentList = players.map((player) => new MockAgent(player.id, player.name));
    for (const agent of agentList) {
      if ([charlie.id, dave.id, eve.id].includes(agent.id)) {
        agent.getJuryQuestion = async (context) => {
          capturedJurorContexts.push(structuredClone(context));
          return { targetFinalistId: alice.id, question: `Question from ${agent.name}?` };
        };
      }
      if (agent.id === alice.id) {
        agent.getJuryAnswer = async (context) => {
          capturedFinalistContexts.push(structuredClone(context));
          return { message: "My answer.", thinking: "" };
        };
      }
    }
    const runnerContext = {
      gameState: gs,
      agents: new Map(agentList.map((agent) => [agent.id, agent])),
      config: { agentActionTimeoutMs: 0 },
      logger,
      contextBuilder: builder,
      mingleInbox,
      formatKernelState: {
        offeredFormats: null,
        selectedFormat: null,
        pressure: null,
        lastSelectedFormat: null,
      },
      eliminationOrder: [charlie.name, dave.name, eve.name],
      eliminationOrderPlayerIds: [charlie.id, dave.id, eve.id],
    } as unknown as PhaseRunnerContext;
    const actor = { send: () => {} } as unknown as PhaseActor;

    await runJudgmentJuryQuestions(runnerContext, actor);

    expect(capturedJurorContexts).toHaveLength(3);
    expect(capturedFinalistContexts).toHaveLength(3);
    expect(JSON.stringify(capturedJurorContexts)).toContain("JUROR_PARTICIPANT_PRIVATE_CANARY");
    expect(JSON.stringify(capturedFinalistContexts)).toContain("FINALIST_PARTICIPANT_PRIVATE_CANARY");
    for (const context of [...capturedJurorContexts, ...capturedFinalistContexts]) {
      const serialized = JSON.stringify(context);
      expect(serialized).not.toContain("HOUSE_SUMMARY_CANARY");
      expect(serialized).not.toContain("OTHER_DIARY_CANARY");
      expect(serialized).not.toContain("OPERATOR_TRACE_CANARY");
    }
  });

  it("pairs each Judgment answer with the latest unmatched reciprocal canonical question", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;

    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: bob.id,
      text: "First question",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: alice.id,
    });
    gs.startRound();
    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: bob.id,
      text: "Second question",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: alice.id,
    });
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: alice.id,
      text: "Second answer",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: bob.id,
    });
    gs.startRound();
    gs.recordJudgmentSpeech({
      speechKind: "jury_answer",
      playerId: alice.id,
      text: "First answer",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: bob.id,
    });

    expect(
      builder.buildPhaseContext(alice.id, Phase.JURY_QUESTIONS).judgmentQuestionHistory,
    ).toEqual([
      {
        jurorName: "Bob",
        finalistName: "Alice",
        question: "First question",
        answer: "First answer",
      },
      {
        jurorName: "Bob",
        finalistName: "Alice",
        question: "Second question",
        answer: "Second answer",
      },
    ]);
  });

  it("keeps unanswered canonical Judgment questions and ignores display-only questions", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((p) => p.name === "Charlie")!;

    gs.recordJudgmentSpeech({
      speechKind: "jury_question",
      playerId: bob.id,
      text: "Unanswered canonical question",
      provenance: "agent",
      phase: Phase.JURY_QUESTIONS,
      addresseeId: alice.id,
    });
    logger.logPublic(
      charlie.id,
      "[QUESTION to Alice] Display-only question",
      Phase.JURY_QUESTIONS,
    );

    expect(
      builder.buildPhaseContext(alice.id, Phase.JURY_QUESTIONS).judgmentQuestionHistory,
    ).toEqual([{
      jurorName: "Bob",
      finalistName: "Alice",
      question: "Unanswered canonical question",
    }]);
  });

  it("buildPhaseContext exposes name-rendered public/canonical records for endgame prompts", () => {
    const alice = gs.getAlivePlayers().find((p) => p.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((p) => p.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((p) => p.name === "Charlie")!;

    gs.recordVote(alice.id, bob.id, charlie.id);
    logger.logPublic(alice.id, "This should be visible.", Phase.LOBBY);
    logger.logSystem("A public House result.", Phase.VOTE);
    logger.logSystem(
      "Viewer-only House narrative beat.",
      Phase.VOTE,
      undefined,
      undefined,
      "house_summary",
    );
    logger.logMingleMessage(alice.id, [bob.id], "Private room talk.", 1);
    logger.logDiary("Alice", "Private diary thought.");
    logger.logThinking(alice.id, "Hidden thought.", Phase.VOTE);

    const ctx = builder.buildPhaseContext(alice.id, Phase.PLEA);

    expect(ctx.gameEventRecord?.some((line) => line.includes("Alice voted empower=Bob, expose=Charlie"))).toBe(true);
    expect(ctx.gameEventRecord?.some((line) => line.includes(alice.id))).toBe(false);
    expect(ctx.publicTranscriptContext?.map((entry) => entry.text)).toEqual([
      "This should be visible.",
      "A public House result.",
    ]);
    expect(ctx.publicMessages.map((entry) => entry.text)).not.toContain(
      "Viewer-only House narrative beat.",
    );
  });

  it("keeps peer format ballots absent while retaining the acting agent's own sealed receipt", () => {
    const alice = gs.getAlivePlayers().find((player) => player.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((player) => player.name === "Bob")!;
    gs.recordFormatMenu(alice.id, ["save_or_eliminate", "vote_bomb"]);
    gs.recordFormatSelected(alice.id, "save_or_eliminate");
    gs.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: alice.id,
      targetId: bob.id,
      polarity: "eliminate",
    });

    const bobContext = builder.buildPhaseContext(bob.id, Phase.FORMAT_RESOLVE);
    const aliceContext = builder.buildPhaseContext(alice.id, Phase.FORMAT_RESOLVE);

    expect(bobContext.gameEventRecord?.some((record) => record.includes("format ballot"))).toBe(false);
    expect(aliceContext.gameEventRecord).toContain(
      "R1/FORMAT_RESOLVE: Your format ballot: EXIT → Bob (sealed).",
    );
  });

  it("projects each actor's authoritative Restricted History ledger into phase context", () => {
    const alice = gs.getAlivePlayers().find((player) => player.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((player) => player.name === "Bob")!;
    const charlie = gs.getAlivePlayers().find((player) => player.name === "Charlie")!;
    const dave = gs.getAlivePlayers().find((player) => player.name === "Dave")!;
    const eve = gs.getAlivePlayers().find((player) => player.name === "Eve")!;

    gs.recordFormatBallot({
      formatId: "majority_elimination",
      voterId: alice.id,
      targetId: bob.id,
    });
    gs.startRound();
    gs.recordFormatBallot({
      formatId: "save_or_eliminate",
      voterId: alice.id,
      targetId: charlie.id,
      polarity: "save",
    });
    gs.startRound();
    gs.recordFormatBallot({
      formatId: "even_votes",
      voterId: alice.id,
      targetId: dave.id,
    });
    gs.startRound();
    builder.currentFormatPressure = {
      empoweredId: eve.id,
      empoweredName: eve.name,
      offeredFormats: ["restricted_history", "vote_bomb"],
      selectedFormat: "restricted_history",
      ruleSheetSummary: "You cannot target anyone you previously targeted to eliminate.",
    };

    const mingleContext = builder.buildPhaseContext(alice.id, Phase.FORMAT_MINGLE);
    const resolveContext = builder.buildPhaseContext(alice.id, Phase.FORMAT_RESOLVE);

    expect(mingleContext.restrictedHistoryLegality).toEqual({
      priorTargetIds: [bob.id, dave.id],
      priorTargetNames: [bob.name, dave.name],
      legalTargetIds: [charlie.id, eve.id],
      legalTargetNames: [charlie.name, eve.name],
    });
    expect(resolveContext.restrictedHistoryLegality).toEqual(
      mingleContext.restrictedHistoryLegality,
    );
  });

  it("does not turn private format-ballot operator turns into player transcript context", () => {
    const alice = gs.getAlivePlayers().find((player) => player.name === "Alice")!;
    const bob = gs.getAlivePlayers().find((player) => player.name === "Bob")!;
    const streamed: GameStreamEvent[] = [];
    logger.setStreamListener((event) => streamed.push(event));

    logger.emitAgentTurn({
      phase: Phase.FORMAT_RESOLVE,
      action: "format-ballot",
      actor: { id: alice.id, name: alice.name, role: "player" },
      visibility: "private",
      response: {
        formatId: "save_or_eliminate",
        targetId: bob.id,
        targetName: bob.name,
        sealed: true,
      },
      scope: "system",
      text: "operator-only sealed format ballot",
    });

    expect(streamed).toHaveLength(1);
    expect(streamed[0]!.type).toBe("agent_turn");
    expect(logger.transcript).toHaveLength(0);
    expect(builder.buildPhaseContext(bob.id, Phase.FORMAT_RESOLVE).publicTranscriptContext).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase utility functions
// ---------------------------------------------------------------------------

describe("computeLobbyMessagesPerPlayer", () => {
  it("defaults to one pass at every player count", () => {
    expect(computeLobbyMessagesPerPlayer(4)).toBe(1);
    expect(computeLobbyMessagesPerPlayer(6)).toBe(1);
    expect(computeLobbyMessagesPerPlayer(8)).toBe(1);
    expect(computeLobbyMessagesPerPlayer(12)).toBe(1);
  });

  it("respects config override", () => {
    expect(computeLobbyMessagesPerPlayer(4, 6)).toBe(6);
    expect(computeLobbyMessagesPerPlayer(12, 1)).toBe(1);
  });
});

describe("computeRoomCount", () => {
  it("skips open rooms below five alive players", () => {
    expect(computeRoomCount(2)).toBe(0);
    expect(computeRoomCount(4)).toBe(0);
  });

  it("scales open rooms by ceil(alive / 3) plus one", () => {
    expect(computeRoomCount(5)).toBe(3);
    expect(computeRoomCount(6)).toBe(3);
    expect(computeRoomCount(7)).toBe(4);
    expect(computeRoomCount(9)).toBe(4);
    expect(computeRoomCount(10)).toBe(5);
    expect(computeRoomCount(12)).toBe(5);
    expect(computeRoomCount(16)).toBe(7);
  });
});

describe("allocateRooms", () => {
  it("honors valid House assignments exactly", () => {
    const a = createUUID(), b = createUUID(), c = createUUID(), d = createUUID(), e = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
      { id: d, name: "D" },
      { id: e, name: "E" },
    ];
    const { rooms, diagnostics } = allocateRooms({
      rooms: [
        { roomId: 2, playerIds: [a, b, e] },
        { roomId: 1, playerIds: [c, d] },
      ],
    }, players, 2, 1, 1);
    expect(rooms).toHaveLength(2);
    expect(rooms[0]!.playerIds).toEqual([c, d]);
    expect(rooms[1]!.playerIds).toEqual([a, b, e]);
    expect(diagnostics.assignments.map((assignment) => assignment.source)).toEqual([
      "house",
      "house",
      "house",
      "house",
      "house",
    ]);
  });

  it("repairs invalid, unknown, duplicate, and missing House assignments", () => {
    const a = createUUID(), b = createUUID(), c = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
      { id: c, name: "C" },
    ];
    const { rooms, diagnostics } = allocateRooms({
      rooms: [
        { roomId: 0, playerIds: [a] },
        { roomId: 3, playerIds: [b] },
        { roomId: 1, playerIds: [a, "unknown", a] },
      ],
    }, players, 2, 1, 1);
    expect(rooms.flatMap((room) => room.playerIds).sort()).toEqual([a, b, c].sort());
    expect(rooms.every((room) => room.playerIds.length > 0)).toBe(true);
    expect(diagnostics.assignments.find((assignment) => assignment.player.id === a)?.source).toBe("house");
    expect(diagnostics.assignments.find((assignment) => assignment.player.id === b)?.source).toBe("repaired");
    expect(diagnostics.assignments.find((assignment) => assignment.player.id === c)?.source).toBe("repaired");
  });

  it("represents empty and singleton rooms", () => {
    const a = createUUID(), b = createUUID();
    const players = [
      { id: a, name: "A" },
      { id: b, name: "B" },
    ];
    const { rooms, diagnostics } = allocateRooms({
      rooms: [
        { roomId: 2, playerIds: [a] },
        { roomId: 1, playerIds: [b] },
      ],
    }, players, 3, 4, 2);
    expect(rooms).toHaveLength(3);
    expect(rooms[0]).toMatchObject({ roomId: 1, round: 4, beat: 2, playerIds: [b] });
    expect(rooms[1]).toMatchObject({ roomId: 2, round: 4, beat: 2, playerIds: [a] });
    expect(rooms[2]).toMatchObject({ roomId: 3, round: 4, beat: 2, playerIds: [] });
    expect(diagnostics.allocatedRooms.map((room) => room.conversationRan)).toEqual([false, false, false]);
  });
});
