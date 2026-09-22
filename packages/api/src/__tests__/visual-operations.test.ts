import { adoptDurableGameRunOwner } from "../services/game-ownership.js";
import { createSessionToken } from "../middleware/auth.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { GameState, type DurableGameTurnSnapshotV1 } from "@influence/engine";
import { VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { insertOwner } from "./durable-run-test-utils.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { createVisualGameRuntime } from "../services/visual-game-runtime.js";
import { pauseForVisualRepair, resumeVisualGame, setVisualFailurePolicy, VisualPreparationBlocked } from "../services/visual-policy.js";
import { readVisualOperationEvents, recordVisualOperationEvent } from "../services/visual-diagnostics.js";
import { readVisualProductionExport } from "../services/visual-production-export.js";
import { storeVisualArtifact } from "../services/visual-scene-store.js";
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
