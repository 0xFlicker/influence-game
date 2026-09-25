import { parseCharacterHeadPosition } from "@influence/engine/character-portrait";
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
  id: string; requestHash: string; assets?: ContentAssetEvidence; candidate?: Profile;
}): Promise<AgentProfileMutationRead> {
  const profile = options.candidate ?? mutation.profile;
  const snapshot = contentSnapshot(profile);

  const [prior] = profile.latestContentRevisionId ? await tx.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.latestContentRevisionId)) : [];
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
      competitiveRevisionId: profile.currentRevisionId, parentRevisionId: prior?.id ?? null,
      ancestryKnown: prior ? prior.ancestryKnown : true, fingerprint, snapshot: { ...snapshot, assets } });
    await tx.insert(schema.agentModerationReviews).values({ id: reviewId, contentRevisionId: revisionId, held: profile.moderationRequired });
  }
  const [saved] = await tx.update(schema.agentProfiles).set({
    latestContentRevisionId: revisionId!,
    contentRevisionId: profile.moderationRequired ? mutation.profile.contentRevisionId : revisionId!,
    moderationVersion: profile.moderationVersion + 1,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(schema.agentProfiles.id, profile.id), eq(schema.agentProfiles.userId, profile.userId))).returning();
  const result = { ...mutation, profile: saved!,
    receipt: { ...mutation.receipt, contentRevisionId: revisionId!, moderationRecordId: reviewId!,
      ...(profile.moderationRequired ? { publication: "held" as const } : { publication: "published" as const }) } };
  await tx.insert(schema.agentContentSubmissions).values({ id: options.id, userId: profile.userId, agentProfileId: profile.id, requestHash: options.requestHash,
    result: result as unknown as Record<string, unknown> });
  return result;
}

/** Decode our immutable snapshot without accepting arbitrary profile columns. */
export function decodeContentSnapshot(snapshot: Record<string, unknown>, profile: Profile): ReturnType<typeof contentSnapshot> {
  const result = contentSnapshot(profile);
  for (const key of ["name", "personality"] as const) {
    if (typeof snapshot[key] !== "string" || !snapshot[key].trim()) throw new ContentSubmissionConflict("The saved snapshot needs admin recovery.");
    result[key] = snapshot[key];
  }
  for (const key of ["personaKey", "backstory", "strategyStyle", "performanceInstructions", "visualDesign", "avatarUrl", "fullBodyReferenceUrl"] as const) {
    const value = snapshot[key];
    if (value !== null && typeof value !== "string") throw new ContentSubmissionConflict("The saved snapshot needs admin recovery.");
    result[key] = value;
  }
  if (snapshot.gender !== null && !["male", "female", "non-binary"].includes(String(snapshot.gender))) throw new ContentSubmissionConflict("The saved gender is invalid.");
  result.gender = snapshot.gender as Profile["gender"];
  // Head geometry is optional: absence means unconfirmed, just like explicit null.
  try { result.headPosition = snapshot.headPosition == null ? null : parseCharacterHeadPosition(snapshot.headPosition); }
  catch { throw new ContentSubmissionConflict("The saved head geometry needs admin recovery."); }
  const crop = snapshot.portraitCrop;
  if (crop === null) result.portraitCrop = null;
  else {
    if (!crop || typeof crop !== "object" || Array.isArray(crop)) throw new ContentSubmissionConflict("The saved crop is invalid.");
    const c = crop as Record<string, unknown>;
    if (typeof c.sourceUrl !== "string" || ![c.x, c.y, c.width, c.height].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)
      || Number(c.width) <= 0 || Number(c.height) <= 0 || Number(c.x) + Number(c.width) > 1 || Number(c.y) + Number(c.height) > 1) {
      throw new ContentSubmissionConflict("The saved crop is invalid.");
    }
    result.portraitCrop = crop as NonNullable<Profile["portraitCrop"]>;
  }
  return result;
}

/** Owner-only projection: never includes evidence hashes, routing, or reviewer notes. */
export async function readOwnerContent(db: Pick<DrizzleDB, "select">, profile: Profile) {
  const [latest] = profile.latestContentRevisionId
    ? await db.select().from(schema.agentContentRevisions).where(and(eq(schema.agentContentRevisions.id, profile.latestContentRevisionId), eq(schema.agentContentRevisions.agentProfileId, profile.id))) : [];
  const [review] = latest ? await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.contentRevisionId, latest.id)) : [];
  return {
    published: profile.contentRevisionId ? contentSnapshot(profile) : null,
    submitted: latest ? { revisionId: latest.id, content: decodeContentSnapshot(latest.snapshot, profile),
      disposition: review?.disposition ?? null, held: review?.held ?? false, status: review?.status ?? null } : null,
    availability: profile.archivedAt ? "archived" as const : profile.moderationRequired && !profile.contentRevisionId ? "withheld" as const : "available" as const,
    moderationVersion: profile.moderationVersion,
  };
}

export async function latestSubmittedProfile(db: Pick<DrizzleDB, "select">, profile: Profile): Promise<Profile> {
  if (!profile.moderationRequired || !profile.latestContentRevisionId) return profile;
  const content = await readOwnerContent(db, profile);
  if (!content.submitted) throw new ContentSubmissionConflict("The submitted draft is unavailable. Reload before submitting.");
  return { ...profile, ...content.submitted.content };
}
