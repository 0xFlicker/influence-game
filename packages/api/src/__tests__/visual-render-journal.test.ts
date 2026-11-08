import { loadPayloads, storeFields } from "../services/payload-storage.js";
import { stableJson } from "../services/stable-hash.js";
import { createHash } from "node:crypto";
import { reserveInference, settleInference } from "../services/inference-allowances.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  readVisualRenderAccounting, reconcileVisualAttempt, renderDurableVisualImage,
  reserveVisualRender, retryVisualRender, visualImageJournal, localizeOwnedVisualReference, renderOwnedVisualReference, retryOwnedVisualReference,
} from "../services/visual-render-journal.js";
import type { VisualImageReceipt } from "../services/visual-image-provider.js";

import sharp from "sharp";
import type { VisualLocalization } from "@influence/engine/visual-localization";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
let db: DrizzleDB;
const request = { operation: "create" as const, background: "opaque" as const, prompt: "Empty warm house", width: 1024, height: 1024, references: [] };
const reservation = { provider: "openai" as const, model: "gpt-image-2", requestHash: "request-1" };
const receipt: VisualImageReceipt = { ...reservation, requestId: "provider-1", status: 200, elapsedMs: 100, usage: { images: 1 }, chargeUncertain: false };
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.games).values({ id: "visual-game", slug: "visual-test", config: "{}" });
});

const reserve = () => reserveVisualRender(db, "visual-game", "boundary-1:lobby:section-1", request);
test("image migration replays a paid historical request without rewriting evidence or generating again", async () => {
  const frozen = { prompt: request.prompt, width: request.width, height: request.height, references: [] };
  const inputHash = createHash("sha256").update(stableJson(frozen)).digest("hex");
  await db.insert(schema.visualRenderOperations).values(await storeFields({
    id: "historical-paid-image", gameId: "visual-game", operationKey: "historical-room", inputHash, request: frozen,
  }, { request: "json-gzip" }));
  const [operation] = await loadPayloads(db.select().from(schema.visualRenderOperations));
  const journal = visualImageJournal(db, operation!);
  await journal.begin(reservation);
  const image = Buffer.from("original paid image bytes");
  await journal.finish(receipt, image);
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls++; throw Error("Historical images must be reused"); }, { preconnect: originalFetch.preconnect });
  const replay = await renderDurableVisualImage(db, { gameId: "visual-game", operationKey: operation!.operationKey, request: { ...request, prompt: "Updated deployment template" } });
  expect(replay.image).toEqual(image);
  expect(replay.receipt).toEqual(receipt);
  const [retained] = await loadPayloads(db.select().from(schema.visualRenderOperations));
  expect(retained!.inputHash).toBe(inputHash);
  expect(retained!.request).toEqual(frozen);
  await expect(reserveVisualRender(db, "visual-game", operation!.operationKey, { ...request, references: [Buffer.from("changed identity")] })).rejects.toThrow("inputs changed");
  const current = await reserve();
  await expect(reserveVisualRender(db, "visual-game", current.operationKey, { ...request, background: "transparent" })).rejects.toThrow("inputs changed");
  expect(calls).toBe(0);
});

test("a retained owner image keeps its original allowance identity across the model migration", async () => {
  const userId = "historical-image-owner";
  await db.insert(schema.users).values({ id: userId });
  const frozen = { prompt: request.prompt, width: request.width, height: request.height, references: [] };
  const inputHash = createHash("sha256").update(stableJson(frozen)).digest("hex");
  await db.insert(schema.visualRenderOperations).values({ id: "historical-owned-image", userId, operationKey: "full-body:historical-owner-request", inputHash });
  const [operation] = await loadPayloads(db.select().from(schema.visualRenderOperations));
  const reservationId = `visual:${operation!.id}`;
  await db.transaction(tx => reserveInference(tx, { id: reservationId, userId, category: "image", inputHash, visualOperationId: operation!.id }));
  const journal = visualImageJournal(db, operation!);
  await journal.begin(reservation);
  const source = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([
    { input: await sharp({ create: { width: 8, height: 8, channels: 4, background: "white" } }).png().toBuffer(), top: 4, left: 4 },
  ]).png().toBuffer();
  await journal.finish(receipt, source);
  const before = (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance;
  globalThis.fetch = Object.assign(async () => { throw Error("Paid image must not dispatch again"); }, { preconnect: originalFetch.preconnect });
  const replay = await renderOwnedVisualReference(db, { userId, requestId: "historical-owner-request", request: { ...request, background: "transparent" } });
  expect(replay.image).toEqual(source);
  expect((await db.select().from(schema.inferenceAccounts))[0]!.imageBalance).toBe(before);
  const reservations = await db.select().from(schema.inferenceReservations);
  expect(reservations).toHaveLength(1);
  expect(reservations[0]).toMatchObject({ id: reservationId, state: "succeeded", inputHash });
});

test("a never-dispatched historical allowance advances on explicit retry without erasing its refund", async () => {
  const userId = "historical-retry-owner";
  await db.insert(schema.users).values({ id: userId });
  await db.insert(schema.visualRenderOperations).values({ id: "historical-never-dispatched", userId, operationKey: "full-body:historical-retry", inputHash: "original-input" });
  const id = "visual:historical-never-dispatched";
  await db.transaction(async tx => {
    await reserveInference(tx, { id, userId, category: "image", inputHash: "original-input", visualOperationId: "historical-never-dispatched" });
    await settleInference(tx, id, userId, "failed");
  });
  await retryOwnedVisualReference(db, userId, "historical-retry");
  expect((await db.select().from(schema.visualRenderOperations))[0]!.generation).toBe(2);
  const reservations = await db.select().from(schema.inferenceReservations);
  expect(reservations).toHaveLength(1);
  expect(reservations[0]).toMatchObject({ id, state: "failed", inputHash: "original-input" });
  expect((await db.select().from(schema.inferenceAccounts))[0]!.imageBalance).toBe(25);
});

describe("durable visual render journal", () => {
  test("reserves each paid dispatch once under concurrency and refuses changed boundary inputs", async () => {
    const [one, two] = await Promise.all([reserve(), reserve()]);
    expect(one.id).toBe(two.id);
    const journal = visualImageJournal(db, one);
    const results = await Promise.allSettled([journal.begin(reservation), journal.begin(reservation)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(reserveVisualRender(db, "visual-game", one.operationKey, { ...request, prompt: "Different people" })).rejects.toThrow("inputs changed");
    await expect(renderDurableVisualImage(db, { gameId: "visual-game", operationKey: one.operationKey, request })).rejects.toThrow("recovery");
    await expect(retryVisualRender(db, one.id, 1)).rejects.toThrow("Reconcile");
  });

  test("commits receipt and pixels atomically and reuses them after restart", async () => {
    const operation = await reserve();
    const journal = visualImageJournal(db, operation);
    await journal.begin(reservation);
    const bytes = Buffer.from("durable image bytes");
    await journal.finish(receipt, bytes);
    await journal.finish(receipt, bytes);
    await expect(journal.finish(receipt, Buffer.from("different image"))).rejects.toThrow("Conflicting");
    const restored = await renderDurableVisualImage(db, { gameId: "visual-game", operationKey: operation.operationKey, request });
    expect(restored.image.equals(bytes)).toBe(true);
    expect(restored.receipt).toEqual(receipt);
    await expect(retryVisualRender(db, operation.id, 1)).rejects.toThrow("Only a failed");
    expect(await readVisualRenderAccounting(db, "visual-game")).toMatchObject({ knownCostMicrousd: 0, unpricedAttempts: 1, uncertainAttempts: 0 });
    expect((await readVisualRenderAccounting(db, "visual-game")).attempts[0]).not.toHaveProperty("image");
  });

  test("permits xAI only after a durable availability failure and retains uncertainty", async () => {
    const operation = await reserve();
    const journal = visualImageJournal(db, operation);
    const fallback = { provider: "xai" as const, model: "grok-imagine-image-2.0", requestHash: "xai-request" };
    await expect(journal.begin(fallback)).rejects.toThrow("fallback");
    await journal.begin(reservation);
    await journal.finish({ ...receipt, requestId: null, status: 503, chargeUncertain: true });
    await journal.begin(fallback);
    await journal.finish({ ...receipt, ...fallback }, Buffer.from("fallback image"));
    expect(await readVisualRenderAccounting(db, "visual-game")).toMatchObject({ unpricedAttempts: 2, uncertainAttempts: 1 });
    expect((await renderDurableVisualImage(db, { gameId: "visual-game", operationKey: operation.operationKey, request })).receipt.provider).toBe("xai");
  });

  test("blocks configuration-error fallback and allows an explicit retry with a fresh generation", async () => {
    const operation = await reserve();
    const journal = visualImageJournal(db, operation);
    await journal.begin(reservation);
    await journal.finish({ ...receipt, status: 401 });
    await expect(journal.begin({ provider: "xai", model: "grok", requestHash: "fallback" })).rejects.toThrow("fallback");
    const next = await retryVisualRender(db, operation.id, 1);
    expect(next.generation).toBe(2);
    await expect(retryVisualRender(db, operation.id, 1)).rejects.toThrow("generation changed");
    await expect(journal.finish(receipt, Buffer.from("late image"))).rejects.toThrow("Conflicting");
    await visualImageJournal(db, next).begin(reservation);
    expect(await loadPayloads(db.select().from(schema.visualRenderAttempts))).toHaveLength(2);
  });

  test("requires reconciliation before retrying an interrupted dispatch and retains its cost", async () => {
    const operation = await reserve();
    const journal = visualImageJournal(db, operation);
    await journal.begin(reservation);
    await expect(retryVisualRender(db, operation.id, 1)).rejects.toThrow("Reconcile");
    const [attempt] = await loadPayloads(db.select().from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.operationId, operation.id)));
    await reconcileVisualAttempt(db, { attemptId: attempt!.id, operatorId: "operator-1", note: "Provider confirmed completed charge; pixels unavailable", costMicrousd: 123_000 });
    const next = await retryVisualRender(db, operation.id, 1);
    await journal.finish(receipt, Buffer.from("late image"));
    const [retained] = await loadPayloads(db.select().from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.id, attempt!.id)));
    expect(retained?.image?.toString()).toBe("late image");
    expect(retained?.generation).toBe(1);
    expect(next.generation).toBe(2);
    expect(await readVisualRenderAccounting(db, "visual-game")).toMatchObject({ knownCostMicrousd: 123_000, unpricedAttempts: 0, uncertainAttempts: 0 });
  });
});


test("portrait model migration preserves accepted evidence and blocks uncertain redispatch", async () => {
  await db.insert(schema.users).values({ id: "portrait-owner" });
  const scene = await sharp({ create: { width: 128, height: 192, channels: 3, background: "white" } }).png().toBuffer();
  const accepted: VisualLocalization = { count: 1, anchors: [{ playerId: "character", label: 1, confidence: "clear", head: { x: .3, y: .1, width: .2, height: .2 } }] };
  let calls = 0;
  let fail = false;
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-6-sol");
    expect(body.text.format.strict).toBe(true);
    if (fail) throw new Error("Interrupted provider transport");
    return Response.json({ status: "completed", usage: { input_tokens: 1000, output_tokens: 100 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(accepted) }] }] });
  }, { preconnect: originalFetch.preconnect });
  const input = { userId: "portrait-owner", requestId: "portrait-model-test", scene, apiKey: "test" };
  const result = await localizeOwnedVisualReference(db, input);
  expect(result.anchors).toEqual(accepted.anchors);
  const [attempt] = await loadPayloads(db.select().from(schema.visualRenderAttempts));
  expect(attempt?.model).toBe("gpt-6-sol");
  // Simulate previously accepted GPT-5.6 evidence at this immutable boundary.
  await db.update(schema.visualRenderAttempts).set({ model: "gpt-5.6-sol", receipt: { ...attempt!.receipt!, model: "gpt-5.6-sol" } }).where(eq(schema.visualRenderAttempts.id, attempt!.id));
  expect(await localizeOwnedVisualReference(db, input)).toEqual(accepted);
  expect(calls).toBe(1);
  fail = true;
  const interrupted = { ...input, requestId: "portrait-interrupted-test" };
  await expect(localizeOwnedVisualReference(db, interrupted)).rejects.toThrow("Interrupted provider transport");
  await expect(localizeOwnedVisualReference(db, interrupted)).rejects.toThrow("needs recovery");
  expect(calls).toBe(2);
});
