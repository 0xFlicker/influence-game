import { afterEach, beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { generateVisualImage, type VisualImageJournal, type VisualImageReceipt } from "../services/visual-image-provider";

const originalFetch = globalThis.fetch;
const originalOpenai = process.env.OPENAI_API_KEY;
const originalXai = process.env.XAI_API_KEY;
let receipts: VisualImageReceipt[];
let begins: string[];
let journal: VisualImageJournal;
let png: string;
const request = { prompt: "An empty lounge", width: 1024, height: 1024, references: [] };

beforeEach(async () => {
  receipts = []; begins = [];
  process.env.OPENAI_API_KEY = "test-openai";
  process.env.XAI_API_KEY = "test-xai";
  png = (await sharp({ create: { width: 16, height: 16, channels: 3, background: "#aaa" } }).png().toBuffer()).toString("base64");
  journal = { begin: async ({ provider }) => { begins.push(provider); }, finish: async (receipt) => { receipts.push(receipt); } };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenai;
  if (originalXai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = originalXai;
});
const success = () => Response.json({ data: [{ b64_json: png }], usage: { output_tokens: 10 } });

test("journals a successful primary render without calling fallback", async () => {
  globalThis.fetch = Object.assign(async () => success(), { preconnect: originalFetch.preconnect });
  const result = await generateVisualImage(request, journal);
  expect(begins).toEqual(["openai"]);
  expect(receipts[0]?.chargeUncertain).toBe(false);
  const metadata = await sharp(result.image).metadata();
  expect([metadata.width, metadata.height]).toEqual([1024, 1024]);
});

test("falls back once for an HTML service outage and records both attempts", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async () => ++calls === 1 ? new Response("Service unavailable", { status: 503 }) : success(), { preconnect: originalFetch.preconnect });
  await generateVisualImage(request, journal);
  expect(begins).toEqual(["openai", "xai"]);
  expect(receipts.map((receipt) => receipt.status)).toEqual([503, 200]);
  expect(receipts[0]?.chargeUncertain).toBe(true);
});

test("retains transport evidence and never repeats an uncertain paid request", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { if (++calls === 1) throw new TypeError("network"); return success(); }, { preconnect: originalFetch.preconnect });
  await expect(generateVisualImage(request, journal)).rejects.toThrow("payment outcome is uncertain");
  expect(begins).toEqual(["openai"]);
  expect(receipts[0]?.chargeUncertain).toBe(true);
  expect(receipts[0]?.failure).toMatchObject({ kind: "transport", name: "TypeError", message: "network" });
});

test("does not mask authentication failure or malformed successful output with fallback", async () => {
  for (const response of [Response.json({ error: "unauthorized" }, { status: 401 }), Response.json({ data: [] })]) {
    begins = []; receipts = [];
    globalThis.fetch = Object.assign(async () => response, { preconnect: originalFetch.preconnect });
    await expect(generateVisualImage(request, journal)).rejects.toThrow();
    expect(begins).toEqual(["openai"]);
    expect(receipts).toHaveLength(1);
  }
});

test("durable reservation failure prevents any network request", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls++; return success(); }, { preconnect: originalFetch.preconnect });
  await expect(generateVisualImage(request, { ...journal, begin: async () => { throw new Error("Already dispatched"); } })).rejects.toThrow("Already dispatched");
  expect(calls).toBe(0);
});


test("rejects invalid image dimensions before reserving a paid attempt", async () => {
  for (const [width, height] of [[512, 864], [1025, 1024], [4096, 1024], [3840, 3840], [3840, 768]]) {
    await expect(generateVisualImage({ ...request, width: width!, height: height! }, journal)).rejects.toThrow("Invalid visual image request");
  }
  expect(begins).toHaveLength(0);
});
