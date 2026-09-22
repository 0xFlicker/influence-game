import { adoptDurableGameRunOwner } from "../services/game-ownership.js";
import { createSessionToken } from "../middleware/auth.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { GameState, Phase, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertOwner, insertCanonicalEventRows } from "./durable-run-test-utils.js";
import { previewFinalsRebuild } from "../services/visual-rebuild-preview.js";
import { hashCanonicalEvent } from "../services/game-events.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { createVisualGameRuntime } from "../services/visual-game-runtime.js";
import { pauseForVisualRepair, resumeVisualGame, setVisualFailurePolicy, VisualPreparationBlocked } from "../services/visual-policy.js";
import { readVisualOperationEvents, recordVisualOperationEvent } from "../services/visual-diagnostics.js";
import { readVisualProductionExport } from "../services/visual-production-export.js";
import { acceptVisualScene, prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { prepareVisualRepair } from "../services/visual-repair.js";
import { createVisualRoutes } from "../routes/visual.js";
import { renderPlannedVisualScene } from "../services/visual-scene-renderer.js";
let db: DrizzleDB, snapshot: DurableGameTurnSnapshotV1, ownerEpoch: string, png: Buffer;
let calls: number;
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalXai = process.env.XAI_API_KEY;
beforeEach(async () => {
  db = await setupTestDB();
  process.env.OPENAI_API_KEY = "test"; process.env.XAI_API_KEY = "test"; calls = 0;
  await db.insert(schema.games).values({ id: "visual-ops", slug: "visual-ops", status: "in_progress", config: JSON.stringify({ visualMode: true }) });
  ownerEpoch = await insertOwner(db, "visual-ops", { expiresAt: "2099-01-01T00:00:00.000Z" });
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues("visual-ops"));
  const execution = createInitialGameExecutionStateV1({ gameId: "visual-ops", ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } });
  await initializeGameExecutionAuthority(db, execution);
  png = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#ddccaa" } }).png().toBuffer();
  const artifact = await storeVisualArtifact(db, "visual-ops", png);
  const cast = [{ id: "p1", name: "Arden", referenceArtifactId: artifact, performanceInstructions: "Quiet" }];
  await db.insert(schema.visualGameAssets).values({ gameId: "visual-ops", profiles: [], cast, portraits: {}, backgrounds: Object.fromEntries(Object.keys(VISUAL_ROOMS).map((room) => [room, artifact])), status: "ready" });
  snapshot = { version: 1, execution, canonicalEvents: [...new GameState(cast, { gameId: "visual-ops" }).getCanonicalEvents()], transcriptEntries: [] };
  globalThis.fetch = Object.assign(async () => { calls++; return Response.json({ error: { code: "invalid_api_key", message: "Test credential rejected" } }, { status: 401 }); }, { preconnect: originalFetch.preconnect });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalXai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = originalXai;
});
const runtime = () => createVisualGameRuntime(db, "visual-ops", ownerEpoch);

test.each([
  ["judgment_opening", Phase.OPENING_STATEMENTS, "getOpeningStatement"],
  ["judgment_jury_questions", Phase.JURY_QUESTIONS, "getJuryAnswer"],
  ["judgment_closing", Phase.CLOSING_ARGUMENTS, "getClosingArgument"],
] as const)("%s reuses the five-person Finals scene and supplies both finalists without pausing", async (actor, phase, method) => {
  const [assets] = await db.select().from(schema.visualGameAssets);
  const referenceArtifactId = assets!.cast[0]!.referenceArtifactId;
  const cast = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, referenceArtifactId, performanceInstructions: "Quiet" }));
  const gameState = new GameState(cast, { gameId: "visual-ops" });
  for (const member of cast.slice(2)) gameState.eliminatePlayer(member.id);
  gameState.setEndgameStage("judgment");
  snapshot.canonicalEvents = [...gameState.getCanonicalEvents()];
  snapshot.execution.xstateSnapshot = { value: actor };
  snapshot.execution.cursor = { version: 1, kind: "phase_enter", actor };
  await db.update(schema.gameExecutionStates).set({ xstateSnapshot: snapshot.execution.xstateSnapshot, executionCursor: snapshot.execution.cursor }).where(eq(schema.gameExecutionStates.gameId, "visual-ops"));
  await db.update(schema.visualGameAssets).set({ cast }).where(eq(schema.visualGameAssets.gameId, "visual-ops"));
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  const expectedIds = ["p1", "p2", "p4", "p5", "p6"];
  const plan = planVisualScene({ roomId: "finals", backgroundArtifactId: referenceArtifactId, cast: cast.filter((member) => expectedIds.includes(member.id)),
    roles: { p1: "finalist", p2: "finalist", p4: "juror", p5: "juror", p6: "juror" } });
  const planned = await prepareVisualScene(db, { gameId: "visual-ops", boundarySequence: 0, plan });
  const scene = await acceptVisualScene(db, { sceneId: planned.id, planHash: planned.planHash, imageArtifactId: referenceArtifactId,
    anchors: expectedIds.map((playerId, index) => ({ playerId, label: index + 1, confidence: "clear", head: { x: index * 0.18, y: 0.2, width: 0.1, height: 0.1 } })) });
  const visual = runtime();
  await visual.prepareVisualBoundary!(snapshot);
  for (const finalist of cast.slice(0, 2)) {
    const context = await visual.prepareVisualTurn!({ context: { gameId: "visual-ops", selfId: finalist.id, selfName: finalist.name, round: 1, phase,
      endgameStage: "judgment", alivePlayers: cast.slice(0, 2), jury: gameState.jury.slice(1), publicMessages: [], mingleMessages: [] },
      method, turnId: `turn-${finalist.id}`, committedHeads: snapshot.execution.heads, committedCursor: snapshot.execution.cursor });
    expect(context.room?.scene.id).toBe(scene.id);
    expect(context.room?.scene.participantIds).toEqual(expectedIds);
    expect(context.room?.scene.annotatedImageUrl).toStartWith("data:image/png;base64,");
  }
  expect(calls).toBe(0);
  expect((await db.select().from(schema.games))[0]?.status).toBe("in_progress");
});

test("Best effort continues, retains evidence and does not reset its budget on restart", async () => {
  const events = await runtime().prepareVisualBoundary!(snapshot);
  expect(events?.some((event) => event.outcome === "portraits")).toBe(true);
  expect((await db.select().from(schema.games))[0]?.status).toBe("in_progress");
  const paidCalls = calls;
  await runtime().prepareVisualBoundary!(snapshot);
  expect(calls).toBe(paidCalls);
  const exported = await readVisualProductionExport(db, "visual-ops");
  expect(exported.policy).toBe("best_effort");
  expect(exported.accounting.attempts[0]?.receipt?.failure?.responseBody).toContain("invalid_api_key");
  expect(exported.accounting.attempts[0]?.request).toHaveProperty("prompt");
  expect(exported.metrics[0]?.failed).toBeGreaterThan(0);
  const accepted = new GameState([], { gameId: "visual-ops" });
  for (const event of events ?? []) accepted.recordVisualOperation(event);
  const replay = GameState.fromCanonicalEvents(accepted.getCanonicalEvents());
  expect(replay.getCanonicalEvents().filter((event) => event.type === "visual.operation_recorded")).toHaveLength(events?.length ?? 0);
  const repeated = await runtime().prepareVisualBoundary!({ ...snapshot, canonicalEvents: [...snapshot.canonicalEvents, ...accepted.getCanonicalEvents().filter((event) => event.type === "visual.operation_recorded")] });
  expect(repeated).toEqual([]);
});

test("rebuilds an unused incorrect Finals plan at the same boundary, preserving evidence and fencing old results", async () => {
  const [assets] = await db.select().from(schema.visualGameAssets);
  const artifact = assets!.cast[0]!.referenceArtifactId;
  const cast = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, referenceArtifactId: artifact, performanceInstructions: "Quiet" }));
  const state = new GameState(cast, { gameId: "visual-ops" });
  for (const member of cast.slice(2)) state.eliminatePlayer(member.id);
  state.setEndgameStage("judgment");
  const events = [...state.getCanonicalEvents()];
  await insertCanonicalEventRows(db, "visual-ops", ownerEpoch, events);
  const last = events.at(-1)!;
  snapshot.canonicalEvents = events;
  snapshot.execution.heads.eventSequence = last.sequence;
  snapshot.execution.heads.eventHash = hashCanonicalEvent(last);
  snapshot.execution.xstateSnapshot = { value: "judgment_opening" };
  snapshot.execution.cursor = { version: 1, kind: "phase_enter", actor: "judgment_opening" };
  await db.update(schema.gameExecutionStates).set({ eventHeadSequence: last.sequence, eventHeadHash: hashCanonicalEvent(last), xstateSnapshot: snapshot.execution.xstateSnapshot, executionCursor: snapshot.execution.cursor }).where(eq(schema.gameExecutionStates.gameId, "visual-ops"));
  await db.update(schema.visualGameAssets).set({ cast }).where(eq(schema.visualGameAssets.gameId, "visual-ops"));
  const wrong = await prepareVisualScene(db, { gameId: "visual-ops", boundarySequence: 0, plan: planVisualScene({ roomId: "finals", backgroundArtifactId: artifact, cast }) });
  const anchors = cast.map((member, index) => ({ playerId: member.id, label: index + 1, confidence: "clear" as const, head: { x: index * 0.15, y: 0.2, width: 0.1, height: 0.1 } }));
  await acceptVisualScene(db, { sceneId: wrong.id, planHash: wrong.planHash, imageArtifactId: artifact, anchors });
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  await pauseForVisualRepair(db, new VisualPreparationBlocked("Participant mismatch", snapshot));
  const preview = await previewFinalsRebuild(db, "visual-ops", wrong.id);
  expect(preview.expectedParticipants.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p5", "p6"]);
  expect(preview.extraIds).toEqual(["p3"]);
  const request = { gameId: "visual-ops", sceneId: wrong.id, expectedRevision: 0, mode: "rebuild" as const, operatorId: "operator", previewHash: preview.previewHash };
  await db.update(schema.gameExecutionStates).set({ dialogueHeadSequence: 1 }).where(eq(schema.gameExecutionStates.gameId, "visual-ops"));
  await expect(prepareVisualRepair(db, request)).rejects.toThrow("unused scene");
  expect((await db.select().from(schema.visualScenes))[0]?.planHash).toBe(wrong.planHash);
  await db.update(schema.gameExecutionStates).set({ dialogueHeadSequence: 0 }).where(eq(schema.gameExecutionStates.gameId, "visual-ops"));
  await expect(prepareVisualRepair(db, { ...request, previewHash: "stale" })).rejects.toThrow("preview changed");
  await prepareVisualRepair(db, request);
  expect(calls).toBe(0);
  await expect(prepareVisualRepair(db, request)).rejects.toThrow("revision changed");
  await expect(acceptVisualScene(db, { sceneId: wrong.id, planHash: wrong.planHash, renderRevision: 0, imageArtifactId: artifact, anchors })).rejects.toThrow("does not match");
  const [repaired] = await db.select().from(schema.visualScenes);
  expect(repaired!.renderRevision).toBe(1);
  expect(repaired!.plan.cast).toHaveLength(5);
  const audit = (await readVisualOperationEvents(db, "visual-ops")).find((row) => row.evidence?.repair);
  expect(audit?.evidence?.repair?.before).toMatchObject({ imageArtifactId: artifact, planHash: wrong.planHash, renderRevision: 0 });
  // Restarted preparation computes exactly the stored replacement plan, without changing the boundary.
  await resumeVisualGame(db, "visual-ops", "operator");
  const adopted = await adoptDurableGameRunOwner(db, "visual-ops", { processId: "rebuild-worker" });
  expect(adopted.ok).toBe(true);
  if (!adopted.ok) throw new Error(adopted.error);
  ownerEpoch = adopted.claim.ownerEpoch;
  snapshot.execution = adopted.claim.executionState;
  const ids = preview.expectedParticipants.map((member) => member.id);
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (String(url).includes("/images/")) return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    const properties = JSON.parse(String(init?.body)).text.format.schema.properties;
    const output = properties.identities ? { count: 5, identities: ids.map((playerId) => ({ playerId, confidence: "clear" })) }
      : properties.matches ? { count: 5, matches: ids.map((playerId, index) => ({ playerId, label: index + 1, confidence: "clear" })) }
      : { count: 5, anchors: ids.map((playerId, index) => ({ playerId, label: index + 1, confidence: "clear", head: { x: index * 0.18, y: 0.2, width: 0.1, height: 0.1 } })) };
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  }, { preconnect: originalFetch.preconnect });
  const resumed = runtime();
  await resumed.prepareVisualBoundary!(snapshot);
  expect((await db.select().from(schema.visualScenes))[0]?.status).toBe("ready");
  expect((await db.select().from(schema.gameExecutionStates))[0]?.committedTurnSequence).toBe(0);
  for (const finalist of cast.slice(0, 2)) {
    const context = await resumed.prepareVisualTurn!({ context: { gameId: "visual-ops", selfId: finalist.id, selfName: finalist.name,
      round: state.round, phase: Phase.OPENING_STATEMENTS, endgameStage: "judgment", alivePlayers: cast.slice(0, 2), jury: state.jury.slice(1), publicMessages: [], mingleMessages: [] },
      method: "getOpeningStatement", turnId: `repaired-${finalist.id}`, committedHeads: snapshot.execution.heads, committedCursor: snapshot.execution.cursor });
    expect(context.room?.scene.participantIds).toEqual(ids);
    expect(context.room?.scene.annotatedImageUrl).toStartWith("data:image/png;base64,");
  }
});

test("Require visuals pauses at the unchanged durable boundary and explicitly resumes", async () => {
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  let failure: VisualPreparationBlocked | undefined;
  try { await runtime().prepareVisualBoundary!(snapshot); } catch (error) { if (error instanceof VisualPreparationBlocked) failure = error; else throw error; }
  expect(failure).toBeDefined();
  await pauseForVisualRepair(db, failure!);
  expect((await db.select().from(schema.games))[0]?.status).toBe("suspended");
  expect((await db.select().from(schema.gameExecutionStates))[0]?.committedTurnSequence).toBe(0);
  expect((await db.select().from(schema.gameRunOwners))[0]?.status).toBe("expired");
  await setVisualFailurePolicy(db, "visual-ops", "best_effort", "operator");
  expect((await db.select().from(schema.games))[0]?.status).toBe("suspended");
  await resumeVisualGame(db, "visual-ops", "operator");
  expect((await db.select().from(schema.games))[0]?.status).toBe("in_progress");
  expect((await db.select().from(schema.gameExecutionStates))[0]?.committedTurnSequence).toBe(0);
  expect((await readVisualOperationEvents(db, "visual-ops")).map((row) => row.event.kind)).toContain("resumed");
  await expect(resumeVisualGame(db, "visual-ops", "operator")).rejects.toThrow("not paused");
  const adopted = await adoptDurableGameRunOwner(db, "visual-ops", { processId: "review-worker" });
  expect(adopted.ok).toBe(true);
  if (!adopted.ok) throw new Error(adopted.error);
  expect(adopted.claim.ownerEpoch).not.toBe(ownerEpoch);
  expect(adopted.claim.executionState.cursor).toEqual(snapshot.execution.cursor);
  expect(adopted.claim.executionState.heads).toEqual(snapshot.execution.heads);

});

test("changing to Best effort while a request is in flight prevents championship suspension", async () => {
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  const failure = new VisualPreparationBlocked("Image failed", snapshot);
  await setVisualFailurePolicy(db, "visual-ops", "best_effort", "operator");
  await pauseForVisualRepair(db, failure);
  expect((await db.select().from(schema.games))[0]?.status).toBe("in_progress");
});

test("stale owners cannot pause games and unrelated suspensions cannot be resumed by visual controls", async () => {
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  await db.update(schema.gameRunOwners).set({ status: "revoked" }).where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch));
  await expect(pauseForVisualRepair(db, new VisualPreparationBlocked("Image failed", snapshot))).rejects.toThrow("active");
  await db.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, "visual-ops"));
  await expect(resumeVisualGame(db, "visual-ops", "operator")).rejects.toThrow("not owned");
});

test("rejected composition retains exact evidence and can be reverified without another image charge", async () => {
  let valid = false, imageCalls = 0;
  globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/images/")) { imageCalls++; return Response.json({ data: [{ b64_json: png.toString("base64") }] }); }
    const body = JSON.parse(String(init?.body));
    const properties = body.text.format.schema.properties;
    const output = properties.identities ? { count: valid ? 1 : 2, identities: [{ playerId: "p1", confidence: "clear" }] }
      : properties.matches ? { count: 1, matches: [{ playerId: "p1", label: 1, confidence: "clear" }] }
      : { count: 1, anchors: [{ playerId: "p1", label: 1, confidence: "clear", head: { x: .2, y: .2, width: .1, height: .1 } }] };
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  }, { preconnect: originalFetch.preconnect });
  await runtime().prepareVisualBoundary!(snapshot);
  const [scene] = await db.select().from(schema.visualScenes);
  expect(scene?.status).toBe("failed"); expect(scene?.candidateArtifactId).toBeTruthy();
  const before = imageCalls;
  expect((await readVisualProductionExport(db, "visual-ops")).accounting.attempts.some((attempt) => attempt.receipt?.failure?.responseBody?.includes('\\"count\\":2'))).toBe(true);
  await setVisualFailurePolicy(db, "visual-ops", "require_visuals", "operator");
  await pauseForVisualRepair(db, new VisualPreparationBlocked("Identity mismatch", snapshot));
  await prepareVisualRepair(db, { gameId: "visual-ops", sceneId: scene!.id, expectedRevision: scene!.renderRevision, mode: "verify", operatorId: "operator" });
  await expect(prepareVisualRepair(db, { gameId: "visual-ops", sceneId: scene!.id, expectedRevision: scene!.renderRevision, mode: "verify", operatorId: "operator" })).rejects.toThrow("revision changed");
  const [repaired] = await db.select().from(schema.visualScenes);
  valid = true;
  expect((await renderPlannedVisualScene(db, repaired!)).status).toBe("ready");
  expect(imageCalls).toBe(before);
});

test("durable diagnostics are idempotent and private routes reject unauthenticated access", async () => {
  await Promise.all([1, 2].map(() => recordVisualOperationEvent(db, "visual-ops", "same-key", { kind: "failure", outcome: "failed", message: "Preserved" })));
  expect(await readVisualOperationEvents(db, "visual-ops")).toHaveLength(1);
  const app = createVisualRoutes(db);
  expect((await app.request("/api/admin/games/visual-ops/visual")).status).toBe(401);
  expect((await app.request("/api/admin/games/visual-ops/visual/evidence/artifact/anything")).status).toBe(401);
  expect((await app.request("/api/admin/games/visual-ops/visual/control", { method: "POST", body: JSON.stringify({ action: "resume" }) })).status).toBe(401);
});


test("read-only admins can inspect evidence but cannot change policy or resume", async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "visual-ops-test-only";
  try {
    await db.insert(schema.users).values({ id: "read-only-reviewer", displayName: "Reviewer" });
    const token = await createSessionToken("read-only-reviewer", { roles: ["admin"], permissions: ["view_admin"] });
    const app = createVisualRoutes(db);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    expect((await app.request("/api/admin/games/visual-ops/visual", { headers })).status).toBe(200);
    const response = await app.request("/api/admin/games/visual-ops/visual/control", { method: "POST", headers, body: JSON.stringify({ action: "policy", policy: "require_visuals" }) });
    expect(response.status).toBe(403);
    expect((await readVisualProductionExport(db, "visual-ops")).policy).toBe("best_effort");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  }
});
