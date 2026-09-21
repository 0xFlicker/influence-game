import { afterEach, beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { planVisualScene, visualRenderGroups } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { prepareVisualScene, readCurrentVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { renderPlannedVisualScene } from "../services/visual-scene-renderer.js";
import { readVisualRenderAccounting } from "../services/visual-render-journal.js";
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
let db: DrizzleDB;
let artifactId: string;
let png: Buffer;
let imageCalls: number;
let visionCalls: number;
let rejectIdentity: boolean;
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.games).values({ id: "game", slug: "render-game", config: "{}" });
  png = await sharp({ create: { width: 512, height: 864, channels: 3, background: "#ddccaa" } }).png().toBuffer();
  artifactId = await storeVisualArtifact(db, "game", png);
  process.env.OPENAI_API_KEY = "test-not-a-real-key";
  imageCalls = 0; visionCalls = 0; rejectIdentity = false;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/responses")) {
      visionCalls += 1;
      const body = JSON.parse(String(init?.body));
      const ids: string[] = body.text.format.schema.properties.anchors.items.properties.playerId.enum;
      const result = { count: rejectIdentity ? ids.length + 1 : ids.length, anchors: ids.map((id, index) => ({ playerId: id, label: index + 1, confidence: "clear", head: { x: index / ids.length, y: 0.3, width: 0.05, height: 0.1 } })) };
      return Response.json({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
    }
    if (!String(url).includes("/v1/images/")) throw new Error("Unexpected test network request");
    imageCalls += 1;
    return Response.json({ data: [{ b64_json: png.toString("base64") }], usage: { output_tokens: 10 } });
  }, { preconnect: originalFetch.preconnect });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
});
async function scene(size: number) {
  const plan = planVisualScene({ roomId: "lobby", backgroundArtifactId: artifactId, cast: Array.from({ length: size }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, referenceArtifactId: artifactId, performanceInstructions: "Calm" })) });
  return prepareVisualScene(db, { gameId: "game", boundarySequence: 1, plan });
}

test("renders and verifies a small scene once, then resumes entirely from durable outputs", async () => {
  const planned = await scene(3);
  const ready = await renderPlannedVisualScene(db, planned);
  expect(ready.status).toBe("ready");
  expect(ready.anchors).toHaveLength(3);
  expect([imageCalls, visionCalls]).toEqual([1, 1]);
  expect((await renderPlannedVisualScene(db, planned)).id).toBe(ready.id);
  expect([imageCalls, visionCalls]).toEqual([1, 1]);
  expect(await readVisualRenderAccounting(db, "game")).toMatchObject({ unpricedAttempts: 2, uncertainAttempts: 0 });
});

test("builds large casts from small groups, harmonizes, and localizes only the final image", async () => {
  const planned = await scene(12);
  const ready = await renderPlannedVisualScene(db, planned);
  expect(ready.anchors).toHaveLength(12);
  expect(imageCalls).toBe(visualRenderGroups(planned.plan).length + 1);
  expect(visionCalls).toBe(1);
});

test("failed identity verification pauses the scene without another automatic paid attempt", async () => {
  rejectIdentity = true;
  const planned = await scene(3);
  await expect(renderPlannedVisualScene(db, planned)).rejects.toThrow("occupant count");
  expect((await readCurrentVisualScene(db, "game", "lobby"))?.status).toBe("failed");
  await expect(renderPlannedVisualScene(db, planned)).rejects.toThrow("recovery");
  expect([imageCalls, visionCalls]).toEqual([1, 1]);
});
