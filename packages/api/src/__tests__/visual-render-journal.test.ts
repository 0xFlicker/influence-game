import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  readVisualRenderAccounting, reconcileVisualAttempt, renderDurableVisualImage,
  reserveVisualRender, retryVisualRender, visualImageJournal,
} from "../services/visual-render-journal.js";
import type { VisualImageReceipt } from "../services/visual-image-provider.js";

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
    await journal.finish({ ...receipt, requestId: null, status: null, chargeUncertain: true });
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
    await expect(journal.finish(receipt, Buffer.from("late image"))).rejects.toThrow("Stale");
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
    await expect(journal.finish(receipt, Buffer.from("late image"))).rejects.toThrow("reconciled");
    const next = await retryVisualRender(db, operation.id, 1);
    expect(next.generation).toBe(2);
    expect(await readVisualRenderAccounting(db, "visual-game")).toMatchObject({ knownCostMicrousd: 123_000, unpricedAttempts: 0, uncertainAttempts: 0 });
  });
});
