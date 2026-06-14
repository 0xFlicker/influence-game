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

export interface BuildRedactedKernelHealthInput {
  status?: KernelHealthStatus | "unknown";
  ownerLastPersistedEventSequence?: number;
  maxEventSequence?: number;
  durableEventCount?: number;
  checkpointCount?: number;
  evidenceManifestCount?: number;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function buildRedactedKernelHealth(
  input: BuildRedactedKernelHealthInput = {},
): RedactedKernelHealth {
  const durableEventCount = toCount(input.durableEventCount);
  const checkpointCount = toCount(input.checkpointCount);
  const evidenceManifestCount = toCount(input.evidenceManifestCount);

  return {
    status: input.status ?? "unknown",
    lastPersistedEventSequence: Math.max(
      toCount(input.ownerLastPersistedEventSequence),
      toCount(input.maxEventSequence),
    ),
    durableEventCount,
    checkpointCount,
    evidenceManifestCount,
    hasDurableEvents: durableEventCount > 0,
    hasCheckpoints: checkpointCount > 0,
    hasEvidenceManifests: evidenceManifestCount > 0,
  };
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
    result.set(gameId, buildRedactedKernelHealth());
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
    result.set(owner.gameId, buildRedactedKernelHealth({
      status: owner.status,
      ownerLastPersistedEventSequence: owner.lastPersistedEventSequence,
      maxEventSequence: current.lastPersistedEventSequence,
      durableEventCount: current.durableEventCount,
      checkpointCount: current.checkpointCount,
      evidenceManifestCount: current.evidenceManifestCount,
    }));
  }

  for (const stat of eventStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const durableEventCount = toCount(stat.count);
    result.set(stat.gameId, buildRedactedKernelHealth({
      status: current.status,
      ownerLastPersistedEventSequence: current.lastPersistedEventSequence,
      maxEventSequence: stat.maxSequence,
      durableEventCount,
      checkpointCount: current.checkpointCount,
      evidenceManifestCount: current.evidenceManifestCount,
    }));
  }

  for (const stat of checkpointStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const checkpointCount = toCount(stat.count);
    result.set(stat.gameId, buildRedactedKernelHealth({
      status: current.status,
      ownerLastPersistedEventSequence: current.lastPersistedEventSequence,
      durableEventCount: current.durableEventCount,
      checkpointCount,
      evidenceManifestCount: current.evidenceManifestCount,
    }));
  }

  for (const stat of evidenceStats) {
    const current = result.get(stat.gameId);
    if (!current) continue;
    const evidenceManifestCount = toCount(stat.count);
    result.set(stat.gameId, buildRedactedKernelHealth({
      status: current.status,
      ownerLastPersistedEventSequence: current.lastPersistedEventSequence,
      durableEventCount: current.durableEventCount,
      checkpointCount: current.checkpointCount,
      evidenceManifestCount,
    }));
  }

  return result;
}
