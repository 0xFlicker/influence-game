import { hasCharacterTransparency } from "./character-transparency.js";
export { hasCharacterTransparency } from "./character-transparency.js";
import { setTimeout } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { cutoutMode, enqueueCutout } from "./character-cutouts.js";
import { readPayload } from "./payload-storage.js";

export class CharacterBackgroundPending extends Error {}

/**
 * Raw generation is already journaled before this stage. Reopening the same request
 * reuses this source/recipe job; a removal failure never dispatches image generation.
 */
export async function prepareTransparentCharacterImage(
  db: DrizzleDB,
  bytes: Uint8Array,
  signal?: AbortSignal,
  onRemoval?: () => Promise<void>,
  wait = true,
) {
  if (await hasCharacterTransparency(bytes)) return Buffer.from(bytes);
  await onRemoval?.();
  const job = await enqueueCutout(db, Buffer.from(bytes), true);
  for (;;) {
    signal?.throwIfAborted();
    const [current] = await db
      .select()
      .from(schema.characterCutouts)
      .where(eq(schema.characterCutouts.id, job.id));
    if (!current) throw new Error("Background-removal job is unavailable");
    if (current.status === "ready" && current.image) {
      const image = await readPayload(current.image);
      if (!(await hasCharacterTransparency(image)))
        throw new Error("Background removal returned invalid transparency");
      return image;
    }
    if (current.status === "failed")
      throw new Error(current.error || "Background removal failed");
    if (cutoutMode() === "disabled")
      throw new Error(
        "Background removal is not configured; the generated source is retained",
      );
    if (!wait)
      throw new CharacterBackgroundPending(
        "Background removal is still running",
      );
    await setTimeout(1000, undefined, { signal });
  }
}

/** An explicit owner retry resets removal for the retained source, never image generation. */
export async function retryCharacterCutout(db: Pick<DrizzleDB,"update">, bytes: Uint8Array) {
  const { createHash } = await import("node:crypto");
  const { and } = await import("drizzle-orm");
  const { CUTOUT_RECIPE } = await import("./character-cutouts.js");
  await db
    .update(schema.characterCutouts)
    .set({
      status: "pending",
      attempts: 0,
      error: null,
      tokenHash: null,
      leaseUntil: null,
      batchJobId: null,
    })
    .where(
      and(
        eq(
          schema.characterCutouts.sourceHash,
          createHash("sha256").update(bytes).digest("hex"),
        ),
        eq(schema.characterCutouts.recipe, CUTOUT_RECIPE),
        eq(schema.characterCutouts.status, "failed"),
      ),
    );
}
