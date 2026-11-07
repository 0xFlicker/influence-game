import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { schema } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  processMockCharacterReference,
  characterGenerationInput,
} from "./character-generation-fixture.js";
import { storeBinary } from "../services/payload-storage.js";
import {
  requestCharacterReference,
  readCharacterReference,
} from "../services/character-reference-jobs.js";

test("background removal yields the worker and resumes the retained source when ready", async () => {
  const db = await setupTestDB(),
    owner = "background-queue-owner";
  await db.insert(schema.users).values({ id: owner });
  const keys = [
    "CHARACTER_CUTOUT_MODE",
    "CUTOUT_API_URL",
    "INFLUENCE_DEPLOYMENT_ENVIRONMENT",
    "NODE_ENV",
  ];
  const previous = keys.map((key) => process.env[key]);
  process.env.CHARACTER_CUTOUT_MODE = "local";
  process.env.CUTOUT_API_URL = "http://localhost:3000/";
  delete process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT;
  process.env.NODE_ENV = "test";
  try {
    const opaque = await sharp({
      create: { width: 64, height: 96, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer();
    const alpha = await sharp({
      create: { width: 64, height: 96, channels: 4, background: "#00000000" },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 20,
              height: 60,
              channels: 4,
              background: "#884422",
            },
          })
            .png()
            .toBuffer(),
          left: 20,
          top: 20,
        },
      ])
      .webp({ lossless: true })
      .toBuffer();
    const waitingId = randomUUID(),
      readyId = randomUUID();
    await requestCharacterReference(
      db,
      owner,
      characterGenerationInput(waitingId, "Waiting background"),
      "",
    );
    await processMockCharacterReference(db, opaque, true);
    expect(await readCharacterReference(db, owner, waitingId)).toMatchObject({
      status: "queued",
      stage: "background",
      error: null,
    });
    await requestCharacterReference(
      db,
      owner,
      characterGenerationInput(readyId, "Already transparent"),
      "",
    );
    await processMockCharacterReference(db, alpha);
    expect((await readCharacterReference(db, owner, readyId))!.status).toBe(
      "ready",
    );
    const [cutout] = await db.select().from(schema.characterCutouts);
    await db
      .update(schema.characterCutouts)
      .set({ status: "ready", image: await storeBinary(alpha) })
      .where(eq(schema.characterCutouts.id, cutout!.id));
    // Advance the persisted poll coordinate after the external stage completes.
    await db
      .update(schema.characterReferenceJobs)
      .set({ updatedAt: new Date(0).toISOString() })
      .where(eq(schema.characterReferenceJobs.id, waitingId));
    await processMockCharacterReference(db, alpha);
    expect((await readCharacterReference(db, owner, waitingId))!.status).toBe(
      "ready",
    );
    expect(await db.select().from(schema.characterCutouts)).toHaveLength(1);
    expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(5);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
