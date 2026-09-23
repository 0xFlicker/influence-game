import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { exportCharacterPortrait, generateVisualProfileReference } from "../services/visual-profile-generation.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { checkAvatarGenerationQuota } from "../services/avatar-generation.js";
import { createOwnedAgentProfile, updateOwnedAgentProfile } from "../services/agent-profile-management.js";
let db: DrizzleDB;
let directory: string;
let image: Buffer;
let calls: string[];
const originalFetch = globalThis.fetch;
const envKeys = ["OPENAI_API_KEY", "XAI_API_KEY", "INFLUENCE_LOCAL_UPLOAD_DIR", "LINODE_OBJ_ENDPOINT", "LINODE_OBJ_BUCKET", "LINODE_OBJ_ACCESS_KEY", "LINODE_OBJ_SECRET_KEY", "INFLUENCE_AVATAR_GENERATION_FREE_QUOTA", "INFLUENCE_AVATAR_GENERATION_DAILY_LIMIT"] as const;
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const userId = "character-owner";
const input = () => ({ requestId: randomUUID(), name: "Mira Vale", personaKey: "diplomat", avatarUrl: null, performanceInstructions: "Measured gestures", visualDesign: "Dark curls, green coat and black boots" });
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values({ id: userId, walletAddress: "character-wallet" });
  directory = await mkdtemp(join(tmpdir(), "character-test-"));
  for (const key of envKeys) delete process.env[key];
  process.env.OPENAI_API_KEY = "test-key";
  process.env.INFLUENCE_LOCAL_UPLOAD_DIR = directory;
  image = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#447755" } }).png().toBuffer();
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = String(url); calls.push(target);
    if (target.endsWith("/images/generations") || target.endsWith("/images/edits")) return Response.json({ data: [{ b64_json: image.toString("base64") }], usage: { input_tokens: 0, output_tokens: 1 } });
    if (target.endsWith("/responses")) return Response.json({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ count: 1, anchors: [{ playerId: "character", label: 1, confidence: "clear", head: { x: 0.4, y: 0.07, width: 0.2, height: 0.15 } }] }) }] }] });
    throw new Error(`Unexpected test request ${target}`);
  }) as unknown as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) { const value = savedEnv.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("complete character image drafts", () => {
  test("one generated full-body image produces a cropped portrait, with exact paid-request replay", async () => {
    const args = input();
    const result = await generateVisualProfileReference(db, userId, args, "http://localhost");
    expect(result.cropWarning).toBeNull();
    expect(result.headSuggestion).toMatchObject({ sourceUrl: result.fullBodyReferenceUrl, sourceWidth: 1024, sourceHeight: 1536, rect: { x: .4, y: .07, width: .2, height: .15 } });
    expect(result.headSuggestion?.confirmation).toBeUndefined();
    expect(result.portraitCrop?.sourceUrl).toBe(result.fullBodyReferenceUrl);
    expect(calls.filter((url) => url.includes("/images/"))).toHaveLength(1);
    const portrait = await readVisualProfileImage(result.avatarUrl!, { name: "", personaKey: "" });
    expect(await sharp(portrait).metadata()).toMatchObject({ width: 512, height: 512 });
    expect(await generateVisualProfileReference(db, userId, args, "http://localhost")).toEqual(result);
    expect(calls).toHaveLength(2);
    expect(await db.select().from(schema.agentProfiles)).toHaveLength(0);
    expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(2);
    const manual = await exportCharacterPortrait({ sourceUrl: result.fullBodyReferenceUrl, x: 0.25, y: 0, width: 0.5, height: 1 / 3 }, "http://localhost");
    expect(manual.portraitCrop).not.toEqual(result.portraitCrop);
    expect(manual.avatarUrl).toBeTruthy();
    expect(calls).toHaveLength(2);
    const context = { userId, publicBaseUrl: "http://localhost" };
    const created = await createOwnedAgentProfile(db, context, { name: args.name, personaKey: args.personaKey, personality: "Observant", gender: "non-binary", creationRequestId: randomUUID() });
    const saved = await updateOwnedAgentProfile(db, context, created.profile.id, {
      submissionId: randomUUID(), expectedContentRevisionId: created.profile.contentRevisionId,
      headPosition: result.headSuggestion, fullBodyReferenceUrl: result.fullBodyReferenceUrl, avatarUrl: result.avatarUrl, portraitCrop: result.portraitCrop,
      visualDesign: args.visualDesign, performanceInstructions: args.performanceInstructions,
    });
    expect(saved.profile.headPosition?.confirmation?.userId).toBe(userId);
    expect(saved.profile.headPosition?.sourceHash).toBe(result.headSuggestion?.sourceHash);
    expect(saved.profile.avatarUrl).toBe(result.avatarUrl);
    expect(saved.profile.fullBodyReferenceUrl).toBe(result.fullBodyReferenceUrl);
    expect(saved.receipt.moderationRecordId).toBeTruthy();
    const recropped = await updateOwnedAgentProfile(db, context, created.profile.id, {
      submissionId: randomUUID(), expectedContentRevisionId: saved.profile.contentRevisionId,
      avatarUrl: manual.avatarUrl, portraitCrop: manual.portraitCrop,
    });
    expect(recropped.profile.headPosition).toEqual(saved.profile.headPosition);
    expect(recropped.profile.portraitCrop).toEqual(manual.portraitCrop);
    expect(calls).toHaveLength(2);
  });
  test("uncertain paid transport is recorded and the same request cannot redispatch", async () => {
    const args = input();
    globalThis.fetch = (async () => { calls.push("transport"); throw new Error("connection lost"); }) as unknown as typeof fetch;
    await expect(generateVisualProfileReference(db, userId, args)).rejects.toThrow();
    await expect(generateVisualProfileReference(db, userId, args)).rejects.toThrow("reconciliation");
    expect(calls).toHaveLength(1);
    const [attempt] = await db.select().from(schema.visualRenderAttempts);
    expect(attempt!.receipt?.chargeUncertain).toBe(true);
  });
  test("uncertain head localization preserves the full-body draft and requires manual crop without another paid call", async () => {
    const fetchImage = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("/responses") ? (calls.push(String(url)), Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] })) : fetchImage(url, init)) as unknown as typeof fetch;
    const args = input();
    const result = await generateVisualProfileReference(db, userId, args);
    expect(result.fullBodyReferenceUrl).toBeTruthy();
    expect(result.avatarUrl).toBeNull();
    expect(result.cropWarning).toContain("Choose a portrait crop");
    await generateVisualProfileReference(db, userId, args);
    expect(calls).toHaveLength(2);
  });
  test("full-body generation shares the image allowance; cropping and exact retries do not consume another slot", async () => {
    process.env.INFLUENCE_AVATAR_GENERATION_FREE_QUOTA = "1";
    const args = input();
    await generateVisualProfileReference(db, userId, args);
    expect(await checkAvatarGenerationQuota(db, userId, [], {})).toMatchObject({ ok: false, code: "quota_exhausted" });
    await generateVisualProfileReference(db, userId, args);
    await expect(generateVisualProfileReference(db, userId, input())).rejects.toThrow("quota");
    expect(calls).toHaveLength(2);
  });
  test("manual confirmation uses oriented source dimensions and rejects portraits that cut through the head", async () => {
    const { writeLocalUpload } = await import("../lib/storage.js");
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    await writeLocalUpload("pfp/oriented.jpg", "image/jpeg", new Uint8Array(bytes).buffer);
    const sourceUrl = "/api/uploads/local?key=pfp%2Foriented.jpg";
    const crop = { sourceUrl, x: 0, y: 0, width: .6, height: .4 };
    const head = { x: .1, y: .1, width: .2, height: .2 };
    const confirmed = await exportCharacterPortrait(crop, "http://localhost", head);
    expect(confirmed.headPosition).toMatchObject({ sourceWidth: 400, sourceHeight: 600, rect: head });
    await expect(exportCharacterPortrait({ ...crop, x: .2 }, "http://localhost", head)).rejects.toThrow("entire head");
    expect(calls).toHaveLength(0);
  });
});
