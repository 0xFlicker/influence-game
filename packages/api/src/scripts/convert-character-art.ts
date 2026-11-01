import { and, eq, isNull } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { saveReadyCharacterArt } from "../services/character-art-save.js";

/** Publish existing finished images before switching readers. No revision or game
 * rewriting, source reconstruction, or inference. Successful saves are resumable. */
export async function convertCharacterArt(db: DrizzleDB) {
  const failures: string[] = [];
  const jobs = await db.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts)
    .where(and(eq(schema.characterCutouts.status, "ready"), isNull(schema.characterCutouts.artSavedAt)));
  for (const job of jobs) {
    try { await saveReadyCharacterArt(db, job.id); }
    catch (error) { failures.push(`job ${job.id}: ${error instanceof Error ? error.message : error}`); }
  }
  if (failures.length) throw new Error(`Conversion incomplete; rerun to resume:\n${failures.join("\n")}`);
  return { finishedImages: jobs.length };
}

export async function assertCharacterArtConverted(db: DrizzleDB) {
  const [job] = await db.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts)
    .where(and(eq(schema.characterCutouts.status, "ready"), isNull(schema.characterCutouts.artSavedAt))).limit(1);
  if (job) throw new Error("Finished transparent images have not been published; run conversion before starting this release");
}
