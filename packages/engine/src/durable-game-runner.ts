import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import type { CanonicalGameEvent } from "./canonical-events";
import {
  durableProviderSemanticCoordinateForSubcall,
} from "./durable-game-turn";
import type {
  DurableJsonObject,
  GameExecutionCursorV1,
  GameExecutionStateV1,
  GameTurnBranchKindV1,
  GameTurnCommitDraftV1,
  GameTurnIntentV1,
  GameTurnNextExecutionV1,
  GamePublicationDraftV1,
  GameTurnTranscriptDraftV1,
} from "./durable-game-turn";
import type {
  DurableGameTurnSnapshotV1,
  GameStreamEvent,
  IAgent,
  PlayerContinuityCapsule,
  TranscriptEntry,
} from "./game-runner.types";
import { PLAYER_CONTINUITY_CAPSULE_VERSION } from "./game-runner.types";
import {
  applyStrategyCandidate,
  markStrategyReconciliationRequired,
} from "./strategy-state";
import type { UUID } from "./types";
import { projectViewerDecisionEvent } from "./viewer-decision-events";
import { durableProviderLogicalCallId } from "./provider-execution";

export interface DurableTurnIntentInput {
  branch: GameTurnBranchKindV1;
  action: string;
  actorIds?: string[];
  targetIds?: string[];
  handles?: string[];
  participantIds?: string[];
  providerActions?: Array<{ actorId: string | null; action: string; contractId: string }>;
}

export interface StagedTurnEffects {
  canonicalEvents: CanonicalGameEvent[];
  transcriptEntries: TranscriptEntry[];
  streamEvents: GameStreamEvent[];
  playerContinuityCapsules: PlayerContinuityCapsule[];
  acceptedProviderCallIds: string[];
}

const STAGED_AGENT_METHODS = new Set<PropertyKey>([
  "getIntroduction",
  "getLobbyMessage",
  "getVotes",
  "getEmpowerRevote",
  "pickRoundFormat",
  "getMingleIntent",
  "sendRoomMessage",
  "takeMingleTurn",
  "getAllianceAction",
  "getAllianceHuddleTurn",
  "getSaveOrEliminateBallot",
  "getVoteBombBallot",
  "getMajorityEliminationBallot",
  "getEvenVotesBallot",
  "getRestrictedHistoryBallot",
  "getTwoNamesInitialNames",
  "getTwoNamesOverride",
  "getTwoNamesReplacement",
  "getTwoNamesBallot",
  "breakTwoNamesTie",
  "getTwoNamesPlea",
  "getBouncePointer",
  "getSafetyBounceVote",
  "breakFormatEliminationTie",
  "getEliminationMessage",
  "getLastMessage",
  "getDiaryEntry",
  "getPlea",
  "getEndgameEliminationVote",
  "getAccusation",
  "getDefense",
  "getOpeningStatement",
  "getJuryQuestion",
  "getJuryAnswer",
  "getClosingArgument",
  "getJuryVote",
]);

const VIEWER_SAFE_TRANSCRIPT_SCOPES = new Set<TranscriptEntry["scope"]>([
  "public",
  "system",
  "mingle",
  "whisper",
  "diary",
]);

export function toDurableJsonObject(value: unknown): DurableJsonObject {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Native XState snapshot is not JSON serializable");
  const parsed: unknown = JSON.parse(encoded);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Native XState snapshot must serialize to an object");
  }
  return parsed as DurableJsonObject;
}

export function createDurableTurnIntent(
  execution: GameExecutionStateV1,
  input: DurableTurnIntentInput,
): GameTurnIntentV1 {
  const turnSequence = execution.heads.turnSequence + 1;
  const turnId = `${execution.gameId}:turn:${turnSequence}`;
  const actorIds = [...(input.actorIds ?? [])];
  const seed = hashCanonicalJson({
    gameId: execution.gameId,
    turnSequence,
    cursor: execution.cursor,
    action: input.action,
  });
  return {
    version: 1,
    gameId: execution.gameId,
    turnId,
    turnSequence,
    seed,
    baseHeads: structuredClone(execution.heads),
    branch: { version: 1, kind: input.branch, action: input.action },
    actorIds,
    targetIds: [...(input.targetIds ?? [])],
    handles: [...(input.handles ?? [])],
    participantIds: [...(input.participantIds ?? actorIds)],
    providerSubcalls: (input.providerActions ?? []).map((call, index) => {
      const slot = index + 1;
      const semanticCoordinate = {
        version: 1 as const,
        kind: "durable_turn" as const,
        turnId,
        subcallSlot: slot,
      };
      return {
        version: 1 as const,
        slot,
        logicalCallId: durableProviderLogicalCallId({
          gameId: execution.gameId,
          turnId,
          subcallSlot: slot,
        }),
        semanticCoordinate,
        actorId: call.actorId,
        action: call.action,
        contractId: call.contractId,
      };
    }),
  };
}

export function seededRandom(seed: string): () => number {
  const digest = seed.startsWith("sha256:") ? seed.slice("sha256:".length) : seed;
  let state = Number.parseInt(digest.slice(0, 8), 16) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function capturePlayerContinuity(
  agents: ReadonlyMap<UUID, IAgent>,
): PlayerContinuityCapsule[] {
  const result: PlayerContinuityCapsule[] = [];
  for (const agent of agents.values()) {
    const capsule = agent.getContinuityCapsule?.();
    if (!capsule) continue;
    result.push(structuredClone({
      ...capsule,
      playerId: agent.id,
      playerName: agent.name,
    }));
  }
  return result;
}

function stagedAgent(
  agent: IAgent,
  initial: PlayerContinuityCapsule | null,
  providerBindings: readonly GameTurnIntentV1["providerSubcalls"][number][],
  providerTurnId: string | null,
  acceptedProviderCallIds: Set<string>,
): { agent: IAgent; readCapsule: () => PlayerContinuityCapsule | null } {
  let capsule = initial ? structuredClone(initial) : null;
  let compactStrategy = capsule
    ? structuredClone(capsule.compactStrategy)
    : agent.getCompactStrategyState?.();
  const overrides: Partial<IAgent> = {
    getContinuityCapsule: () => capsule ? structuredClone({
      version: PLAYER_CONTINUITY_CAPSULE_VERSION,
      compactStrategy: capsule.compactStrategy,
      notes: capsule.notes,
      relationships: capsule.relationships,
      powerActionMemory: capsule.powerActionMemory,
      roundHistory: capsule.roundHistory,
    }) : null,
    updateAlly: (name) => {
      if (!capsule || capsule.relationships.allies.includes(name)) return;
      capsule.relationships.allies.push(name);
    },
    updateThreat: (name) => {
      if (!capsule || capsule.relationships.threats.includes(name)) return;
      capsule.relationships.threats.push(name);
    },
    addNote: (subject, note) => {
      if (!capsule) return;
      capsule.notes.push({ subject, note });
    },
    removeFromMemory: (name) => {
      if (!capsule) return;
      capsule.relationships.allies = capsule.relationships.allies.filter((entry) => entry !== name);
      capsule.relationships.threats = capsule.relationships.threats.filter((entry) => entry !== name);
      capsule.notes = capsule.notes.filter((entry) => entry.subject !== name);
    },
  };
  if (compactStrategy) {
    overrides.getCompactStrategyState = () => {
      if (!compactStrategy) throw new Error(`Agent ${agent.id} lost staged strategy`);
      return structuredClone(compactStrategy);
    };
    overrides.commitCompactStrategyCandidate = (boundary, candidate) => {
      if (!compactStrategy) throw new Error(`Agent ${agent.id} lost staged strategy`);
      const result = applyStrategyCandidate(compactStrategy, boundary, candidate);
      compactStrategy = structuredClone(result.state);
      if (capsule) capsule.compactStrategy = structuredClone(result.state);
      return result;
    };
    overrides.markCompactStrategyReconciliationRequired = () => {
      if (!compactStrategy) throw new Error(`Agent ${agent.id} lost staged strategy`);
      compactStrategy = markStrategyReconciliationRequired(compactStrategy);
      if (capsule) capsule.compactStrategy = structuredClone(compactStrategy);
      return structuredClone(compactStrategy);
    };
    if (agent.getRecallContinuitySnapshot) {
      overrides.getRecallContinuitySnapshot = () => ({
        ...structuredClone(agent.getRecallContinuitySnapshot!()),
        compactStrategy: structuredClone(compactStrategy!),
      });
    }
  }
  let providerBindingIndex = 0;
  let proxy: IAgent;
  proxy = new Proxy(agent, {
    get(target, property) {
      const override = Reflect.get(overrides, property);
      if (override !== undefined) return override;
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (!STAGED_AGENT_METHODS.has(property)) return value.bind(target);
      return (...args: unknown[]) => {
        const providerBinding = providerBindings[providerBindingIndex++] ?? null;
        const semanticCoordinate = providerBinding && providerTurnId
          ? durableProviderSemanticCoordinateForSubcall(providerTurnId, providerBinding)
          : null;
        target.setDurableProviderTurnBinding?.(providerBinding ? {
          turnId: semanticCoordinate!.turnId,
          subcallSlot: providerBinding.slot,
          semanticCoordinate: structuredClone(semanticCoordinate!),
        } : null);
        return Promise.resolve(Reflect.apply(value, proxy, args)).then((result: unknown) => {
          if (providerBinding && providerResultWasAccepted(result)) {
            acceptedProviderCallIds.add(providerBinding.logicalCallId);
          }
          return result;
        });
      };
    },
  });
  return {
    agent: proxy,
    readCapsule: () => capsule ? structuredClone(capsule) : null,
  };
}

export function createStagedAgents(
  agents: ReadonlyMap<UUID, IAgent>,
  continuity: readonly PlayerContinuityCapsule[],
  providerSubcalls: readonly GameTurnIntentV1["providerSubcalls"][number][] = [],
  providerTurnId: string | null = null,
): {
  agents: Map<UUID, IAgent>;
  readContinuity: () => PlayerContinuityCapsule[];
  readAcceptedProviderCallIds: () => string[];
} {
  const capsules = new Map(continuity.map((entry) => [entry.playerId, entry]));
  const providerBindingsByActor = new Map<string, GameTurnIntentV1["providerSubcalls"][number][]>();
  for (const entry of providerSubcalls) {
    if (!entry.actorId) continue;
    const bindings = providerBindingsByActor.get(entry.actorId) ?? [];
    bindings.push(entry);
    providerBindingsByActor.set(entry.actorId, bindings);
  }
  const acceptedProviderCallIds = new Set<string>();
  const readers: Array<() => PlayerContinuityCapsule | null> = [];
  const staged = new Map<UUID, IAgent>();
  for (const [id, agent] of agents) {
    const wrapped = stagedAgent(
      agent,
      capsules.get(id) ?? null,
      providerBindingsByActor.get(id) ?? [],
      providerTurnId,
      acceptedProviderCallIds,
    );
    staged.set(id, wrapped.agent);
    readers.push(wrapped.readCapsule);
  }
  return {
    agents: staged,
    readContinuity: () => readers.flatMap((read) => {
      const value = read();
      return value ? [value] : [];
    }),
    readAcceptedProviderCallIds: () => [...acceptedProviderCallIds],
  };
}

function providerResultWasAccepted(result: unknown): boolean {
  if (result === null || result === undefined || typeof result !== "object") return false;
  const record = result as Record<string, unknown>;
  if (record.providerAbsence === true || record.engineFallback !== undefined) return false;
  if (record.decisionSource === "fallback") return false;
  return true;
}

export function collectStagedEffects(input: {
  base: DurableGameTurnSnapshotV1;
  canonicalEvents: readonly CanonicalGameEvent[];
  transcriptEntries: readonly TranscriptEntry[];
  streamEvents: readonly GameStreamEvent[];
  playerContinuityCapsules: readonly PlayerContinuityCapsule[];
  acceptedProviderCallIds?: readonly string[];
}): StagedTurnEffects {
  return {
    canonicalEvents: input.canonicalEvents.slice(input.base.canonicalEvents.length).map((entry) => structuredClone(entry)),
    transcriptEntries: input.transcriptEntries.slice(input.base.transcriptEntries.length).map((entry) => structuredClone(entry)),
    streamEvents: input.streamEvents.map((entry) => structuredClone(entry)),
    playerContinuityCapsules: input.playerContinuityCapsules.map((entry) => structuredClone(entry)),
    acceptedProviderCallIds: [...(input.acceptedProviderCallIds ?? [])],
  };
}

export function buildTurnCommitDraft(input: {
  base: DurableGameTurnSnapshotV1;
  intent: GameTurnIntentV1;
  nextCursor: GameExecutionCursorV1;
  xstateSnapshot: DurableJsonObject;
  houseNarrativeContinuity: GameTurnNextExecutionV1["houseNarrativeContinuity"];
  effects: StagedTurnEffects;
}): GameTurnCommitDraftV1 {
  const eventDrafts = input.effects.canonicalEvents.map((event) => ({
    version: 1 as const,
    round: event.round,
    phase: event.phase,
    type: event.type,
    source: event.source,
    visibility: event.visibility,
    payloadVersion: event.payloadVersion,
    sourcePointers: structuredClone(event.sourcePointers),
    payload: structuredClone(event.payload) as unknown as DurableJsonObject,
  }));
  const transcriptDrafts = input.effects.transcriptEntries.map((entry) => Object.fromEntries(
    Object.entries(structuredClone(entry)).filter(([key]) => key !== "timestamp" && key !== "entrySequence"),
  ) as GameTurnTranscriptDraftV1);
  const publicationDrafts: GamePublicationDraftV1[] = [
    ...input.effects.canonicalEvents.flatMap((event, index) => projectViewerDecisionEvent(event)
      ? [{
          version: 1 as const,
          kind: "canonical_event" as const,
          eventIndex: index,
          availableAt: null,
        }]
      : []),
    ...input.effects.transcriptEntries.flatMap((entry, index) => VIEWER_SAFE_TRANSCRIPT_SCOPES.has(entry.scope)
      ? [{
          version: 1 as const,
          kind: "transcript_entry" as const,
          transcriptIndex: index,
          availableAt: null,
      }]
      : []),
  ];
  let pacingHead = input.base.execution.nextPublicationAvailableAt;
  let lastPresentationPhase = input.base.execution.lastPresentationPhase;
  const scheduledPublications = publicationDrafts.map((publication) => {
    pacingHead = nextDeterministicPublicationTime(pacingHead);
    if (
      publication.kind === "canonical_event"
      && input.effects.canonicalEvents[publication.eventIndex]?.type === "game.phase_entered"
    ) {
      lastPresentationPhase = input.effects.canonicalEvents[publication.eventIndex]!.phase;
    }
    return { ...publication, availableAt: pacingHead };
  });
  const terminalPublication: GamePublicationDraftV1[] = input.nextCursor.kind === "terminal"
    ? [{
        version: 1,
        kind: "completion",
        eventIndex: null,
        availableAt: null,
      }]
    : [];
  const publications = [...scheduledPublications, ...terminalPublication];
  return {
    version: 1,
    gameId: input.intent.gameId,
    turnId: input.intent.turnId,
    turnSequence: input.intent.turnSequence,
    intentHash: hashCanonicalJson(input.intent),
    expectedBaseHeads: structuredClone(input.intent.baseHeads),
    nextExecution: {
      version: 1,
      status: input.nextCursor.kind === "terminal"
        ? "terminal"
        : "ready",
      lastPresentationPhase,
      nextPublicationAvailableAt: input.nextCursor.kind === "terminal" ? null : pacingHead,
      xstateSnapshot: structuredClone(input.xstateSnapshot),
      cursor: structuredClone(input.nextCursor),
      playerContinuityCapsules: input.effects.playerContinuityCapsules.map((entry) => structuredClone(entry)),
      houseNarrativeContinuity: input.houseNarrativeContinuity
        ? structuredClone(input.houseNarrativeContinuity)
        : null,
      retry: null,
    },
    canonicalEvents: eventDrafts,
    transcriptEntries: transcriptDrafts,
    publications,
    acceptedProviderCallIds: [...input.effects.acceptedProviderCallIds],
  };
}

function nextDeterministicPublicationTime(previous: string | null): string {
  const previousMs = previous === null ? 0 : Date.parse(previous);
  if (!Number.isFinite(previousMs)) {
    throw new Error("Durable publication pacing head is not a canonical timestamp");
  }
  return new Date(previousMs + 1).toISOString();
}
