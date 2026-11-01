import { loadPayloads } from "../services/payload-storage.js";
import { createVisualTurnContextReader } from "../services/visual-turn-context.js";
import { eq } from "drizzle-orm";
import { beginConversation, huddleSessionId, GameState, Phase, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { prepareCommittedHuddleScene } from "../services/visual-huddle-boundary.js";
import { prepareCommittedMingleScenes } from "../services/visual-mingle-boundary.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import sharp from "sharp";
import { planVisualScene, visualRoomCropGroups } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { prepareVisualScene, readCurrentVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { renderPlannedVisualScene, renderVisualCandidate } from "../services/visual-scene-renderer.js";
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
      expect(body.model).toBe("gpt-6-sol");
      expect(body.text.format.strict).toBe(true);
      const identity = Boolean(body.text.format.schema.properties.matches);
      const composition = Boolean(body.text.format.schema.properties.identities);
      const ids: string[] = (body.text.format.schema.properties.identities ?? body.text.format.schema.properties.matches ?? body.text.format.schema.properties.anchors).items.properties.playerId.enum;
      const result = { ...(body.text.format.schema.properties.missingParticipantIds ? { missingParticipantIds: [] } : {}), count: rejectIdentity ? ids.length + 1 : ids.length, anchors: ids.map((id, index) => ({ playerId: id, label: index + 1, confidence: "clear", head: { x: index / ids.length, y: 0.3, width: 0.05, height: 0.1 } })) };
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

test.each([9, 10, 12, 14])("renders %i contestants into distinct room regions with no harmonization", async size => {
  const bands = await sharp({ create: { width: 3072, height: 1536, channels: 3, background: "red" } }).composite([{ input: await sharp({ create: { width: 1536, height: 1536, channels: 3, background: "blue" } }).png().toBuffer(), left: 1536, top: 0 }]).png().toBuffer();
  artifactId = await storeVisualArtifact(db, "game", bands);
  const mock = globalThis.fetch, backdrops: string[] = [];
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/v1/images/")) {
      const inputs = (init?.body as FormData).getAll("image[]");
      expect(inputs.length).toBeLessThanOrEqual(5);
      backdrops.push(Buffer.from(await (inputs[0] as Blob).arrayBuffer()).toString("base64"));
    }
    return mock(url, init);
  }, { preconnect: originalFetch.preconnect });
  const planned = await scene(size), count = Math.ceil(size / 4);
  const ready = await renderPlannedVisualScene(db, planned);
  expect(ready.shots?.mode).toBe("groups");
  expect(ready.shots?.overview).toBeNull();
  expect(ready.shots?.groups.flatMap(s => s.visibleParticipantIds).sort()).toEqual(planned.plan.cast.map(m => m.id).sort());
  expect(ready.shots?.groups).toHaveLength(count);
  expect(new Set(backdrops).size).toBeGreaterThan(1);
  expect([imageCalls, visionCalls]).toEqual([count, count * 3]);
  await renderPlannedVisualScene(db, planned);
  expect([imageCalls, visionCalls]).toEqual([count, count * 3]);
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
  expect(imageCalls).toBe(3);
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
        opened: false, movementIntents: {}, conversations: rooms.map(room => room.playerIds.length < 2 ? null : beginConversation(room.playerIds, "test")),
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
  expect([imageCalls, visionCalls]).toEqual([4, 4]);
  await prepare();
  expect([imageCalls, visionCalls]).toEqual([4, 4]);
  if (execution.cursor.kind !== "mingle") throw new Error("Expected Mingle cursor");
  const window = execution.cursor.progress.window!;
  window.allRooms = structuredClone(window.initialAllocation.rooms);
  window.roomByPlayerId.p0 = 5;
  window.nextBeat = 2;
  window.conversations = Array.from({length:window.roomCount},(_,i)=>{
    const ids=cast.filter(p=>window.roomByPlayerId[p.id]===i+1).map(p=>p.id);
    return ids.length < 2 ? null : beginConversation(ids,"test");
  });
  execution.heads.turnSequence = 1;
  await db.update(schema.gameExecutionStates).set({ executionCursor: execution.cursor, committedTurnSequence: 1 }).where(eq(schema.gameExecutionStates.gameId, "game"));
  const moved = await prepare();
  expect([imageCalls, visionCalls]).toEqual([6, 6]);
  expect(moved[1]?.imageArtifactId).toBe(initial[1]?.imageArtifactId);
  expect(moved[4]?.anchors?.map((anchor) => anchor.playerId)).toEqual(["p0"]);
  const movedView = await readContext({ context: { ...context, currentRoomId: 5, mingleBeat: 2 }, method: "takeMingleTurn", turnId: "turn-2", committedHeads: execution.heads, committedCursor: execution.cursor });
  expect(movedView.room?.scene.participantIds).toEqual(["p0"]);
  delete window.roomByPlayerId.p1;
  await expect(prepare()).rejects.toThrow("canonical participants");
  expect([imageCalls, visionCalls]).toEqual([6, 6]);
});

test("an aborted scene cannot reserve a paid request", async () => {
  const planned = await scene(3);
  const controller = new AbortController();
  controller.abort(new Error("Preparation cancelled"));
  await expect(renderPlannedVisualScene(db, planned, controller.signal)).rejects.toThrow("Preparation cancelled");
  expect([imageCalls, visionCalls]).toEqual([0, 0]);
  expect(await loadPayloads(db.select().from(schema.visualRenderAttempts))).toHaveLength(0);
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

test("best effort keeps a one-missing-person shot and never fabricates their anchor", async () => {
  const mock = globalThis.fetch;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/responses")) {
      const body = JSON.parse(String(init?.body));
      expect(body.text.format.schema.required).toContain("missingParticipantIds");
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ count: 1, missingParticipantIds: ["p1"], anchors: [{ playerId: "p0", label: 1, confidence: "clear", head: { x: .2, y: .2, width: .1, height: .1 } }] }) }] }] });
    }
    return mock(url, init);
  }, { preconnect: originalFetch.preconnect });
  const ready = await renderPlannedVisualScene(db, await scene(2), undefined, undefined, true);
  expect(ready.status).toBe("ready");
  expect(ready.shots?.overview).toMatchObject({ participantIds: ["p0", "p1"], visibleParticipantIds: ["p0"] });
  expect(ready.anchors?.map(a => a.playerId)).toEqual(["p0"]);
  expect(imageCalls).toBe(1);
});

test("best effort discards a duplicate-filled group while keeping the other group as playable pixels", async () => {
  const mock = globalThis.fetch;
  let groupNumber = 0;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).endsWith("/responses")) return mock(url, init);
    const body = JSON.parse(String(init?.body));
    const ids: string[] = body.text.format.schema.properties.anchors.items.properties.playerId.enum;
    const result = { count: ids.length + (groupNumber++ === 0 ? 1 : 0), missingParticipantIds: [], anchors: ids.map((playerId, i) => ({ playerId, label: i + 1, confidence: "clear", head: { x: i / ids.length, y: .2, width: .05, height: .1 } })) };
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] });
  }, { preconnect: originalFetch.preconnect });
  const planned = await scene(6);
  const ready = await renderPlannedVisualScene(db, planned, undefined, undefined, true);
  expect(ready.status).toBe("ready");
  expect(ready.shots?.mode).toBe("groups");
  expect(ready.shots?.groups).toHaveLength(visualRoomCropGroups(planned.plan).length - 1);
  expect(ready.imageArtifactId).toBe(ready.shots!.groups[0]!.imageArtifactId);
  expect(ready.candidateArtifactId).toBe(ready.imageArtifactId);
  expect(ready.plan.cast).toHaveLength(6);
  const callsBefore = imageCalls;
  expect((await renderPlannedVisualScene(db, ready, undefined, undefined, true)).id).toBe(ready.id);
  expect(imageCalls).toBe(callsBefore);
});


test("large-cast identity rejection retains the rejected region without harmonization", async () => {
  rejectIdentity = true;
  await expect(renderPlannedVisualScene(db, await scene(10))).rejects.toThrow("unexpected occupant count");
  const stored = await readCurrentVisualScene(db, "game", "lobby");
  expect(stored?.candidateArtifactId).toBeTruthy();
  expect(stored?.status).toBe("failed");
  expect([imageCalls, visionCalls]).toEqual([1, 1]);
});

test("huddle scenes reuse only an exact cast, freeze the speech binding, and leave ordinary rooms alone", async () => {
  const cast = Array.from({length: 3}, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, referenceArtifactId: artifactId, performanceInstructions: "Calm" }));
  const game = new GameState(cast, { gameId: "game" });
  game.recordAllianceHuddleSchedule({ id: "selection", allianceId: "pair", window: "format", round: 1, pass: 1,
    decision: "scheduled", memberIds: ["p0", "p1"], rationale: "Private", createdAt: new Date().toISOString() });
  await db.update(schema.games).set({status: "in_progress"}).where(eq(schema.games.id, "game"));
  const ownerEpoch = await insertOwner(db, "game", {expiresAt: "2099-01-01T00:00:00Z"});
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues("game"));
  const execution = createInitialGameExecutionStateV1({ gameId: "game", ownerEpoch, xstateSnapshot: {value: "format_mingle"},
    cursor: {version: 1, kind: "huddle_conversation", completion: "format_resolve", progress: {scheduleIds: ["selection"], index: 0, conversation: beginConversation(["p0", "p1"], "selection")}} });
  await initializeGameExecutionAuthority(db, execution);
  const snapshot: DurableGameTurnSnapshotV1 = {version: 1, execution, canonicalEvents: [...game.getCanonicalEvents()], transcriptEntries: []};
  const fullRoom = await prepareVisualScene(db, {gameId: "game", boundarySequence: 0,
    plan: planVisualScene({roomId: "mingle-1", backgroundArtifactId: artifactId, cast})});
  await renderPlannedVisualScene(db, fullRoom);
  // Only room five is available for a newly staged huddle; the larger room cannot be reused.
  const input = {snapshot, frozenCast: cast, backgrounds: {"mingle-5": artifactId}};
  const first = await prepareCommittedHuddleScene(db, input);
  expect(first?.id).not.toBe(fullRoom.id);
  expect(first?.plan.roomId).toBe("mingle-5");
  expect(first?.plan.cast.map(m => m.id)).toEqual(["p0", "p1"]);
  const counts = [imageCalls, visionCalls];
  expect((await prepareCommittedHuddleScene(db, input))?.id).toBe(first?.id);
  expect([imageCalls, visionCalls]).toEqual(counts);
  snapshot.transcriptEntries.push({round: 1, phase: Phase.FORMAT_MINGLE, scope: "huddle", from: "Player 0", text: "Hello", timestamp: 1,
    dialogueContext: {version: 1, sessionId: huddleSessionId("selection"), visualScene: {id: first!.id, roomId: "mingle-5"}}});
  expect((await prepareCommittedHuddleScene(db, input))?.id).toBe(first?.id);
  expect((await readCurrentVisualScene(db, "game", "mingle-1"))?.id).toBe(fullRoom.id);
  expect([imageCalls, visionCalls]).toEqual(counts);
});

test.each(["village", "pack", "hunt"] as const)("preserves frozen Werewolf %s direction and individual staging with a supplied background", async purpose => {
  const { planWerewolfScene } = await import("../services/werewolf-scene-plan");
  const size = purpose === "village" ? 12 : purpose === "pack" ? 2 : 3;
  const base = await scene(size);
  const plan = await planWerewolfScene(db, "game", { purpose, roomId: purpose === "village" ? "lobby" : purpose === "pack" ? "mingle-1" : "mingle-2", boundarySequence: 1, day: 1, participantIds: base.plan.cast.map(m => m.id), wolfIds: [], targetId: purpose === "hunt" ? "p2" : null }, base.plan.cast);
  const mock = globalThis.fetch, prompts: string[] = [];
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/v1/images/")) prompts.push(String((init?.body as FormData).get("prompt")));
    return mock(url, init);
  }, { preconnect: originalFetch.preconnect });
  const prepared = await prepareVisualScene(db, { gameId: "game", boundarySequence: 1, plan });
  await renderPlannedVisualScene(db, prepared);
  expect(prompts).toHaveLength(Math.ceil(size / 4));
  for (const prompt of prompts) expect(prompt).toContain(plan.direction!.roomDirection);
  for (const placement of plan.placements) expect(prompts.filter(prompt => prompt.includes(JSON.stringify(placement.position)))).toHaveLength(1);
  if (size > 4) for (const prompt of prompts) expect(prompt).toContain("Do not reconstruct the entire room");
});


test("generic repair defaults do not impose whole-room staging on a supplied crop", async () => {
  const mock = globalThis.fetch, prompts: string[] = [];
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/v1/images/")) prompts.push(String((init?.body as FormData).get("prompt")));
    return mock(url, init);
  }, { preconnect: originalFetch.preconnect });
  await renderVisualCandidate(db, await scene(9), undefined, undefined, { renderContext: { style: "Preserve reference style", roomName: "Lobby", roomDirection: "Rebuild an entire modern kitchen" } });
  expect(prompts).toHaveLength(3);
  for (const prompt of prompts) {
    expect(prompt).not.toContain("Rebuild an entire modern kitchen");
    expect(prompt).not.toContain('"position":');
    expect(prompt).toContain("Do not reconstruct the entire room");
  }
});
