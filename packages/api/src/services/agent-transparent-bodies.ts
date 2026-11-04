import { inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson } from "./payload-storage.js";
import { savedCharacterArtHash } from "./character-art-save.js";

/** Read only published derivatives of this exact body. Never enqueue or generate art. */
export async function readAgentTransparentBodies(db: DrizzleDB, profiles: (typeof schema.agentProfiles.$inferSelect)[]) {
  const ids = profiles.flatMap(p => p.contentRevisionId ? [p.contentRevisionId] : []);
  const revisions = ids.length ? await db.select({id:schema.agentContentRevisions.id,snapshot:schema.agentContentRevisions.snapshot}).from(schema.agentContentRevisions).where(inArray(schema.agentContentRevisions.id,ids)) : [];
  const snapshots = new Map(await Promise.all(revisions.map(async r => [r.id,await readJson(r.snapshot)] as const)));
  const hashes = new Map<string,string>();
  for (const profile of profiles) {
    const url = profile.fullBodyReferenceUrl;
    if (!url) continue;
    const assets = snapshots.get(profile.contentRevisionId ?? "")?.assets as Record<string,string> | undefined;
    const hash = assets?.[url] ?? (profile.headPosition?.sourceUrl === url ? profile.headPosition.sourceHash : null) ?? savedCharacterArtHash(url);
    if (hash) hashes.set(profile.id,hash);
  }
  const assets = hashes.size ? await db.select({hash:schema.agentContentAssets.hash,url:schema.agentContentAssets.transparentUrl}).from(schema.agentContentAssets).where(inArray(schema.agentContentAssets.hash,[...hashes.values()])) : [];
  const urls = new Map(assets.map(a => [a.hash,a.url]));
  return new Map(profiles.map(p => [p.id,urls.get(hashes.get(p.id) ?? "") ?? (savedCharacterArtHash(p.fullBodyReferenceUrl) ? p.fullBodyReferenceUrl : null)]));
}
