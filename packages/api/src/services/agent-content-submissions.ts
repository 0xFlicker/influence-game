import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { AgentProfileMutationRead } from "./agent-profile-management.js";
import { sha256StableJson } from "./stable-hash.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type Profile = typeof schema.agentProfiles.$inferSelect;
export class ContentSubmissionConflict extends Error {}
export type ContentAssetEvidence = Record<string, { hash: string; bytes: Buffer }>;

/** Capture exact bytes before the profile transaction. No provider calls. */
export async function prepareContentAssets(profile: Pick<Profile, "avatarUrl" | "fullBodyReferenceUrl" | "portraitCrop">): Promise<ContentAssetEvidence> {
  const evidence: ContentAssetEvidence = {};
  for (const url of new Set([profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl])) {
    if (!url) continue;
    const bytes = await readVisualProfileImage(url, { name: "", personaKey: "" });
    evidence[url] = { hash: createHash("sha256").update(bytes).digest("hex"), bytes };
  }
  return evidence;
}
export function contentSnapshot(profile: Profile) {
  return {
    name: profile.name, personaKey: profile.personaKey, gender: profile.gender,
    personality: profile.personality, backstory: profile.backstory, strategyStyle: profile.strategyStyle,
    performanceInstructions: profile.performanceInstructions, visualDesign: profile.visualDesign,
    avatarUrl: profile.avatarUrl, fullBodyReferenceUrl: profile.fullBodyReferenceUrl, portraitCrop: profile.portraitCrop, headPosition: profile.headPosition,
  };
}
export async function replayContentSubmission(tx: Tx | DrizzleDB, userId: string, agentId: string, id: string, requestHash: string): Promise<AgentProfileMutationRead | null> {
  const [prior] = await tx.select().from(schema.agentContentSubmissions).where(eq(schema.agentContentSubmissions.id, id));
  if (!prior) return null;
  if (prior.userId !== userId || prior.agentProfileId !== agentId || prior.requestHash !== requestHash) throw new ContentSubmissionConflict("This submission ID was already used for different changes. Start a new submission.");
  return { ...(prior.result as unknown as AgentProfileMutationRead), replayed: true };
}

/** Called under the profile lock, in the same transaction as the accepted update. */
export async function recordContentSubmission(tx: Tx, mutation: AgentProfileMutationRead, options: {
  id: string; requestHash: string; assets?: ContentAssetEvidence;
}): Promise<AgentProfileMutationRead> {
  const profile = mutation.profile;
  const snapshot = contentSnapshot(profile);

  const [prior] = profile.contentRevisionId ? await tx.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.contentRevisionId)) : [];
  const previousAssets = (prior?.snapshot.assets ?? {}) as Record<string, string>;
  const assets: Record<string, string> = {};
  const missingUrls = [profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl].filter((url): url is string => Boolean(url && !options.assets?.[url] && !previousAssets[url]));
  const evidence = missingUrls.length ? { ...await prepareContentAssets(profile), ...options.assets } : options.assets;
  for (const url of new Set([profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl])) {
    if (!url) continue;
    const captured = evidence?.[url];
    if (captured) { await tx.insert(schema.agentContentAssets).values(captured).onConflictDoNothing(); assets[url] = captured.hash; }
    else assets[url] = previousAssets[url]!;
  }
  const fingerprint = sha256StableJson({ ...snapshot, assets });
  let revisionId = prior?.id;
  let reviewId: string | undefined;
  if (prior?.fingerprint === fingerprint) {
    [reviewId] = (await tx.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.contentRevisionId, prior.id))).map((r) => r.id);
  } else {
    revisionId = randomUUID();
    reviewId = randomUUID();
    await tx.insert(schema.agentContentRevisions).values({ id: revisionId, agentProfileId: profile.id, userId: profile.userId,
      competitiveRevisionId: profile.currentRevisionId, fingerprint, snapshot: { ...snapshot, assets } });
    await tx.insert(schema.agentModerationReviews).values({ id: reviewId, contentRevisionId: revisionId });
    await tx.update(schema.agentProfiles).set({ contentRevisionId: revisionId }).where(and(eq(schema.agentProfiles.id, profile.id), eq(schema.agentProfiles.userId, profile.userId)));
  }
  const result = { ...mutation, profile: { ...profile, contentRevisionId: revisionId! },
    receipt: { ...mutation.receipt, contentRevisionId: revisionId!, moderationRecordId: reviewId! } };
  await tx.insert(schema.agentContentSubmissions).values({ id: options.id, userId: profile.userId, agentProfileId: profile.id, requestHash: options.requestHash,
    result: result as unknown as Record<string, unknown> });
  return result;
}
