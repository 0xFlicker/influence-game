import { describe, expect, it } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import type { CanonicalGameEvent } from "../canonical-events";
import type {
  GamePublicationV1,
  GameTurnCommitDraftV1,
  GameTurnCommitResultV1,
  GameTurnIntentV1,
} from "../durable-game-turn";
import {
  assertGameTurnCommitDraftV1,
  assertGameTurnIntentV1,
} from "../durable-game-turn";
import { GameRunner } from "../game-runner";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { durableProviderLogicalCallId } from "../provider-execution";
import type {
  DurableGameTurnCommittedV1,
  DurableGameTurnInitializationV1,
  DurableGameTurnPlanV1,
  DurableGameTurnSnapshotV1,
  DurableGameTurnStore,
  PhaseContext,
  HouseNarrativeTurnContext,
  HouseSummaryAttemptResult,
  TranscriptEntry,
} from "../game-runner.types";
import { createUUID, GameState } from "../game-state";
import { seededRandom } from "../durable-game-runner";
import { createOpeningStrategyState } from "../strategy-state";
import { Phase } from "../types";
import { MockAgent } from "./mock-agent";
import { TEST_GAME_CONFIG } from "./full-game-test-support";

const DIALOGUE_SCOPES = new Set<TranscriptEntry["scope"]>([
  "public",
  "mingle",
  "huddle",
  "whisper",
  "system",
]);

class MemoryDurableTurnStore implements DurableGameTurnStore {
  snapshot: DurableGameTurnSnapshotV1 | null = null;
  initializeCalls = 0;
  readonly plannedActions: string[] = [];
  readonly committedActions: string[] = [];
  readonly committedDrafts: GameTurnCommitDraftV1[] = [];
  beforeCommit?: (draft: GameTurnCommitDraftV1) => Promise<void>;
  onCommit?: (draft: GameTurnCommitDraftV1, snapshot: DurableGameTurnSnapshotV1) => void;
  throwAfterCommitAction: string | null = null;
  private threwAfterCommit = false;
  private readonly planned = new Map<string, GameTurnIntentV1>();
  private readonly committed = new Map<string, DurableGameTurnCommittedV1>();

  plannedIntentForAction(action: string): GameTurnIntentV1 | undefined {
    return [...this.planned.values()].find((intent) => intent.branch.action === action);
  }

  async load(): Promise<DurableGameTurnSnapshotV1 | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async initialize(input: DurableGameTurnInitializationV1): Promise<DurableGameTurnSnapshotV1> {
    this.initializeCalls += 1;
    if (this.snapshot) return structuredClone(this.snapshot);
    this.snapshot = {
      version: 1,
      execution: {
        version: 1,
        gameId: input.gameId,
        ownerEpoch: "test-owner",
        status: "ready",
        heads: {
          version: 1,
          turnSequence: 0,
          eventSequence: 0,
          eventHash: null,
          dialogueSequence: 0,
          publicationSequence: 0,
        },
        lastPresentationPhase: null,
        nextPublicationAvailableAt: null,
        xstateSnapshot: structuredClone(input.xstateSnapshot),
        cursor: structuredClone(input.cursor),
        playerContinuityCapsules: structuredClone(input.playerContinuityCapsules),
        houseNarrativeContinuity: structuredClone(input.houseNarrativeContinuity),
        retry: null,
      },
      canonicalEvents: structuredClone(input.canonicalEvents),
      transcriptEntries: structuredClone(input.transcriptEntries),
    };
    return structuredClone(this.snapshot);
  }

  async planNextTurn(intent: GameTurnIntentV1): Promise<DurableGameTurnPlanV1> {
    assertGameTurnIntentV1(intent);
    const existingCommit = this.committed.get(intent.turnId);
    if (existingCommit) {
      return {
        status: "committed",
        ...structuredClone(existingCommit),
      };
    }
    const existing = this.planned.get(intent.turnId);
    if (existing && hashCanonicalJson(existing) !== hashCanonicalJson(intent)) {
      throw new Error(`conflicting intent ${intent.turnId}`);
    }
    this.planned.set(intent.turnId, structuredClone(intent));
    this.plannedActions.push(intent.branch.action);
    return { version: 1, status: "execute", intent: structuredClone(intent) };
  }

  async commitTurn(draft: GameTurnCommitDraftV1): Promise<DurableGameTurnCommittedV1> {
    assertGameTurnCommitDraftV1(draft);
    const existing = this.committed.get(draft.turnId);
    if (existing) return structuredClone(existing);
    await this.beforeCommit?.(draft);
    const base = this.snapshot;
    if (!base) throw new Error("commit before initialization");
    const committedAt = "2026-08-27T00:00:00.000Z";
    const events = draft.canonicalEvents.map((event, index) => ({
      sequence: draft.expectedBaseHeads.eventSequence + index + 1,
      gameId: draft.gameId,
      round: event.round,
      phase: event.phase,
      type: event.type,
      timestamp: committedAt,
      source: event.source,
      visibility: event.visibility,
      payloadVersion: event.payloadVersion,
      sourcePointers: structuredClone(event.sourcePointers),
      payload: structuredClone(event.payload),
    }) as CanonicalGameEvent);
    let nextDialogueSequence = draft.expectedBaseHeads.dialogueSequence + 1;
    const transcriptEntries = draft.transcriptEntries.map((entry, index) => ({
      ...structuredClone(entry),
      timestamp: Date.parse(committedAt) + index,
      ...(DIALOGUE_SCOPES.has(entry.scope)
        ? { entrySequence: nextDialogueSequence++ }
        : {}),
    }) as TranscriptEntry);
    const eventHash = events.at(-1)
      ? hashCanonicalJson(events.at(-1)!)
      : draft.expectedBaseHeads.eventHash;
    const publications: GamePublicationV1[] = draft.publications.map((publication, index) => ({
      version: 1,
      gameId: draft.gameId,
      sequence: draft.expectedBaseHeads.publicationSequence + index + 1,
      turnId: draft.turnId,
      turnSequence: draft.turnSequence,
      turnPublicationOrdinal: index + 1,
      availableAt: publication.availableAt,
      payload: publication.kind === "canonical_event"
        ? {
            version: 1,
            kind: "canonical_event",
            eventSequence: events[publication.eventIndex]!.sequence,
          }
        : publication.kind === "transcript_entry"
          ? {
              version: 1,
              kind: "transcript_entry",
              turnId: draft.turnId,
              transcriptOrdinal: publication.transcriptIndex + 1,
            }
          : {
              version: 1,
              kind: publication.kind,
              eventSequence: publication.eventIndex === null
                ? null
                : events[publication.eventIndex]!.sequence,
            },
    }));
    const nextSnapshot: DurableGameTurnSnapshotV1 = {
      version: 1,
      execution: {
        version: 1,
        gameId: draft.gameId,
        ownerEpoch: base.execution.ownerEpoch,
        status: draft.nextExecution.status,
        heads: {
          version: 1,
          turnSequence: draft.turnSequence,
          eventSequence: draft.expectedBaseHeads.eventSequence + events.length,
          eventHash,
          dialogueSequence: nextDialogueSequence - 1,
          publicationSequence: draft.expectedBaseHeads.publicationSequence + publications.length,
        },
        lastPresentationPhase: draft.nextExecution.lastPresentationPhase,
        nextPublicationAvailableAt: draft.nextExecution.nextPublicationAvailableAt,
        xstateSnapshot: structuredClone(draft.nextExecution.xstateSnapshot),
        cursor: structuredClone(draft.nextExecution.cursor),
        playerContinuityCapsules: structuredClone(draft.nextExecution.playerContinuityCapsules),
        houseNarrativeContinuity: structuredClone(draft.nextExecution.houseNarrativeContinuity),
        retry: structuredClone(draft.nextExecution.retry),
      },
      canonicalEvents: [...base.canonicalEvents, ...events].map((entry) => structuredClone(entry)),
      transcriptEntries: [...base.transcriptEntries, ...transcriptEntries].map((entry) => structuredClone(entry)),
    };
    const result: GameTurnCommitResultV1 = {
      version: 1,
      gameId: draft.gameId,
      turnId: draft.turnId,
      turnSequence: draft.turnSequence,
      intentHash: draft.intentHash,
      effectHash: hashCanonicalJson(draft),
      committedAt,
      state: structuredClone(nextSnapshot.execution),
      canonicalEvents: events.map((event) => ({
        sequence: event.sequence,
        eventHash: hashCanonicalJson(event),
        event: structuredClone(event),
      })),
      dialogueSequences: transcriptEntries.flatMap((entry) => entry.entrySequence ? [entry.entrySequence] : []),
      publications,
      alreadyCommitted: false,
    };
    const committed: DurableGameTurnCommittedV1 = {
      version: 1,
      result,
      snapshot: nextSnapshot,
    };
    this.snapshot = structuredClone(nextSnapshot);
    this.committed.set(draft.turnId, structuredClone(committed));
    this.committedActions.push(this.planned.get(draft.turnId)?.branch.action ?? "unknown");
    this.committedDrafts.push(structuredClone(draft));
    this.onCommit?.(draft, nextSnapshot);
    if (
      !this.threwAfterCommit
      && this.throwAfterCommitAction === this.planned.get(draft.turnId)?.branch.action
    ) {
      this.threwAfterCommit = true;
      throw new Error("simulated ambiguous commit response");
    }
    return structuredClone(committed);
  }
}

class ObservedAgent extends MockAgent {
  introductionCalls = 0;
  lobbyCalls = 0;
  readonly lobbyContexts: PhaseContext[] = [];

  constructor(
    id: string,
    name: string,
    private readonly introductionDelayMs = 0,
  ) {
    super(id, name);
  }

  override async getIntroduction(ctx: PhaseContext) {
    this.introductionCalls += 1;
    if (this.introductionDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.introductionDelayMs));
    }
    return super.getIntroduction(ctx);
  }

  override async getLobbyMessage(ctx: PhaseContext) {
    this.lobbyCalls += 1;
    this.lobbyContexts.push(structuredClone(ctx));
    return super.getLobbyMessage(ctx);
  }
}

const DURABLE_HOUSE_PUBLIC_COPY = "  The House clocks Alpha's entrance and Beta's immediate counter-position.  ";
const DURABLE_HOUSE_NOTEBOOK = "PRIVATE DURABILITY CANARY: Beta intends to test Alpha after the opening.";

class DurableNarrativeHouse extends TemplateHouseInterviewer {
  summaryCalls = 0;

  override async generateHouseSummary(
    context: HouseNarrativeTurnContext,
  ): Promise<HouseSummaryAttemptResult> {
    this.summaryCalls += 1;
    if (context.narrationContext.boundary.actorCoordinate !== "introduction") {
      return super.generateHouseSummary(context);
    }
    const boundary = structuredClone(context.narrationContext.boundary);
    return {
      status: "emitted",
      boundary,
      beat: {
        version: 2,
        boundary: structuredClone(boundary),
        publicSummary: DURABLE_HOUSE_PUBLIC_COPY,
      },
      privateNarrativeNotebook: DURABLE_HOUSE_NOTEBOOK,
      providerCalls: 1,
      usage: [],
    };
  }
}

class SelfMutatingLobbyAgent extends ObservedAgent {
  liveAllies: string[] = [];

  getContinuityCapsule() {
    return {
      version: 2 as const,
      compactStrategy: createOpeningStrategyState(),
      notes: [],
      relationships: { allies: [...this.liveAllies], threats: [] },
      powerActionMemory: [],
      roundHistory: [],
    };
  }

  restoreContinuityCapsule(capsule: Parameters<NonNullable<import("../game-runner.types").IAgent["restoreContinuityCapsule"]>>[0]): void {
    this.liveAllies = [...capsule.relationships.allies];
  }

  override updateAlly(name: string): void {
    if (!this.liveAllies.includes(name)) this.liveAllies.push(name);
  }

  override async getLobbyMessage(ctx: PhaseContext) {
    this.updateAlly("Beta");
    return super.getLobbyMessage(ctx);
  }
}

class ScriptedVoteAgent extends ObservedAgent {
  constructor(
    id: string,
    name: string,
    private readonly voteTarget: string,
    private readonly voteDelayMs = 0,
    private readonly revoteDelayMs = 0,
  ) {
    super(id, name);
  }

  override async getVotes() {
    if (this.voteDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.voteDelayMs));
    }
    return { empowerTarget: this.voteTarget, thinking: "scripted vote" };
  }

  override async getEmpowerRevote(
    _ctx: PhaseContext,
    tiedCandidates: string[],
    _originalVote: { empowerTarget: string },
  ) {
    if (this.revoteDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.revoteDelayMs));
    }
    return { empowerTarget: tiedCandidates[0]!, thinking: "scripted revote" };
  }
}

class FormatContextProbeAgent extends ObservedAgent {
  readonly mingleContexts: PhaseContext[] = [];
  readonly ballotContexts: PhaseContext[] = [];

  override async takeMingleTurn(
    ctx: PhaseContext,
    roomMates: string[],
    conversationHistory?: Array<{ from: string; text: string }>,
  ) {
    this.mingleContexts.push(structuredClone(ctx));
    return super.takeMingleTurn(ctx, roomMates, conversationHistory);
  }

  override async getSaveOrEliminateBallot(ctx: PhaseContext, aliveIds: string[]) {
    this.ballotContexts.push(structuredClone(ctx));
    return super.getSaveOrEliminateBallot(ctx, aliveIds);
  }
}

class EndgameProbeAgent extends ObservedAgent {
  pleaCalls = 0;
  endgameVoteCalls = 0;
  accusationCalls = 0;
  defenseCalls = 0;
  openingCalls = 0;
  juryQuestionCalls = 0;
  juryAnswerCalls = 0;
  closingCalls = 0;
  juryVoteCalls = 0;
  diaryCalls = 0;
  readonly defenseInputs: Array<{ accusation: string; accuserName: string }> = [];

  override async getPlea(ctx: PhaseContext) {
    this.pleaCalls += 1;
    return super.getPlea(ctx);
  }

  override async getEndgameEliminationVote(ctx: PhaseContext) {
    this.endgameVoteCalls += 1;
    return super.getEndgameEliminationVote(ctx);
  }

  override async getAccusation(ctx: PhaseContext) {
    this.accusationCalls += 1;
    return super.getAccusation(ctx);
  }

  override async getDefense(ctx: PhaseContext, accusation: string, accuserName: string) {
    this.defenseCalls += 1;
    this.defenseInputs.push({ accusation, accuserName });
    return super.getDefense(ctx, accusation, accuserName);
  }

  override async getOpeningStatement(ctx: PhaseContext) {
    this.openingCalls += 1;
    return super.getOpeningStatement(ctx);
  }

  override async getJuryQuestion(ctx: PhaseContext, finalistIds: [string, string]) {
    this.juryQuestionCalls += 1;
    return super.getJuryQuestion(ctx, finalistIds);
  }

  override async getJuryAnswer(ctx: PhaseContext, question: string, jurorName: string) {
    this.juryAnswerCalls += 1;
    return super.getJuryAnswer(ctx, question, jurorName);
  }

  override async getClosingArgument(ctx: PhaseContext) {
    this.closingCalls += 1;
    return super.getClosingArgument(ctx);
  }

  override async getJuryVote(ctx: PhaseContext, finalistIds: [string, string]) {
    this.juryVoteCalls += 1;
    return super.getJuryVote(ctx, finalistIds);
  }

  override async getDiaryEntry(
    ctx: PhaseContext,
    question: string,
    sessionHistory?: Array<{ question: string; answer: string }>,
  ) {
    this.diaryCalls += 1;
    return super.getDiaryEntry(ctx, question, sessionHistory);
  }
}

const ENDGAME_DURABLE_CONFIG = {
  ...TEST_GAME_CONFIG,
  formatManifest: ["save_or_eliminate" as const],
  mingleSessionsPerRound: 1,
  diaryRoomAfterPhases: [],
};

const ENDGAME_NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Echo"] as const;

function endgameAgents(ids: readonly string[]): EndgameProbeAgent[] {
  return ids.map((id, index) => new EndgameProbeAgent(id, ENDGAME_NAMES[index]!));
}

async function expectAborted(run: Promise<unknown>): Promise<void> {
  await expect(run).rejects.toThrow("Game run aborted");
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for durable test condition");
}

describe("GameRunner durable logical turns", () => {
  it("commits Two Names as restart-safe staged turns with an atomic Override replacement", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = ["A", "B", "C", "D", "E"].map(
      (name) => new MockAgent(createUUID(), name),
    );
    const [empowered, firstNamed, _secondNamed, replacement] = agents;
    if (!empowered || !firstNamed || !replacement) throw new Error("expected agents");
    for (const agent of agents) {
      agent.getTwoNamesOverride = async () => ({
        action: "use",
        removedNomineeId: firstNamed.id,
        decisionSource: "llm",
        fallbackReason: null,
      });
    }
    empowered.getTwoNamesReplacement = async () => ({
      targetId: replacement.id,
      decisionSource: "llm",
      fallbackReason: null,
    });
    const runner = new GameRunner(
      agents,
      {
        ...TEST_GAME_CONFIG,
        maxRounds: 1,
        minPlayers: 5,
        mingleSessionsPerRound: 1,
        formatManifest: ["two_names"],
      },
      undefined,
      {
        durableTurnStore: store,
        maxRoundsMode: "exact",
      },
    );

    await runner.run();

    expect(store.committedActions).toEqual(expect.arrayContaining([
      "two-names-setup",
      "two-names-initial-mingle",
      "two-names-override-transition",
      "two-names-final-mingle",
      "two-names-plea-1",
      "two-names-plea-2",
      "two-names-ballots",
    ]));
    const transitionIndex = store.committedActions.indexOf("two-names-override-transition");
    const transition = store.committedDrafts[transitionIndex];
    const setup = store.snapshot?.canonicalEvents.find(
      (event) => event.type === "format.two_names_setup",
    );
    if (!setup || setup.type !== "format.two_names_setup") throw new Error("expected Two Names setup");
    const transitionIntent = store.plannedIntentForAction("two-names-override-transition");
    expect(transitionIntent?.providerSubcalls.map((subcall) => ({
      slot: subcall.slot,
      actorId: subcall.actorId,
      action: subcall.action,
    }))).toEqual([
      { slot: 1, actorId: setup.payload.overrideHolderId, action: "format-two-names-override" },
      { slot: 2, actorId: empowered.id, action: "format-two-names-replacement" },
    ]);
    expect(transitionIntent?.providerSubcalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slot: 1,
        semanticCoordinate: {
          version: 1,
          kind: "durable_turn",
          turnId: transitionIntent?.turnId,
          subcallSlot: 1,
        },
        logicalCallId: durableProviderLogicalCallId({
          gameId: transitionIntent?.gameId ?? "",
          turnId: transitionIntent?.turnId ?? "",
          subcallSlot: 1,
        }),
      }),
      expect.objectContaining({
        slot: 2,
        semanticCoordinate: {
          version: 1,
          kind: "durable_turn",
          turnId: transitionIntent?.turnId,
          subcallSlot: 2,
        },
        logicalCallId: durableProviderLogicalCallId({
          gameId: transitionIntent?.gameId ?? "",
          turnId: transitionIntent?.turnId ?? "",
          subcallSlot: 2,
        }),
      }),
    ]));
    const initialMingleIntent = store.plannedIntentForAction("two-names-initial-mingle");
    const finalMingleIntent = store.plannedIntentForAction("two-names-final-mingle");
    expect(initialMingleIntent?.providerSubcalls).toEqual([
      expect.objectContaining({ actorId: null, action: "house-mingle-assignment" }),
      expect.objectContaining({ actorId: null, action: "house-alliance-proposer-selection" }),
      expect.objectContaining({ actorId: null, action: "house-alliance-huddle-schedule" }),
    ]);
    expect(finalMingleIntent?.providerSubcalls).toEqual([
      expect.objectContaining({ actorId: null, action: "house-mingle-assignment" }),
      expect.objectContaining({ actorId: null, action: "house-alliance-proposer-selection" }),
      expect.objectContaining({ actorId: null, action: "house-alliance-huddle-schedule" }),
    ]);
    expect(initialMingleIntent?.providerSubcalls[0]?.semanticCoordinate).not.toEqual(
      finalMingleIntent?.providerSubcalls[0]?.semanticCoordinate,
    );
    expect(transition?.canonicalEvents.map((event) => event.type)).toEqual([
      "format.two_names_override_used",
      "format.two_names_replacement_named",
    ]);
    expect(store.snapshot?.canonicalEvents.filter(
      (event) => event.type === "format.resolved" && event.payload.formatId === "two_names",
    )).toHaveLength(1);
  });

  it("uses the durable turn seed for replay-stable endgame random tiebreaks", () => {
    const ids = Array.from({ length: 4 }, () => createUUID());
    const base = new GameState(ids.map((id, index) => ({ id, name: ENDGAME_NAMES[index]! })));
    base.eliminatePlayer(ids[2]!);
    base.eliminatePlayer(ids[3]!);
    base.recordJuryVote(ids[2]!, ids[0]!);
    base.recordJuryVote(ids[3]!, ids[1]!);
    const events = base.getCanonicalEvents();
    const first = GameState.fromCanonicalEvents(events);
    const second = GameState.fromCanonicalEvents(events);
    const seed = hashCanonicalJson({ turnId: "judgment-jury-vote", sequence: 42 });

    const firstResult = first.tallyJuryVotes(seededRandom(seed));
    const secondResult = second.tallyJuryVotes(seededRandom(seed));

    expect(firstResult.method).toBe("random_tiebreaker");
    expect(secondResult).toEqual(firstResult);
    expect(first.getCanonicalEvents().at(-1)?.payload).toEqual(second.getCanonicalEvents().at(-1)?.payload);
  });

  it("prepares durable authority and roster bootstrap exactly once before run", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = [
      new ObservedAgent(createUUID(), "Alpha"),
      new ObservedAgent(createUUID(), "Beta"),
      new ObservedAgent(createUUID(), "Gamma"),
    ];
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });

    await Promise.all([
      runner.prepareDurableExecution(),
      runner.prepareDurableExecution(),
    ]);

    expect(store.initializeCalls).toBe(1);
    expect(store.committedActions).toEqual(["bootstrap-roster"]);
    expect(store.snapshot!.execution.cursor).toEqual({
      version: 1,
      kind: "phase_enter",
      actor: "introduction",
    });

    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "lobby") {
        runner.abort();
      }
    };
    await expectAborted(runner.run());
    expect(store.initializeCalls).toBe(1);
    expect(store.committedActions.filter((action) => action === "bootstrap-roster")).toHaveLength(1);
  });

  it("plans before parallel dispatch and commits introductions in stable roster order", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = [
      new ObservedAgent(createUUID(), "Alpha", 20),
      new ObservedAgent(createUUID(), "Beta", 10),
      new ObservedAgent(createUUID(), "Gamma", 1),
    ];
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "lobby") {
        runner.abort();
      }
    };

    await expectAborted(runner.run());

    expect(store.plannedActions).toEqual(["bootstrap-roster", "introduction"]);
    expect(agents.every((agent) => agent.introductionCalls === 1)).toBe(true);
    expect(
      runner.transcriptLog
        .filter((entry) => entry.scope === "public")
        .map((entry) => entry.from),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
    const introductionDraft = store.committedDrafts.find((draft) =>
      draft.nextExecution.cursor.kind === "phase_enter"
      && draft.nextExecution.cursor.actor === "lobby"
    );
    expect(introductionDraft).toBeDefined();
    const publicationTimes = introductionDraft!.publications.map((publication) => publication.availableAt);
    expect(publicationTimes.every((availableAt) => availableAt !== null)).toBe(true);
    expect(publicationTimes).toEqual([...publicationTimes].sort());
    expect(new Set(publicationTimes).size).toBe(publicationTimes.length);
    expect(introductionDraft!.nextExecution.nextPublicationAvailableAt).toBe(publicationTimes.at(-1) ?? null);
    expect(introductionDraft!.nextExecution.lastPresentationPhase).toBe(Phase.INTRODUCTION);
    const publishedTranscriptScopes = introductionDraft!.publications.flatMap((publication) =>
      publication.kind === "transcript_entry"
        ? [introductionDraft!.transcriptEntries[publication.transcriptIndex]!.scope]
        : [],
    );
    expect(publishedTranscriptScopes).toContain("system");
    expect(publishedTranscriptScopes).toContain("public");
  });

  it("commits House-authored public copy and its private notebook atomically before release", async () => {
    const store = new MemoryDurableTurnStore();
    store.throwAfterCommitAction = "introduction";
    const house = new DurableNarrativeHouse();
    const agents = ["Alpha", "Beta", "Gamma"].map(
      (name) => new ObservedAgent(createUUID(), name),
    );
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, house, {
      durableTurnStore: store,
    });
    let durableAtRelease = false;
    const streamed: unknown[] = [];
    runner.setStreamListener((event) => {
      streamed.push(structuredClone(event));
      if (
        event.type === "agent_turn"
        && event.action === "house-mc-summary"
        && event.text === DURABLE_HOUSE_PUBLIC_COPY
      ) {
        const continuity = store.snapshot?.execution.houseNarrativeContinuity;
        durableAtRelease = continuity?.privateNarrativeNotebook === DURABLE_HOUSE_NOTEBOOK
          && continuity.recentBeats.some(
            (beat) => beat.publicSummary === DURABLE_HOUSE_PUBLIC_COPY,
          );
      }
    });
    store.onCommit = (draft) => {
      if (
        draft.nextExecution.cursor.kind === "phase_enter"
        && draft.nextExecution.cursor.actor === "lobby"
      ) {
        runner.abort();
      }
    };

    await expectAborted(runner.run());

    expect(house.summaryCalls).toBe(1);
    expect(durableAtRelease).toBe(true);
    expect(store.snapshot!.transcriptEntries.some(
      (entry) => entry.dialogueKind === "house_summary"
        && entry.text === DURABLE_HOUSE_PUBLIC_COPY,
    )).toBe(true);
    expect(store.snapshot!.execution.houseNarrativeContinuity?.privateNarrativeNotebook)
      .toBe(DURABLE_HOUSE_NOTEBOOK);
    expect(JSON.stringify(streamed)).not.toContain(DURABLE_HOUSE_NOTEBOOK);
  });

  it("does not dispatch the next Lobby consumer until the prior speaker commit returns", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = [
      new ObservedAgent(createUUID(), "Alpha"),
      new ObservedAgent(createUUID(), "Beta"),
      new ObservedAgent(createUUID(), "Gamma"),
    ];
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let heldFirstLobbyCommit = false;
    store.beforeCommit = async (_draft) => {
      const action = store.plannedActions.at(-1);
      if (action === "lobby-speech" && !heldFirstLobbyCommit) {
        heldFirstLobbyCommit = true;
        await commitGate;
      }
    };
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "serial_actor"
          && draft.nextExecution.cursor.lane === "lobby_speech"
          && draft.nextExecution.cursor.actorIndex === 1) {
        runner.abort();
      }
    };

    const run = runner.run();
    await waitFor(() => heldFirstLobbyCommit && agents[0]!.lobbyCalls === 1);
    expect(agents[1]!.lobbyCalls).toBe(0);
    releaseCommit?.();
    await expectAborted(run);
  });

  it("stages provider-method continuity writes without mutating the live agent before commit", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = [
      new SelfMutatingLobbyAgent(createUUID(), "Alpha"),
      new SelfMutatingLobbyAgent(createUUID(), "Beta"),
      new SelfMutatingLobbyAgent(createUUID(), "Gamma"),
    ];
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let held = false;
    store.beforeCommit = async () => {
      if (store.plannedActions.at(-1) === "lobby-speech" && !held) {
        held = true;
        await commitGate;
      }
    };
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "serial_actor"
          && draft.nextExecution.cursor.lane === "lobby_speech"
          && draft.nextExecution.cursor.actorIndex === 1) {
        runner.abort();
      }
    };

    const run = runner.run();
    await waitFor(() => held && agents[0]!.lobbyCalls === 1);
    expect(agents[0]!.liveAllies).toEqual([]);
    releaseCommit?.();
    await expectAborted(run);
    expect(agents[0]!.liveAllies).toContain("Beta");
  });

  it("commits initial votes and re-votes in stable roster order", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = [createUUID(), createUUID(), createUUID(), createUUID()];
    const agents = [
      new ScriptedVoteAgent(ids[0]!, "Alpha", ids[1]!, 20),
      new ScriptedVoteAgent(ids[1]!, "Beta", ids[0]!, 15),
      new ScriptedVoteAgent(ids[2]!, "Gamma", ids[0]!, 10, 20),
      new ScriptedVoteAgent(ids[3]!, "Delta", ids[1]!, 1, 1),
    ];
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "format_menu") {
        runner.abort();
      }
    };

    await expectAborted(runner.run());

    expect(
      store.snapshot!.canonicalEvents
        .filter((event) => event.type === "vote.cast")
        .map((event) => event.type === "vote.cast" ? event.payload.voterId : ""),
    ).toEqual(ids);
    expect(
      store.snapshot!.canonicalEvents
        .filter((event) => event.type === "vote.empower_revote_cast")
        .map((event) => event.type === "vote.empower_revote_cast" ? event.payload.voterId : ""),
    ).toEqual([ids[2]!, ids[3]!]);
  });

  it("commits the format menu and empowered pick before entering durable Mingle", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = [
      new ObservedAgent(createUUID(), "Alpha"),
      new ObservedAgent(createUUID(), "Beta"),
      new ObservedAgent(createUUID(), "Gamma"),
    ];
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "format_mingle") {
        runner.abort();
      }
    };

    await expectAborted(runner.run());

    expect(store.committedActions).toContain("format-menu");
    expect(store.committedActions).toContain("format-pick");
    expect(
      store.snapshot!.canonicalEvents.some((event) => event.type === "format.selected"),
    ).toBe(true);
    expect(store.snapshot!.execution.cursor).toEqual({
      version: 1,
      kind: "phase_enter",
      actor: "format_mingle",
    });
  });

  it("resumes from committed Format Mingle authority and commits resolution at the Reckoning cursor", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = Array.from({ length: 5 }, () => createUUID());
    const firstAgents = ids.map((id, index) =>
      new ObservedAgent(id, ["Alpha", "Beta", "Gamma", "Delta", "Echo"][index]!),
    );
    const config = {
      ...TEST_GAME_CONFIG,
      formatManifest: ["save_or_eliminate" as const],
      mingleSessionsPerRound: 1,
    };
    const firstRunner = new GameRunner(firstAgents, config, undefined, {
      gameId: createUUID(),
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "format_mingle") {
        firstRunner.abort();
      }
    };
    await expectAborted(firstRunner.run());

    const resumedAgents = ids.map((id, index) =>
      new FormatContextProbeAgent(id, ["Alpha", "Beta", "Gamma", "Delta", "Echo"][index]!),
    );
    const resumedRunner = new GameRunner(resumedAgents, config, undefined, {
      gameId: store.snapshot!.execution.gameId,
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "reckoning_lobby") {
        resumedRunner.abort();
      }
    };
    await expectAborted(resumedRunner.run());

    expect(resumedAgents.every((agent) => agent.introductionCalls === 0)).toBe(true);
    expect(resumedAgents.every((agent) => agent.lobbyCalls === 0)).toBe(true);
    const mingleContexts = resumedAgents.flatMap((agent) => agent.mingleContexts);
    expect(mingleContexts.length).toBeGreaterThan(0);
    expect(mingleContexts.every((ctx) => ctx.revealedVoteLedger?.length === ids.length)).toBe(true);
    expect(mingleContexts.every((ctx) => ctx.formatPressure?.selectedFormat === "save_or_eliminate")).toBe(true);
    const ballotContexts = resumedAgents.flatMap((agent) => agent.ballotContexts);
    expect(ballotContexts).toHaveLength(ids.length);
    expect(ballotContexts.every((ctx) => ctx.revealedVoteLedger?.length === ids.length)).toBe(true);
    expect(ballotContexts.every((ctx) => ctx.formatPressure?.selectedFormat === "save_or_eliminate")).toBe(true);
    expect(store.committedActions.filter((action) => action === "format-mingle")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "format-resolve")).toHaveLength(1);
    expect(store.snapshot!.canonicalEvents.filter((event) => event.type === "mingle.rooms_allocated")).toHaveLength(1);
    expect(store.snapshot!.canonicalEvents.filter((event) => event.type === "format.resolved")).toHaveLength(1);
    expect(store.snapshot!.canonicalEvents.filter((event) => event.type === "player.eliminated")).toHaveLength(1);
    expect(store.snapshot!.execution.cursor).toEqual({
      version: 1,
      kind: "phase_enter",
      actor: "reckoning_lobby",
    });
  });

  it("reproduces the exact Safety Bounce resolution draft after a pre-commit restart", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = Array.from({ length: 5 }, () => createUUID());
    const names = ["Alpha", "Beta", "Gamma", "Delta", "Echo"];
    const config = {
      ...TEST_GAME_CONFIG,
      formatManifest: ["safety_bounce" as const],
      mingleSessionsPerRound: 1,
    };
    const setupRunner = new GameRunner(
      ids.map((id, index) => new ObservedAgent(id, names[index]!)),
      config,
      undefined,
      { gameId: createUUID(), durableTurnStore: store },
    );
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "format_resolve") {
        setupRunner.abort();
      }
    };
    await expectAborted(setupRunner.run());

    let failedDraft: GameTurnCommitDraftV1 | null = null;
    store.onCommit = undefined;
    store.beforeCommit = async (draft) => {
      if (draft.canonicalEvents.some((event) => event.type === "format.safety_bounce_started")) {
        failedDraft = structuredClone(draft);
        throw new Error("simulated crash before durable format resolution commit");
      }
    };
    const failedRunner = new GameRunner(
      ids.map((id, index) => new ObservedAgent(id, names[index]!)),
      config,
      undefined,
      { gameId: store.snapshot!.execution.gameId, durableTurnStore: store },
    );
    await expect(failedRunner.run()).rejects.toThrow("simulated crash before durable format resolution commit");
    expect(store.snapshot!.execution.cursor).toEqual({
      version: 1,
      kind: "phase_enter",
      actor: "format_resolve",
    });

    let committedDraft: GameTurnCommitDraftV1 | null = null;
    store.beforeCommit = undefined;
    const resumedRunner = new GameRunner(
      ids.map((id, index) => new ObservedAgent(id, names[index]!)),
      config,
      undefined,
      { gameId: store.snapshot!.execution.gameId, durableTurnStore: store },
    );
    store.onCommit = (draft) => {
      if (draft.canonicalEvents.some((event) => event.type === "format.safety_bounce_started")) {
        committedDraft = structuredClone(draft);
        resumedRunner.abort();
      }
    };
    await expectAborted(resumedRunner.run());

    expect(failedDraft).not.toBeNull();
    expect(committedDraft).not.toBeNull();
    expect(hashCanonicalJson(committedDraft)).toBe(hashCanonicalJson(failedDraft));
    const failedStarter = failedDraft!.canonicalEvents.find(
      (event) => event.type === "format.safety_bounce_started",
    );
    const committedStarter = committedDraft!.canonicalEvents.find(
      (event) => event.type === "format.safety_bounce_started",
    );
    expect(committedStarter?.payload).toEqual(failedStarter?.payload);
  });

  it("commits a terminal execution head and returns when Format Resolve reaches actor end", async () => {
    const store = new MemoryDurableTurnStore();
    const agents = ["Alpha", "Beta", "Gamma", "Delta", "Echo"].map(
      (name) => new ObservedAgent(createUUID(), name),
    );
    const runner = new GameRunner(
      agents,
      {
        ...TEST_GAME_CONFIG,
        maxRounds: 1,
        formatManifest: ["save_or_eliminate"],
        mingleSessionsPerRound: 1,
      },
      undefined,
      {
        durableTurnStore: store,
        maxRoundsMode: "exact",
      },
    );

    const result = await runner.run();

    expect(result.rounds).toBe(1);
    expect(store.snapshot!.execution.status).toBe("terminal");
    expect(store.snapshot!.execution.cursor).toEqual({
      version: 1,
      kind: "terminal",
      stage: "commit_game",
    });
    expect(store.snapshot!.execution.xstateSnapshot.value).toBe("end");
    expect(store.committedActions.at(-1)).toBe("format-resolve");
    const terminalDraft = store.committedDrafts.at(-1)!;
    expect(terminalDraft.publications.filter((publication) => publication.kind === "completion")).toEqual([{
      version: 1,
      kind: "completion",
      eventIndex: null,
      availableAt: null,
    }]);
    expect(terminalDraft.nextExecution.nextPublicationAvailableAt).toBeNull();
  });

  it("resumes at Reckoning vote without repeating committed lobby or plea effects", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = Array.from({ length: 5 }, () => createUUID());
    const firstAgents = endgameAgents(ids);
    const firstRunner = new GameRunner(firstAgents, ENDGAME_DURABLE_CONFIG, undefined, {
      gameId: createUUID(),
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "reckoning_vote") {
        firstRunner.abort();
      }
    };
    await expectAborted(firstRunner.run());
    expect(firstAgents.map((agent) => agent.pleaCalls)).toEqual([1, 1, 1, 1, 0]);

    const resumedAgents = endgameAgents(ids);
    const resumedRunner = new GameRunner(resumedAgents, ENDGAME_DURABLE_CONFIG, undefined, {
      gameId: store.snapshot!.execution.gameId,
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "tribunal_lobby") {
        resumedRunner.abort();
      }
    };
    await expectAborted(resumedRunner.run());

    expect(resumedAgents.every((agent) => agent.pleaCalls === 0)).toBe(true);
    expect(resumedAgents.reduce((sum, agent) => sum + agent.endgameVoteCalls, 0)).toBe(4);
    expect(store.committedActions.filter((action) => action === "reckoning-lobby")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "reckoning-plea")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "reckoning-vote")).toHaveLength(1);
    expect(store.snapshot!.canonicalEvents.filter((event) =>
      event.type === "endgame.elimination_resolved" && event.payload.stage === "reckoning"
    )).toHaveLength(1);
  });

  it("rebuilds Tribunal defenses from typed canonical accusations after reload", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = Array.from({ length: 5 }, () => createUUID());
    const setupRunner = new GameRunner(endgameAgents(ids), ENDGAME_DURABLE_CONFIG, undefined, {
      gameId: createUUID(),
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "tribunal_defense") {
        setupRunner.abort();
      }
    };
    await expectAborted(setupRunner.run());

    const canonicalAccusations = store.snapshot!.canonicalEvents.filter(
      (event) => event.type === "endgame.speech_recorded"
        && event.payload.speechKind === "accusation",
    );
    expect(canonicalAccusations.length).toBeGreaterThan(0);
    for (const entry of store.snapshot!.transcriptEntries) {
      if (entry.phase === Phase.ACCUSATION && entry.scope === "public") {
        entry.text = "TRANSCRIPT PROSE CANARY — never use as accusation authority";
      }
    }

    const resumedAgents = endgameAgents(ids);
    const resumedRunner = new GameRunner(resumedAgents, ENDGAME_DURABLE_CONFIG, undefined, {
      gameId: store.snapshot!.execution.gameId,
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "tribunal_vote") {
        resumedRunner.abort();
      }
    };
    await expectAborted(resumedRunner.run());

    const canonicalByTarget = new Map<string, string>();
    for (const event of canonicalAccusations) {
      if (event.type === "endgame.speech_recorded" && event.payload.targetId) {
        canonicalByTarget.set(event.payload.targetId, event.payload.text);
      }
    }
    const capturedByTarget = new Map(
      resumedAgents.flatMap((agent) => agent.defenseInputs.map((input) => [agent.id, input.accusation] as const)),
    );
    expect(capturedByTarget).toEqual(canonicalByTarget);
    expect([...capturedByTarget.values()]).not.toContain("TRANSCRIPT PROSE CANARY — never use as accusation authority");
    expect(resumedAgents.every((agent) => agent.accusationCalls === 0)).toBe(true);
    expect(store.committedActions.filter((action) => action === "tribunal-accusation")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "tribunal-defense")).toHaveLength(1);
  });

  it("resumes Judgment Q&A and jury vote without repeating committed finale turns", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = Array.from({ length: 5 }, () => createUUID());
    const config = {
      ...ENDGAME_DURABLE_CONFIG,
      diaryRoomAfterPhases: [Phase.OPENING_STATEMENTS],
    };
    const setupAgents = endgameAgents(ids);
    const setupRunner = new GameRunner(setupAgents, config, undefined, {
      gameId: createUUID(),
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "judgment_jury_questions") {
        setupRunner.abort();
      }
    };
    await expectAborted(setupRunner.run());
    expect(setupAgents.reduce((sum, agent) => sum + agent.openingCalls, 0)).toBe(2);
    expect(setupAgents.reduce((sum, agent) => sum + agent.diaryCalls, 0)).toBe(5);
    const openingDraft = store.committedDrafts.find((draft) =>
      draft.nextExecution.cursor.kind === "phase_enter"
      && draft.nextExecution.cursor.actor === "judgment_jury_questions"
    );
    expect(openingDraft?.transcriptEntries.some((entry) => entry.scope === "diary")).toBe(true);

    const questionAgents = endgameAgents(ids);
    const questionRunner = new GameRunner(questionAgents, config, undefined, {
      gameId: store.snapshot!.execution.gameId,
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "judgment_jury_vote") {
        questionRunner.abort();
      }
    };
    await expectAborted(questionRunner.run());
    const juryQuestionCalls = questionAgents.reduce((sum, agent) => sum + agent.juryQuestionCalls, 0);
    expect(juryQuestionCalls).toBeGreaterThan(0);
    expect(questionAgents.reduce((sum, agent) => sum + agent.closingCalls, 0)).toBe(2);
    expect(questionAgents.every((agent) => agent.openingCalls === 0)).toBe(true);

    const voteAgents = endgameAgents(ids);
    const voteRunner = new GameRunner(voteAgents, config, undefined, {
      gameId: store.snapshot!.execution.gameId,
      durableTurnStore: store,
    });
    store.onCommit = undefined;
    const result = await voteRunner.run();

    expect(result.winner).toBeDefined();
    expect(voteAgents.every((agent) => agent.juryQuestionCalls === 0)).toBe(true);
    expect(voteAgents.every((agent) => agent.closingCalls === 0)).toBe(true);
    expect(voteAgents.reduce((sum, agent) => sum + agent.juryVoteCalls, 0)).toBeGreaterThan(0);
    expect(store.committedActions.filter((action) => action === "judgment-opening")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "judgment-jury-questions")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "judgment-closing")).toHaveLength(1);
    expect(store.committedActions.filter((action) => action === "judgment-jury-vote")).toHaveLength(1);
    expect(store.snapshot!.execution.status).toBe("terminal");
    expect(store.committedDrafts.at(-1)!.publications.at(-1)).toEqual({
      version: 1,
      kind: "completion",
      eventIndex: null,
      availableAt: null,
    });
  });

  it("installs an ambiguously committed turn without repeating provider dispatch or effects", async () => {
    const store = new MemoryDurableTurnStore();
    store.throwAfterCommitAction = "introduction";
    const agents = [
      new ObservedAgent(createUUID(), "Alpha"),
      new ObservedAgent(createUUID(), "Beta"),
      new ObservedAgent(createUUID(), "Gamma"),
    ];
    const runner = new GameRunner(agents, TEST_GAME_CONFIG, undefined, {
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "phase_enter"
          && draft.nextExecution.cursor.actor === "lobby") {
        runner.abort();
      }
    };

    await expectAborted(runner.run());

    expect(agents.map((agent) => agent.introductionCalls)).toEqual([1, 1, 1]);
    expect(
      store.snapshot?.transcriptEntries.filter((entry) => entry.scope === "public").length,
    ).toBe(3);
  });

  it("resumes a committed mid-Lobby cursor without duplicate dispatch or effects", async () => {
    const store = new MemoryDurableTurnStore();
    const ids = [createUUID(), createUUID(), createUUID()];
    const firstAgents = [
      new ObservedAgent(ids[0]!, "Alpha"),
      new ObservedAgent(ids[1]!, "Beta"),
      new ObservedAgent(ids[2]!, "Gamma"),
    ];
    const firstRunner = new GameRunner(firstAgents, TEST_GAME_CONFIG, undefined, {
      gameId: createUUID(),
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "serial_actor"
          && draft.nextExecution.cursor.lane === "lobby_speech"
          && draft.nextExecution.cursor.actorIndex === 1) {
        firstRunner.abort();
      }
    };
    await expectAborted(firstRunner.run());

    const gameId = store.snapshot!.execution.gameId;
    const resumedAgents = [
      new ObservedAgent(ids[0]!, "Alpha"),
      new ObservedAgent(ids[1]!, "Beta"),
      new ObservedAgent(ids[2]!, "Gamma"),
    ];
    const resumedRunner = new GameRunner(resumedAgents, TEST_GAME_CONFIG, undefined, {
      gameId,
      durableTurnStore: store,
    });
    store.onCommit = (draft) => {
      if (draft.nextExecution.cursor.kind === "serial_actor"
          && draft.nextExecution.cursor.lane === "lobby_speech"
          && draft.nextExecution.cursor.actorIndex === 2) {
        resumedRunner.abort();
      }
    };
    await expectAborted(resumedRunner.run());

    expect(resumedAgents.map((agent) => agent.introductionCalls)).toEqual([0, 0, 0]);
    expect(resumedAgents.map((agent) => agent.lobbyCalls)).toEqual([0, 1, 0]);
    expect(
      resumedAgents[1]!.lobbyContexts[0]!.publicMessages.some(
        (entry) => entry.from === "Alpha" && entry.phase === "LOBBY",
      ),
    ).toBe(true);
    expect(
      store.snapshot!.transcriptEntries.filter(
        (entry) => entry.scope === "public" && entry.phase === "LOBBY",
      ).map((entry) => entry.from),
    ).toEqual(["Alpha", "Beta"]);
  });
});
