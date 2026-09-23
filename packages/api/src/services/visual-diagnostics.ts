import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { VisualOperationEvent } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";

export interface VisualFailureEvidence {
  kind: "transport" | "http" | "response" | "identity" | "anchors" | "timeout" | "internal";
  name: string;
  message: string;
  stack?: string;
  responseBody?: string;
  truncated?: boolean;
  context?: {
    reason: "participants" | "stale_scene" | "reference" | "artifact" | "anchors" | "scene_unavailable";
    roomId: string; sceneId: string | null; renderRevision: number | null; agentId: string;
    expectedParticipants: Array<{ id: string; name: string }>;
    sceneParticipants: Array<{ id: string; name: string }>;
    missingIds: string[]; extraIds: string[];
  };
  repair?: { before: unknown; after: unknown };
}

/** Only response evidence is bounded; never interpret agent-authored cue content. */
export function visualFailureEvidence(error: unknown, kind: VisualFailureEvidence["kind"], responseBody?: string): VisualFailureEvidence {
  return {
    kind, name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    ...(responseBody !== undefined ? { responseBody: responseBody.slice(0, 65_536), truncated: responseBody.length > 65_536 } : {}),
  };
}

type EventInput = Omit<VisualOperationEvent, "id" | "occurredAt" | "boundarySequence" | "sceneId" | "operationId"> &
  Partial<Pick<VisualOperationEvent, "boundarySequence" | "sceneId" | "operationId">>;
type Writer = Pick<DrizzleDB, "insert">;

/** Can join the attempt transaction; evidence is durable before gameplay selects a fallback. */
export async function recordVisualOperationEvent(db: Writer, gameId: string, eventKey: string, input: EventInput, evidence?: VisualFailureEvidence): Promise<void> {
  const id = randomUUID();
  await db.insert(schema.visualOperationEvents).values({ id, gameId, eventKey, evidence,
    event: { id, occurredAt: new Date().toISOString(), boundarySequence: null, sceneId: null, operationId: null, ...input },
  }).onConflictDoNothing();
}

export async function readVisualOperationEvents(db: DrizzleDB, gameId: string) {
  return db.select().from(schema.visualOperationEvents).where(eq(schema.visualOperationEvents.gameId, gameId))
    .orderBy(asc(schema.visualOperationEvents.createdAt), asc(schema.visualOperationEvents.id));
}
