import { desc, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { KernelHealthStatus } from "../db/schema.js";

export interface RedactedKernelHealth {
  status: KernelHealthStatus | "unknown";
  lastPersistedEventSequence: number;
  durableEventCount: number;
  checkpointCount: number;
  evidenceManifestCount: number;
  hasDurableEvents: boolean;
  hasCheckpoints: boolean;
  hasEvidenceManifests: boolean;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10);
  return 0;
}

export async function getRedactedKernelHealth(
  db: DrizzleDB,
  gameId: string,
): Promise<RedactedKernelHealth> {
  return (await getRedactedKernelHealthByGameId(db, [gameId])).get(gameId)!;
}

export async function getRedactedKernelHealthByGameId(
  db: DrizzleDB,
  gameIds: readonly string[],
): Promise<Map<string, RedactedKernelHealth>> {
  const ids = [...new Set(gameIds)];
  const result = new Map<string, RedactedKernelHealth>();
  for (const gameId of ids) {
    result.set(gameId, {
      status: "unknown",
      lastPersistedEventSequence: 0,
      durableEventCount: 0,
      checkpointCount: 0,
      evidenceManifestCount: 0,
      hasDurableEvents: false,
      hasCheckpoints: false,
      hasEvidenceManifests: false,
    });
  }
  if (ids.length === 0) return result;

  const [owners, eventStats, checkpointStats, evidenceStats] = await Promise.all([
    db.select({
      gameId: schema.gameRunOwners.gameId,
      status: schema.gameRunOwners.kernelHealth,
      lastPersistedEventSequence: schema.gameRunOwners.lastPersistedEventSequence,
    })
      .from(schema.gameRunOwners)
      .where(inArray(schema.gameRunOwners.gameId, ids))
      .orderBy(desc(schema.gameRunOwners.acquiredAt)),
    db.select({
      gameId: schema.gameEvents.gameId,
      count: sql<number>`count(*)::int`,
      maxSequence: sql<number>`coalesce(max(${schema.gameEvents.sequence}), 0)::int`,
    })
      .from(schema.gameEvents)
      .where(inArray(schema.gameEvents.gameId, ids))
      .groupBy(schema.gameEvents.gameId),
    db.select({
      gameId: schema.gameCheckpoints.gameId,
      count: sql<number>`count(*)::int`,
    })
      .from(schema.gameCheckpoints)
      .where(inArray(schema.gameCheckpoints.gameId, ids))
      .groupBy(schema.gameCheckpoints.gameId),
    db.select({
      gameId: schema.gameEvidenceManifests.gameId,
      count: sql<number>`count(*)::int`,
    })
      .from(schema.gameEvidenceManifests)
      .where(inArray(schema.gameEvidenceManifests.gameId, ids))
      .groupBy(schema.gameEvidenceManifests.gameId),
  ]);

  for (const owner of owners) {
    const current = result.get(owner.gameId);
    if (!current || current.status !== "unknown") continue;
    result.set(owner.gameId, {
      ...current,
      status: owner.status,
      lastPersistedEventSequence: Math.max(
        current.lastPersistedEventSequence,
        toCount(owner.lastPersistedEventSequence),
      ),
    });
  }

  for (const stat of eventStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const durableEventCount = toCount(stat.count);
    result.set(stat.gameId, {
      ...current,
      durableEventCount,
      hasDurableEvents: durableEventCount > 0,
      lastPersistedEventSequence: Math.max(
        current.lastPersistedEventSequence,
        toCount(stat.maxSequence),
      ),
    });
  }

  for (const stat of checkpointStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const checkpointCount = toCount(stat.count);
    result.set(stat.gameId, {
      ...current,
      checkpointCount,
      hasCheckpoints: checkpointCount > 0,
    });
  }

  for (const stat of evidenceStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const evidenceManifestCount = toCount(stat.count);
    result.set(stat.gameId, {
      ...current,
      evidenceManifestCount,
      hasEvidenceManifests: evidenceManifestCount > 0,
    });
  }

  return result;
}
