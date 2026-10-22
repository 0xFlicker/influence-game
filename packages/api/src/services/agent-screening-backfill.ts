import { randomUUID } from "node:crypto";
import { asc, eq, gt } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { contentSnapshot, prepareContentAssets } from "./agent-content-submissions.js";
import { enqueueAgentScreening } from "./agent-screening-queue.js";
import { storeBinary, storeJson } from "./payload-storage.js";
import { sha256StableJson } from "./stable-hash.js";
import { sanitizeOwnerLearningFailureMessage } from "./owner-learning-failure-evidence.js";

/** Resumable, bounded pages. Captures present-day legacy content, never invents history. */
export async function backfillAgentScreenings(db: DrizzleDB, options: { apply: boolean; after?: string; limit?: number }) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Backfill limit must be 1–1000");
  const profiles = await db.select().from(schema.agentProfiles).where(options.after ? gt(schema.agentProfiles.id, options.after) : undefined)
    .orderBy(asc(schema.agentProfiles.id)).limit(limit);
  const result = { inspected: profiles.length, profilesWithoutSnapshots: profiles.filter(p => !p.contentRevisionId && !p.latestContentRevisionId).length,
    queuedProfiles: 0, capturedProfiles: 0, conflicts: [] as string[], failures: [] as { profileId: string; reason: string }[], nextCursor: profiles.length === limit ? profiles.at(-1)!.id : null };
  for (const profile of profiles) {
    if (!options.apply) continue;
    try {
      const ids = [...new Set([profile.contentRevisionId, profile.latestContentRevisionId].filter((id): id is string => Boolean(id)))];
      if (ids.length) {
        for (const id of ids) await enqueueAgentScreening(db, id);
        result.queuedProfiles++; continue;
      }
      const snapshot = contentSnapshot(profile);
      const evidence = await prepareContentAssets(profile);
      const assets = Object.fromEntries(Object.entries(evidence).map(([url, value]) => [url, value.hash]));
      const storedAssets = await Promise.all(Object.values(evidence).map(async value => ({ hash: value.hash, bytes: await storeBinary(value.bytes) })));
      const storedSnapshot = await storeJson({ ...snapshot, assets });
      const captured = await db.transaction(async tx => {
        const [current] = await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, profile.id)).for("update");
        if (!current || current.contentRevisionId || current.latestContentRevisionId || sha256StableJson(contentSnapshot(current)) !== sha256StableJson(snapshot)) return false;
        const id = randomUUID();
        for (const asset of storedAssets) await tx.insert(schema.agentContentAssets).values(asset).onConflictDoNothing();
        await tx.insert(schema.agentContentRevisions).values({ id, agentProfileId: profile.id, userId: profile.userId,
          competitiveRevisionId: current.currentRevisionId, ancestryKnown: false, snapshot: storedSnapshot,
          fingerprint: sha256StableJson({ ...snapshot, assets }) });
        await tx.insert(schema.agentModerationReviews).values({ id: randomUUID(), contentRevisionId: id, held: current.moderationRequired });
        // Attach evidence coordinates only; no publication, rating, timestamps or roster changes.
        await tx.update(schema.agentProfiles).set({ latestContentRevisionId: id, contentRevisionId: current.moderationRequired ? null : id }).where(eq(schema.agentProfiles.id, profile.id));
        await enqueueAgentScreening(tx, id);
        return true;
      });
      if (captured) { result.capturedProfiles++; result.queuedProfiles++; }
      else result.conflicts.push(profile.id);
    } catch (error) { result.failures.push({ profileId: profile.id, reason: sanitizeOwnerLearningFailureMessage(error) }); }
  }
  return result;
}
