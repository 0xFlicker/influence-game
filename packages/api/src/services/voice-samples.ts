import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  PLAYER_VOICES,
  VOICE_CATALOG_VERSION,
  assignPlayerVoice,
} from "@influence/engine/voice-catalog";
import {
  AudioProviderFailure,
  generateXaiAudio,
  measureAudio,
} from "./audio-provider.js";
import { audioRecipe } from "./audio-source.js";
import { readPayload, storeBinary, storeJson } from "./payload-storage.js";
export const VOICE_SAMPLE_TEXT =
  "Every promise matters. Let's see who keeps theirs.";
export const voiceSampleId = (voice: string) =>
  `${VOICE_CATALOG_VERSION}:gameplay-v1:${voice}`;
/** Explicit operator preparation only; readers never dispatch speech generation. */
export async function prepareVoiceSamples(db: DrizzleDB) {
  for (const voice of PLAYER_VOICES) {
    const id = voiceSampleId(voice.id);
    const [existing] = await db
      .select()
      .from(schema.voiceSamples)
      .where(eq(schema.voiceSamples.id, id));
    if (existing?.status === "ready") continue;
    if (existing)
      throw new Error(
        `Voice sample ${voice.id} needs reconciliation before another request`,
      );
    await db.insert(schema.voiceSamples).values({ id, status: "running" });
    const recipe = audioRecipe(
      {
        momentId: id,
        speakerId: null,
        text: VOICE_SAMPLE_TEXT,
        synthesisText: VOICE_SAMPLE_TEXT,
        context: "speech",
        eventSequence: 0,
        audiences: ["omniscient"],
      },
      assignPlayerVoice(id, null, voice.id),
    );
    let result;
    try {
      result = await generateXaiAudio(recipe);
    } catch (error) {
      const evidence = await storeJson({
        recipe,
        failure:
          error instanceof AudioProviderFailure
            ? error.evidence
            : {
                message:
                  error instanceof Error
                    ? error.message
                    : "Unknown audio failure",
              },
      });
      await db
        .update(schema.voiceSamples)
        .set({ status: "needs_reconciliation", evidence })
        .where(eq(schema.voiceSamples.id, id));
      throw error;
    }
    const audio = await storeBinary(result.bytes);
    await readPayload(audio);
    const providerEvidence = await storeJson({ ...result.evidence, recipe });
    await db
      .update(schema.voiceSamples)
      .set({ audio, evidence: providerEvidence })
      .where(eq(schema.voiceSamples.id, id));
    const evidence = await storeJson({
      ...result.evidence,
      durationMs: await measureAudio(result.bytes),
      recipe,
    });
    await db
      .update(schema.voiceSamples)
      .set({ audio, evidence, status: "ready" })
      .where(eq(schema.voiceSamples.id, id));
  }
}
