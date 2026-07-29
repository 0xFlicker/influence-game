import { describe, expect, test } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { GameState } from "../game-state";
import type {
  IAgent,
  MingleTurnAction,
  PhaseContext,
  RecallContinuitySnapshot,
} from "../game-runner.types";
import {
  commitMingleTurnMovements,
  executeMingleTurn,
  initializeMingleExecution,
} from "../mingle-turn-execution";
import type { PhaseRunnerContext } from "../phases/phase-runner-context";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase, type UUID } from "../types";
import { emptyRecallContinuitySnapshot } from "../context-recall-plan";

const PLAYERS = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
  { id: "d", name: "D" },
  { id: "e", name: "E" },
];

class TurnAgent {
  readonly histories: Array<Array<{ from: string; text: string }>> = [];
  readonly contexts: PhaseContext[] = [];

  constructor(
    readonly id: UUID,
    readonly name: string,
    readonly turns: MingleTurnAction[],
  ) {}

  onGameStart(): void {}
  async onPhaseStart(): Promise<void> {}
  getRecallContinuitySnapshot(): RecallContinuitySnapshot {
    return emptyRecallContinuitySnapshot();
  }
  async takeMingleTurn(
    context: PhaseContext,
    _roomMates: string[],
    conversationHistory: Array<{ from: string; text: string }> = [],
  ): Promise<MingleTurnAction> {
    this.contexts.push(context);
    this.histories.push(conversationHistory.map((entry) => ({ ...entry })));
    const turn = this.turns.shift();
    if (!turn) throw new Error(`No scripted turn for ${this.name}`);
    return turn;
  }
}

function harness() {
  const gameState = new GameState(PLAYERS, {
    gameId: "mingle-turn-seam",
    now: () => 1_700_000_000_000,
  });
  gameState.startRound();
  const logger = new TranscriptLogger(gameState);
  const mingleInbox = new Map<UUID, Array<{ from: string; text: string }>>([
    ["a", [{ from: "old", text: "stale" }]],
  ]);
  const contextBuilder = new ContextBuilder(
    gameState,
    logger,
    mingleInbox,
    PLAYERS.length,
  );
  contextBuilder.currentRoomAllocations = [{
    roomId: 9,
    round: 1,
    beat: 9,
    playerIds: ["a"],
  }];
  const a = new TurnAgent("a", "A", [{
    message: "A opens",
    noReply: false,
    gotoRoomId: 3,
    gotoPlayerName: null,
    thinking: "move later",
  }]);
  const b = new TurnAgent("b", "B", [{
    message: "B answers",
    noReply: false,
    gotoRoomId: null,
    gotoPlayerName: null,
    thinking: "stay",
  }]);
  const agents = new Map<UUID, IAgent>([
    ["a", a as unknown as IAgent],
    ["b", b as unknown as IAgent],
  ]);
  const ctx = {
    gameState,
    agents,
    config: DEFAULT_CONFIG,
    logger,
    contextBuilder,
    mingleInbox,
    eliminationOrder: [],
    formatKernelState: {
      offeredFormats: null,
      selectedFormat: null,
      pressure: null,
      lastSelectedFormat: null,
    },
    diaryRoom: {},
    houseInterviewer: {},
  } as unknown as PhaseRunnerContext;
  return { ctx, a, b, logger, mingleInbox, contextBuilder };
}

describe("shared Mingle turn execution", () => {
  test("initializes the live/evaluation boundary and preserves inbox/current-beat semantics", async () => {
    const { ctx, a, b, logger, mingleInbox, contextBuilder } = harness();
    const initialized = initializeMingleExecution(ctx, Phase.MINGLE_I);

    expect(initialized.roomCount).toBe(3);
    expect(initialized.initialRoomCounts).toEqual([
      { roomId: 1, count: 0 },
      { roomId: 2, count: 0 },
      { roomId: 3, count: 0 },
    ]);
    expect(mingleInbox.get("a")).toEqual([]);
    expect(contextBuilder.currentRoomAllocations).toEqual([]);
    expect(logger.transcript.at(-1)?.text).toBe("=== MINGLE I: PRIVATE ROOMS ===");

    const room = {
      roomId: 2,
      round: 1,
      beat: 1,
      playerIds: ["a", "b"],
    };
    const roomCounts = [
      { roomId: 1, count: 0 },
      { roomId: 2, count: 2 },
      { roomId: 3, count: 3 },
    ];
    const conversationHistory: Array<{ from: string; text: string }> = [];
    const first = await executeMingleTurn({
      ctx,
      phase: Phase.MINGLE_I,
      room,
      playerId: "a",
      roomCount: 3,
      roomCounts,
      mingleIntent: null,
      totalBeats: 2,
      conversationHistory,
    });
    const second = await executeMingleTurn({
      ctx,
      phase: Phase.MINGLE_I,
      room,
      playerId: "b",
      roomCount: 3,
      roomCounts,
      mingleIntent: null,
      totalBeats: 2,
      conversationHistory,
    });

    expect(a.histories).toEqual([[]]);
    expect(b.histories).toEqual([[{ from: "A", text: "A opens" }]]);
    expect(mingleInbox.get("a")).toEqual([{ from: "B", text: "B answers" }]);
    expect(mingleInbox.get("b")).toEqual([{ from: "A", text: "A opens" }]);
    expect(logger.transcript.filter((entry) => entry.scope === "mingle").map((entry) => entry.text))
      .toEqual(["A opens", "B answers"]);

    const frozenRooms = new Map<UUID, number>([["a", 2], ["b", 2]]);
    const frozen = commitMingleTurnMovements({
      ctx,
      turns: [first, second],
      roomByPlayerId: frozenRooms,
      roomCount: 3,
      phase: Phase.MINGLE_I,
      mode: "evaluation_frozen_schedule",
    });
    expect(frozenRooms.get("a")).toBe(2);
    expect(frozen[0]).toMatchObject({
      fromRoomId: 2,
      toRoomId: 2,
      moved: false,
      requestedToRoomId: 3,
      movementApplied: false,
    });
  });

  test("keeps live movement application unchanged", async () => {
    const { ctx } = harness();
    initializeMingleExecution(ctx, Phase.MINGLE);
    const room = {
      roomId: 2,
      round: 1,
      beat: 1,
      playerIds: ["a", "b"],
    };
    const conversationHistory: Array<{ from: string; text: string }> = [];
    const turns = [];
    for (const playerId of room.playerIds) {
      turns.push(await executeMingleTurn({
        ctx,
        phase: Phase.MINGLE,
        room,
        playerId,
        roomCount: 3,
        roomCounts: [
          { roomId: 1, count: 0 },
          { roomId: 2, count: 2 },
          { roomId: 3, count: 3 },
        ],
        mingleIntent: null,
        totalBeats: 2,
        conversationHistory,
      }));
    }
    const roomByPlayerId = new Map<UUID, number>([["a", 2], ["b", 2]]);
    const records = commitMingleTurnMovements({
      ctx,
      turns,
      roomByPlayerId,
      roomCount: 3,
      phase: Phase.MINGLE,
      mode: "live",
    });

    expect(roomByPlayerId.get("a")).toBe(3);
    expect(records[0]).toMatchObject({
      fromRoomId: 2,
      toRoomId: 3,
      moved: true,
      gotoRoomId: 3,
    });
    expect("requestedToRoomId" in records[0]!).toBe(false);
  });
});
