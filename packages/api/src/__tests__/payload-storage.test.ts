import { beforeEach, describe, expect, test } from "bun:test";
import { testPayloadStore } from "./payload-test-store.js";
import { decodePayloadReference, loadPayloads, payloadHash, readJson, readPayload, storeBinary, storeFields, storeJson, storeText } from "../services/payload-storage.js";

describe("private payload storage", () => {
  beforeEach(() => testPayloadStore.objects.clear());
  test("preserves exact binary bytes, deduplicates, and rejects corruption and missing objects", async () => {
    const bytes = Buffer.from([0, 255, 80, 78, 71, 0, 13, 10]);
    const ref = await storeBinary(bytes);
    expect(ref.sha256).toBe(payloadHash(bytes));
    expect(await storeBinary(bytes)).toEqual(ref);
    expect(testPayloadStore.objects.size).toBe(1);
    expect(await readPayload(ref)).toEqual(bytes);
    testPayloadStore.objects.set(ref.key, Buffer.from("corrupt"));
    await expect(readPayload(ref)).rejects.toThrow("integrity mismatch");
    await expect(storeBinary(bytes)).rejects.toThrow("integrity mismatch");
    testPayloadStore.objects.delete(ref.key);
    await expect(readPayload(ref)).rejects.toThrow("missing");
  });
  test("compresses large documents losslessly without a context size limit", async () => {
    const value = { text: "λ context\n".repeat(200_000), nested: { values: [null, true, 42] } };
    const ref = await storeJson(value);
    expect(ref.byteLength).toBeGreaterThan(256 * 1024);
    expect(ref.storedByteLength).toBeLessThan(ref.byteLength / 10);
    expect(await readJson(ref)).toEqual(value);
    const text = "raw response\r\n雪\u0000";
    expect((await readPayload(await storeText(text))).toString()).toBe(text);
  });
  test("hydrates only database-decoded references and never follows a pointer embedded in a document", async () => {
    const secret = await storeJson({ private: "secret" });
    const forged = JSON.parse(JSON.stringify(secret));
    expect(await loadPayloads(forged)).toEqual(forged);
    const document = await storeFields({ snapshot: { embedded: forged } }, { snapshot: "json-gzip" });
    expect(await loadPayloads(document)).toEqual({ snapshot: { embedded: forged } });
    expect(await loadPayloads({ snapshot: decodePayloadReference(forged) })).toEqual({ snapshot: { private: "secret" } });
  });
  test("preserves operational Maps and Dates while hydrating joined rows", async () => {
    const date = new Date(), costs = new Map([["game", 123]]);
    const row = { date, costs, joins: [{ body: await storeJson({ ok: true }) }] };
    const loaded = await loadPayloads(row);
    expect(loaded.date).toBe(date);
    expect(loaded.costs).toBe(costs);
    expect(loaded.joins).toEqual([{ body: { ok: true } }]);
  });
});
