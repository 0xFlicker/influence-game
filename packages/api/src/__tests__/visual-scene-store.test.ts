import { beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import type { VisualPlayerAnchor } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { acceptVisualScene, failVisualScene, prepareVisualScene, readCurrentVisualScene, readVisualArtifact, retryVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
let db: DrizzleDB;
let artifactId: string;
const anchors: VisualPlayerAnchor[] = [{ playerId: "p1", label: 1, head: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 }, confidence: "clear" }];
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.games).values([{ id: "game", slug: "visual-game", config: "{}" }, { id: "other", slug: "other-game", config: "{}" }]);
  artifactId = await storeVisualArtifact(db, "game", await sharp({ create: { width: 256, height: 256, channels: 3, background: "#c06040" } }).png().toBuffer());
});
const plan = () => planVisualScene({ roomId: "lobby", backgroundArtifactId: artifactId, cast: [{ id: "p1", name: "Player one", referenceArtifactId: artifactId, performanceInstructions: "Calm" }] });

test("freezes pixels, rejects cross-game assets, and reuses identical artifacts", async () => {
  const pixels = await readVisualArtifact(db, "game", artifactId);
  expect(await storeVisualArtifact(db, "game", pixels)).toBe(artifactId);
  await expect(readVisualArtifact(db, "other", artifactId)).rejects.toThrow("unavailable");
  await expect(prepareVisualScene(db, { gameId: "other", boundarySequence: 1, plan: plan() })).rejects.toThrow("belonging to this game");
});

test("requires complete localization, accepts once, and reuses unchanged scenes", async () => {
  const first = await prepareVisualScene(db, { gameId: "game", boundarySequence: 1, plan: plan() });
  const result = { sceneId: first.id, planHash: first.planHash, imageArtifactId: artifactId, anchors };
  await expect(acceptVisualScene(db, { ...result, anchors: [] })).rejects.toThrow("verified participant");
  const accepted = await acceptVisualScene(db, result);
  expect(accepted.status).toBe("ready");
  expect(accepted.annotatedArtifactId).not.toBe(artifactId);
  expect((await acceptVisualScene(db, result)).id).toBe(first.id);
  const next = await prepareVisualScene(db, { gameId: "game", boundarySequence: 2, plan: plan() });
  expect(next.id).toBe(first.id);
  expect(next.status).toBe("ready");
  expect(next.annotatedArtifactId).toBe(accepted.annotatedArtifactId);
});

test("new boundaries fence late results; empty rooms reuse backgrounds without rendering", async () => {
  const first = await prepareVisualScene(db, { gameId: "game", boundarySequence: 1, plan: plan() });
  const empty = await prepareVisualScene(db, { gameId: "game", boundarySequence: 2, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: artifactId, cast: [] }) });
  expect(empty).toMatchObject({ status: "ready", imageArtifactId: artifactId, annotatedArtifactId: artifactId, anchors: [] });
  await expect(acceptVisualScene(db, { sceneId: first.id, planHash: first.planHash, imageArtifactId: artifactId, anchors })).rejects.toThrow("Stale");
  expect((await readCurrentVisualScene(db, "game", "lobby"))?.id).toBe(empty.id);
  await expect(prepareVisualScene(db, { gameId: "game", boundarySequence: 2, plan: plan() })).rejects.toThrow("changed");
});

test("failed scenes require explicit recovery before acceptance", async () => {
  const scene = await prepareVisualScene(db, { gameId: "game", boundarySequence: 1, plan: plan() });
  await failVisualScene(db, scene.id, "Identity not clear");
  const result = { sceneId: scene.id, planHash: scene.planHash, imageArtifactId: artifactId, anchors };
  await expect(acceptVisualScene(db, result)).rejects.toThrow("explicit retry");
  await retryVisualScene(db, scene.id);
  expect((await acceptVisualScene(db, result)).status).toBe("ready");
});
