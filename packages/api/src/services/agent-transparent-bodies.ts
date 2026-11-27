import { inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";
import { savedCharacterArtHash } from "./character-art-save.js";
import { decodeContentSnapshot } from "./agent-content-submissions.js";

type Profile = typeof schema.agentProfiles.$inferSelect;
type ArtworkSource = Pick<Profile, "id" | "fullBodyReferenceUrl" | "headPosition"> & {
  snapshot?: Record<string, unknown>;
};

async function readArtworkSnapshots(db: DrizzleDB, ids: string[]) {
  const revisions = ids.length ? await db.select({
    id: schema.agentContentRevisions.id,
    agentProfileId: schema.agentContentRevisions.agentProfileId,
    userId: schema.agentContentRevisions.userId,
    snapshot: schema.agentContentRevisions.snapshot,
  }).from(schema.agentContentRevisions).where(inArray(schema.agentContentRevisions.id, ids)) : [];
  return new Map(await Promise.all(revisions.map(async ({ snapshot, ...revision }) => [
    revision.id, { ...revision, snapshot: await readJson(snapshot) },
  ] as const)));
}

async function readTransparentBodies(db: DrizzleDB, profiles: ArtworkSource[]) {
  const hashes = new Map<string,string>();
  for (const profile of profiles) {
    const url = profile.fullBodyReferenceUrl;
    if (!url) continue;
    const assets = profile.snapshot?.assets as Record<string,string> | undefined;
    const hash = assets?.[url] ?? (profile.headPosition?.sourceUrl === url ? profile.headPosition.sourceHash : null) ?? savedCharacterArtHash(url);
    if (hash) hashes.set(profile.id,hash);
  }
  const assets = hashes.size ? await db.select({hash:schema.agentContentAssets.hash,url:schema.agentContentAssets.transparentUrl}).from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash,[...hashes.values()])) : [];
  const urls = new Map(assets.map(a => [a.hash,a.url]));
  return new Map(profiles.map(p => [p.id,urls.get(hashes.get(p.id) ?? "") ?? (savedCharacterArtHash(p.fullBodyReferenceUrl) ? p.fullBodyReferenceUrl : null)]));
}

/** Resolve the accepted body for public and game-entry surfaces. */
export async function readAgentTransparentBodies(db: DrizzleDB, profiles: Profile[]) {
  const ids = profiles.flatMap(p => p.contentRevisionId ? [p.contentRevisionId] : []);
  const revisions = await readArtworkSnapshots(db, ids);
  return readTransparentBodies(db, profiles.map(profile => ({
    ...profile,
    snapshot: revisions.get(profile.contentRevisionId ?? "")?.snapshot,
  })));
}

/** Read the latest saved, unpublished artwork for already owner-scoped profiles. */
export async function readSubmittedAgentArtwork(db: DrizzleDB, profiles: Profile[]) {
  const pending = profiles.filter(p => p.latestContentRevisionId && p.latestContentRevisionId !== p.contentRevisionId);
  const revisions = await readArtworkSnapshots(db, pending.map(p => p.latestContentRevisionId!));
  const sources = pending.map(profile => {
    const revision = revisions.get(profile.latestContentRevisionId!);
    if (revision?.agentProfileId !== profile.id || revision.userId !== profile.userId) {
      throw new Error("The submitted character artwork revision is unavailable.");
    }
    const { avatarUrl, fullBodyReferenceUrl, headPosition } = decodeContentSnapshot(revision.snapshot, profile);
    return { id: profile.id, avatarUrl, fullBodyReferenceUrl, headPosition, snapshot: revision.snapshot };
  });
  const bodies = await readTransparentBodies(db, sources);
  return new Map(sources.map(({ id, avatarUrl, fullBodyReferenceUrl }) => [id, {
    imageUrl: bodies.get(id) ?? fullBodyReferenceUrl ?? avatarUrl,
    hasFullBody: fullBodyReferenceUrl !== null,
  }]));
}
