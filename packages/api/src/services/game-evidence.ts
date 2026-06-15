import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

export interface EvidenceStoragePointer {
  provider: string;
  bucket: string;
  key: string;
}

export interface CreateEvidenceManifestInput {
  gameId: string;
  ownerEpoch: string;
  eventSequence?: number;
  evidenceType: string;
  retentionClass?: string;
  accessScope?: "producer_admin";
  expiresAt?: string;
  storage?: EvidenceStoragePointer;
  sourcePointers?: ReadonlyArray<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export type CreateEvidenceManifestResult =
  | { ok: true; manifestId: string }
  | { ok: false; error: string };

function validateEvidenceStoragePointer(storage?: EvidenceStoragePointer, gameId?: string): void {
  if (!storage) return;

  if (storage.provider !== "linode_object_storage") {
    throw new Error("private evidence storage must use linode_object_storage");
  }
  if (!storage.bucket || !storage.key) {
    throw new Error("private evidence storage requires bucket and key");
  }
  if (process.env.LINODE_OBJ_BUCKET && storage.bucket === process.env.LINODE_OBJ_BUCKET) {
    throw new Error("private evidence storage must not use the public profile-picture bucket");
  }
  const privateBucket = process.env.LINODE_PRIVATE_EVIDENCE_BUCKET;
  if (!privateBucket) {
    throw new Error("LINODE_PRIVATE_EVIDENCE_BUCKET must be configured for private evidence storage");
  }
  if (storage.bucket !== privateBucket) {
    throw new Error("private evidence storage must use the configured private evidence bucket");
  }
  const requiredPrefix = gameId ? `evidence/${gameId}/` : "evidence/";
  if (
    storage.key.startsWith("/") ||
    storage.key.includes("..") ||
    storage.key.startsWith("pfp/") ||
    !storage.key.startsWith(requiredPrefix) ||
    storage.key.startsWith("http://") ||
    storage.key.startsWith("https://")
  ) {
    throw new Error("private evidence storage key must be a private object key");
  }
}

export async function markEvidenceDegraded(
  db: DrizzleDB,
  gameId: string,
  ownerEpoch: string,
  reason: string,
): Promise<void> {
  await db.update(schema.gameRunOwners)
    .set({
      kernelHealth: "degraded",
      failureReason: `evidence_manifest_failed: ${reason}`,
    })
    .where(and(
      eq(schema.gameRunOwners.gameId, gameId),
      eq(schema.gameRunOwners.ownerEpoch, ownerEpoch),
      eq(schema.gameRunOwners.status, "active"),
    ));
}

export async function createEvidenceManifest(
  db: DrizzleDB,
  input: CreateEvidenceManifestInput,
): Promise<CreateEvidenceManifestResult> {
  try {
    validateEvidenceStoragePointer(input.storage, input.gameId);
    const manifestId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM game_run_owners
        WHERE game_id = ${input.gameId}
          AND owner_epoch = ${input.ownerEpoch}
        FOR UPDATE
      `);

      const owner = (await tx
        .select({
          status: schema.gameRunOwners.status,
          expiresAt: schema.gameRunOwners.expiresAt,
        })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, input.gameId),
          eq(schema.gameRunOwners.ownerEpoch, input.ownerEpoch),
        )))[0];
      if (!owner) {
        throw new Error("durable owner not found");
      }
      if (owner.status !== "active") {
        throw new Error(`owner is ${owner.status}`);
      }
      if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
        throw new Error("owner expired");
      }

      if (input.eventSequence != null) {
        const event = (await tx
          .select({ sequence: schema.gameEvents.sequence })
          .from(schema.gameEvents)
          .where(and(
            eq(schema.gameEvents.gameId, input.gameId),
            eq(schema.gameEvents.sequence, input.eventSequence),
          )))[0];
        if (!event) {
          throw new Error("evidence manifest event boundary not found");
        }
      }

      await tx.insert(schema.gameEvidenceManifests)
        .values({
          id: manifestId,
          gameId: input.gameId,
          ownerEpoch: input.ownerEpoch,
          eventSequence: input.eventSequence,
          evidenceType: input.evidenceType,
          retentionClass: input.retentionClass ?? "debug",
          accessScope: input.accessScope ?? "producer_admin",
          expiresAt: input.expiresAt,
          storageProvider: input.storage?.provider,
          storageBucket: input.storage?.bucket,
          storageKey: input.storage?.key,
          sourcePointers: input.sourcePointers,
          metadata: input.metadata ?? {},
        });
    });

    return { ok: true, manifestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEvidenceDegraded(db, input.gameId, input.ownerEpoch, message).catch(() => {});
    return { ok: false, error: message };
  }
}

export function assertPrivateEvidenceStoragePointer(storage?: EvidenceStoragePointer): void {
  validateEvidenceStoragePointer(storage);
}
