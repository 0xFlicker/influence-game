import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  readVisualRenderAccounting, reconcileVisualAttempt, renderDurableVisualImage,
  reserveVisualRender, retryVisualRender, visualImageJournal, localizeOwnedVisualReference,
} from "../services/visual-render-journal.js";
import type { VisualImageReceipt } from "../services/visual-image-provider.js";

import sharp from "sharp";
import type { VisualLocalization } from "@influence/engine/visual-localization";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
let db: DrizzleDB;
const request = { prompt: "Empty warm house", width: 1024, height: 1024, references: [] };
const reservation = { provider: "openai" as const, model: "gpt-image-2", requestHash: "request-1" };
const receipt: VisualImageReceipt = { ...reservation, requestId: "provider-1", status: 200, elapsedMs: 100, usage: { images: 1 }, chargeUncertain: false };
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.games).values({ id: "visual-game", slug: "visual-test", config: "{}" });
});

const reserve = () => reserveVisualRender(db, "visual-game", "boundary-1:lobby:section-1", request);
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
    expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(2);
  });

  test("requires reconciliation before retrying an interrupted dispatch and retains its cost", async () => {
    const operation = await reserve();
    const journal = visualImageJournal(db, operation);
    await journal.begin(reservation);
    await expect(retryVisualRender(db, operation.id, 1)).rejects.toThrow("Reconcile");
    const [attempt] = await db.select().from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.operationId, operation.id));
    await reconcileVisualAttempt(db, { attemptId: attempt!.id, operatorId: "operator-1", note: "Provider confirmed completed charge; pixels unavailable", costMicrousd: 123_000 });
    const next = await retryVisualRender(db, operation.id, 1);
    await journal.finish(receipt, Buffer.from("late image"));
    const [retained] = await db.select().from(schema.visualRenderAttempts).where(eq(schema.visualRenderAttempts.id, attempt!.id));
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
  const [attempt] = await db.select().from(schema.visualRenderAttempts);
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
