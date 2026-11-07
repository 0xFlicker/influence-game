import { hasCharacterTransparency } from "./transparent-character-image.js";
import { normalizeModelPreference } from "@influence/engine/game-model-routing";
import { SCREENING_POLICY_VERSION } from "./agent-screening-policy.js";
import { assignPlayerVoice, isPlayerVoiceId } from "@influence/engine/voice-catalog";
import { cutoutMode, CUTOUT_RECIPE } from "./character-cutouts.js";
import { loadPayloads, storeFields } from "./payload-storage.js";
import { enqueueAgentScreening } from "./agent-screening-queue.js";
import { parseCharacterHeadPosition } from "@influence/engine/character-portrait";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
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
export async function prepareContentAssets(profile: Pick<Profile, "avatarUrl" | "fullBodyReferenceUrl" | "portraitCrop">, saved: ContentAssetEvidence = {}, access?: {db: Pick<DrizzleDB,"select">;userId:string}): Promise<ContentAssetEvidence> {
  const evidence: ContentAssetEvidence = {};
  for (const url of new Set([profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl])) {
    if (!url) continue;
    if (saved[url]) { evidence[url] = saved[url]; continue; }
    const bytes = await readVisualProfileImage(url, { name: "", personaKey: "" }, access);
    evidence[url] = { hash: createHash("sha256").update(bytes).digest("hex"), bytes };
  }
  return evidence;
}
/** Reuse the immutable image evidence belonging to the draft being edited. */
export async function readSavedContentAssets(db: Pick<DrizzleDB, "select">, profile: Profile): Promise<ContentAssetEvidence> {
  const revisionId = profile.latestContentRevisionId ?? profile.contentRevisionId;
  if (!revisionId) return {};
  const [revision] = await loadPayloads(db.select().from(schema.agentContentRevisions).where(and(
    eq(schema.agentContentRevisions.id, revisionId), eq(schema.agentContentRevisions.agentProfileId, profile.id),
  )));
  if (!revision) throw new ContentSubmissionConflict("The character content revision is unavailable. Reload before submitting.");
  const references = (revision.snapshot.assets ?? {}) as Record<string, string>;
  const hashes = [...new Set(Object.values(references))];
  if (!hashes.length) return {};
  const assets = await loadPayloads(db.select().from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash, hashes)));
  const byHash = new Map(assets.map((asset) => [asset.hash, asset]));
  const evidence: ContentAssetEvidence = {};
  for (const [url, hash] of Object.entries(references)) {
    const asset = byHash.get(hash);
    if (!asset) throw new Error("Saved character image evidence is unavailable");
    evidence[url] = { hash, bytes: asset.bytes };
  }
  return evidence;
}
export function contentSnapshot(profile: Profile) {
  return {
    name: profile.name, personaKey: profile.personaKey, gender: profile.gender,
    personality: profile.personality, backstory: profile.backstory, strategyStyle: profile.strategyStyle, werewolfStrategyStyle: profile.werewolfStrategyStyle,
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
  id: string; requestHash: string; assets?: ContentAssetEvidence; candidate?: Profile; voiceId?: unknown; sourceReviewId?: unknown; avatarChangeSource?: import("../db/schema.js").AvatarChangeSource;
}): Promise<AgentProfileMutationRead> {
  const profile = options.candidate ?? mutation.profile;
  if (options.voiceId !== undefined && options.voiceId !== null && !isPlayerVoiceId(options.voiceId)) throw new ContentSubmissionConflict("Choose an eligible player voice");
  const [voice] = await tx.select().from(schema.agentVoices).where(eq(schema.agentVoices.agentProfileId, profile.id));
  const assignment = options.voiceId === undefined && voice?.assignment.origin === "selected"
    ? voice.assignment
    : assignPlayerVoice(profile.id, profile.gender, options.voiceId ?? undefined);
  const snapshot = { ...contentSnapshot(profile), modelPreference: profile.modelPreference, voiceAssignment: assignment, ...(typeof options.sourceReviewId === "string" ? { sourceReviewId: options.sourceReviewId } : {}) };

  const [prior] = profile.latestContentRevisionId ? await loadPayloads(tx.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.latestContentRevisionId))) : [];
  const previousAssets = (prior?.snapshot.assets ?? {}) as Record<string, string>;
  const assets: Record<string, string> = {};
  const missingUrls = [profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl].filter((url): url is string => Boolean(url && !options.assets?.[url] && !previousAssets[url]));
  const evidence = missingUrls.length ? { ...await prepareContentAssets(profile, {}, {db:tx,userId:profile.userId}), ...options.assets } : options.assets;
  for (const url of new Set([profile.avatarUrl, profile.fullBodyReferenceUrl, profile.portraitCrop?.sourceUrl])) {
    if (!url) continue;
    const captured = evidence?.[url];
    if (captured) { await tx.insert(schema.agentContentAssets).values(await storeFields(captured, {"bytes":"binary"})).onConflictDoNothing(); assets[url] = captured.hash; }
    else assets[url] = previousAssets[url]!;
  }
  const fingerprint = sha256StableJson({ ...snapshot, assets });
  const withoutPreferences = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "modelPreference" && key !== "voiceAssignment" && key !== "sourceReviewId"));
  const metadataOnly = prior?.id === mutation.profile.contentRevisionId
    && sha256StableJson(withoutPreferences(prior.snapshot)) === sha256StableJson(withoutPreferences({ ...snapshot, assets }));
  let revisionId = prior?.id;
  let reviewId: string | undefined;
  if (prior?.fingerprint === fingerprint) {
    [reviewId] = (await tx.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.contentRevisionId, prior.id))).map((r) => r.id);
  } else {
    revisionId = randomUUID();
    reviewId = randomUUID();
    await tx.insert(schema.agentContentRevisions).values(await storeFields({ id: revisionId, agentProfileId: profile.id, userId: profile.userId,
      avatarChangeSource:options.avatarChangeSource??"mcp_update", competitiveRevisionId: profile.currentRevisionId, parentRevisionId: prior?.id ?? null,
      ancestryKnown: prior ? prior.ancestryKnown : true, fingerprint, snapshot: { ...snapshot, assets } }, {"snapshot":"json-gzip"}));
    await tx.insert(schema.agentModerationReviews).values({ id: reviewId, contentRevisionId: revisionId, held: !metadataOnly, status: metadataOnly ? "resolved" : "pending" });
  }
  // Optional derivative demand shares the captured content bytes. A savepoint
  // prevents an unavailable cutout lane from rejecting ordinary character edits.
  try {
    const bodyHash = profile.fullBodyReferenceUrl ? assets[profile.fullBodyReferenceUrl] : null;
    const bodyBytes = profile.fullBodyReferenceUrl ? evidence?.[profile.fullBodyReferenceUrl]?.bytes : null;
    const nativeAlpha = bodyBytes ? await hasCharacterTransparency(bodyBytes) : false;
    if (bodyHash && nativeAlpha) await tx.update(schema.agentContentAssets).set({ transparentUrl: profile.fullBodyReferenceUrl }).where(eq(schema.agentContentAssets.hash, bodyHash));
    else if (bodyHash && cutoutMode() !== "disabled") await tx.transaction(async savepoint => {
      await savepoint.insert(schema.characterCutoutDemands).values({ id: randomUUID(), agentProfileId: profile.id,
        playerId: profile.id, sourceKey: `sha256:${bodyHash}`, recipe: CUTOUT_RECIPE }).onConflictDoNothing();
    });
  } catch (error) { console.error("[character-cutouts] Agent demand unavailable", { agentId: profile.id, error }); }
  if(!metadataOnly)await enqueueAgentScreening(tx, revisionId!);
  if (metadataOnly) {
    await tx.insert(schema.agentVoices).values({ agentProfileId: profile.id, assignment }).onConflictDoUpdate({ target: schema.agentVoices.agentProfileId, set: { assignment, updatedAt: new Date() } });
  }
  const [saved] = await tx.update(schema.agentProfiles).set({
    latestContentRevisionId: revisionId!,
    ...(metadataOnly ? { modelPreference: profile.modelPreference } : {}),
    contentRevisionId: metadataOnly ? revisionId! : mutation.profile.contentRevisionId,
    moderationVersion: profile.moderationVersion + 1,
    updatedAt: new Date().toISOString(),
  }).where(and(eq(schema.agentProfiles.id, profile.id), eq(schema.agentProfiles.userId, profile.userId))).returning();
  // Retire legacy, never-screened intake work; screened revisions and human work remain reviewable.
  const closed = await tx.execute<{ id: string }>(sql`UPDATE agent_moderation_reviews AS review
    SET status = 'superseded', version = review.version + 1
    FROM agent_content_revisions AS revision
    WHERE review.content_revision_id = revision.id
      AND revision.agent_profile_id = ${profile.id}
      AND revision.id IS DISTINCT FROM ${saved!.latestContentRevisionId}
      AND revision.id IS DISTINCT FROM ${saved!.contentRevisionId}
      AND review.status = 'pending' AND review.route = 'ordinary'
      AND review.disposition = 'allowed' AND NOT review.held AND NOT review.flagged
      AND review.cycle = 1
      AND NOT EXISTS (SELECT 1 FROM agent_screenings WHERE content_revision_id = revision.id)
    RETURNING review.id`);
  // A separate statement sees claims committed while the UPDATE waited for its
  // review lock. A single CTE would retain the earlier statement snapshot.
  if (closed.length) await tx.delete(schema.moderationClaims).where(inArray(schema.moderationClaims.reviewId, closed.map(row => row.id)));
  const [decision]=await tx.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.id,reviewId!));
  const result = { ...mutation, profile: saved!,
    receipt: { ...mutation.receipt, contentRevisionId: revisionId!, moderationRecordId: reviewId!,
      publication: saved!.contentRevisionId === revisionId ? "published" as const : saved!.moderationRequired || decision?.disposition === "rejected" || decision?.flagged || decision?.status!=="pending" ? "held" as const : "reviewing" as const } };
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
  if (snapshot.werewolfStrategyStyle !== undefined && snapshot.werewolfStrategyStyle !== null && typeof snapshot.werewolfStrategyStyle !== "string") throw new ContentSubmissionConflict("The Werewolf strategy is invalid.");
  result.werewolfStrategyStyle = typeof snapshot.werewolfStrategyStyle === "string" ? snapshot.werewolfStrategyStyle : null;
  if (snapshot.gender !== null && !["male", "female", "non-binary"].includes(String(snapshot.gender))) throw new ContentSubmissionConflict("The saved gender is invalid.");
  result.gender = snapshot.gender as Profile["gender"];
  // Head geometry is optional: absence means unconfirmed, just like explicit null.
  try {
    result.headPosition = snapshot.headPosition == null ? null : parseCharacterHeadPosition(snapshot.headPosition);
    if(result.headPosition && snapshot.headPosition && typeof snapshot.headPosition === "object") {
      const confirmation=(snapshot.headPosition as {confirmation?:unknown}).confirmation;
      if(confirmation!==undefined){
        if(!confirmation||typeof confirmation!=="object"||!("userId" in confirmation)||typeof confirmation.userId!=="string"||!("at" in confirmation)||typeof confirmation.at!=="string"||!Number.isFinite(Date.parse(confirmation.at)))throw new Error("Invalid stored head confirmation");
        result.headPosition={...result.headPosition,confirmation:{userId:confirmation.userId,at:confirmation.at}};
      }
    }
  }
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
  const [entry]=await db.select().from(schema.agentEntryIntents).where(eq(schema.agentEntryIntents.agentId,profile.id));
  const [voice] = await db.select().from(schema.agentVoices).where(eq(schema.agentVoices.agentProfileId,profile.id));
  const [latest] = profile.latestContentRevisionId
    ? await loadPayloads(db.select().from(schema.agentContentRevisions).where(and(eq(schema.agentContentRevisions.id, profile.latestContentRevisionId), eq(schema.agentContentRevisions.agentProfileId, profile.id)))) : [];
  const [review] = latest ? await db.select().from(schema.agentModerationReviews).where(eq(schema.agentModerationReviews.contentRevisionId, latest.id)) : [];
  const [screening] = latest ? await db.select({ status: schema.agentScreenings.status, recommendation: schema.agentScreenings.recommendation, failureCode:schema.agentScreenings.failureCode }).from(schema.agentScreenings).where(and(eq(schema.agentScreenings.contentRevisionId, latest.id), eq(schema.agentScreenings.policyVersion, SCREENING_POLICY_VERSION))) : [];
  const reviewState = (!latest && !profile.moderationRequired && !screening?.failureCode) || latest?.id === profile.contentRevisionId ? "accepted" : review?.status === "pending" && review.version === 0 && review.route === "ordinary" && !review.flagged && !profile.moderationRequired && (screening?.status === "pending" || screening?.status === "running" || screening?.status === "completed" && screening.recommendation === "no_concern" && !profile.moderationRequired && !screening?.failureCode) ? "reviewing" : "held";
  return {
    reviewState,
    reviewMessage:screening?.failureCode==="publication_roster_conflict"?"A waiting game needs attention before these changes can be published.":screening?.failureCode==="publication_ancestor_review"?"An earlier submission needs human review before these changes can be published.":null,
    entryIntent:entry?.intent??null,
    voiceId: latest?.id === profile.contentRevisionId ? voice?.assignment.origin === "selected" ? voice.assignment.voiceId : null : latest?.snapshot.voiceAssignment && typeof latest.snapshot.voiceAssignment === "object" ? (latest.snapshot.voiceAssignment as { voiceId?: string; origin?: string }).origin === "selected" ? (latest.snapshot.voiceAssignment as { voiceId?: string }).voiceId : null : null,
    published: profile.contentRevisionId ? contentSnapshot(profile) : null,
    submitted: latest ? { revisionId: latest.id, content: { ...decodeContentSnapshot(latest.snapshot, profile), modelPreference: normalizeModelPreference(latest.id === profile.contentRevisionId ? profile.modelPreference : latest.snapshot.modelPreference ?? profile.modelPreference) },
      disposition: review?.disposition ?? null, held: review?.held ?? false, status: review?.status ?? null } : null,
    availability: profile.archivedAt ? "archived" as const : !profile.contentRevisionId && (profile.moderationRequired || profile.latestContentRevisionId) ? "withheld" as const : "available" as const,
    moderationVersion: profile.moderationVersion,
  };
}

export async function latestSubmittedProfile(db: Pick<DrizzleDB, "select">, profile: Profile): Promise<Profile> {
  if (!profile.latestContentRevisionId || profile.latestContentRevisionId === profile.contentRevisionId) return profile;
  const content = await readOwnerContent(db, profile);
  if (!content.submitted) throw new ContentSubmissionConflict("The submitted draft is unavailable. Reload before submitting.");
  return { ...profile, ...content.submitted.content };
}

/** Capture the already usable legacy version before its first enforced edit. Never invent past revisions. */
export async function captureExistingAgentBaseline(tx:Tx,profile:Profile,evidence?:ContentAssetEvidence):Promise<Profile> {
  if(profile.latestContentRevisionId || profile.contentRevisionId || profile.moderationRequired)return profile;
  const captured=await prepareContentAssets(profile,evidence,{db:tx,userId:profile.userId});
  const assets:Record<string,string>={};
  for(const [url,asset] of Object.entries(captured)){await tx.insert(schema.agentContentAssets).values(await storeFields({...asset,isPublic:true},{bytes:"binary"})).onConflictDoNothing();assets[url]=asset.hash;}
  const snapshot={...contentSnapshot(profile),assets}; const id=randomUUID();
  await tx.insert(schema.agentContentRevisions).values(await storeFields({id,agentProfileId:profile.id,userId:profile.userId,competitiveRevisionId:profile.currentRevisionId,ancestryKnown:false,snapshot,fingerprint:sha256StableJson(snapshot)},{snapshot:"json-gzip"}));
  await tx.insert(schema.agentModerationReviews).values({id:randomUUID(),contentRevisionId:id,status:"resolved",held:false});
  const [saved]=await tx.update(schema.agentProfiles).set({contentRevisionId:id,latestContentRevisionId:id}).where(eq(schema.agentProfiles.id,profile.id)).returning();
  return saved!;
}
