import {
  CANONICALIZER_ID,
  CANONICALIZER_VERSION,
  PROTOCOL_SCHEMA_HASH,
  PROTOCOL_VERSION,
  hashCanonicalJson,
  type FrozenCaseArtifact,
  type JsonObject,
  type JsonValue,
  type SourceReceiptArtifact,
} from "@influence/prompt-lab-protocol";
import { GameState, type TranscriptEntry } from "@influence/engine";
import { and, asc, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  evaluateHistoricalCheckpointIntegrity,
  type HistoricalCheckpointIntegrityInput,
} from "./game-recovery-support.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { PrivateTraceReadModel, type PrivateTraceContentRead } from "./private-trace-read-model.js";
import type { PrivateTraceStorageAdapter } from "./private-trace-storage.js";
import {
  atomicWriteArtifact,
  createTemporaryMaterialization,
  promoteValidatedMaterialization,
  readArtifact,
  withRunMutationLock,
  type PrivateWorkspace,
} from "./prompt-thread-workspace.js";

const DEFAULT_GAME_ID = "233ed9f5-78d5-4bbc-9dc3-aefc9d64b847";
const DEFAULT_TARGET_MANIFEST_IDS = [
  "e947436d-2510-4033-a6ef-c254823cbad9",
  "3d490f4b-fddf-4b14-b11d-3bdd462e74bb",
  "0f6f8720-2b90-428a-8614-183d64aa73a4",
  "09b39c97-77d8-4768-a336-fce426ef7074",
] as const;

export interface PromptThreadCaseSelection {
  gameId: string;
  slug: string;
  checkpointId: string;
  boundarySequence: number;
  checkpointKind: "phase_boundary";
  actorCoordinate: string;
  phase: string;
  round: number;
  actorIds?: readonly [string, string] | readonly string[];
  targetManifestIds: readonly [string, string, string, string] | readonly string[];
  corroboratingSequences: readonly number[];
}

export const VAST_AZURE_SURGE_PROMPT_THREAD_CASE = Object.freeze({
  gameId: DEFAULT_GAME_ID,
  slug: "vast-azure-surge",
  checkpointId: "7c13af79-674f-446c-a3e1-fc28dceb4382",
  boundarySequence: 240,
  checkpointKind: "phase_boundary",
  actorCoordinate: "mingle_i",
  phase: "MINGLE_I",
  round: 4,
  targetManifestIds: DEFAULT_TARGET_MANIFEST_IDS,
  corroboratingSequences: [241, 242, 244, 245, 250],
} satisfies PromptThreadCaseSelection);

export interface MaterializePromptThreadCaseInput {
  workspace: PrivateWorkspace;
  selection?: PromptThreadCaseSelection;
  storageFactory?: () => PrivateTraceStorageAdapter;
  now?: () => Date;
}

export interface MaterializePromptThreadCaseResult {
  caseId: string;
  caseArtifact: FrozenCaseArtifact;
  sourceReceiptArtifact: SourceReceiptArtifact;
  casePath: string;
  sourceReceiptPath: string;
  traceManifestIds: string[];
}

interface MaterializedSource {
  privateData: JsonObject;
  sources: JsonValue[];
  traceManifestIds: string[];
}

interface TraceManifestRow {
  id: string;
  gameId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function toJsonObject(value: unknown): JsonObject {
  return toJsonValue(value) as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function actorMetadata(metadata: Record<string, unknown>): { id: string; name: string } | null {
  const actor = metadata.actor;
  if (!isRecord(actor) || typeof actor.id !== "string" || typeof actor.name !== "string") {
    return null;
  }
  return { id: actor.id, name: actor.name };
}

function manifestMatchesCoordinate(
  row: TraceManifestRow,
  selection: PromptThreadCaseSelection,
  action: string,
): boolean {
  return row.metadata.action === action &&
    row.metadata.phase === selection.phase &&
    row.metadata.round === selection.round;
}

function requireTargetManifests(
  rows: readonly TraceManifestRow[],
  selection: PromptThreadCaseSelection,
): TraceManifestRow[] {
  if (selection.targetManifestIds.length !== 4) {
    throw new Error("Selected prompt thread requires exactly four target trace manifests");
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const targets = selection.targetManifestIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`Target trace manifest not found: ${id}`);
    if (!manifestMatchesCoordinate(row, selection, "mingle-turn")) {
      throw new Error(`Target trace manifest ${id} does not match selected Mingle coordinate`);
    }
    return row;
  });
  const actorIds = targets.map((row) => actorMetadata(row.metadata)?.id);
  if (actorIds.some((actorId) => !actorId)) {
    throw new Error("Target trace manifests require immutable actor IDs");
  }
  if (
    actorIds[0] !== actorIds[2] ||
    actorIds[1] !== actorIds[3] ||
    actorIds[0] === actorIds[1]
  ) {
    throw new Error("Target traces do not form the required A-B-A-B thread");
  }
  if (selection.actorIds) {
    if (selection.actorIds.length !== 2 ||
        selection.actorIds[0] !== actorIds[0] ||
        selection.actorIds[1] !== actorIds[1]) {
      throw new Error("Target trace actors do not match selected actor IDs");
    }
  }
  return targets;
}

function requireIntentManifests(
  rows: readonly TraceManifestRow[],
  targets: readonly TraceManifestRow[],
  selection: PromptThreadCaseSelection,
): TraceManifestRow[] {
  const actorIds = [
    actorMetadata(targets[0]!.metadata)!.id,
    actorMetadata(targets[1]!.metadata)!.id,
  ];
  return actorIds.map((actorId, actorIndex) => {
    const firstTargetAt = targets[actorIndex]!.createdAt;
    const matches = rows.filter((row) => (
      manifestMatchesCoordinate(row, selection, "mingle-intent") &&
      actorMetadata(row.metadata)?.id === actorId &&
      row.createdAt < firstTargetAt
    ));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one preceding mingle-intent trace for actor ${actorId}; found ${matches.length}`,
      );
    }
    return matches[0]!;
  });
}

function validateTraceBody(
  content: PrivateTraceContentRead,
  row: TraceManifestRow,
  selection: PromptThreadCaseSelection,
): Record<string, unknown> {
  if (content.truncated ||
      content.returnedByteLength !== content.byteLength ||
      (content.totalByteLength !== undefined && content.returnedByteLength !== content.totalByteLength)) {
    throw new Error(`Trace object ${row.id} is truncated`);
  }
  const body = parseJsonObject(content.content, `Trace object ${row.id}`);
  const bodyActor = isRecord(body.actor) ? body.actor : null;
  const metadataActor = actorMetadata(row.metadata);
  if (!metadataActor ||
      bodyActor?.id !== metadataActor.id ||
      bodyActor.name !== metadataActor.name ||
      body.action !== row.metadata.action ||
      body.phase !== selection.phase ||
      body.round !== selection.round) {
    throw new Error(`Trace object ${row.id} does not match its manifest coordinate`);
  }
  return body;
}

function selectedActorIds(targets: readonly TraceManifestRow[]): readonly [string, string] {
  return [
    actorMetadata(targets[0]!.metadata)!.id,
    actorMetadata(targets[1]!.metadata)!.id,
  ];
}

function buildHistoryCatalog(
  transcriptReplay: readonly TranscriptEntry[],
  actorIds: readonly [string, string],
): JsonValue[] {
  const selected = new Set(actorIds);
  const catalog: JsonValue[] = [];
  for (const entry of transcriptReplay) {
    const speakerId = typeof entry.speakerPlayerId === "string"
      ? entry.speakerPlayerId
      : null;
    const audienceIds = Array.isArray(entry.audiencePlayerIds)
      ? entry.audiencePlayerIds.filter((id): id is string => typeof id === "string")
      : [];

    if (entry.scope === "system") {
      if (entry.dialogueKind !== "system_phase_banner") continue;
      catalog.push(toJsonValue({
        lane: "prelude",
        sequence: entry.entrySequence ?? null,
        round: entry.round,
        phase: String(entry.phase),
        speakerPlayerId: null,
        audiencePlayerIds: [],
        eligibleActorIds: [...actorIds],
        text: entry.text,
      }));
      continue;
    }

    const isPublic = entry.scope === "public";
    const eligibleActorIds = isPublic
      ? [...actorIds]
      : actorIds.filter((actorId) => actorId === speakerId || audienceIds.includes(actorId));
    if (eligibleActorIds.length === 0) continue;
    if (!isPublic && speakerId !== null && !selected.has(speakerId) &&
        audienceIds.every((id) => !selected.has(id))) {
      continue;
    }
    catalog.push(toJsonValue({
      lane: "history",
      sequence: entry.entrySequence ?? null,
      round: entry.round,
      phase: String(entry.phase),
      scope: entry.scope,
      speakerPlayerId: speakerId,
      audiencePlayerIds: audienceIds,
      eligibleActorIds,
      text: entry.text,
      ...(entry.dialogueContext ? { context: entry.dialogueContext } : {}),
    }));
  }
  return catalog;
}

function actorVisibleTranscriptReplay(
  transcriptReplay: readonly TranscriptEntry[],
  actorIds: readonly [string, string],
): TranscriptEntry[] {
  return transcriptReplay
    .filter((entry) => {
      if (entry.scope === "system") {
        return entry.dialogueKind === "system_phase_banner";
      }
      if (entry.scope === "public") return true;
      const speakerId = typeof entry.speakerPlayerId === "string"
        ? entry.speakerPlayerId
        : null;
      const audienceIds = Array.isArray(entry.audiencePlayerIds)
        ? entry.audiencePlayerIds
        : [];
      return actorIds.some(
        (actorId) => actorId === speakerId || audienceIds.includes(actorId),
      );
    })
    .map((entry) => ({
      ...entry,
      ...(entry.to ? { to: [...entry.to] } : {}),
      ...(entry.audiencePlayerIds
        ? { audiencePlayerIds: [...entry.audiencePlayerIds] }
        : {}),
      ...(entry.dialogueContext
        ? { dialogueContext: { ...entry.dialogueContext } }
        : {}),
    }));
}

interface ParsedRoomTape {
  schedule: JsonValue[];
  roomCounts: JsonValue[];
}

function parseRoomSchedule(
  rows: readonly { roomMetadata: string | null }[],
  actorIds: readonly [string, string],
): ParsedRoomTape {
  const schedule: Array<{
    roomId: number;
    round: number;
    beat: number;
    playerIds: string[];
    playerCount: number;
  }> = [];
  const roomCountsByBeat = new Map<number, Array<{
    roomId: number;
    playerCount: number;
  }>>();
  for (const row of rows) {
    if (!row.roomMetadata) continue;
    const metadata = parseJsonObject(row.roomMetadata, "Room allocation metadata");
    if (!Array.isArray(metadata.rooms)) continue;
    const rowCountsByBeat = new Map<number, Array<{
      roomId: number;
      playerCount: number;
    }>>();
    for (const candidate of metadata.rooms) {
      if (!isRecord(candidate) ||
          typeof candidate.roomId !== "number" ||
          typeof candidate.round !== "number" ||
          typeof candidate.beat !== "number" ||
          !Array.isArray(candidate.playerIds) ||
          !candidate.playerIds.every((id) => typeof id === "string")) {
        throw new Error("Room allocation metadata contains an invalid structured room");
      }
      const playerIds = candidate.playerIds as string[];
      const rowCounts = rowCountsByBeat.get(candidate.beat) ?? [];
      rowCounts.push({
        roomId: candidate.roomId,
        playerCount: playerIds.length,
      });
      rowCountsByBeat.set(candidate.beat, rowCounts);
      if (!actorIds.every((actorId) => playerIds.includes(actorId))) continue;
      schedule.push({
        roomId: candidate.roomId,
        round: candidate.round,
        beat: candidate.beat,
        playerIds: [...playerIds],
        playerCount: playerIds.length,
      });
    }
    for (const [beat, rowCounts] of rowCountsByBeat) {
      const existing = roomCountsByBeat.get(beat);
      const normalized = rowCounts.sort((left, right) => left.roomId - right.roomId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) {
        throw new Error(`Conflicting structured room counts for beat ${beat}`);
      }
      roomCountsByBeat.set(beat, normalized);
    }
  }
  const uniqueByBeat = new Map<number, (typeof schedule)[number]>();
  for (const entry of schedule.sort((left, right) => left.beat - right.beat)) {
    if (uniqueByBeat.has(entry.beat)) {
      throw new Error(`Non-unique selected room schedule for beat ${entry.beat}`);
    }
    uniqueByBeat.set(entry.beat, entry);
  }
  if (uniqueByBeat.size === 0) {
    throw new Error("Selected actors have no structured room schedule");
  }
  return {
    schedule: [...uniqueByBeat.values()].map(toJsonValue),
    roomCounts: [...uniqueByBeat.keys()]
      .sort((left, right) => left - right)
      .map((beat) => toJsonValue({
        beat,
        rooms: roomCountsByBeat.get(beat) ?? [],
      })),
  };
}

function corroboratingSources(
  selection: PromptThreadCaseSelection,
  events: Awaited<ReturnType<typeof getPersistedGameEvents>>["events"],
): JsonValue[] {
  const expectedTypes = new Map<number, string>();
  if (selection.gameId === DEFAULT_GAME_ID &&
      selection.boundarySequence === 240) {
    expectedTypes.set(241, "mingle.coordination_receipt_recorded");
    expectedTypes.set(242, "mingle.coordination_receipt_recorded");
    expectedTypes.set(244, "mingle.coordination_receipt_recorded");
    expectedTypes.set(245, "mingle.coordination_receipt_recorded");
    expectedTypes.set(250, "mingle.rooms_allocated");
  }
  return selection.corroboratingSequences.map((sequence) => {
    const event = events.find((candidate) => candidate.sequence === sequence);
    if (!event) throw new Error(`Missing corroborating canonical event ${sequence}`);
    const expectedType = expectedTypes.get(sequence);
    if (expectedType && event.eventType !== expectedType) {
      throw new Error(
        `Corroborating canonical event ${sequence} is ${event.eventType}, expected ${expectedType}`,
      );
    }
    return toJsonValue({
      sequence,
      eventType: event.eventType,
      eventHash: event.eventHash,
    });
  });
}

async function readMaterializedSource(
  db: DrizzleDB,
  selection: PromptThreadCaseSelection,
  storageFactory?: () => PrivateTraceStorageAdapter,
): Promise<MaterializedSource> {
  return db.transaction(async (tx) => {
    const readDb = tx as unknown as DrizzleDB;
    const games = await tx
      .select()
      .from(schema.games)
      .where(and(
        eq(schema.games.id, selection.gameId),
        eq(schema.games.slug, selection.slug),
      ));
    if (games.length !== 1) {
      throw new Error(`Expected exactly one selected source game; found ${games.length}`);
    }
    const game = games[0]!;

    const checkpointRows = await tx
      .select()
      .from(schema.gameCheckpoints)
      .where(and(
        eq(schema.gameCheckpoints.id, selection.checkpointId),
        eq(schema.gameCheckpoints.gameId, game.id),
        eq(schema.gameCheckpoints.lastEventSequence, selection.boundarySequence),
        eq(schema.gameCheckpoints.checkpointKind, selection.checkpointKind),
        eq(schema.gameCheckpoints.actorCoordinate, selection.actorCoordinate),
      ));
    if (checkpointRows.length !== 1) {
      throw new Error(`Expected exactly one selected checkpoint tuple; found ${checkpointRows.length}`);
    }
    const checkpoint = checkpointRows[0]!;
    if (checkpoint.phase !== selection.phase || checkpoint.round !== selection.round) {
      throw new Error("Selected checkpoint phase/round does not match the requested coordinate");
    }

    const persistedEvents = await getPersistedGameEvents(tx, game.id);
    const historical = evaluateHistoricalCheckpointIntegrity({
      checkpoint: checkpoint as HistoricalCheckpointIntegrityInput,
      persistedEvents,
    });
    if (!historical.ok) {
      throw new Error(`Historical checkpoint integrity failed: ${historical.reason}`);
    }
    const canonicalPrefix = historical.resumeFrom.canonicalEvents;
    const startingState = GameState.fromCanonicalEvents(canonicalPrefix);
    const projection = startingState.getDomainProjection();

    const rosterRows = await tx
      .select()
      .from(schema.gamePlayers)
      .where(eq(schema.gamePlayers.gameId, game.id))
      .orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id));
    const rosterById = new Map(rosterRows.map((row) => [row.id, {
      id: row.id,
      userId: row.userId,
      agentProfileId: row.agentProfileId,
      agentRevisionId: row.agentRevisionId,
      persona: parseJsonObject(row.persona, `Roster persona ${row.id}`),
      agentConfig: parseJsonObject(row.agentConfig, `Roster agent config ${row.id}`),
    }] as const));
    const canonicalPlayers = startingState.getAllPlayers();
    const roster = canonicalPlayers.map((player) => rosterById.get(player.id));
    if (roster.some((row) => !row) ||
        rosterRows.length !== canonicalPlayers.length ||
        roster.some((row, index) => {
          const personaName = typeof row?.persona.name === "string" ? row.persona.name : null;
          return personaName !== canonicalPlayers[index]!.name;
        })) {
      throw new Error("Roster identity does not match the canonical starting projection");
    }
    const canonicalRoster = roster.map((row) => row!);

    const manifestRows = await tx
      .select({
        id: schema.gameEvidenceManifests.id,
        gameId: schema.gameEvidenceManifests.gameId,
        metadata: schema.gameEvidenceManifests.metadata,
        createdAt: schema.gameEvidenceManifests.createdAt,
      })
      .from(schema.gameEvidenceManifests)
      .where(and(
        eq(schema.gameEvidenceManifests.gameId, game.id),
        eq(schema.gameEvidenceManifests.evidenceType, "private_decision_trace"),
      ))
      .orderBy(asc(schema.gameEvidenceManifests.createdAt), asc(schema.gameEvidenceManifests.id));
    const targets = requireTargetManifests(manifestRows, selection);
    const intents = requireIntentManifests(manifestRows, targets, selection);
    const actorIds = selectedActorIds(targets);
    const traceRows = [...intents, ...targets];
    const traceReadModel = new PrivateTraceReadModel(readDb, storageFactory);
    const traces: Array<{
      manifestId: string;
      actorId: string;
      action: unknown;
      byteLength: number;
      sha256: string;
      body: Record<string, unknown>;
    }> = [];
    const traceSources: JsonValue[] = [];
    for (const row of traceRows) {
      const read = await traceReadModel.readCompleteContentForExperiment(row.id, {
        gameId: game.id,
      });
      if (!read.ok) {
        throw new Error(`Trace ${row.id} integrity/read failed (${read.status}): ${read.error}`);
      }
      const body = validateTraceBody(read.response, row, selection);
      const actor = actorMetadata(row.metadata)!;
      traces.push({
        manifestId: row.id,
        actorId: actor.id,
        action: row.metadata.action,
        byteLength: read.response.returnedByteLength,
        sha256: read.response.sha256,
        body,
      });
      traceSources.push(toJsonValue({
        kind: "private_trace_object",
        manifestId: row.id,
        actorId: actor.id,
        action: row.metadata.action,
        byteLength: read.response.returnedByteLength,
        sha256: read.response.sha256,
        storageProvider: "producer_authorized_private_storage",
        accessReceipt: {
          purpose: "prompt_thread_case_materialization",
          accessorRole: "producer",
          outcome: "allowed",
          auditLocation: "external_source_receipt",
          sourceDatabaseWrite: false,
        },
      }));
    }

    const roomRows = await tx
      .select({ roomMetadata: schema.transcripts.roomMetadata })
      .from(schema.transcripts)
      .where(and(
        eq(schema.transcripts.gameId, game.id),
        eq(schema.transcripts.round, selection.round),
        eq(schema.transcripts.phase, selection.phase),
      ))
      .orderBy(asc(schema.transcripts.timestamp), asc(schema.transcripts.id));
    const roomTape = parseRoomSchedule(roomRows, actorIds);
    const eligibleTranscriptReplay = actorVisibleTranscriptReplay(
      historical.resumeFrom.transcriptReplay,
      actorIds,
    );
    const historyCatalog = buildHistoryCatalog(eligibleTranscriptReplay, actorIds);
    const corroboration = corroboratingSources(selection, persistedEvents.events);
    const transcriptState = (await tx
      .select()
      .from(schema.gameTranscriptStates)
      .where(eq(schema.gameTranscriptStates.gameId, game.id)))[0] ?? null;

    const config = parseJsonObject(game.config, "Game config");
    const privateData = toJsonObject({
      version: 1,
      materializerVersion: "prompt-thread-case-materializer/v1",
      baselineClaim: "trace_observable_message_equivalent",
      selection: {
        gameId: game.id,
        slug: game.slug,
        boundarySequence: selection.boundarySequence,
        checkpointId: checkpoint.id,
        checkpointKind: checkpoint.checkpointKind,
        actorCoordinate: checkpoint.actorCoordinate,
        phase: checkpoint.phase,
        round: checkpoint.round,
        actorIds,
        targetManifestIds: [...selection.targetManifestIds],
        intentManifestIds: intents.map((row) => row.id),
        corroboratingSequences: [...selection.corroboratingSequences],
      },
      startingState: {
        canonicalEvents: canonicalPrefix,
        canonicalProjection: projection,
        config,
        roster: canonicalRoster,
        continuity: {
          playerContinuityCapsules: historical.resumeFrom.playerContinuityCapsules ?? [],
          houseContinuityCapsule: historical.resumeFrom.houseContinuityCapsule,
          houseContinuityRequirement: historical.resumeFrom.houseContinuityRequirement,
          tokenCostCursor: historical.resumeFrom.tokenCostCursor,
        },
        transcriptReplay: eligibleTranscriptReplay,
        historyCatalog,
        lanes: {
          protected: {
            canonicalBoundarySequence: selection.boundarySequence,
            projectionHash: checkpoint.projectionHash,
          },
          prelude: historyCatalog.filter(
            (entry) => isRecord(entry) && entry.lane === "prelude",
          ),
          hot: [],
          history: historyCatalog.filter(
            (entry) => isRecord(entry) && entry.lane === "history",
          ),
        },
        roomSchedule: roomTape.schedule,
        roomCounts: roomTape.roomCounts,
      },
      traces,
      fidelityContract: {
        canonicalizerId: CANONICALIZER_ID,
        canonicalizerVersion: CANONICALIZER_VERSION,
        bytePreservingMessageContent: true,
        transportOnlyExclusions: ["request.transportOnly"],
        historicallyProven: [
          "prompt.messages",
          "prompt.raw_system_content",
          "prompt.raw_user_content",
          "action",
          "model.name",
          "requestedReasoningEffort",
          "reasoningPolicy",
        ],
        historicallyUnproven: [
          "exact_deployed_revision",
          "tool_schema_serialization",
          "sdk_serialization",
          "response_format_envelope",
          "cache_state",
          "provider_routing",
        ],
      },
    });

    const eventPrefixHash = hashCanonicalJson(toJsonValue(canonicalPrefix));
    const sources: JsonValue[] = [
      toJsonValue({
        kind: "source_game",
        gameId: game.id,
        slug: game.slug,
        status: game.status,
        gameKernel: game.gameKernel,
        transcriptCaptureVersion: game.transcriptCaptureVersion,
        cognitiveArtifactCaptureVersion: game.cognitiveArtifactCaptureVersion,
      }),
      toJsonValue({
        kind: "historical_checkpoint",
        checkpointId: checkpoint.id,
        ownerEpoch: checkpoint.ownerEpoch,
        boundarySequence: checkpoint.lastEventSequence,
        checkpointKind: checkpoint.checkpointKind,
        actorCoordinate: checkpoint.actorCoordinate,
        phase: checkpoint.phase,
        round: checkpoint.round,
        eventHeadHash: checkpoint.eventHeadHash,
        projectionHash: checkpoint.projectionHash,
        transcriptCursor: checkpoint.transcriptCursor,
      }),
      toJsonValue({
        kind: "canonical_event_prefix",
        throughSequence: selection.boundarySequence,
        eventCount: canonicalPrefix.length,
        sha256: eventPrefixHash,
        completeSourceChainHead: persistedEvents.lastTrustedSequence,
      }),
      toJsonValue({
        kind: "transcript_boundary",
        checkpointEntryCount: historical.resumeFrom.transcriptReplay.length,
        captureVersion: game.transcriptCaptureVersion,
        durableState: transcriptState,
      }),
      ...traceSources,
      ...corroboration,
    ];
    return {
      privateData,
      sources,
      traceManifestIds: traceRows.map((row) => row.id),
    };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export async function materializePromptThreadCase(
  db: DrizzleDB,
  input: MaterializePromptThreadCaseInput,
): Promise<MaterializePromptThreadCaseResult> {
  const selection = input.selection ?? VAST_AZURE_SURGE_PROMPT_THREAD_CASE;
  const source = await readMaterializedSource(db, selection, input.storageFactory);
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const caseId = hashCanonicalJson(source.privateData);
  const sourceReceiptArtifact: SourceReceiptArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "source_receipt",
    createdAt,
    caseId,
    sources: source.sources,
    canonicalizerId: CANONICALIZER_ID,
    canonicalizerVersion: CANONICALIZER_VERSION,
    sourceDatabaseMutation: false,
  };
  const sourceReceiptHash = hashCanonicalJson(sourceReceiptArtifact);
  const caseArtifact: FrozenCaseArtifact = {
    protocolVersion: PROTOCOL_VERSION,
    schemaHash: PROTOCOL_SCHEMA_HASH,
    kind: "frozen_case",
    createdAt,
    caseId,
    sourceReceiptHash,
    privateData: source.privateData,
  };
  const contentHash = hashCanonicalJson(toJsonValue({
    caseArtifact,
    sourceReceiptArtifact,
  }));
  const lockId = `materialize-${caseId.slice("sha256:".length, "sha256:".length + 32)}`;

  return withRunMutationLock(input.workspace, lockId, async (lock) => {
    const temporary = await createTemporaryMaterialization(lock);
    await atomicWriteArtifact(
      lock,
      `${temporary.relativePath}/case.json`,
      caseArtifact,
    );
    await atomicWriteArtifact(
      lock,
      `${temporary.relativePath}/source-receipt.json`,
      sourceReceiptArtifact,
    );
    const promoted = await promoteValidatedMaterialization(lock, temporary, {
      contentHash,
      validate: async () => {
        await readArtifact(input.workspace, `${temporary.relativePath}/case.json`);
        await readArtifact(input.workspace, `${temporary.relativePath}/source-receipt.json`);
      },
    });
    return {
      caseId,
      caseArtifact,
      sourceReceiptArtifact,
      casePath: `${promoted.absolutePath}/case.json`,
      sourceReceiptPath: `${promoted.absolutePath}/source-receipt.json`,
      traceManifestIds: source.traceManifestIds,
    };
  });
}
