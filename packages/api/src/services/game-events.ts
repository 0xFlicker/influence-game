import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  validateCanonicalGameEvent,
  type CanonicalGameEvent,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { markGameSuspended } from "./game-ownership.js";
import { sha256StableJson } from "./stable-hash.js";

export function hashCanonicalEvent(event: CanonicalGameEvent): string {
  return sha256StableJson(event);
}

function validateEnvelopeMetadata(gameId: string, event: CanonicalGameEvent): void {
  const result = validateCanonicalGameEvent(event);
  if (!result.ok) {
    throw new Error(`Invalid canonical event: ${result.errors.join("; ")}`);
  }
  if (event.gameId !== gameId) {
    throw new Error(`Canonical event gameId ${event.gameId} does not match API game ${gameId}`);
  }
  if (event.payloadVersion !== 1) {
    throw new Error(`Unsupported canonical event payload version ${event.payloadVersion}`);
  }
}

export async function appendGameEvents(
  db: DrizzleDB,
  params: {
    gameId: string;
    ownerEpoch: string;
    events: readonly CanonicalGameEvent[];
  },
): Promise<void> {
  if (params.events.length === 0) return;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM game_run_owners
        WHERE game_id = ${params.gameId}
          AND owner_epoch = ${params.ownerEpoch}
        FOR UPDATE
      `);

      const owner = (await tx
        .select({
          status: schema.gameRunOwners.status,
          expiresAt: schema.gameRunOwners.expiresAt,
          lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
        })
        .from(schema.gameRunOwners)
        .where(and(
          eq(schema.gameRunOwners.gameId, params.gameId),
          eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
        )))[0];

      if (!owner) {
        throw new Error(`No durable owner for game ${params.gameId}`);
      }
      if (owner.status !== "active") {
        throw new Error(`Owner epoch ${params.ownerEpoch} is ${owner.status}`);
      }
      if (owner.expiresAt && new Date(owner.expiresAt).getTime() <= Date.now()) {
        throw new Error(`Owner epoch ${params.ownerEpoch} expired`);
      }

      let nextSequence = owner.lastPersistedEventSequence + 1;
      let newHead = owner.lastPersistedEventSequence;

      for (const event of params.events) {
        validateEnvelopeMetadata(params.gameId, event);
        const eventHash = hashCanonicalEvent(event);

        if (event.sequence < nextSequence) {
          const existing = (await tx
            .select({
              eventHash: schema.gameEvents.eventHash,
              ownerEpoch: schema.gameEvents.ownerEpoch,
            })
            .from(schema.gameEvents)
            .where(and(
              eq(schema.gameEvents.gameId, params.gameId),
              eq(schema.gameEvents.sequence, event.sequence),
            )))[0];
          if (existing?.eventHash === eventHash && existing.ownerEpoch === params.ownerEpoch) {
            continue;
          }
          throw new Error(`Conflicting duplicate canonical event sequence ${event.sequence}`);
        }

        if (event.sequence !== nextSequence) {
          throw new Error(`Non-contiguous canonical event sequence: expected ${nextSequence}, got ${event.sequence}`);
        }

        await tx.insert(schema.gameEvents)
          .values({
            gameId: params.gameId,
            sequence: event.sequence,
            eventType: event.type,
            eventHash,
            ownerEpoch: params.ownerEpoch,
            visibility: event.visibility,
            payloadVersion: event.payloadVersion,
            runSource: "api",
            sourcePointers: event.sourcePointers as unknown as ReadonlyArray<Record<string, unknown>>,
            envelope: event as unknown as Record<string, unknown>,
          });

        newHead = event.sequence;
        nextSequence += 1;
      }

      if (newHead !== owner.lastPersistedEventSequence) {
        await tx.update(schema.gameRunOwners)
          .set({
            lastPersistedEventSequence: newHead,
          })
          .where(and(
            eq(schema.gameRunOwners.gameId, params.gameId),
            eq(schema.gameRunOwners.ownerEpoch, params.ownerEpoch),
            eq(schema.gameRunOwners.status, "active"),
          ));
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(`Owner epoch ${params.ownerEpoch} is revoked`)) {
      await markGameSuspended(db, params.gameId, "event_append_failed", {
        message,
      }).catch(() => {});
    }
    throw error;
  }
}
