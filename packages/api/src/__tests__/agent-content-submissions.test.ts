import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile, createOwnedAgent, updateOwnedAgent } from "../services/agent-profile-management.js";
import { contentImageFixture } from "./content-image-fixture.js";
import { writeLocalUpload } from "../lib/storage.js";

let db: DrizzleDB;
let directory: string;
const priorDirectory = process.env.INFLUENCE_LOCAL_UPLOAD_DIR;
const context = { userId: "content-owner", publicBaseUrl: "http://localhost" };
const initial = { name: "Arden Vale", personality: "Observant", gender: "non-binary", personaKey: "observer" };
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values({ id: context.userId, walletAddress: "content-owner-wallet" });
  directory = await mkdtemp(join(tmpdir(), "agent-content-"));
  process.env.INFLUENCE_LOCAL_UPLOAD_DIR = directory;
});
afterEach(async () => {
  if (priorDirectory === undefined) delete process.env.INFLUENCE_LOCAL_UPLOAD_DIR;
  else process.env.INFLUENCE_LOCAL_UPLOAD_DIR = priorDirectory;
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function create() { return createOwnedAgentProfile(db, context, { ...initial, creationRequestId: randomUUID() }); }
describe("atomic character content submissions", () => {
  test("records the full profile and pending review, without a moderation call or admission gate", async () => {
    const result = await create();
    const [revision] = await db.select().from(schema.agentContentRevisions);
    const [review] = await db.select().from(schema.agentModerationReviews);
    expect(result.profile.contentRevisionId).toBe(revision!.id);
    expect(result.receipt).toMatchObject({ contentRevisionId: revision!.id, moderationRecordId: review!.id });
    expect(review!.status).toBe("pending");
    expect(revision!.snapshot).toMatchObject({ name: initial.name, personality: initial.personality, performanceInstructions: null, avatarUrl: null });
    expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
  });
  test("replays the original creation receipt even after later edits", async () => {
    const input = { ...initial, creationRequestId: randomUUID() };
    const first = await createOwnedAgentProfile(db, context, input);
    await updateOwnedAgentProfile(db, context, first.profile.id, { personality: "Changed", submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId });
    const replay = await createOwnedAgentProfile(db, context, input);
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.profile.personality).toBe(initial.personality);
  });
  test("the shared submission ID also deduplicates creation without a separate creation key", async () => {
    const input = { ...initial, submissionId: randomUUID() };
    const first = await createOwnedAgentProfile(db, context, input);
    const replay = await createOwnedAgentProfile(db, context, input);
    expect(replay.profile.id).toBe(first.profile.id);
    expect(replay.receipt).toEqual(first.receipt);
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(1);
  });
  test("accepted snapshots cannot be rewritten", async () => {
    const first = await create();
    await expect(db.update(schema.agentContentRevisions).set({ snapshot: { name: "Tampered" } }).where(eq(schema.agentContentRevisions.id, first.profile.contentRevisionId!)).execute()).rejects.toThrow();
    await expect(db.update(schema.agentContentSubmissions).set({ requestHash: "tampered" }).execute()).rejects.toThrow();
    const [revision] = await db.select().from(schema.agentContentRevisions);
    expect(revision!.snapshot.name).toBe(initial.name);
  });
  test("deduplicates retries and unchanged saves; rejects changed reuse and stale image edits", async () => {
    const first = await create();
    const input = { personality: "Decisive", submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId };
    const updated = await updateOwnedAgentProfile(db, context, first.profile.id, input);
    const replay = await updateOwnedAgentProfile(db, context, first.profile.id, input);
    expect(replay.receipt).toEqual(updated.receipt);
    await expect(updateOwnedAgentProfile(db, context, first.profile.id, { ...input, personality: "Another" })).rejects.toThrow("submission ID");
    await expect(updateOwnedAgentProfile(db, context, first.profile.id, { submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId, visualDesign: "Blue coat" })).rejects.toThrow("another session");
    await updateOwnedAgentProfile(db, context, first.profile.id, { personality: "Decisive", submissionId: randomUUID(), expectedContentRevisionId: updated.profile.contentRevisionId });
    expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(2);
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(2);
  });
  test("concurrent edits accept only one starting revision", async () => {
    const first = await create();
    const results = await Promise.allSettled(["One", "Two"].map((visualDesign) => updateOwnedAgentProfile(db, context, first.profile.id, { visualDesign, submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(2);
  });
  test("captures original image bytes and crop metadata without recalibrating competition", async () => {
    const first = await create();
    const bytes = Uint8Array.from([137,80,78,71]);
    await writeLocalUpload("pfp/source.png", "image/png", bytes.buffer);
    const url = "http://localhost/api/uploads/local?key=pfp%2Fsource.png";
    const second = await updateOwnedAgentProfile(db, context, first.profile.id, { fullBodyReferenceUrl: url, avatarUrl: url, submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId });
    const crop = { sourceUrl: url, x: 0.1, y: 0, width: 0.4, height: 0.4 };
    const third = await updateOwnedAgentProfile(db, context, first.profile.id, { portraitCrop: crop, submissionId: randomUUID(), expectedContentRevisionId: second.profile.contentRevisionId });
    expect(third.profile.currentRevisionId).toBe(first.profile.currentRevisionId);
    expect(third.profileRevision.ratingRecalibrated).toBe(false);
    const [revision] = await db.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, third.profile.contentRevisionId!));
    expect(revision!.snapshot.portraitCrop).toEqual(crop);
    await writeLocalUpload("pfp/source.png", "image/png", Uint8Array.from([0]).buffer);
    const [asset] = await db.select().from(schema.agentContentAssets);
    expect(asset!.bytes).toEqual(Buffer.from(bytes));
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(3);
  });
  test("review persistence failure rolls the profile and both revision types back", async () => {
    const first = await create();
    await db.execute(sql`CREATE FUNCTION reject_test_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected review write failure'; END $$`);
    await db.execute(sql`CREATE TRIGGER reject_test_review BEFORE INSERT ON agent_moderation_reviews FOR EACH ROW EXECUTE FUNCTION reject_test_review()`);
    try {
      await expect(updateOwnedAgentProfile(db, context, first.profile.id, { personality: "Never accepted", submissionId: randomUUID(), expectedContentRevisionId: first.profile.contentRevisionId })).rejects.toThrow();
      const [saved] = await db.select().from(schema.agentProfiles);
      expect(saved!.personality).toBe(initial.personality);
      expect(await db.select().from(schema.agentContentRevisions)).toHaveLength(1);
      expect(await db.select().from(schema.agentRevisions)).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER reject_test_review ON agent_moderation_reviews`);
      await db.execute(sql`DROP FUNCTION reject_test_review()`);
    }
  });
  test("agent tools submit image-only and crop-only drafts without changing competitive history", async () => {
    const first = await createOwnedAgent(db, context, { creationRequestId: randomUUID(), displayName: initial.name, archetype: "observer", personalityPrompt: initial.personality, publicBiography: null, strategyStyle: null });
    const sourceUrl = await contentImageFixture("pfp/crop-tool.png");
    let revision = first.agent.contentRevisionId;
    for (const change of [{ avatarUrl: sourceUrl }, { portraitCrop: { sourceUrl, x: 0, y: 0, width: 0.5, height: 0.5 } }]) {
      const saved = await updateOwnedAgent(db, context, { agentId: first.agent.id, ...change, submissionId: randomUUID(), expectedContentRevisionId: revision });
      expect(saved.agent.currentRevision).toEqual(first.agent.currentRevision);
      expect(saved.receipt.moderationRecordId).toBeTruthy();
      revision = saved.agent.contentRevisionId;
    }
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(3);
  });
  test("agent tools share the same submission and do not schedule a portrait after saving", async () => {
    const first = await createOwnedAgent(db, context, { creationRequestId: randomUUID(), displayName: initial.name, archetype: "observer", personalityPrompt: initial.personality, publicBiography: null, strategyStyle: null });
    const result = await updateOwnedAgent(db, context, { agentId: first.agent.id, submissionId: randomUUID(), expectedContentRevisionId: first.agent.contentRevisionId, performanceInstructions: "37" });
    expect(result.receipt.moderationRecordId).toBeTruthy();
    expect(await db.select().from(schema.agentModerationReviews)).toHaveLength(2);
    expect(await db.select().from(schema.avatarGenerationRequests)).toHaveLength(0);
  });
});
