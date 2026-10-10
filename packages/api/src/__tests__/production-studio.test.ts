import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { Phase } from "@influence/engine";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { replayWerewolf, werewolfActionPlans } from "@influence/engine/werewolf";
import { werewolfConversationScene } from "@influence/engine/werewolf/visual-scenes";
import { productionMomentKey } from "@influence/engine/production-moments";
import { stableProductionJson, type ProductionExportDescriptor } from "@influence/engine/production-moments/export";
import type { ProductionPresentationSettings } from "@influence/engine/production-moments/settings";
import { schema, type DrizzleDB } from "../db/index.js";
import { getPermissionsForUser } from "../db/rbac.js";
import { createSessionToken, type AuthEnv } from "../middleware/auth.js";
import { createProductionStudioRoutes } from "../routes/production-studio.js";
import { createVisualReplayProductionRoutes } from "../routes/visual-replay-production.js";
import { appendGameEvents } from "../services/game-events.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { readInfluenceProductionSource } from "../services/influence-production-source.js";
import { buildWerewolfProductionSourceSnapshot, readWerewolfProductionSource } from "../services/werewolf-production-source.js";
import { createResolvedRoundCanonicalEventFixture, insertGame, insertOwner, withJuryWinner } from "./durable-run-test-utils.js";
import { grantTestAuthority } from "./rbac-fixtures.js";
import { setupTestDB } from "./test-utils.js";
import { seedProductionStudioFixture } from "./production-studio-fixtures.js";

let db: DrizzleDB, app: Hono<AuthEnv>, token: string;
const originalSecret = process.env.JWT_SECRET;
const settings: ProductionPresentationSettings = { width: 640, height: 360, fps: 24, reducedMotion: false, music: false, volume: 1, profile: { ending: "finish-score", overrides: {} } };
beforeEach(async () => {
  db = await setupTestDB(); process.env.JWT_SECRET = "local-production-studio-route-test";
  await db.insert(schema.users).values({ id: "operator" });
  // Deliberately claim more in the JWT than the database grants.
  token = await createSessionToken("operator", { roles: ["sysop"], permissions: ["manage_roles", "view_admin"] });
  app = new Hono<AuthEnv>(); app.route("/", createVisualReplayProductionRoutes(db)); app.route("/", createProductionStudioRoutes(db));
});
afterEach(() => { if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret; });
const root = (gameId: string) => `/api/admin/production/games/${gameId}`;
function request(path: string, body?: unknown, authorization = token) {
  return app.request(path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${authorization}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }) });
}
async function influence(id = "studio-influence") {
  const gameId = await insertGame(db, { id, status: "completed" });
  await db.insert(schema.gamePlayers).values(["atlas", "echo", "mira", "nyx"].map(id => ({ id, gameId, persona: JSON.stringify({ name: id, personality: "Frozen" }), agentConfig: "{}" })));
  const ownerEpoch = await insertOwner(db, gameId);
  await appendGameEvents(db, { gameId, ownerEpoch, events: withJuryWinner(createResolvedRoundCanonicalEventFixture(gameId), "mira") });
  const [transcript] = await db.insert(schema.transcripts).values({ gameId, round: 1, phase: Phase.LOBBY, scope: "public", fromPlayerId: "atlas",
    text: "Accepted original speech", thinking: "Accepted independent thinking", timestamp: 1 }).returning();
  const source = await readInfluenceProductionSource(db, gameId);
  const speech = source.catalog.moments.find(moment => moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(transcript!.id) && moment.kind === "speech")!;
  const thought = source.catalog.moments.find(moment => moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(transcript!.id) && moment.kind === "thinking")!;
  return { gameId, source, speech, thought };
}
async function wolf() {
  const id = "studio-werewolf", events = await werewolfResultsFixture("saved", id, 2);
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  return { id, events };
}
async function producer() { await grantTestAuthority(db, "operator", [], "producer"); }
function annotationBody(source: Awaited<ReturnType<typeof readInfluenceProductionSource>>, revision: number, tags: Record<string, string>) {
  return { snapshot: source.snapshot, audience: "public", thinking: true, expectedRevision: revision, tags };
}
function descriptorHash(descriptor: Omit<ProductionExportDescriptor, "hash">) {
  return `sha256:${createHash("sha256").update(stableProductionJson(descriptor)).digest("hex")}`;
}

test("metadata grants never acquire editorial source, even with privileged JWT claims", async () => {
  const f = await influence();
  const sourceUrl = `${root(f.gameId)}/source?audience=public&thinking=on`;
  expect((await request(sourceUrl)).status).toBe(403);
  await grantTestAuthority(db, "operator", ["view_admin", "start_game"], "visual-operator");
  const library = await request("/api/admin/production/library"); expect(library.status).toBe(200);
  const metadata = await request(root(f.gameId)); expect(metadata.status).toBe(200);
  expect((await metadata.json() as { capabilities: { visualRead: boolean; editorial: boolean } }).capabilities).toMatchObject({ visualRead: true, editorial: false });
  expect((await request(sourceUrl)).status).toBe(403);
  await producer();
  const authorized = await request(sourceUrl); expect(authorized.status).toBe(200); expect(authorized.headers.get("cache-control")).toBe("private, no-store");
  expect((await authorized.json() as { game: { id: string } }).game.id).toBe(f.gameId);
});

test("DB role revocation takes effect on source and annotation despite the existing JWT", async () => {
  const f = await influence(); await producer();
  expect((await request(`${root(f.gameId)}/source?audience=public&thinking=on`)).status).toBe(200);
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "producer"));
  await db.delete(schema.userRoles).where(eq(schema.userRoles.roleId, role!.id));
  expect((await request(`${root(f.gameId)}/source?audience=public&thinking=on`)).status).toBe(403);
  expect((await request(`${root(f.gameId)}/moments/${encodeURIComponent(f.speech.id)}/annotation`, annotationBody(f.source, 0, { cut: "youtube" }))).status).toBe(403);
  expect(await db.select().from(schema.productionMomentAnnotations)).toEqual([]);
});

test("thought and speech annotations remain independent and stale replacements return saved revisions", async () => {
  const f = await influence(); await producer();
  const path = (id: string) => `${root(f.gameId)}/moments/${encodeURIComponent(id)}/annotation`;
  const saved = await request(path(f.thought.id), annotationBody(f.source, 0, { cut: "youtube" }));
  expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ momentId: f.thought.id, tags: { cut: "youtube" }, revision: 1 });
  const conflict = await request(path(f.thought.id), annotationBody(f.source, 0, { cut: "different" }));
  expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ current: { tags: { cut: "youtube" }, revision: 1 } });
  const untag = await request(path(f.thought.id), annotationBody(f.source, 1, {})); expect(untag.status).toBe(200); expect(await untag.json()).toMatchObject({ tags: {}, revision: 2 });
  const late = await request(path(f.thought.id), annotationBody(f.source, 1, { cut: "youtube" })); expect(late.status).toBe(409);
  const rows = await db.select().from(schema.productionMomentAnnotations); expect(rows).toHaveLength(1); expect(rows[0]!.momentKey).toBe(f.thought.id); expect(rows[0]!.revision).toBe(2);
});

test("concurrent tag replacements produce one winner and a structured current-value conflict", async () => {
  const f = await influence(); await producer();
  const path = `${root(f.gameId)}/moments/${encodeURIComponent(f.speech.id)}/annotation`;
  expect((await request(path, annotationBody(f.source, 0, { cut: "initial" }))).status).toBe(200);
  const responses = await Promise.all([request(path, annotationBody(f.source, 1, { cut: "one" })), request(path, annotationBody(f.source, 1, { cut: "two" }))]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const conflict = responses.find(response => response.status === 409)!;
  expect(await conflict.json()).toMatchObject({ current: { revision: 2 } });
});

test("frozen tagged export resolves exact IDs after tag membership changes and rejects tampering", async () => {
  const f = await influence(); await producer();
  const annotation = `${root(f.gameId)}/moments/${encodeURIComponent(f.thought.id)}/annotation`;
  expect((await request(annotation, annotationBody(f.source, 0, { cut: "youtube" }))).status).toBe(200);
  const prepared = await request(`${root(f.gameId)}/selection`, { snapshot: f.source.snapshot, audience: "public", thinking: true,
    selection: { mode: "tagged", thinking: true, predicate: { cut: "youtube" } }, expectedMomentIds: [f.thought.id], settings, copy: { title: "Frozen copy" } });
  expect(prepared.status).toBe(200);
  const descriptor = await prepared.json() as ProductionExportDescriptor;
  expect(descriptor.momentIds).toEqual([f.thought.id]);
  expect(descriptor.annotations).toEqual([{ momentId: f.thought.id, tags: { cut: "youtube" }, revision: 1 }]);
  const retagged = await request(annotation, annotationBody(f.source, 1, { cut: "other" }));
  expect(retagged.status).toBe(200); expect(await retagged.json()).toMatchObject({ tags: { cut: "other" }, revision: 2 });
  const stalePreview = await request(`${root(f.gameId)}/selection`, { snapshot: f.source.snapshot, audience: "public", thinking: true,
    selection: { mode: "tagged", thinking: true, predicate: { cut: "youtube" } }, expectedMomentIds: [f.thought.id], settings, copy: {} });
  expect(stalePreview.status).toBe(409);
  expect(await stalePreview.json()).toMatchObject({ error: "Saved tags changed this cut. Refresh tags and review the cut before exporting." });
  const validated = await request(`${root(f.gameId)}/selection/validate`, descriptor);
  expect(validated.status).toBe(200); expect(await validated.json()).toEqual({ valid: true, hash: descriptor.hash, momentIds: [f.thought.id] });
  expect(descriptor.annotations).toEqual([{ momentId: f.thought.id, tags: { cut: "youtube" }, revision: 1 }]);
  expect((await request(`${root(f.gameId)}/selection/validate`, { ...descriptor, copy: { title: "Tampered" } })).status).toBe(400);
  const otherMoment = productionMomentKey("another", { kind: "influence-transcript", transcriptId: "1" }, { kind: "speech" });
  const { hash: _hash, ...invalid } = { ...descriptor, momentIds: [otherMoment],
    annotations: [{ momentId: otherMoment, tags: {}, revision: 0 }] };
  expect((await request(`${root(f.gameId)}/selection/validate`, { ...invalid, hash: descriptorHash(invalid) })).status).toBe(400);
});

test("recipe freezes independent labels in one snapshot and survives later predicate changes", async () => {
  const f = await influence(); await producer();
  const thoughtUrl = `${root(f.gameId)}/moments/${encodeURIComponent(f.thought.id)}/annotation`;
  const speechUrl = `${root(f.gameId)}/moments/${encodeURIComponent(f.speech.id)}/annotation`;
  expect((await request(thoughtUrl, annotationBody(f.source, 0, {"label.smart":"true", "label.fourth_wall":"true", note:"retained"}))).status).toBe(200);
  expect((await request(speechUrl, annotationBody(f.source, 0, {"label.aggressive":"true"}))).status).toBe(200);
  const selection = {mode:"recipe",thinking:true,base:"empty",policies:{thinking:{mode:"any",labels:["fourth_wall","smart"]},speech:{mode:"any",labels:["smart","aggressive"]}}} as const;
  const body = {snapshot:f.source.snapshot,audience:"public",thinking:true,selection,expectedMomentIds:[f.thought.id,f.speech.id],settings,copy:{title:"Exact reviewed cut"}};
  const response = await request(`${root(f.gameId)}/selection`,body); expect(response.status).toBe(200);
  const frozen = await response.json() as ProductionExportDescriptor;
  expect(frozen.selection).toEqual(selection); expect(frozen.momentIds).toEqual(body.expectedMomentIds);
  expect(frozen.annotations[0]!.tags).toEqual({"label.smart":"true", "label.fourth_wall":"true",note:"retained"});
  expect((await request(thoughtUrl,annotationBody(f.source,1,{note:"retained"}))).status).toBe(200);
  expect((await request(`${root(f.gameId)}/selection`,body)).status).toBe(409);
  expect((await request(`${root(f.gameId)}/selection/validate`,frozen)).status).toBe(200);
  expect((await request(`${root(f.gameId)}/selection/validate`,{...frozen,selection:{...selection,base:"full"}})).status).toBe(400);
});

test("a completed game cannot export a handcrafted descriptor from its previously valid paused prefix", async () => {
  const f = await wolf(); await producer();
  const boundary = f.events.findIndex((_event, index) => werewolfActionPlans(replayWerewolf(f.events.slice(0, index + 1)))
    .some(plan => plan.request.action === "pack_talk"));
  expect(boundary).toBeGreaterThan(0);
  const prefix = f.events.slice(0, boundary + 1), state = replayWerewolf(prefix);
  const scene = werewolfConversationScene(state, "pack_talk")!;
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, f.id));
  await db.insert(schema.werewolfEvents).values(prefix.map(event => ({ gameId: f.id, sequence: event.sequence, event })));
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visibility: "public", visualFailurePolicy: "require_visuals",
    visualPause: { kind: "werewolf", id: "studio-frozen-pause", boundarySequence: state.sequence, reason: "Fixture image repair",
      work: { kind: "scene", descriptor: scene } } }) }).where(eq(schema.games.id, f.id));
  const paused = await readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: true });
  const speech = paused.catalog.moments.find(moment => moment.kind === "speech")!;
  expect(paused.status).toBe("suspended"); expect(speech).toBeDefined();
  await db.insert(schema.werewolfEvents).values(f.events.slice(boundary + 1).map(event => ({ gameId: f.id, sequence: event.sequence, event })));
  await db.update(schema.games).set({ status: "completed", config: JSON.stringify({ visibility: "public" }) }).where(eq(schema.games.id, f.id));
  const pinned = await readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: true, snapshot: paused.snapshot });
  expect(pinned.snapshot.sourceHash).toBe(paused.snapshot.sourceHash);
  const prepared = await request(`${root(f.id)}/selection`, { snapshot: paused.snapshot, audience: "omniscient", thinking: true,
    selection: { mode: "ids", thinking: true, ids: [speech.id] }, expectedMomentIds: [speech.id], settings, copy: {} });
  expect(prepared.status).toBe(409);
  expect(await prepared.json()).toEqual({ error: "Export requires the complete accepted game history. Refresh the source." });
  const frozen: Omit<ProductionExportDescriptor, "hash"> = { schema: "house.production-selection", version: 1,
    gameId: f.id, gameKind: "werewolf", audience: "omniscient", sourceSnapshot: { ...paused.snapshot }, momentIds: [speech.id],
    selection: { mode: "ids", thinking: true, ids: [speech.id] }, settings, copy: {}, recordings: [],
    annotations: [{ momentId: speech.id, tags: {}, revision: 0 }] };
  const response = await request(`${root(f.id)}/selection/validate`, { ...frozen, hash: descriptorHash(frozen) });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Export requires the complete accepted game history. Refresh the source." });
});

test("recordings freeze only against selected authorized speech and its exact actor", async () => {
  const f = await influence(); await producer();
  const recording = { momentId: f.speech.id, messageId: f.speech.source.kind === "influence-transcript" ? f.speech.source.transcriptId : "",
    speakerId: f.speech.actorId!, textHash: createHash("sha256").update("Accepted original speech").digest("hex"),
    sha256: "a".repeat(64), durationMs: 1200 };
  const body = { snapshot: f.source.snapshot, audience: "public", thinking: true,
    selection: { mode: "ids", thinking: true, ids: [f.speech.id] }, expectedMomentIds: [f.speech.id], settings, copy: {} };
  for (const invalid of [{ ...recording, momentId: f.thought.id }, { ...recording, speakerId: "echo" }]) {
    const response = await request(`${root(f.gameId)}/selection`, { ...body, recordings: [invalid] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Recording does not match a selected authorized speech moment" });
  }
  const prepared = await request(`${root(f.gameId)}/selection`, { ...body, recordings: [recording] });
  expect(prepared.status).toBe(200);
  const descriptor = await prepared.json() as ProductionExportDescriptor;
  expect(descriptor.recordings).toEqual([recording]);
  expect(descriptor.annotations).toEqual([{ momentId: f.speech.id, tags: {}, revision: 0 }]);
  expect((await request(`${root(f.gameId)}/selection/validate`, descriptor)).status).toBe(200);
  const { hash: _hash, ...wrongSpeaker } = { ...descriptor, recordings: [{ ...recording, speakerId: "echo" }] };
  expect((await request(`${root(f.gameId)}/selection/validate`, { ...wrongSpeaker, hash: descriptorHash(wrongSpeaker) })).status).toBe(400);
});

test("Mystery source and handcrafted private keys cannot select or annotate private Werewolf moments", async () => {
  const f = await wolf(); await producer();
  const mystery = await readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false });
  const privateSource = await db.transaction(tx => buildWerewolfProductionSourceSnapshot(tx, f.id, { audience: "omniscient", thinking: true }), { isolationLevel: "repeatable read", accessMode: "read only" });
  const thought = privateSource.catalog.moments.find(moment => moment.kind === "thinking")!;
  expect(thought).toBeDefined();
  const publicResponse = await request(`${root(f.id)}/source?audience=mystery&thinking=off`); expect(publicResponse.status).toBe(200);
  const serialized = JSON.stringify(await publicResponse.json());
  for (const field of ["\"staging\"", "\"thinking\":\"", "\"reasoningContext\"", "\"pack_vote\""]) expect(serialized).not.toContain(field);
  expect((await request(`${root(f.id)}/source?audience=mystery&thinking=on`)).status).toBe(403);
  const unauthorizedAnnotation = await request(`${root(f.id)}/moments/${encodeURIComponent(thought.id)}/annotation`, { snapshot: mystery.snapshot, audience: "mystery", thinking: false, expectedRevision: 0, tags: { cut: "youtube" } });
  expect(unauthorizedAnnotation.status).toBe(400);
  const unauthorizedSelection = await request(`${root(f.id)}/selection`, { snapshot: mystery.snapshot, audience: "mystery", thinking: false,
    selection: { mode: "ids", thinking: false, ids: [thought.id] }, expectedMomentIds: [thought.id], settings, copy: {} });
  expect(unauthorizedSelection.status).toBe(400); expect(await db.select().from(schema.productionMomentAnnotations)).toEqual([]);
});

test("a validated paused source previews its fixed prefix while full export remains blocked", async () => {
  const gameId = await insertGame(db, { id: "paused-studio", status: "in_progress" });
  const ownerEpoch = await insertOwner(db, gameId);
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  await initializeGameExecutionAuthority(db, createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } }));
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visualMode: true, visualPause: { boundarySequence: 0, reason: "Fixture pending image" } }) }).where(eq(schema.games.id, gameId));
  await producer();
  const preview = await request(`${root(gameId)}/source?audience=public&thinking=on`); expect(preview.status).toBe(200);
  const page = await preview.json() as Awaited<ReturnType<typeof readInfluenceProductionSource>>;
  expect(page.snapshot.throughEventSequence).toBe(0); expect(page.snapshot.throughTurnSequence).toBe(0);
  const exported = await request(`${root(gameId)}/selection`, { snapshot: page.snapshot, audience: "public", thinking: true,
    selection: { mode: "full", thinking: true }, expectedMomentIds: [], settings, copy: {} });
  expect(exported.status).toBe(409); expect(await exported.json()).toMatchObject({ error: "Export requires a completed game; paused previews remain available" });
});

test("browser/export fixture seeds real API sources, independent selections and byte-free media", async () => {
  await producer();
  const fixture = await seedProductionStudioFixture(db);
  const existingProducer = await getPermissionsForUser(db, "operator");
  for (const permission of ["view_admin", "start_game", "manage_postgame_media"]) expect(existingProducer.permissions).not.toContain(permission);
  const response = await request(`${root(fixture.influence.id)}/source?audience=public&thinking=on`, undefined, fixture.producer.token);
  expect(response.status).toBe(200);
  const source = await response.json() as Awaited<ReturnType<typeof readInfluenceProductionSource>>;
  expect(source.game.gameKernel).toBe("format"); expect(source.catalog.moments.some(moment => moment.kind === "result")).toBe(true);
  expect(source.catalog.moments.find(moment => moment.id === fixture.influence.thoughtId)?.kind).toBe("thinking");
  expect(source.catalog.moments.find(moment => moment.id === fixture.influence.speechId)?.kind).toBe("speech");
  expect(source.visual.scenes).toHaveLength(1); expect(Object.keys(source.visual.fullBodies)).toHaveLength(9);
  expect((await request(`${root(fixture.influence.id)}/source?audience=public&thinking=on`, undefined, fixture.legacyVisual.token)).status).toBe(403);
  expect((await request(`${root(fixture.werewolf.id)}/source?audience=mystery&thinking=off`, undefined, fixture.producer.token)).status).toBe(200);
  expect((await request(`${root(fixture.werewolf.id)}/source?audience=omniscient&thinking=on`, undefined, fixture.producer.token)).status).toBe(200);
  expect((await request(`${root(fixture.pausedInfluence.id)}/source?audience=public&thinking=on`, undefined, fixture.producer.token)).status).toBe(200);
});
