import { and, eq, or, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { storePublicCharacterImage } from "../lib/storage.js";
import { payloadHash, readPayload, loadPayloads, type StoredPayload } from "./payload-storage.js";
import { readVisualProfileImage } from "./visual-game-assets.js";

export function isSavedCharacterArt(url: string | null | undefined): boolean {
  return savedCharacterArtHash(url) !== null;
}

export function savedCharacterArtHash(url: string | null | undefined): string | null {
  if (!url) return null;
  const parsed = new URL(url, "http://local.invalid");
  const key = parsed.pathname === "/api/uploads/local" ? parsed.searchParams.get("key") : parsed.pathname.slice(1);
  return /^characters\/([a-f0-9]{64})\.png$/.exec(key ?? "")?.[1] ?? null;
}

/** Publish once before changing any character references. Content-addressed keys
 * make interrupted uploads safe to retry; no existing object is overwritten. */
export async function publishCharacterArt(image: StoredPayload<Buffer>) {
  const bytes = await readPayload(image);
  const uploaded = await storePublicCharacterImage(`characters/${image.sha256}.png`, Uint8Array.from(bytes).buffer);
  const verified = await readVisualProfileImage(uploaded.publicUrl, { name: "", personaKey: "" });
  if (verified.length !== bytes.length || payloadHash(verified) !== image.sha256) throw new Error("Saved character artwork verification failed");
  return uploaded.publicUrl;
}

/** Save to exactly one owner per character. Seats, immutable revisions and
 * production artifacts are never updated for an owned character. */
export async function saveReadyCharacterArt(db: DrizzleDB, jobId: string) {
  // Advance retry order before storage I/O, including attempts interrupted by a restart.
  const [job] = await db.update(schema.characterCutouts).set({ artSaveAttemptedAt: sql`clock_timestamp()` })
    .where(and(eq(schema.characterCutouts.id, jobId), eq(schema.characterCutouts.status, "ready"))).returning();
  if (job?.status !== "ready" || !job.image) throw new Error("Finished character image is unavailable");
  try {
    const url = await publishCharacterArt(job.image);
    const demands = await db.select().from(schema.characterCutoutDemands).where(eq(schema.characterCutoutDemands.cutoutId, jobId));
    const owners = new Map<string, { profileId?: string; playerId?: string }>();
    for (const demand of demands) {
      const [seat] = demand.gameId ? await db.select().from(schema.gamePlayers).where(and(
        or(eq(schema.gamePlayers.id, demand.playerId), eq(schema.gamePlayers.werewolfPlayerId, demand.playerId)), eq(schema.gamePlayers.gameId, demand.gameId))) : [];
      const profileId = demand.agentProfileId ?? seat?.agentProfileId;
      if (profileId) owners.set(`profile:${profileId}`, { profileId });
      else if (seat) owners.set(`seat:${seat.id}`, { playerId: seat.id });
      else throw new Error(`No durable character for demand ${demand.id}`);
    }
    // Storage reads finish before acquiring any database lock. A changed source
    // or newly attached demand is detected again at the commit boundary.
    const candidates: Array<{ profileId?: string; playerId?: string; sourceUrl: string | null }> = [];
    for (const [, owner] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
      const [profile] = owner.profileId ? await db.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, owner.profileId)) : [];
      const [seat] = owner.playerId ? await db.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.id, owner.playerId)) : [];
      const art = profile ?? (seat ? JSON.parse(seat.persona) as { fullBodyReferenceUrl?: string } : null);
      if (!art) throw new Error("Character disappeared during artwork preparation");
      if (isSavedCharacterArt(art.fullBodyReferenceUrl)) continue;
      if (!art.fullBodyReferenceUrl) {
        // A generated reference may be the character's first full-body picture.
        candidates.push({ ...owner, sourceUrl: null });
        continue;
      }
      const [revision] = profile?.contentRevisionId ? await loadPayloads(db.select({ snapshot: schema.agentContentRevisions.snapshot })
        .from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.contentRevisionId))) : [];
      const retainedHash = (revision?.snapshot.assets as Record<string, string> | undefined)?.[art.fullBodyReferenceUrl];
      const sourceHash = retainedHash ?? payloadHash(await readVisualProfileImage(art.fullBodyReferenceUrl, { name: "", personaKey: "" }));
      if (sourceHash === job.sourceHash) candidates.push({ ...owner, sourceUrl: art.fullBodyReferenceUrl });
    }
    return await db.transaction(async tx => {
      const [current] = await tx.select().from(schema.characterCutouts).where(eq(schema.characterCutouts.id, jobId)).for("update");
      if (current?.status !== "ready" || current.image?.sha256 !== job.image!.sha256) throw new Error("Finished artwork changed before save");
      const attached = await tx.select({ id: schema.characterCutoutDemands.id }).from(schema.characterCutoutDemands).where(eq(schema.characterCutoutDemands.cutoutId, jobId));
      if (attached.length !== demands.length || attached.some(row => !demands.some(demand => demand.id === row.id)))
        throw new Error("Character references changed during preparation; finished-image save will retry");
      let saved = 0;
      for (const owner of candidates) {
        const [profile] = owner.profileId ? await tx.select().from(schema.agentProfiles).where(eq(schema.agentProfiles.id, owner.profileId)).for("update") : [];
        const [seat] = owner.playerId ? await tx.select().from(schema.gamePlayers).where(eq(schema.gamePlayers.id, owner.playerId)).for("update") : [];
        const art = profile ?? (seat ? JSON.parse(seat.persona) as Pick<typeof schema.agentProfiles.$inferSelect, "fullBodyReferenceUrl" | "headPosition" | "portraitCrop"> : null);
        if (!art) throw new Error("Character disappeared during artwork save");
        if ((art.fullBodyReferenceUrl ?? null) !== owner.sourceUrl) continue;
        const oldUrl = art.fullBodyReferenceUrl ?? null;
        const next = { ...art, fullBodyReferenceUrl: url,
          headPosition: art.headPosition?.sourceUrl === oldUrl ? { ...art.headPosition, sourceUrl: url, sourceHash: job.image!.sha256 } : art.headPosition,
          portraitCrop: art.portraitCrop?.sourceUrl === oldUrl ? { ...art.portraitCrop, sourceUrl: url } : art.portraitCrop };
        if (profile) await tx.update(schema.agentProfiles).set({ fullBodyReferenceUrl: url, headPosition: next.headPosition, portraitCrop: next.portraitCrop }).where(eq(schema.agentProfiles.id, profile.id));
        else await tx.update(schema.gamePlayers).set({ persona: JSON.stringify(next) }).where(eq(schema.gamePlayers.id, seat!.id));
        saved++;
      }
      await tx.update(schema.characterCutouts).set({ artSavedAt: new Date(), saveError: null }).where(eq(schema.characterCutouts.id, jobId));
      return { saved };
    });
  } catch (error) {
    await db.update(schema.characterCutouts).set({ saveError: error instanceof Error ? error.message.slice(0, 1000) : "Artwork save failed" }).where(eq(schema.characterCutouts.id, jobId));
    throw error;
  }
}

