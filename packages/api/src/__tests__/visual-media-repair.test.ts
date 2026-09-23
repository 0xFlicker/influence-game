import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { Phase, type GameTurnIntentV1 } from "@influence/engine";
import { insertOwner } from "./durable-run-test-utils.js";
import { createInitialGameExecutionStateV1 } from "../services/game-turn-commit.js";
import { planVisualScene, visualRenderGroups } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { acceptVisualScene, prepareVisualScene, storeVisualArtifact, type StoredVisualScene } from "../services/visual-scene-store.js";
import { controlVisualMedia, readVisualMedia, type MediaControl } from "../services/visual-media-repair.js";
import { claimVisualMediaJob, executeVisualMediaJob } from "../services/visual-media-worker.js";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { reserveVisualRender, visualImageJournal, renderDurableVisualImage, } from "../services/visual-render-journal.js";
import { renderVisualCandidate } from "../services/visual-scene-renderer.js";
import { createVisualRoutes } from "../routes/visual.js";
import { createSessionToken } from "../middleware/auth.js";

let db: DrizzleDB, scene: StoredVisualScene, imageId: string, png: Buffer, calls: string[], fail: string | null;
const originalFetch = globalThis.fetch, originalKey = process.env.OPENAI_API_KEY, originalSecret = process.env.JWT_SECRET;
beforeEach(async () => {
  db = await setupTestDB(); calls = []; fail = null; process.env.OPENAI_API_KEY = "provider-free-test"; process.env.JWT_SECRET = "media-test-only";
  await db.insert(schema.games).values({ id: "media", slug: "media", status: "completed", config: JSON.stringify({ visualMode: true, visualFailurePolicy: "best_effort" }) });
  png = await sharp({ create: { width: 512, height: 864, channels: 3, background: "#aabbcc" } }).png().toBuffer();
  imageId = await storeVisualArtifact(db, "media", png);
  scene = await prepareVisualScene(db, { gameId: "media", boundarySequence: 2, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: imageId,
    cast: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, referenceArtifactId: imageId, performanceInstructions: "Quiet" })) }) });
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/responses")) {
      const body = JSON.parse(String(init?.body));
      const properties = body.text.format.schema.properties;
      const kind = properties.identities ? "composition" : properties.matches ? "identities" : "heads";
      calls.push(kind);
      const ids: string[] = (properties.identities ?? properties.matches ?? properties.anchors).items.properties.playerId.enum ?? [];
      const count = fail === "count" ? ids.length + 1 : ids.length;
      const anchors = ids.map((playerId, i) => ({ playerId, label: i + 1, confidence: "clear", head: { x: i / ids.length, y: .2, width: .05, height: .1 } }));
      const result = kind === "composition" ? { count, identities: ids.map(playerId => ({ playerId: fail === "duplicate" ? ids[0] : playerId, confidence: "clear" })) }
        : kind === "identities" ? { count, matches: anchors.map(({ head: _head, ...rest }) => rest) } : { count, anchors };
      return Response.json({ status: "completed", usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: fail === "heads" && kind === "heads" ? "malformed" : JSON.stringify(result) }] }] });
    }
    if (!String(url).includes("/v1/images/")) throw new Error("Unexpected provider URL");
    calls.push("image");
    if (fail === "first-image" || fail === "harmonize" && calls.filter(c => c === "image").length === 3) return Response.json({ error: { message: "Failed harmonization" } }, { status: 400 });
    return Response.json({ data: [{ b64_json: png.toString("base64") }], usage: { output_tokens: 10 } });
  }, { preconnect: originalFetch.preconnect });
});
afterEach(() => { globalThis.fetch = originalFetch; if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey; });
const send = (extra: Partial<MediaControl> = {}) => controlVisualMedia(db, "media", "admin", { requestId: crypto.randomUUID(), sceneId: scene.id, expectedVersion: 0, action: "regenerate", ...extra } as MediaControl);
async function run(render = renderVisualCandidate) { const job = await claimVisualMediaJob(db, crypto.randomUUID()); expect(job).not.toBeNull(); await executeVisualMediaJob(db, job!, new AbortController().signal, render); return job!; }
async function acceptedOriginal() { scene = await acceptVisualScene(db, { sceneId: scene.id, planHash: scene.planHash, imageArtifactId: imageId, anchors: [], verifiedParticipantIds: scene.plan.cast.map(m => m.id) }); }

test.each(["in_progress", "suspended", "completed"])("repairs %s scenes independently and publishes only by review", async status => {
  await db.update(schema.games).set({ status }).where(eq(schema.games.id, "media"));
  await acceptedOriginal();
  const before = await db.select().from(schema.games);
  const original = await db.select().from(schema.visualScenes);
  const pinned = (await readViewerMedia(db, "media")).publicationSnapshot;
  const receipt = await send(); expect(receipt).toMatchObject({ accepted: true, version: 1 });
  await run(); const media = await readVisualMedia(db, "media");
  expect(media.jobs[0]?.status).toBe("ready"); expect(media.publications).toHaveLength(0);
  expect(await db.select().from(schema.games)).toEqual(before); expect(await db.select().from(schema.visualScenes)).toEqual(original);
  expect(await db.select().from(schema.transcripts)).toEqual([]); expect(await db.select().from(schema.gameExecutionStates)).toEqual([]);
  expect((await readViewerMedia(db, "media")).scenes[0]?.publicationRevision).toBe(0);
  expect(await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: receipt.jobId! })).toMatchObject({ accepted: true });
  expect((await readViewerMedia(db, "media")).scenes[0]?.publicationRevision).toBe(1);
  expect((await readViewerMedia(db, "media", pinned)).scenes[0]?.publicationRevision).toBe(0);
  expect(await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: receipt.jobId! })).toMatchObject({ code: "publication_conflict" });
  await send({ action: "publish", expectedVersion: 1, expectedPublication: 1, versionId: `original:${scene.id}` });
  expect((await readViewerMedia(db, "media")).scenes[0]?.mediaVersionId).toBe(`original:${scene.id}`);
  expect((await readVisualMedia(db, "media")).publications).toHaveLength(2);
});

test("double clicks deduplicate; authorized rejections do not allocate versions", async () => {
  const requestId = "same-click";
  const receipts = await Promise.all([send({ requestId }), send({ requestId })]); expect(receipts[0]).toEqual(receipts[1]);
  expect(await send()).toMatchObject({ code: "stale_version" });
  expect(await send({ expectedVersion: 1 })).toMatchObject({ code: "already_pending" });
  expect(await send({ requestId, expectedVersion: 7 })).toMatchObject({ code: "request_conflict" });
  const media = await readVisualMedia(db, "media"); expect(media.jobs).toHaveLength(1); expect(media.requests).toHaveLength(3);
  expect((await db.select().from(schema.visualOperationEvents)).some(row => row.evidence?.name === "request_conflict")).toBe(true);
  expect(await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: receipts[0]!.jobId! })).toMatchObject({ code: "unverified" });
});

test("canonical bindings recover fallback dialogue, follow Mingle movement, and keep portrait-only beats", async () => {
  const ownerEpoch = await insertOwner(db, "media");
  const state = createInitialGameExecutionStateV1({ gameId: "media", ownerEpoch, xstateSnapshot: { value: "introduction" }, cursor: { version: 1, kind: "phase_enter", actor: "introduction" } });
  const intent: GameTurnIntentV1 = { version: 1, gameId: "media", turnId: "dialogue", turnSequence: 10, seed: "fixture", baseHeads: state.heads,
    branch: { version: 1, kind: "engine", action: "round_start" }, actorIds: [], targetIds: [], handles: [], participantIds: [], providerSubcalls: [] };
  const hash = `sha256:${"a".repeat(64)}`, date = new Date().toISOString();
  await db.insert(schema.gameTurns).values({ id: intent.turnId, gameId: "media", turnSequence: 10, plannedOwnerEpoch: ownerEpoch, committedOwnerEpoch: ownerEpoch,
    baseEventSequence: 1, baseDialogueSequence: 0, basePublicationSequence: 0, intent, intentHash: hash, effectHash: hash, status: "committed", committedAt: date,
    commitResult: { version: 1, gameId: "media", turnId: intent.turnId, turnSequence: 10, intentHash: hash, effectHash: hash, committedAt: date, state, canonicalEvents: [], dialogueSequences: [], publications: [], alreadyCommitted: false } });
  const room = await prepareVisualScene(db, { gameId: "media", boundarySequence: 4, plan: planVisualScene({ roomId: "mingle-1", backgroundArtifactId: imageId, cast: scene.plan.cast.slice(0, 2) }) });
  const moved = await prepareVisualScene(db, { gameId: "media", boundarySequence: 6, plan: planVisualScene({ roomId: "mingle-2", backgroundArtifactId: imageId, cast: scene.plan.cast.slice(0, 2) }) });
  const finals = await prepareVisualScene(db, { gameId: "media", boundarySequence: 8, plan: planVisualScene({ roomId: "finals", backgroundArtifactId: imageId, cast: scene.plan.cast.slice(0, 2) }) });
  const entries: Array<{ phase: Phase; safeContext?: typeof schema.transcripts.$inferInsert.safeContext; audience?: string[]; scope?: "public" | "diary" }> = [
    { phase: Phase.LOBBY },
    { phase: Phase.FORMAT_MINGLE, safeContext: { version: 1, roomId: 1 }, audience: ["p1"] },
    { phase: Phase.FORMAT_MINGLE, safeContext: { version: 1, roomId: 2 }, audience: ["p1"] },
    { phase: Phase.FORMAT_MINGLE, safeContext: { version: 1, roomId: 1 }, audience: ["p4"] },
    { phase: Phase.FORMAT_MINGLE },
    { phase: Phase.INTRODUCTION },
    { phase: Phase.LOBBY, safeContext: { version: 1, presentationPurpose: "farewell" } },
    { phase: Phase.LOBBY, scope: "diary" },
    { phase: Phase.OPENING_STATEMENTS },
  ];
  await db.insert(schema.transcripts).values(entries.map((entry, i) => ({ gameId: "media", round: 1, phase: entry.phase, text: "Ignored prose: arbitrary room or cast claims", timestamp: 1,
    gameTurnId: intent.turnId, gameTurnTranscriptOrdinal: i + 1, entrySequence: entry.scope === "diary" ? null : i + 1, speakerPlayerId: "p0", audiencePlayerIds: entry.scope === "diary" ? null : entry.audience ?? [], safeContext: entry.scope === "diary" ? null : entry.safeContext ?? { version: 1 }, scope: entry.scope ?? "public" })));
  const before = await db.select().from(schema.transcripts);
  expect((await readViewerMedia(db, "media")).bindings).toEqual({ 1: scene.id, 2: room.id, 3: moved.id, 9: finals.id });
  // Publishing a failed gameplay scene makes its existing canonical dialogue usable by viewers.
  const receipt = await send(); await run();
  await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: receipt.jobId! });
  expect((await readViewerMedia(db, "media")).scenes[0]?.publicationRevision).toBe(1);
  expect(await db.select().from(schema.transcripts)).toEqual(before);
  // Final 4 pleas must reuse exactly the surviving cast, even when a newer
  // lobby image contains an extra eliminated contestant.
  const four = await prepareVisualScene(db, { gameId: "media", boundarySequence: 7, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: imageId, cast: scene.plan.cast.slice(0, 4) }) });
  await prepareVisualScene(db, { gameId: "media", boundarySequence: 8, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: imageId, cast: scene.plan.cast.slice(0, 5) }) });
  for (const [index, event] of [
    { type: "game.phase_entered", payload: { phase: Phase.LOBBY, remainingPlayers: scene.plan.cast.slice(0, 5).map(({ id, name }) => ({ id, name })) } },
    { type: "player.eliminated", payload: { playerId: "p4", playerName: "Player 4" } },
    { type: "endgame.stage_set", payload: { stage: "reckoning", lastEmpoweredFromRegularRounds: null } },
  ].entries()) {
    const sequence = index + 1;
    await db.insert(schema.gameEvents).values({ gameId: "media", sequence, eventType: event.type, eventHash: hash, ownerEpoch, visibility: "public", payloadVersion: 1,
      envelope: { ...event, gameId: "media", sequence, round: 3, phase: Phase.PLEA, timestamp: date, source: "engine", visibility: "public", payloadVersion: 1, sourcePointers: [] } });
  }
  await db.update(schema.gameTurns).set({ baseEventSequence: 3 }).where(eq(schema.gameTurns.id, intent.turnId));
  await db.insert(schema.transcripts).values({ gameId: "media", round: 3, phase: Phase.PLEA, text: "The prose does not name the cast.", timestamp: 2, scope: "public",
    gameTurnId: intent.turnId, gameTurnTranscriptOrdinal: 10, entrySequence: 10, speakerPlayerId: "p0", audiencePlayerIds: [], safeContext: { version: 1 } });
  expect((await readViewerMedia(db, "media")).bindings[10]).toBe(four.id);
  await db.delete(schema.visualScenes).where(eq(schema.visualScenes.id, four.id));
  expect((await readViewerMedia(db, "media")).bindings[10]).toBeUndefined();
});

test("one lease, expired claim recovery, and late old-owner completion cannot accept", async () => {
  await send(); const first = (await claimVisualMediaJob(db, "first"))!; expect(await claimVisualMediaJob(db, "second")).toBeNull();
  await db.update(schema.visualRepairJobs).set({ leaseUntil: "2000-01-01T00:00:00Z" }).where(eq(schema.visualRepairJobs.id, first.id));
  const second = (await claimVisualMediaJob(db, "second"))!; expect(second.id).toBe(first.id);
  await executeVisualMediaJob(db, first, new AbortController().signal); expect(calls).toHaveLength(0);
  expect((await readVisualMedia(db, "media")).jobs[0]?.owner).toBe("second");
  await executeVisualMediaJob(db, second, new AbortController().signal); expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("ready");
});

test("restart reuses saved steps and blocks a dispatched attempt with no receipt", async () => {
  await send(); const job = (await claimVisualMediaJob(db, "owner"))!;
  const request = { prompt: "saved section", width: 512, height: 864, references: [] };
  const op = await reserveVisualRender(db, "media", `media:${job.id}:uncertain`, request, scene.id, job.id);
  const journal = visualImageJournal(db, op);
  await journal.begin({ provider: "openai", model: "gpt-image-2", requestHash: "test" });
  await executeVisualMediaJob(db, job, new AbortController().signal, async () => {
    await renderDurableVisualImage(db, { gameId: "media", operationKey: op.operationKey, request, repairJobId: job.id });
    throw new Error("must not dispatch");
  });
  expect(calls).toHaveLength(0); expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("needs_reconciliation");
  expect(await send({ expectedVersion: 1, action: "continue", sourceJobId: job.id })).toMatchObject({ code: "needs_reconciliation" });
  await journal.finish({ provider: "openai", model: "gpt-image-2", requestHash: "test", requestId: "late", status: 200, elapsedMs: 10, usage: null, chargeUncertain: false }, png);
  expect((await readVisualMedia(db, "media")).versions).toHaveLength(0);
  expect((await db.select().from(schema.visualRenderAttempts))[0]?.image).not.toBeNull();
});

test("continue reuses successful sections and retries only failed harmonization", async () => {
  fail = "harmonize"; await send(); const first = await run();
  expect(visualRenderGroups(scene.plan)).toHaveLength(2); expect(calls).toEqual(["image", "image", "image"]);
  expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("failed");
  fail = "first-image"; calls = []; await send({ expectedVersion: 1, action: "continue", sourceJobId: first.id }); const second = await run();
  expect(calls).toEqual(["image"]);
  fail = null; calls = []; await send({ expectedVersion: 2, action: "continue", sourceJobId: second.id }); await run();
  expect(calls).toEqual(["image", "composition", "heads", "identities"]);
});

test.each(["count", "duplicate"])("rejects %s identities without automatic regeneration", async failure => {
  fail = failure; await send(); await run(); expect((await readVisualMedia(db, "media")).versions).toHaveLength(0);
  expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("failed"); expect(calls.filter(c => c === "image")).toHaveLength(3);
});

test("uncertain geometry produces no guessed anchors and can be published", async () => {
  fail = "heads"; const receipt = await send(); await run(); const media = await readVisualMedia(db, "media");
  expect(media.versions[0]?.localization.anchors).toEqual([]);
  expect(media.jobs[0]?.status).toBe("ready");
  expect(await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: receipt.jobId! })).toMatchObject({ accepted: true });
});

test("recheck uses the selected image and does not generate; historic scene bypasses current arrangement gate", async () => {
  await acceptedOriginal();
  await prepareVisualScene(db, { gameId: "media", boundarySequence: 6, plan: planVisualScene({ ...scene.plan, cast: scene.plan.cast.slice(0, 2) }) });
  expect(await send({ action: "verify", sourceVersionId: `original:${scene.id}` })).toMatchObject({ accepted: true }); await run();
  expect(calls).toEqual(["composition", "heads", "identities"]);
  expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("ready");
});

test("empty-room generation verifies zero occupants", async () => {
  scene = await prepareVisualScene(db, { gameId: "media", boundarySequence: 6, plan: planVisualScene({ roomId: "mingle-1", backgroundArtifactId: imageId, cast: [] }) });
  await send(); await run(); expect(calls).toEqual(["image", "composition"]);
  expect((await readVisualMedia(db, "media")).jobs[0]?.status).toBe("ready");
});

test("immutable inputs, versions and publication evidence reject updates; failed acceptance rolls back", async () => {
  await acceptedOriginal(); await send(); await run(); const media = await readVisualMedia(db, "media");
  await expect(Promise.resolve(db.update(schema.visualRepairJobs).set({ plan: { ...scene.plan, cast: [] } }).where(eq(schema.visualRepairJobs.id, media.jobs[0]!.id)))).rejects.toThrow();
  await expect(Promise.resolve(db.update(schema.visualMediaVersions).set({ verificationVersion: "forged" }).where(eq(schema.visualMediaVersions.id, media.versions[0]!.id)))).rejects.toThrow();
  await expect(db.transaction(async tx => { await tx.insert(schema.visualMediaPublications).values({ id: "rollback", gameId: "media", sceneId: scene.id, versionId: media.versions[0]!.id, revision: 1, operatorId: "admin", createdAt: new Date().toISOString() }); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect((await readVisualMedia(db, "media")).publications).toHaveLength(0);
  await expect(Promise.resolve(db.execute(sql`DELETE FROM visual_media_requests`))).rejects.toThrow();
});

test("API queues once, returns durable rejection, and keeps candidates behind admin authorization", async () => {
  await db.insert(schema.users).values({ id: "operator", displayName: "Operator" });
  const token = await createSessionToken("operator", { roles: ["admin"], permissions: ["view_admin", "start_game"] });
  const app = createVisualRoutes(db); const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const invalid = await app.request("/api/admin/games/media/visual/media", { method: "POST", headers, body: "{" });
  expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ accepted: false, code: "invalid_media_request", auditId: expect.any(String) });
  const body = { action: "regenerate", sceneId: scene.id, requestId: "api", expectedVersion: 0 };
  const first = await app.request("/api/admin/games/media/visual/media", { method: "POST", headers, body: JSON.stringify(body) }); expect(first.status).toBe(200);
  const receipt = await first.json() as { jobId: string; versionId: string }; expect(receipt.versionId).toBe(receipt.jobId);
  const again = await app.request("/api/admin/games/media/visual/media", { method: "POST", headers, body: JSON.stringify(body) }); expect(await again.json()).toEqual(receipt);
  const denied = await app.request("/api/admin/games/media/visual/media", { method: "POST", headers, body: JSON.stringify({ ...body, requestId: "second" }) }); expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "stale_version" });
  await run(); const version = (await readVisualMedia(db, "media")).versions[0]!;
  expect((await app.request(`/api/games/media/visual/artifacts/${version.imageArtifactId}`)).status).toBe(404);
  expect((await app.request(`/api/admin/games/media/visual/evidence/artifact/${version.annotatedArtifactId}`)).status).toBe(401);
  await send({ action: "publish", expectedVersion: 1, expectedPublication: 0, versionId: version.id });
  expect((await app.request(`/api/games/media/visual/artifacts/${version.imageArtifactId}`)).status).toBe(200);
});
