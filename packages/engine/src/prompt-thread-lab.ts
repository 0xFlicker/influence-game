import {
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  canonicalJson,
  hashCanonicalJson,
  parseArtifact,
  type ContinuationCheckpointArtifact,
  type FrozenCaseArtifact,
  type JsonObject,
  type JsonValue,
} from "@influence/prompt-lab-protocol";
import type OpenAI from "openai";
import { InfluenceAgent, type Personality } from "./agent";
import { ContextBuilder } from "./context-builder";
import { GameState } from "./game-state";
import type {
  IAgent,
  MingleIntentAction,
  PlayerContinuityCapsule,
  PrivateDecisionTrace,
  TranscriptEntry,
} from "./game-runner.types";
import {
  commitMingleTurnMovements,
  DEFAULT_MINGLE_BEATS,
  executeMingleTurn,
  initializeMingleExecution,
  type CollectedMingleTurn,
  type MingleTurnExecutionRecord,
} from "./mingle-turn-execution";
import { providerProfileById } from "./model-catalog";
import {
  prepareAgentPhaseContext,
  type PhaseRunnerContext,
} from "./phases/phase-runner-context";
import { buildRevealedRoundFacts } from "./revealed-round-facts";
import { TranscriptLogger } from "./transcript-logger";
import {
  DEFAULT_CONFIG,
  Phase,
  type GameConfig,
  type MingleRoomCount,
  type RoomAllocation,
  type UUID,
} from "./types";

const TRANSPORT_ONLY_EXCLUSIONS = ["request.transportOnly"] as const;
const PERSONALITIES = new Set<Personality>([
  "honest",
  "strategic",
  "deceptive",
  "paranoid",
  "social",
  "aggressive",
  "loyalist",
  "observer",
  "diplomat",
  "wildcard",
  "contrarian",
  "provocateur",
  "martyr",
  "broker",
]);

interface StoredTrace {
  manifestId: string;
  actorId: UUID;
  action: "mingle-intent" | "mingle-turn";
  body: Record<string, unknown>;
  output: Record<string, unknown>;
}

interface ReplayScheduleBeat {
  roomId: number;
  round: number;
  beat: number;
  playerIds: UUID[];
  roomCounts: MingleRoomCount[];
}

interface ValidatedPromptThreadCase {
  artifact: FrozenCaseArtifact;
  gameState: GameState;
  config: GameConfig & { mingleSessionsPerRound: number };
  actorIds: [UUID, UUID];
  roster: Array<{
    id: UUID;
    name: string;
    personality: Personality;
    model: string;
    reasoningPolicy: string;
    providerProfileId: string;
    catalogId?: string;
    backstory?: string;
    personalityPrompt?: string;
    strategyInstructions?: string;
  }>;
  continuity: Map<UUID, PlayerContinuityCapsule>;
  transcriptReplay: TranscriptEntry[];
  schedule: [ReplayScheduleBeat, ReplayScheduleBeat];
  traces: [
    StoredTrace,
    StoredTrace,
    StoredTrace,
    StoredTrace,
    StoredTrace,
    StoredTrace,
  ];
  exclusions: readonly (typeof TRANSPORT_ONLY_EXCLUSIONS)[number][];
}

export interface PromptThreadReplayTurn {
  turn: number;
  beat: number;
  actorId: UUID;
  conversationHistoryBefore: Array<{ from: string; text: string }>;
  inboxBefore: Array<{ from: string; text: string }>;
  message: string | null;
}

export interface PromptThreadReplayCapture {
  caseId: string;
  actorOrder: UUID[];
  traces: PrivateDecisionTrace[];
  turns: PromptThreadReplayTurn[];
  movementRecords: MingleTurnExecutionRecord[];
  checkpoints: ContinuationCheckpointArtifact[];
  selectionExplanations: PromptThreadSelectionExplanation[];
}

export interface PromptThreadSelectionExplanation {
  turn: number;
  actorId: UUID;
  promptClass: string;
  laneSummary: {
    protectedCount: number;
    hotCount: number;
    authorizedHistoryCount: number;
    selectedHistoryCount: number;
  };
  budget: {
    envelopeChars: number;
    historyBudgetChars: number;
    protectedChars: number;
    hotChars: number;
    historyChars: number;
  };
  items: Array<{
    sourceId: string;
    terminalReason: "selected_history" | "history_disabled" | "seed_miss" | "budget_excluded";
  }>;
}

export interface PromptThreadGeneratedCellInput {
  turn: 1 | 2 | 3 | 4;
  model: string;
  promptCacheKey: string;
  previousResponses: unknown[];
  dispatch: (request: Record<string, unknown>) => Promise<unknown>;
}

export interface PromptThreadGeneratedCellResult {
  request: Record<string, unknown>;
  response: unknown;
  capture: PromptThreadReplayCapture;
  checkpoint: ContinuationCheckpointArtifact;
}

export interface PromptThreadFidelityReceipt {
  version: 1;
  status: "matched";
  caseId: string;
  turnCount: 4;
  canonicalizerId: typeof CANONICALIZER_ID;
  canonicalizerVersion: typeof CANONICALIZER_VERSION;
  comparedLanes: string[];
  transportOnlyExclusions: string[];
  sourceMutation: false;
}

export async function capturePromptThreadReplay(
  caseValue: FrozenCaseArtifact,
  options: {
    onDeterministicProviderSetup?: () => void;
    generatedCell?: PromptThreadGeneratedCellInput;
  } = {},
): Promise<PromptThreadReplayCapture> {
  const validated = validatePromptThreadCase(caseValue);
  options.onDeterministicProviderSetup?.();
  const generatedCell = options.generatedCell;
  if (
    generatedCell
    && generatedCell.previousResponses.length !== generatedCell.turn - 1
  ) {
    throw new Error("Generated prompt-thread cell requires every prior branch response");
  }

  const { gameState } = validated;
  const logger = new TranscriptLogger(gameState);
  logger.seed(validated.transcriptReplay);
  const mingleInbox = new Map<UUID, Array<{ from: string; text: string }>>();
  const selectionExplanations: PromptThreadSelectionExplanation[] = [];
  const contextBuilder = new ContextBuilder(
    gameState,
    logger,
    mingleInbox,
    validated.roster.length,
    undefined,
    (observation) => {
      if (observation.promptClass !== "ordinary_speech") return;
      selectionExplanations.push({
        turn: selectionExplanations.length + 1,
        actorId: observation.actorId,
        promptClass: observation.promptClass,
        laneSummary: structuredClone(observation.laneSummary),
        budget: structuredClone(observation.budget),
        items: structuredClone(observation.explanation),
      });
    },
  );
  hydrateRevealedVoteLedger(
    contextBuilder,
    gameState.getCanonicalEvents(),
  );
  const capturedTraces: PrivateDecisionTrace[] = [];
  const agents = new Map<UUID, IAgent>();
  const scriptsByActor = new Map<UUID, StoredTrace[]>();
  for (const trace of validated.traces) {
    const scripts = scriptsByActor.get(trace.actorId) ?? [];
    scripts.push(trace);
    scriptsByActor.set(trace.actorId, scripts);
  }
  const generatedProvider = generatedCell
    ? createGeneratedCellProvider(validated, generatedCell)
    : null;

  for (const actorId of validated.actorIds) {
    const roster = validated.roster.find((entry) => entry.id === actorId)!;
    const profileId = providerProfileId(roster.providerProfileId);
    const providerProfile = providerProfileById(profileId);
    const agent = new InfluenceAgent(
      roster.id,
      roster.name,
      roster.personality,
      generatedProvider?.clientFor(actorId)
        ?? deterministicOpenAIStub(scriptsByActor.get(actorId) ?? []),
      generatedCell?.model ?? roster.model,
      roster.backstory,
      undefined,
      {
        providerProfileId: profileId,
        reasoningPolicy: reasoningPolicy(roster.reasoningPolicy),
        ...(providerProfile.openAIReasoningSummary
          ? { openAIReasoningSummary: providerProfile.openAIReasoningSummary }
          : {}),
        ...(roster.catalogId ? { catalogId: roster.catalogId } : {}),
        privateTraceSink: (trace) => {
          capturedTraces.push(trace);
        },
        ...(roster.personalityPrompt
          ? { personalityPrompt: roster.personalityPrompt }
          : {}),
        ...(roster.strategyInstructions
          ? { strategyInstructions: roster.strategyInstructions }
          : {}),
        ...(generatedCell
          ? {
              promptCacheLineage: generatedCell.promptCacheKey,
              requireOpenAIResponses: true,
              evaluationFailFast: true,
              structuredCallMaxAttempts: 1,
            }
          : {}),
      },
    );
    const allPlayers = validated.roster.map(({ id, name }) => ({ id, name }));
    agent.onGameStart(gameState.gameId, allPlayers);
    agent.restoreContinuityCapsule(validated.continuity.get(actorId)!, {
      livingPlayerNames: gameState.getAlivePlayers().map((player) => player.name),
    });
    agents.set(actorId, agent);
  }

  const ctx = {
    gameState,
    agents,
    config: validated.config,
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
  const initialized = initializeMingleExecution(ctx, Phase.MINGLE_I);
  if (initialized.roomCount !== validated.schedule[0].roomCounts.length) {
    throw new Error(
      "Prompt-thread room-count policy does not match the frozen full roomCounts",
    );
  }

  const intents = new Map<UUID, MingleIntentAction>();
  for (const actorId of validated.actorIds) {
    const agent = agents.get(actorId)!;
    const phaseContext = prepareAgentPhaseContext(
      ctx,
      agent,
      actorId,
      Phase.MINGLE_I,
      "strategic_decision",
      undefined,
      undefined,
      {
        roomCount: initialized.roomCount,
        roomCounts: validated.schedule[0].roomCounts,
      },
    );
    const intent = await agent.getMingleIntent?.(phaseContext);
    if (!intent) {
      throw new Error(`Recorded Mingle intent did not replay for actor ${actorId}`);
    }
    intents.set(actorId, intent);
  }

  const turns: PromptThreadReplayTurn[] = [];
  const movementRecords: MingleTurnExecutionRecord[] = [];
  const checkpoints: ContinuationCheckpointArtifact[] = [];
  const roomByPlayerId = new Map<UUID, number>(
    validated.schedule[0].playerIds.map((playerId) => [
      playerId,
      validated.schedule[0].roomId,
    ]),
  );
  let turnNumber = 0;

  replayBeats:
  for (const beat of validated.schedule) {
    for (const playerId of beat.playerIds) {
      roomByPlayerId.set(playerId, beat.roomId);
    }
    const room: RoomAllocation = {
      roomId: beat.roomId,
      round: beat.round,
      beat: beat.beat,
      playerIds: [...beat.playerIds],
    };
    contextBuilder.currentRoomAllocations = [room];
    contextBuilder.currentRoomCounts = beat.roomCounts.map((count) => ({ ...count }));
    const conversationHistory: Array<{ from: string; text: string }> = [];
    const collectedBeatTurns: CollectedMingleTurn[] = [];

    for (const actorId of validated.actorIds) {
      turnNumber += 1;
      const conversationHistoryBefore = conversationHistory.map((entry) => ({
        ...entry,
      }));
      const inboxBefore = (mingleInbox.get(actorId) ?? []).map((entry) => ({
        ...entry,
      }));
      const collected = await executeMingleTurn({
        ctx,
        phase: Phase.MINGLE_I,
        room,
        playerId: actorId,
        roomCount: initialized.roomCount,
        roomCounts: beat.roomCounts,
        mingleIntent: summarizeIntent(intents.get(actorId)!),
        totalBeats: validated.config.mingleSessionsPerRound,
        conversationHistory,
      });
      collectedBeatTurns.push(collected);
      turns.push({
        turn: turnNumber,
        beat: beat.beat,
        actorId,
        conversationHistoryBefore,
        inboxBefore,
        message: collected.message,
      });
      checkpoints.push(createContinuationCheckpoint({
        caseId: validated.artifact.caseId,
        turn: turnNumber,
        actorId,
        gameState,
        logger,
        mingleInbox,
        roomByPlayerId,
        agents,
        output: collected.action,
      }));
      if (generatedCell && turnNumber === generatedCell.turn) {
        break replayBeats;
      }
    }
    movementRecords.push(...commitMingleTurnMovements({
      ctx,
      turns: collectedBeatTurns,
      roomByPlayerId,
      roomCount: initialized.roomCount,
      phase: Phase.MINGLE_I,
      mode: "evaluation_frozen_schedule",
    }));
  }

  const expectedTraceCount = generatedCell ? generatedCell.turn + 2 : 6;
  if (capturedTraces.length !== expectedTraceCount) {
    throw new Error(
      `Deterministic replay emitted ${capturedTraces.length} traces; expected ${expectedTraceCount}`,
    );
  }
  return {
    caseId: validated.artifact.caseId,
    actorOrder: turns.map((turn) => turn.actorId),
    traces: capturedTraces,
    turns,
    movementRecords,
    checkpoints,
    selectionExplanations,
  };
}

export async function runPromptThreadGeneratedCell(
  caseValue: FrozenCaseArtifact,
  input: PromptThreadGeneratedCellInput,
): Promise<PromptThreadGeneratedCellResult> {
  let generated:
    | { request: Record<string, unknown>; response: unknown }
    | undefined;
  const capture = await capturePromptThreadReplay(caseValue, {
    generatedCell: {
      ...input,
      dispatch: async (request) => {
        const response = await input.dispatch(request);
        generated = {
          request: structuredClone(request),
          response: structuredClone(response),
        };
        return response;
      },
    },
  });
  const checkpoint = capture.checkpoints.at(-1);
  if (!generated || !checkpoint) {
    throw new Error("Generated prompt-thread cell did not reach its provider boundary");
  }
  return {
    request: generated.request,
    response: generated.response,
    capture,
    checkpoint,
  };
}

export function verifyPromptThreadSourceFidelity(
  caseValue: FrozenCaseArtifact,
  capture: PromptThreadReplayCapture,
): PromptThreadFidelityReceipt {
  const validated = validatePromptThreadCase(caseValue);
  if (capture.caseId !== caseValue.caseId) {
    throw new Error("Prompt-thread capture belongs to a different case fingerprint");
  }
  const expectedTurns = validated.traces.slice(2);
  const actualTurns = capture.traces.slice(2);
  if (actualTurns.length !== 4) {
    throw new Error(`Prompt-thread capture has ${actualTurns.length} turn traces; expected four`);
  }
  const lanes = [
    "prompt.messages",
    "prompt.raw_system_content",
    "prompt.raw_user_content",
    "action",
    "request_shape",
    "model.name",
    "requestedReasoningEffort",
    "reasoningPolicy",
    "toolName",
  ];
  for (let index = 0; index < expectedTurns.length; index += 1) {
    const expected = fidelityLanes(expectedTurns[index]!.body);
    const actual = fidelityLanes(
      actualTurns[index] as unknown as Record<string, unknown>,
    );
    for (const lane of lanes) {
      if (canonicalJson(expected[lane]) !== canonicalJson(actual[lane])) {
        throw new Error(
          `Prompt-thread source mismatch at turn ${index + 1} lane ${lane}`,
        );
      }
    }
  }
  return {
    version: 1,
    status: "matched",
    caseId: caseValue.caseId,
    turnCount: 4,
    canonicalizerId: CANONICALIZER_ID,
    canonicalizerVersion: CANONICALIZER_VERSION,
    comparedLanes: lanes,
    transportOnlyExclusions: [...validated.exclusions],
    sourceMutation: false,
  };
}

export async function runPromptThreadSourceGate(
  caseValue: FrozenCaseArtifact,
): Promise<{
  receipt: PromptThreadFidelityReceipt;
  capture: PromptThreadReplayCapture;
}> {
  const capture = await capturePromptThreadReplay(caseValue);
  return {
    receipt: verifyPromptThreadSourceFidelity(caseValue, capture),
    capture,
  };
}

function validatePromptThreadCase(
  caseValue: FrozenCaseArtifact,
): ValidatedPromptThreadCase {
  const artifact = parseArtifact(caseValue);
  if (artifact.kind !== "frozen_case") {
    throw new Error("Prompt-thread source replay requires a frozen_case artifact");
  }
  if (hashCanonicalJson(artifact.privateData) !== artifact.caseId) {
    throw new Error("Prompt-thread case fingerprint does not match privateData");
  }
  const privateData = record(artifact.privateData, "case privateData");
  if (privateData.version !== 1) {
    throw new Error("Prompt-thread case privateData version must be 1");
  }
  const selection = record(privateData.selection, "case selection");
  const actorIds = stringPair(selection.actorIds, "case actorIds");
  if (selection.phase !== Phase.MINGLE_I) {
    throw new Error("Prompt-thread replay currently requires MINGLE_I");
  }
  const starting = record(privateData.startingState, "startingState");
  if (!Array.isArray(starting.canonicalEvents)) {
    throw new Error("Prompt-thread startingState requires canonicalEvents");
  }
  const gameState = GameState.fromCanonicalEvents(
    starting.canonicalEvents as never[],
    { now: () => 1_700_000_000_000 },
  );
  if (
    canonicalJson(gameState.getDomainProjection())
    !== canonicalJson(starting.canonicalProjection)
  ) {
    throw new Error("Prompt-thread starting projection does not match canonical events");
  }
  const roster = parseRoster(starting.roster);
  for (const actorId of actorIds) {
    if (!gameState.getAlivePlayers().some((player) => player.id === actorId)) {
      throw new Error(`Prompt-thread actor ${actorId} is not alive at the boundary`);
    }
  }
  const continuityRecord = record(starting.continuity, "starting continuity");
  if (!Array.isArray(continuityRecord.playerContinuityCapsules)) {
    throw new Error("Prompt-thread case requires player continuity capsules");
  }
  const continuity = new Map<UUID, PlayerContinuityCapsule>();
  for (const value of continuityRecord.playerContinuityCapsules) {
    const capsule = record(value, "player continuity capsule") as unknown as PlayerContinuityCapsule;
    if (
      capsule.version !== 1
      || typeof capsule.playerId !== "string"
      || typeof capsule.playerName !== "string"
    ) {
      throw new Error("Prompt-thread player continuity capsule is invalid");
    }
    continuity.set(capsule.playerId, structuredClone(capsule));
  }
  for (const actorId of actorIds) {
    if (!continuity.has(actorId)) {
      throw new Error(`Prompt-thread case is missing continuity for ${actorId}`);
    }
  }
  if (!Array.isArray(starting.transcriptReplay)) {
    throw new Error("Prompt-thread case requires transcriptReplay");
  }
  const schedule = parseSchedule(
    starting.roomSchedule,
    starting.roomCounts,
    actorIds,
  );
  const traces = parseStoredTraces(privateData.traces, actorIds);
  const fidelity = record(privateData.fidelityContract, "fidelityContract");
  if (
    fidelity.canonicalizerId !== CANONICALIZER_ID
    || fidelity.canonicalizerVersion !== CANONICALIZER_VERSION
    || fidelity.bytePreservingMessageContent !== true
  ) {
    throw new Error("Prompt-thread fidelity canonicalizer contract is incompatible");
  }
  if (
    !Array.isArray(fidelity.transportOnlyExclusions)
    || fidelity.transportOnlyExclusions.length !== TRANSPORT_ONLY_EXCLUSIONS.length
    || fidelity.transportOnlyExclusions.some(
      (value, index) => value !== TRANSPORT_ONLY_EXCLUSIONS[index],
    )
  ) {
    throw new Error("Prompt-thread case requests an unsupported transport-only exclusion");
  }
  const configInput = record(starting.config, "starting config");
  const config = {
    ...DEFAULT_CONFIG,
    ...configInput,
    timers: {
      ...DEFAULT_CONFIG.timers,
      ...(isRecord(configInput.timers) ? configInput.timers : {}),
    },
  } as GameConfig;
  const mingleSessionsPerRound =
    config.mingleSessionsPerRound ?? DEFAULT_MINGLE_BEATS;
  if (
    !Number.isInteger(mingleSessionsPerRound)
    || mingleSessionsPerRound < 1
  ) {
    throw new Error(
      "Prompt-thread starting config requires a positive mingleSessionsPerRound",
    );
  }
  return {
    artifact,
    gameState,
    config: {
      ...config,
      mingleSessionsPerRound,
    },
    actorIds,
    roster,
    continuity,
    transcriptReplay: structuredClone(starting.transcriptReplay) as TranscriptEntry[],
    schedule,
    traces,
    exclusions: TRANSPORT_ONLY_EXCLUSIONS,
  };
}

function hydrateRevealedVoteLedger(
  contextBuilder: ContextBuilder,
  events: ReturnType<GameState["getCanonicalEvents"]>,
): void {
  const rounds = [...new Set(
    events
      .map((event) => event.round)
      .filter((round) => Number.isInteger(round) && round > 0),
  )].sort((left, right) => left - right);

  for (const round of rounds) {
    const standardVote = buildRevealedRoundFacts({
      events,
      round,
    }).roundFacts.standardVote;
    if (standardVote.status !== "available") continue;

    contextBuilder.revealVoteLedgerEntries(
      standardVote.ledger.map((entry) => ({
        round,
        voterId: entry.voter.id,
        voterName: entry.voter.name,
        empowerTargetId: entry.empowerTarget.id,
        empowerTargetName: entry.empowerTarget.name,
        ...(entry.exposeTarget
          ? {
              exposeTargetId: entry.exposeTarget.id,
              exposeTargetName: entry.exposeTarget.name,
            }
          : {}),
        ...(entry.revoteEmpowerTarget
          ? {
              revoteEmpowerTargetId: entry.revoteEmpowerTarget.id,
              revoteEmpowerTargetName: entry.revoteEmpowerTarget.name,
            }
          : {}),
      })),
    );
  }
}

function parseRoster(value: unknown): ValidatedPromptThreadCase["roster"] {
  if (!Array.isArray(value) || value.length < 5) {
    throw new Error("Prompt-thread roster must contain the full five-plus player cast");
  }
  return value.map((candidate) => {
    const row = record(candidate, "roster row");
    const persona = record(row.persona, "roster persona");
    const config = record(row.agentConfig, "roster agentConfig");
    const personality = persona.personality;
    if (
      typeof row.id !== "string"
      || typeof persona.name !== "string"
      || typeof personality !== "string"
      || !PERSONALITIES.has(personality as Personality)
      || typeof config.model !== "string"
    ) {
      throw new Error("Prompt-thread roster row is incomplete");
    }
    return {
      id: row.id,
      name: persona.name,
      personality: personality as Personality,
      model: config.model,
      reasoningPolicy:
        typeof config.reasoningPolicy === "string"
          ? config.reasoningPolicy
          : "action-policy",
      providerProfileId:
        typeof config.providerProfileId === "string"
          ? config.providerProfileId
          : "openai",
      ...(typeof config.catalogId === "string"
        ? { catalogId: config.catalogId }
        : {}),
      ...(typeof persona.backstory === "string"
        ? { backstory: persona.backstory }
        : {}),
      ...(typeof config.personalityPrompt === "string"
        ? { personalityPrompt: config.personalityPrompt }
        : {}),
      ...(typeof config.strategyInstructions === "string"
        ? { strategyInstructions: config.strategyInstructions }
        : {}),
    };
  });
}

function parseSchedule(
  scheduleValue: unknown,
  roomCountsValue: unknown,
  actorIds: [UUID, UUID],
): [ReplayScheduleBeat, ReplayScheduleBeat] {
  if (!Array.isArray(scheduleValue) || scheduleValue.length !== 2) {
    throw new Error("Prompt-thread replay requires exactly two scheduled room beats");
  }
  if (!Array.isArray(roomCountsValue) || roomCountsValue.length !== 2) {
    throw new Error("Prompt-thread room schedule requires explicit full roomCounts");
  }
  const countsByBeat = new Map<number, MingleRoomCount[]>();
  for (const candidate of roomCountsValue) {
    const entry = record(candidate, "per-beat roomCounts");
    if (typeof entry.beat !== "number" || !Array.isArray(entry.rooms)) {
      throw new Error("Prompt-thread per-beat roomCounts entry is invalid");
    }
    const rooms = entry.rooms.map((candidateCount) => {
      const count = record(candidateCount, "room count");
      const numericCount = typeof count.count === "number"
        ? count.count
        : count.playerCount;
      if (
        typeof count.roomId !== "number"
        || typeof numericCount !== "number"
      ) {
        throw new Error("Prompt-thread room count is invalid");
      }
      return { roomId: count.roomId, count: numericCount };
    });
    countsByBeat.set(entry.beat, rooms);
  }
  const schedule = scheduleValue.map((candidate, index) => {
    const beat = record(candidate, `roomSchedule beat ${index + 1}`);
    const playerIds = stringArray(beat.playerIds, "scheduled playerIds");
    if (!actorIds.every((actorId) => playerIds.includes(actorId))) {
      throw new Error("Prompt-thread room schedule must contain both selected actors");
    }
    if (
      typeof beat.roomId !== "number"
      || typeof beat.round !== "number"
      || beat.beat !== index + 1
    ) {
      throw new Error("Prompt-thread room schedule is invalid");
    }
    const roomCounts = countsByBeat.get(beat.beat);
    if (!roomCounts) {
      throw new Error(`Prompt-thread roomCounts are missing beat ${beat.beat}`);
    }
    const expectedIds = roomCounts.map(({ roomId }) => roomId);
    if (
      new Set(expectedIds).size !== roomCounts.length
      || expectedIds.some((roomId, roomIndex) => roomId !== roomIndex + 1)
    ) {
      throw new Error("Prompt-thread roomCounts must cover every room in order");
    }
    if (
      roomCounts.find((count) => count.roomId === beat.roomId)?.count
      !== playerIds.length
    ) {
      throw new Error("Prompt-thread selected room count does not match its roster");
    }
    return {
      roomId: beat.roomId,
      round: beat.round,
      beat: beat.beat as number,
      playerIds,
      roomCounts,
    };
  });
  return schedule as [ReplayScheduleBeat, ReplayScheduleBeat];
}

function parseStoredTraces(
  value: unknown,
  actorIds: [UUID, UUID],
): ValidatedPromptThreadCase["traces"] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new Error("Prompt-thread case requires six ordered traces");
  }
  const expected = [
    ["mingle-intent", actorIds[0]],
    ["mingle-intent", actorIds[1]],
    ["mingle-turn", actorIds[0]],
    ["mingle-turn", actorIds[1]],
    ["mingle-turn", actorIds[0]],
    ["mingle-turn", actorIds[1]],
  ] as const;
  const traces = value.map((candidate, index) => {
    const trace = record(candidate, `trace ${index + 1}`);
    const body = record(trace.body, `trace ${index + 1} body`);
    const output = record(body.output, `trace ${index + 1} output`);
    if (
      typeof trace.manifestId !== "string"
      || trace.actorId !== expected[index]![1]
      || trace.action !== expected[index]![0]
      || body.actor === undefined
      || body.action !== trace.action
    ) {
      throw new Error(`Prompt-thread trace ${index + 1} does not match A-B-A-B tape`);
    }
    return {
      manifestId: trace.manifestId,
      actorId: trace.actorId,
      action: trace.action,
      body,
      output,
    } as StoredTrace;
  });
  return traces as ValidatedPromptThreadCase["traces"];
}

function deterministicOpenAIStub(scripts: StoredTrace[]): OpenAI {
  let index = 0;
  const nextScript = () => {
    const script = scripts[index++];
    if (!script) throw new Error("Deterministic replay script exhausted");
    return script;
  };
  return {
    responses: {
      create: async () => {
        const script = nextScript();
        return storedTraceResponse(script);
      },
    },
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          const script = nextScript();
          const toolChoice = record(params.tool_choice, "deterministic tool choice");
          const chosenFunction = record(
            toolChoice.function,
            "deterministic tool function",
          );
          const name =
            typeof chosenFunction.name === "string"
              ? chosenFunction.name
              : script.action;
          return {
            id: `deterministic-${script.manifestId}`,
            object: "chat.completion",
            created: 0,
            model: String(params.model ?? "fixture-model"),
            choices: [{
              index: 0,
              finish_reason: "tool_calls",
              logprobs: null,
              message: {
                role: "assistant",
                content: null,
                refusal: null,
                tool_calls: [{
                  id: `tool-${script.manifestId}`,
                  type: "function",
                  function: {
                    name,
                    arguments: JSON.stringify(script.output),
                  },
                }],
              },
            }],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

function createGeneratedCellProvider(
  validated: ValidatedPromptThreadCase,
  input: PromptThreadGeneratedCellInput,
): { clientFor: (actorId: UUID) => OpenAI } {
  const intentByActor = new Map(
    validated.traces
      .slice(0, 2)
      .map((trace) => [trace.actorId, trace] as const),
  );
  return {
    clientFor: (actorId) => {
      let invocation = 0;
      return {
        responses: {
          create: async (params: Record<string, unknown>) => {
            invocation += 1;
            if (invocation === 1) {
              const intent = intentByActor.get(actorId);
              if (!intent) {
                throw new Error(`Generated replay is missing intent for ${actorId}`);
              }
              return storedTraceResponse(intent);
            }
            const actorOffset = validated.actorIds.indexOf(actorId);
            if (actorOffset < 0) {
              throw new Error(`Generated replay actor ${actorId} is not selected`);
            }
            const turn = actorOffset + 1 + ((invocation - 2) * 2);
            if (turn < input.turn) {
              const prior = input.previousResponses[turn - 1];
              if (prior === undefined) {
                throw new Error(`Generated replay is missing prior response for turn ${turn}`);
              }
              return structuredClone(prior);
            }
            if (turn !== input.turn) {
              throw new Error(`Generated replay attempted future turn ${turn}`);
            }
            const request = {
              ...structuredClone(params),
              model: input.model,
              prompt_cache_key: input.promptCacheKey,
            };
            return input.dispatch(request);
          },
        },
      } as unknown as OpenAI;
    },
  };
}

function storedTraceResponse(script: StoredTrace): Record<string, unknown> {
  const outputText = JSON.stringify(script.output);
  return {
    id: `deterministic-${script.manifestId}`,
    object: "response",
    status: "completed",
    output_text: outputText,
    output: [{
      id: `message-${script.manifestId}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: outputText,
      }],
    }],
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    },
  };
}

function createContinuationCheckpoint(input: {
  caseId: string;
  turn: number;
  actorId: UUID;
  gameState: GameState;
  logger: TranscriptLogger;
  mingleInbox: Map<UUID, Array<{ from: string; text: string }>>;
  roomByPlayerId: Map<UUID, number>;
  agents: Map<UUID, IAgent>;
  output: unknown;
}): ContinuationCheckpointArtifact {
  const privateState = toJsonObject({
    caseId: input.caseId,
    actorId: input.actorId,
    canonicalEvents: input.gameState.getCanonicalEvents(),
    board: input.gameState.getDomainProjection(),
    transcript: input.logger.transcript,
    mingleInbox: [...input.mingleInbox.entries()],
    roomByPlayerId: [...input.roomByPlayerId.entries()],
    continuity: [...input.agents.entries()].map(([actorId, agent]) => ({
      actorId,
      capsule: agent.getContinuityCapsule?.() ?? null,
    })),
    output: input.output,
  });
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "continuation_checkpoint",
    createdAt: "1970-01-01T00:00:00.000Z",
    branchId: input.caseId,
    cellId: `source-turn-${input.turn}`,
    turn: input.turn,
    privateState,
  };
}

function fidelityLanes(
  trace: Record<string, unknown>,
): Record<string, JsonValue> {
  const prompt = record(trace.prompt, "trace prompt");
  if (!Array.isArray(prompt.messages)) {
    throw new Error("Trace prompt messages are missing");
  }
  const messages = prompt.messages as Array<Record<string, unknown>>;
  const rawSystem = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  const rawUser = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);
  const model = record(trace.model, "trace model");
  const promptReuse = isRecord(trace.promptReuse)
    ? trace.promptReuse
    : {};
  return {
    "prompt.messages": hashCanonicalJson(toJsonValue(messages)),
    "prompt.raw_system_content": hashCanonicalJson(toJsonValue(rawSystem)),
    "prompt.raw_user_content": hashCanonicalJson(toJsonValue(rawUser)),
    action: toJsonValue(trace.action ?? null),
    request_shape: toJsonValue(promptReuse.requestShape ?? null),
    "model.name": toJsonValue(model.name ?? null),
    requestedReasoningEffort: toJsonValue(
      trace.requestedReasoningEffort ?? null,
    ),
    reasoningPolicy: toJsonValue(trace.reasoningPolicy ?? null),
    toolName: toJsonValue(trace.toolName ?? null),
  };
}

function summarizeIntent(intent: MingleIntentAction) {
  const {
    thinking: _thinking,
    reasoningContext: _reasoningContext,
    ...summary
  } = intent;
  return {
    ...summary,
    seekPlayers: [...summary.seekPlayers],
    avoidPlayers: [...summary.avoidPlayers],
  };
}

function providerProfileId(value: string) {
  return value as ConstructorParameters<typeof InfluenceAgent>[7] extends {
    providerProfileId?: infer T;
  } ? T : never;
}

function reasoningPolicy(value: string) {
  return value as ConstructorParameters<typeof InfluenceAgent>[7] extends {
    reasoningPolicy?: infer T;
  } ? T : never;
}

function stringPair(value: unknown, label: string): [string, string] {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || value.some((entry) => typeof entry !== "string")
    || value[0] === value[1]
  ) {
    throw new Error(`${label} must contain two distinct actor IDs`);
  }
  return [value[0] as string, value[1] as string];
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.length < 2
    || value.some((entry) => typeof entry !== "string")
    || new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain distinct player IDs`);
  }
  return value as string[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function toJsonObject(value: unknown): JsonObject {
  return toJsonValue(value) as JsonObject;
}
