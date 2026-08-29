import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { stableJson } from "./stable-hash.js";

export interface PrivateContentStoragePointer {
  provider: string;
  bucket: string;
  key: string;
}

export interface CreateEvidenceManifestInput {
  /** Deterministic id for retry-safe evidence writes. Omit for ordinary traces. */
  manifestId?: string;
  gameId: string;
  ownerEpoch: string;
  eventSequence?: number;
  decisionId?: string;
  evidenceType: string;
  retentionClass?: string;
  accessScope?: "producer_admin";
  expiresAt?: string;
  storage?: PrivateContentStoragePointer;
  sourcePointers?: ReadonlyArray<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export type CreateEvidenceManifestResult =
  | { ok: true; manifestId: string }
  | { ok: false; error: string };

function validatePrivateContentStoragePointer(storage?: PrivateContentStoragePointer, gameId?: string): void {
  if (!storage) return;

  if (storage.provider !== "linode_object_storage") {
    throw new Error("private content storage must use linode_object_storage");
  }
  if (!storage.bucket || !storage.key) {
    throw new Error("private content storage requires bucket and key");
  }
  if (process.env.LINODE_OBJ_BUCKET && storage.bucket === process.env.LINODE_OBJ_BUCKET) {
    throw new Error("private content storage must not use the public profile-picture bucket");
  }
  const privateContentBucket = process.env.LINODE_PRIVATE_CONTENT_BUCKET;
  if (!privateContentBucket) {
    throw new Error("LINODE_PRIVATE_CONTENT_BUCKET must be configured for private content storage");
  }
  if (storage.bucket !== privateContentBucket) {
    throw new Error("private content storage must use the configured private content bucket");
  }
  const requiredPrefix = gameId ? `content/${gameId}/` : "content/";
  if (
    storage.key.startsWith("/") ||
    storage.key.includes("..") ||
    storage.key.startsWith("pfp/") ||
    !storage.key.startsWith(requiredPrefix) ||
    storage.key.startsWith("http://") ||
    storage.key.startsWith("https://")
  ) {
    throw new Error("private content storage key must be a private object key");
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
    validatePrivateContentStoragePointer(input.storage, input.gameId);
    const manifestId = input.manifestId ?? randomUUID();

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

      const values = {
        id: manifestId,
        gameId: input.gameId,
        ownerEpoch: input.ownerEpoch,
        eventSequence: input.eventSequence,
        decisionId: input.decisionId,
        evidenceType: input.evidenceType,
        retentionClass: input.retentionClass ?? "debug",
        accessScope: input.accessScope ?? "producer_admin",
        expiresAt: input.expiresAt,
        storageProvider: input.storage?.provider,
        storageBucket: input.storage?.bucket,
        storageKey: input.storage?.key,
        sourcePointers: input.sourcePointers,
        metadata: input.metadata ?? {},
      } as const;
      const inserted = await tx.insert(schema.gameEvidenceManifests)
        .values({
          ...values,
        })
        .onConflictDoNothing({ target: schema.gameEvidenceManifests.id })
        .returning({ id: schema.gameEvidenceManifests.id });

      if (inserted.length === 0) {
        const existing = (await tx
          .select()
          .from(schema.gameEvidenceManifests)
          .where(eq(schema.gameEvidenceManifests.id, manifestId)))[0];
        if (!existing) throw new Error("Evidence manifest id conflict could not be resolved");
        const immutableExisting = {
          gameId: existing.gameId,
          ownerEpoch: existing.ownerEpoch,
          eventSequence: existing.eventSequence ?? undefined,
          decisionId: existing.decisionId ?? undefined,
          evidenceType: existing.evidenceType,
          retentionClass: existing.retentionClass,
          accessScope: existing.accessScope,
          expiresAt: existing.expiresAt ?? undefined,
          storageProvider: existing.storageProvider ?? undefined,
          storageBucket: existing.storageBucket ?? undefined,
          storageKey: existing.storageKey ?? undefined,
          sourcePointers: existing.sourcePointers ?? undefined,
          metadata: existing.metadata,
        };
        const immutableInput = {
          gameId: values.gameId,
          ownerEpoch: values.ownerEpoch,
          eventSequence: values.eventSequence,
          decisionId: values.decisionId,
          evidenceType: values.evidenceType,
          retentionClass: values.retentionClass,
          accessScope: values.accessScope,
          expiresAt: values.expiresAt,
          storageProvider: values.storageProvider,
          storageBucket: values.storageBucket,
          storageKey: values.storageKey,
          sourcePointers: values.sourcePointers,
          metadata: values.metadata,
        };
        if (stableJson(immutableExisting) !== stableJson(immutableInput)) {
          throw new Error("Evidence manifest id has conflicting immutable identity");
        }
      }
    });

    return { ok: true, manifestId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markEvidenceDegraded(db, input.gameId, input.ownerEpoch, message).catch(() => {});
    return { ok: false, error: message };
  }
}

export function assertPrivateContentStoragePointer(storage?: PrivateContentStoragePointer): void {
  validatePrivateContentStoragePointer(storage);
}
