import { beforeEach, expect, test } from "bun:test";
import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB, acceptTestAgent } from "./test-utils.js";
import {
  readAgentDraft,
  saveAgentDraft,
  deleteAgentDraft,
} from "../services/agent-editor-drafts.js";
import {
  storeAgentDraftImage,
  readAgentDraftImage,
} from "../services/agent-draft-images.js";
import {
  createOwnedAgentProfile,
  updateOwnedAgentProfile,
} from "../services/agent-profile-management.js";
import {
  requestCharacterReference,
  readCharacterReference,
  retryCharacterReference,
  decideCharacterReference,
} from "../services/character-reference-jobs.js";
import {
  publishScreenedAgent,
  reconcileScreenedAgents,
} from "../services/agent-screening-publication.js";
import { hasEligibleAgentContent } from "../services/agent-content-eligibility.js";
import { hasCharacterTransparency } from "../services/character-transparency.js";
import {
  processMockCharacterReference,
  characterGenerationInput,
} from "./character-generation-fixture.js";
import { storeBinary } from "../services/payload-storage.js";
let db: DrizzleDB;
const owner = "workspace-owner",
  foreign = "workspace-stranger";
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values([{ id: owner }, { id: foreign }]);
});
const draft = () => ({
  version: 4,
  current: { name: "Arden" },
  base: { name: "" },
  creationRequestId: randomUUID(),
});
async function transparent() {
  return sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 20, height: 70, channels: 4, background: "#884422" },
        })
          .png()
          .toBuffer(),
        top: 10,
        left: 20,
      },
    ])
    .webp({ lossless: true })
    .toBuffer();
}
test("private draft CAS protects saves and deletes across sessions", async () => {
  const version = await saveAgentDraft(
    db,
    owner,
    "create:manage:none",
    null,
    draft(),
  );
  expect(await readAgentDraft(db, foreign, "create:manage:none")).toBeNull();
  const next = await saveAgentDraft(
    db,
    owner,
    "create:manage:none",
    version,
    draft(),
  );
  await expect(
    saveAgentDraft(db, owner, "create:manage:none", version, draft()),
  ).rejects.toThrow("another session");
  await expect(
    deleteAgentDraft(db, owner, "create:manage:none", version),
  ).rejects.toThrow("another session");
  expect((await readAgentDraft(db, owner, "create:manage:none"))?.version).toBe(
    next,
  );
  await deleteAgentDraft(db, owner, "create:manage:none", next);
  expect(await readAgentDraft(db, owner, "create:manage:none")).toBeNull();
  await deleteAgentDraft(db, owner, "create:manage:none", next);
  const recreated = await saveAgentDraft(
    db,
    owner,
    "create:manage:none",
    null,
    draft(),
  );
  await expect(
    deleteAgentDraft(db, owner, "create:manage:none", version),
  ).rejects.toThrow("another session");
  expect((await readAgentDraft(db, owner, "create:manage:none"))!.version).toBe(
    recreated,
  );
});
test("draft images stay private through submission; acceptance publishes the exact pixels", async () => {
  const bytes = await transparent(),
    url = await storeAgentDraftImage(db, owner, bytes),
    hash = url.split("/").at(-1)!;
  expect(await readAgentDraftImage(db, hash, owner)).toEqual(bytes);
  await expect(readAgentDraftImage(db, hash)).rejects.toThrow("private");
  await expect(readAgentDraftImage(db, hash, foreign)).rejects.toThrow(
    "private",
  );
  const created = await createOwnedAgentProfile(
    db,
    { userId: owner },
    {
      name: "Arden Workspace",
      personality: "Patient",
      gender: "non-binary",
      fullBodyReferenceUrl: url,
      avatarUrl: url,
      headPosition: {
        sourceUrl: url,
        sourceHash: createHash("sha256").update(bytes).digest("hex"),
        sourceWidth: 64,
        sourceHeight: 96,
        rect: { x: 0.3, y: 0.1, width: 0.3, height: 0.2 },
      },
    },
  );
  expect(created.receipt.publication).toBe("reviewing");
  expect(hasEligibleAgentContent(created.profile)).toBe(false);
  await expect(readAgentDraftImage(db, hash)).rejects.toThrow("private");
  await acceptTestAgent(db, created.profile.id);
  expect(await readAgentDraftImage(db, hash)).toEqual(bytes);
  expect(await db.select().from(schema.characterCutoutDemands)).toHaveLength(0);
});
test("reconciliation publishes a persisted clear assessment after an interrupted worker", async () => {
  const created = await createOwnedAgentProfile(
    db,
    { userId: owner },
    { name: "Recovered Workspace", personality: "Patient" },
  );
  await db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" })
    .where(
      eq(
        schema.agentScreenings.contentRevisionId,
        created.profile.latestContentRevisionId!,
      ),
    );
  await reconcileScreenedAgents(db);
  await reconcileScreenedAgents(db);
  const [profile] = await db.select().from(schema.agentProfiles);
  expect(profile!.contentRevisionId).toBe(
    created.profile.latestContentRevisionId,
  );
  expect(hasEligibleAgentContent(profile!)).toBe(true);
});
test("model and voice-only changes reuse the accepted content decision", async () => {
  const created = await createOwnedAgentProfile(
    db,
    { userId: owner },
    { name: "Preferences Workspace", personality: "Patient" },
  );
  await acceptTestAgent(db, created.profile.id);
  const before = await db.select().from(schema.agentScreenings);
  const changed = await updateOwnedAgentProfile(
    db,
    { userId: owner },
    created.profile.id,
    { voiceId: "ara", modelPreference: { catalogId: "openai:gpt-6-luna" } },
  );
  expect(changed.receipt.publication).toBe("published");
  expect(await db.select().from(schema.agentScreenings)).toHaveLength(
    before.length,
  );
  expect(
    (await db.select().from(schema.agentVoices))[0]!.assignment.voiceId,
  ).toBe("ara");
});
test("a generated image job is owner-bound, durable, read-only on polling, and explicitly selected", async () => {
  const input = {
    ...characterGenerationInput(randomUUID(), "Generated Workspace"),
    draftScope: "create:manage:none",
  };
  const first = await requestCharacterReference(db, owner, input, "");
  await requestCharacterReference(db, owner, input, "");
  expect(first?.status).toBe("queued");
  expect(await readCharacterReference(db, foreign, input.requestId)).toBeNull();
  await expect(
    requestCharacterReference(db, owner, { ...input, name: "Conflicting" }, ""),
  ).rejects.toThrow("different input");
  expect(
    (await readCharacterReference(db, owner, input.requestId))?.status,
  ).toBe("queued");
  await processMockCharacterReference(db, await transparent());
  const ready = await readCharacterReference(db, owner, input.requestId);
  expect(ready?.status).toBe("ready");
  await expect(
    decideCharacterReference(db, foreign, input.requestId, "selected"),
  ).rejects.toThrow();
  await decideCharacterReference(db, owner, input.requestId, "selected");
  expect(
    (await readCharacterReference(db, owner, input.requestId))?.status,
  ).toBe("selected");
  expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(2);
});
test("Grok-style opaque source retries only failed background removal and retains its source", async () => {
  const sourceBytes = await sharp({
      create: { width: 64, height: 96, channels: 3, background: "white" },
    })
      .webp()
      .toBuffer(),
    source = sourceBytes;
  const input = characterGenerationInput(randomUUID(), "Opaque Workspace");
  await requestCharacterReference(db, owner, input, "");
  await processMockCharacterReference(db, source, true);
  expect(
    (await readCharacterReference(db, owner, input.requestId))?.status,
  ).toBe("failed");
  const [cutout] = await db.select().from(schema.characterCutouts);
  expect(cutout!.sourceHash).toHaveLength(64);
  await db
    .update(schema.characterCutouts)
    .set({ status: "failed", attempts: 3, error: "Synthetic removal failure" })
    .where(eq(schema.characterCutouts.id, cutout!.id));
  await retryCharacterReference(db, owner, input.requestId);
  expect((await db.select().from(schema.characterCutouts))[0]!.attempts).toBe(
    0,
  );
  const image = await storeBinary(await transparent());
  await db
    .update(schema.characterCutouts)
    .set({ status: "ready", image })
    .where(eq(schema.characterCutouts.id, cutout!.id));
  await db
    .update(schema.characterReferenceJobs)
    .set({ updatedAt: new Date(0).toISOString() })
    .where(eq(schema.characterReferenceJobs.id, input.requestId));
  await processMockCharacterReference(db, source, true);
  const result = await readCharacterReference(db, owner, input.requestId);
  expect(result?.status).toBe("ready");
  const hash = String(result?.result?.fullBodyReferenceUrl).split("/").at(-1)!;
  expect(
    await hasCharacterTransparency(await readAgentDraftImage(db, hash, owner)),
  ).toBe(true);
  expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(3);
  expect(
    await db
      .select()
      .from(schema.characterCutouts)
      .where(and(eq(schema.characterCutouts.sourceHash, cutout!.sourceHash))),
  ).toHaveLength(1);
});

test("stale screening and a human-flagged ancestor cannot publish a newer submission", async () => {
  const created = await createOwnedAgentProfile(
    db,
    { userId: owner },
    { name: "Ancestry Workspace", personality: "Initial" },
  );
  await db
    .update(schema.agentModerationReviews)
    .set({ flagged: true, version: 1 })
    .where(
      eq(
        schema.agentModerationReviews.contentRevisionId,
        created.receipt.contentRevisionId!,
      ),
    );
  const changed = await updateOwnedAgentProfile(
    db,
    { userId: owner },
    created.profile.id,
    { personality: "Corrected" },
  );
  await db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" });
  await publishScreenedAgent(db, created.receipt.contentRevisionId!);
  await publishScreenedAgent(db, changed.receipt.contentRevisionId!);
  expect(
    (await db.select().from(schema.agentProfiles))[0]!.contentRevisionId,
  ).toBeNull();
  expect(
    (
      await db
        .select()
        .from(schema.agentScreenings)
        .where(
          eq(
            schema.agentScreenings.contentRevisionId,
            changed.receipt.contentRevisionId!,
          ),
        )
    )[0]!.failureCode,
  ).toBe("publication_ancestor_review");
  await db
    .update(schema.agentModerationReviews)
    .set({ status: "resolved", flagged: false, version: 2 })
    .where(
      eq(
        schema.agentModerationReviews.contentRevisionId,
        created.receipt.contentRevisionId!,
      ),
    );
  await publishScreenedAgent(db, changed.receipt.contentRevisionId!);
  expect((await db.select().from(schema.agentProfiles))[0]!.personality).toBe(
    "Corrected",
  );
});

test("user image uploads cannot be submitted as generation jobs", async () => {
  await expect(
    requestCharacterReference(
      db,
      owner,
      {
        ...characterGenerationInput(randomUUID(), "Upload rejected"),
        uploadSource: "/api/agent-profiles/images/" + "a".repeat(64),
      },
      "",
    ),
  ).rejects.toThrow("must be generated");
  expect(await db.select().from(schema.characterReferenceJobs)).toHaveLength(0);
});
