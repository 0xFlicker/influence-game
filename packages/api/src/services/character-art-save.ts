import { and, eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { storePublicCharacterImage } from "../lib/storage.js";
import { payloadHash, readPayload, type StoredPayload } from "./payload-storage.js";
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

/** Publish a derivative of these exact source bytes. No profile, revision or
 * game reference changes: both earlier and later references use the same asset. */
export async function saveReadyCharacterArt(db: DrizzleDB, jobId: string) {
  const [job] = await db.update(schema.characterCutouts).set({ artSaveAttemptedAt: sql`clock_timestamp()` })
    .where(and(eq(schema.characterCutouts.id, jobId), eq(schema.characterCutouts.status, "ready"))).returning();
  if (!job?.image) throw new Error("Finished character image is unavailable");
  try {
    const transparentUrl = await publishCharacterArt(job.image);
    await db.transaction(async tx => {
      await tx.insert(schema.agentContentAssets).values({ hash: job.sourceHash, bytes: job.source, transparentUrl })
        .onConflictDoUpdate({ target: schema.agentContentAssets.hash, set: { transparentUrl } });
      await tx.update(schema.characterCutouts).set({ artSavedAt: new Date(), saveError: null }).where(eq(schema.characterCutouts.id, jobId));
    });
    return { saved: 1 };
  } catch (error) {
    await db.update(schema.characterCutouts).set({ saveError: error instanceof Error ? error.message.slice(0, 1000) : "Artwork save failed" }).where(eq(schema.characterCutouts.id, jobId));
    throw error;
  }
}
