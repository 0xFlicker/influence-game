import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { PrivateDecisionTrace } from "@influence/engine";
import { schema, type DrizzleDB } from "../db/index.js";
import type {
  CognitiveArtifactActorRole,
  CognitiveArtifactType,
  CognitiveArtifactVisibilityStatus,
} from "../db/schema.js";

export const COGNITIVE_ARTIFACT_CAPTURE_VERSION = 1;
export const MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES = 256 * 1024;

export interface WriteCognitiveArtifactsInput {
  gameId: string;
  trace: PrivateDecisionTrace;
  captureVersion: number;
  eventSequence?: number;
}

export type WriteCognitiveArtifactsResult =
  | {
    ok: true;
    artifactIds: string[];
    degradedArtifactIds: string[];
    skippedReason?: "capture_disabled" | "empty_trace";
  }
  | {
    ok: false;
    artifactIds: string[];
    degradedArtifactIds: string[];
    error: string;
  };

interface CognitiveArtifactDraft {
  artifactType: CognitiveArtifactType;
  payload: Record<string, unknown>;
}

interface ActorMetadata {
  actorPlayerId?: string;
  actorUserId?: string;
  actorAgentProfileId?: string;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function captureMetadata(trace: PrivateDecisionTrace): Record<string, unknown> {
  return {
    formatVersion: 1,
    traceVersion: trace.version,
    action: trace.action,
    actor: {
      ...(trace.actor.id && { id: trace.actor.id }),
      name: trace.actor.name,
      role: trace.actor.role,
    },
    ...(trace.phase && { phase: trace.phase }),
    ...(trace.round !== undefined && { round: trace.round }),
    modelName: trace.model.name,
    traceCreatedAt: trace.createdAt,
  };
}

function extractStrategyPayload(
  trace: PrivateDecisionTrace,
  capture: Record<string, unknown>,
): Record<string, unknown> | null {
  const decisionLog = nonEmptyText(trace.decisionLog);
  const strategicLensRationale = nonEmptyText(trace.strategicLensRationale);
  const strategy: Record<string, unknown> = {
    capture,
    ...(decisionLog && { decisionLog }),
    ...(trace.strategicLens && { strategicLens: trace.strategicLens }),
    ...(strategicLensRationale && { strategicLensRationale }),
    ...(trace.strategyPacketRevision && { strategyPacketRevision: trace.strategyPacketRevision }),
    ...(trace.strategyPacketUpdate && { strategyPacketUpdate: trace.strategyPacketUpdate }),
    ...(trace.strategyPacketSummary && { strategyPacketSummary: trace.strategyPacketSummary }),
    ...(trace.strategicReflectionSummary && { strategicReflectionSummary: trace.strategicReflectionSummary }),
  };
  return Object.keys(strategy).length > 1 ? strategy : null;
}

export function extractCognitiveArtifactDrafts(
  trace: PrivateDecisionTrace,
): CognitiveArtifactDraft[] {
  const capture = captureMetadata(trace);
  const drafts: CognitiveArtifactDraft[] = [];
  const reasoningContext = nonEmptyText(trace.reasoningContext);
  const providerReasoningSummary = nonEmptyText(trace.providerReasoningSummary?.text);
  const thinking = nonEmptyText(trace.emittedThinking);

  if (reasoningContext || providerReasoningSummary) {
    drafts.push({
      artifactType: "reasoning",
      payload: {
        ...(reasoningContext && { reasoningContext }),
        ...(providerReasoningSummary && { reasoningSummary: providerReasoningSummary }),
        capture,
      },
    });
  }

  if (thinking) {
    drafts.push({
      artifactType: "thinking",
      payload: {
        thinking,
        capture,
      },
    });
  }

  const strategyPayload = extractStrategyPayload(trace, capture);
  if (strategyPayload) {
    drafts.push({
      artifactType: "strategy",
      payload: strategyPayload,
    });
  }

  return drafts;
}

async function loadActorMetadata(
  db: DrizzleDB,
  gameId: string,
  trace: PrivateDecisionTrace,
): Promise<ActorMetadata> {
  const actorId = trace.actor.id;
  if (!actorId || (trace.actor.role !== "player" && trace.actor.role !== "juror")) {
    return {};
  }

  const player = (await db
    .select({
      id: schema.gamePlayers.id,
      userId: schema.gamePlayers.userId,
      agentProfileId: schema.gamePlayers.agentProfileId,
    })
    .from(schema.gamePlayers)
    .where(and(
      eq(schema.gamePlayers.id, actorId),
      eq(schema.gamePlayers.gameId, gameId),
    )))[0];

  if (!player) return {};
  return {
    actorPlayerId: player.id,
    ...(player.userId && { actorUserId: player.userId }),
    ...(player.agentProfileId && { actorAgentProfileId: player.agentProfileId }),
  };
}

function degradedPayloadDiagnostics(
  reason: string,
  originalPayloadByteLength: number,
): Record<string, unknown> {
  return {
    reason,
    originalPayloadByteLength,
    maxPayloadByteLength: MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES,
  };
}

export async function writeCognitiveArtifactsForTrace(
  db: DrizzleDB,
  input: WriteCognitiveArtifactsInput,
): Promise<WriteCognitiveArtifactsResult> {
  if (input.captureVersion !== COGNITIVE_ARTIFACT_CAPTURE_VERSION) {
    return {
      ok: true,
      artifactIds: [],
      degradedArtifactIds: [],
      skippedReason: "capture_disabled",
    };
  }

  const drafts = extractCognitiveArtifactDrafts(input.trace);
  if (drafts.length === 0) {
    return {
      ok: true,
      artifactIds: [],
      degradedArtifactIds: [],
      skippedReason: "empty_trace",
    };
  }

  try {
    const actorMetadata = await loadActorMetadata(db, input.gameId, input.trace);
    const eventSequence = input.eventSequence ?? input.trace.boundary?.finalEventSequence;
    const artifactIds: string[] = [];
    const degradedArtifactIds: string[] = [];

    for (const draft of drafts) {
      const artifactId = randomUUID();
      const payloadByteLength = jsonByteLength(draft.payload);
      const oversized = payloadByteLength > MAX_COGNITIVE_ARTIFACT_PAYLOAD_BYTES;
      const visibilityStatus: CognitiveArtifactVisibilityStatus = oversized ? "capture_degraded" : "active";

      await db.insert(schema.gameCognitiveArtifacts)
        .values({
          id: artifactId,
          gameId: input.gameId,
          captureVersion: input.captureVersion,
          ...(eventSequence !== undefined && { eventSequence }),
          artifactType: draft.artifactType,
          actorRole: input.trace.actor.role as CognitiveArtifactActorRole,
          ...actorMetadata,
          action: input.trace.action,
          ...(input.trace.phase && { phase: input.trace.phase }),
          ...(input.trace.round !== undefined && { round: input.trace.round }),
          visibilityStatus,
          payloadByteLength: oversized ? 0 : payloadByteLength,
          payload: oversized ? {} : draft.payload,
          ...(oversized && {
            diagnostics: degradedPayloadDiagnostics("payload_too_large", payloadByteLength),
          }),
        });

      if (oversized) {
        degradedArtifactIds.push(artifactId);
      } else {
        artifactIds.push(artifactId);
      }
    }

    return {
      ok: true,
      artifactIds,
      degradedArtifactIds,
    };
  } catch (error) {
    return {
      ok: false,
      artifactIds: [],
      degradedArtifactIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
