import { createVisualTurnContextReader } from "../services/visual-turn-context.js";
import { eq } from "drizzle-orm";
import { GameState, Phase, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { prepareCommittedMingleScenes } from "../services/visual-mingle-boundary.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
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
      const identity = Boolean(body.text.format.schema.properties.matches);
      const composition = Boolean(body.text.format.schema.properties.identities);
      const ids: string[] = (body.text.format.schema.properties.identities ?? body.text.format.schema.properties.matches ?? body.text.format.schema.properties.anchors).items.properties.playerId.enum;
      const result = { count: rejectIdentity ? ids.length + 1 : ids.length, anchors: ids.map((id, index) => ({ playerId: id, label: index + 1, confidence: "clear", head: { x: index / ids.length, y: 0.3, width: 0.05, height: 0.1 } })) };
      return Response.json({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(composition ? { count: result.count, identities: result.anchors.map(({ playerId, confidence }) => ({ playerId, confidence })) } : identity ? { count: result.count, matches: result.anchors.map(({ head: _head, ...match }) => match) } : result) }] }] });
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
  expect([imageCalls, visionCalls]).toEqual([1, 3]);
  expect((await renderPlannedVisualScene(db, planned)).id).toBe(ready.id);
  expect([imageCalls, visionCalls]).toEqual([1, 3]);
  expect(await readVisualRenderAccounting(db, "game")).toMatchObject({ unpricedAttempts: 1, uncertainAttempts: 0 });
});

test("builds large casts from small groups, harmonizes, and localizes only the final image", async () => {
  const planned = await scene(12);
  const ready = await renderPlannedVisualScene(db, planned);
  expect(ready.anchors).toHaveLength(12);
  expect(imageCalls).toBe(visualRenderGroups(planned.plan).length + 1);
  expect(visionCalls).toBe(3);
});

test("failed identity verification pauses the scene without another automatic paid attempt", async () => {
  rejectIdentity = true;
  const planned = await scene(3);
  await expect(renderPlannedVisualScene(db, planned)).rejects.toThrow("unexpected occupant count");
  expect((await readCurrentVisualScene(db, "game", "lobby"))?.status).toBe("failed");
  await expect(renderPlannedVisualScene(db, planned)).rejects.toThrow("recovery");
  expect([imageCalls, visionCalls]).toEqual([1, 1]);
});

test("loss of the boundary retains paid output but prevents subsequent dispatch and scene mutation", async () => {
  const planned = await scene(12);
  const guard = async () => {
    if (imageCalls > 0) throw new Error("Boundary changed");
  };
  await expect(renderPlannedVisualScene(db, planned, undefined, guard)).rejects.toThrow("Boundary changed");
  expect([imageCalls, visionCalls]).toEqual([1, 0]);
  expect((await readCurrentVisualScene(db, "game", "lobby"))?.status).toBe("preparing");
  expect(await readVisualRenderAccounting(db, "game")).toMatchObject({ unpricedAttempts: 1, uncertainAttempts: 0 });
  const resumed = await renderPlannedVisualScene(db, planned);
  expect(resumed.status).toBe("ready");
  expect(imageCalls).toBe(visualRenderGroups(planned.plan).length + 1);
});

test("checks the boundary again before xAI availability fallback", async () => {
  const planned = await scene(3);
  const savedXaiKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-not-a-real-key";
  globalThis.fetch = Object.assign(async () => {
    imageCalls += 1;
    return Response.json({ error: "Unavailable" }, { status: 503 });
  }, { preconnect: originalFetch.preconnect });
  try {
    await expect(renderPlannedVisualScene(db, planned, undefined, async () => {
      if (imageCalls > 0) throw new Error("Owner revoked");
    })).rejects.toThrow("Owner revoked");
    expect(imageCalls).toBe(1);
    expect(await readVisualRenderAccounting(db, "game")).toMatchObject({ uncertainAttempts: 1 });
    expect((await readCurrentVisualScene(db, "game", "lobby"))?.status).toBe("preparing");
  } finally {
    if (savedXaiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedXaiKey;
  }
});


test("prepares five committed Mingle rooms and regenerates only rooms affected by movement", async () => {
  const cast = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, referenceArtifactId: artifactId, performanceInstructions: "Calm" }));
  const game = new GameState(cast, { gameId: "game" });
  const rooms = Array.from({ length: 5 }, (_, i) => ({ round: 1, beat: 1, roomId: i + 1, playerIds: cast.slice(i * 3, i * 3 + 3).map((member) => member.id) }));
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, "game"));
  const ownerEpoch = await insertOwner(db, "game", { expiresAt: "2099-01-01T00:00:00.000Z" });
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues("game"));
  const execution = createInitialGameExecutionStateV1({ gameId: "game", ownerEpoch, xstateSnapshot: { value: "format_mingle" }, cursor: {
    version: 1, kind: "mingle", progress: {
      version: 1, completion: "format_resolve", inboxStartIndex: 0, window: {
        phase: Phase.FORMAT_MINGLE, alivePlayers: cast.map(({ id, name }) => ({ id, name })), roomCount: 5, beats: 3, nextBeat: 1,
        initialAllocation: { rooms, diagnostics: { round: 1, beat: 1, roomCount: 5, eligiblePlayers: cast.map(({ id, name }) => ({ id, name })), assignments: [], allocatedRooms: [] } },
        roomByPlayerId: Object.fromEntries(rooms.flatMap((room) => room.playerIds.map((id) => [id, room.roomId]))), allRooms: [],
      },
    },
  } });
  await initializeGameExecutionAuthority(db, execution);
  const snapshot: DurableGameTurnSnapshotV1 = { version: 1, execution, canonicalEvents: [...game.getCanonicalEvents()], transcriptEntries: [] };
  const backgrounds = { "mingle-1": artifactId, "mingle-2": artifactId, "mingle-3": artifactId, "mingle-4": artifactId, "mingle-5": artifactId };
  const prepare = () => prepareCommittedMingleScenes(db, { snapshot, frozenCast: cast, backgrounds });
  await expect(prepareCommittedMingleScenes(db, { snapshot, backgrounds,
    frozenCast: cast.map((member, index) => index === 11 ? { ...member, referenceArtifactId: "missing-reference" } : member),
  })).rejects.toThrow("unavailable frozen artifacts");
  expect([imageCalls, visionCalls]).toEqual([0, 0]);
  const initial = await prepare();
  expect(initial).toHaveLength(5);
  const readContext = createVisualTurnContextReader(db, { gameId: "game", ownerEpoch, frozenCast: cast });
  const context = { gameId: "game", selfId: "p0", selfName: "Player 0", round: 1, phase: Phase.FORMAT_MINGLE,
    alivePlayers: cast.map(({ id, name }) => ({ id, name })), publicMessages: [], mingleMessages: [], currentRoomId: 1, mingleBeat: 1 };
  const initialView = await readContext({ context, method: "takeMingleTurn", turnId: "turn-1", committedHeads: execution.heads, committedCursor: execution.cursor });
  expect(initialView.room?.scene.participantIds).toEqual(["p0", "p1", "p2"]);
  expect(initial[4]?.imageArtifactId).toBe(artifactId);
  expect([imageCalls, visionCalls]).toEqual([4, 12]);
  await prepare();
  expect([imageCalls, visionCalls]).toEqual([4, 12]);
  if (execution.cursor.kind !== "mingle") throw new Error("Expected Mingle cursor");
  const window = execution.cursor.progress.window!;
  window.allRooms = structuredClone(window.initialAllocation.rooms);
  window.roomByPlayerId.p0 = 5;
  window.nextBeat = 2;
  execution.heads.turnSequence = 1;
  await db.update(schema.gameExecutionStates).set({ executionCursor: execution.cursor, committedTurnSequence: 1 }).where(eq(schema.gameExecutionStates.gameId, "game"));
  const moved = await prepare();
  expect([imageCalls, visionCalls]).toEqual([6, 18]);
  expect(moved[1]?.imageArtifactId).toBe(initial[1]?.imageArtifactId);
  expect(moved[4]?.anchors?.map((anchor) => anchor.playerId)).toEqual(["p0"]);
  const movedView = await readContext({ context: { ...context, currentRoomId: 5, mingleBeat: 2 }, method: "takeMingleTurn", turnId: "turn-2", committedHeads: execution.heads, committedCursor: execution.cursor });
  expect(movedView.room?.scene.participantIds).toEqual(["p0"]);
  delete window.roomByPlayerId.p1;
  await expect(prepare()).rejects.toThrow("canonical participants");
  expect([imageCalls, visionCalls]).toEqual([6, 18]);
});

test("an aborted scene cannot reserve a paid request", async () => {
  const planned = await scene(3);
  const controller = new AbortController();
  controller.abort(new Error("Preparation cancelled"));
  await expect(renderPlannedVisualScene(db, planned, controller.signal)).rejects.toThrow("Preparation cancelled");
  expect([imageCalls, visionCalls]).toEqual([0, 0]);
  expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(0);
});

test("asset preparation freezes portraits, generates references and all eight backgrounds once", async () => {
  const { prepareVisualGameAssets } = await import("../services/visual-game-assets.js");
  await db.insert(schema.gamePlayers).values({ id: "p0", gameId: "game", agentConfig: "{}", persona: JSON.stringify({ name: "Arden", personaKey: "honest", performanceInstructions: "Measured delivery" }) });
  const first = await prepareVisualGameAssets(db, "game", async () => {});
  expect(first.cast).toHaveLength(1);
  expect(first.cast[0]?.performanceInstructions).toBe("Measured delivery");
  expect(Object.keys(first.backgrounds)).toHaveLength(8);
  expect(Object.keys(first.portraits)).toEqual(["p0"]);
  expect(imageCalls).toBe(9);
  await db.update(schema.gamePlayers).set({ persona: JSON.stringify({ name: "Changed" }) }).where(eq(schema.gamePlayers.id, "p0"));
  const resumed = await prepareVisualGameAssets(db, "game", async () => {});
  expect(resumed.cast).toEqual(first.cast);
  expect(imageCalls).toBe(9);
});

test("viewer routes expose only clean accepted images and frozen portraits", async () => {
  const { createVisualRoutes } = await import("../routes/visual.js");
  await db.update(schema.games).set({ config: JSON.stringify({ visualMode: true }) }).where(eq(schema.games.id, "game"));
  const ready = await renderPlannedVisualScene(db, await scene(3));
  const app = createVisualRoutes(db);
  const response = await app.request("/api/games/game/visual");
  const body = await response.json() as { scenes: Array<Record<string, unknown>> };
  expect(body.scenes[0]!.imageUrl).toContain(ready.imageArtifactId!);
  expect(body.scenes[0]!.annotatedImageUrl).toBeUndefined();
  expect(body.scenes[0]!.plan).toBeUndefined();
  expect((await app.request(`/api/games/game/visual/artifacts/${ready.imageArtifactId}`)).status).toBe(200);
  expect((await app.request(`/api/games/game/visual/artifacts/${ready.annotatedArtifactId}`)).status).toBe(404);
  expect((await app.request(`/api/games/game/visual/artifacts/${artifactId}`)).status).toBe(404);
});

test("bounded scene repair falls back after two failures, survives restart and permits a later arrangement", async () => {
  const { renderVisualSceneBestEffort } = await import("../services/visual-best-effort.js");
  rejectIdentity = true;
  const planned = await scene(3);
  expect(await renderVisualSceneBestEffort(db, planned, async () => {})).toBeNull();
  expect([imageCalls, visionCalls]).toEqual([2, 2]);
  const failed = (await readCurrentVisualScene(db, "game", "lobby"))!;
  expect(failed.renderRevision).toBe(1);
  const unchanged = await prepareVisualScene(db, { gameId: "game", boundarySequence: 2, plan: planned.plan });
  expect(unchanged.id).toBe(failed.id);
  expect(await renderVisualSceneBestEffort(db, unchanged, async () => {})).toBeNull();
  expect([imageCalls, visionCalls]).toEqual([2, 2]);
  rejectIdentity = false;
  const moved = await prepareVisualScene(db, { gameId: "game", boundarySequence: 3, plan: { ...planned.plan, cast: planned.plan.cast.slice(0, 2), placements: planned.plan.placements.slice(0, 2) } });
  expect((await renderVisualSceneBestEffort(db, moved, async () => {}))?.status).toBe("ready");
  expect(imageCalls).toBe(3);
});

test("a hung provider times out to portraits, records uncertainty and rejects late scene acceptance", async () => {
  const { renderVisualSceneBestEffort } = await import("../services/visual-best-effort.js");
  const gate = Promise.withResolvers<Response>();
  globalThis.fetch = Object.assign(async () => gate.promise, { preconnect: originalFetch.preconnect });
  const planned = await scene(2);
  expect(await renderVisualSceneBestEffort(db, planned, async () => {}, 50)).toBeNull();
  const failed = (await readCurrentVisualScene(db, "game", "lobby"))!;
  expect(failed.status).toBe("failed");
  expect(await renderVisualSceneBestEffort(db, failed, async () => {}, 50)).toBeNull();
  expect((await readVisualRenderAccounting(db, "game")).attempts).toHaveLength(1);
  gate.resolve(Response.json({ data: [{ b64_json: png.toString("base64") }] }));
  await Bun.sleep(100);
  expect((await readCurrentVisualScene(db, "game", "lobby"))?.status).toBe("failed");
});

test("verified composition with malformed geometry publishes an unanchored scene, never guessed anchors", async () => {
  const mock = globalThis.fetch;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/responses") && JSON.parse(String(init?.body)).text.format.schema.properties.anchors) {
      return Response.json({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] });
    }
    return mock(url, init);
  }, { preconnect: originalFetch.preconnect });
  const ready = await renderPlannedVisualScene(db, await scene(2));
  expect(ready.status).toBe("ready");
  expect(ready.anchors).toEqual([]);
});

test("fallback consumes one shared repair allowance across a multi-section scene", async () => {
  const { renderVisualSceneBestEffort } = await import("../services/visual-best-effort.js");
  const savedXai = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test";
  let fallbackCalls = 0;
  globalThis.fetch = Object.assign(async (url: string | URL | Request) => {
    imageCalls++;
    if (String(url).includes("api.x.ai")) { fallbackCalls++; return Response.json({ data: [{ b64_json: png.toString("base64") }] }); }
    return Response.json({ error: { code: "rate_limit", message: "Slow down" } }, { status: 429 });
  }, { preconnect: originalFetch.preconnect });
  try {
    const planned = await scene(6);
    expect(await renderVisualSceneBestEffort(db, planned, async () => {})).toBeNull();
    expect(fallbackCalls).toBe(1);
    expect(imageCalls).toBe(3);
    const [stored] = await db.select().from(schema.visualScenes);
    expect(stored?.repairBudgetUsed).toBe(true);
    expect(await renderVisualSceneBestEffort(db, stored!, async () => {})).toBeNull();
    expect(imageCalls).toBe(3);
  } finally {
    if (savedXai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = savedXai;
  }
});
