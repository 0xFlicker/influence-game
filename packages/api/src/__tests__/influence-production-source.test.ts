import { storeFields } from "../services/payload-storage.js";
import { beforeEach, expect, test } from "bun:test";
import { Phase, type GameTurnIntentV1 } from "@influence/engine";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { and, eq, gt } from "drizzle-orm";
import sharp from "sharp";
import { schema, type DrizzleDB } from "../db/index.js";
import { buildInfluenceProductionSourceSnapshot, decodeInfluenceProductionSnapshot, readInfluenceProductionSource } from "../services/influence-production-source.js";
import { appendGameEvents } from "../services/game-events.js";
import { createInitialGameExecutionStateV1, initializeGameExecutionAuthority } from "../services/game-turn-commit.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { acceptVisualScene, prepareVisualScene, storeVisualArtifact } from "../services/visual-scene-store.js";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { createCanonicalEventFixture, createResolvedRoundCanonicalEventFixture, insertGame, insertOwner, withJuryWinner, withRetrospective, insertRetrospectiveTranscriptFixture } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });
async function fixture(id = "production-influence", resolved = true, duplicatePointer = false) {
  const gameId = await insertGame(db, { id, slug: id, status: "completed", config: { visualMode: true, privateConfig: "CONFIG_SENTINEL" } });
  await db.insert(schema.gamePlayers).values(["atlas", "echo", "mira", "nyx"].map(id => ({ id, gameId,
    persona: JSON.stringify({ name: id === "atlas" ? "Atlas" : id, personality: "Frozen character", avatarUrl: `/avatars/${id}.png` }), agentConfig: "{}" })));
  const ownerEpoch = await insertOwner(db, gameId);
  const events = withRetrospective(withJuryWinner(resolved ? createResolvedRoundCanonicalEventFixture(gameId) : createCanonicalEventFixture(gameId), "mira"), 1000);
  const statements = events.filter(event => event.type === "retrospective.statement_recorded");
  const altered = duplicatePointer ? events.map(event => event === statements[0] ? {...event,sourcePointers:[...event.sourcePointers,
    {...statements[1]!.sourcePointers[0]!,actorId:statements[0]!.payload.actorId}]} : event === statements[1] ? {...event,sourcePointers:[]} : event) : events;
  await appendGameEvents(db, { gameId, ownerEpoch, events:altered });
  await insertRetrospectiveTranscriptFixture(db, events);
  return { gameId, events, ownerEpoch };
}
async function dialogue(gameId: string, number: number, extra: Partial<typeof schema.transcripts.$inferInsert> = {}) {
  const [row] = await db.insert(schema.transcripts).values({ gameId, round: 1, phase: Phase.LOBBY, scope: "public", fromPlayerId: "atlas",
    text: `Speech ${number}`, thinking: number === 1 ? "Independent thought" : null, timestamp: number, ...extra }).returning();
  return row!;
}
async function asset(gameId: string, color = "#223344") {
  return storeVisualArtifact(db, gameId, await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer());
}
async function scene(gameId: string, image: string) {
  const row = await prepareVisualScene(db, { gameId, boundarySequence: 0, plan: planVisualScene({ roomId: "lobby", backgroundArtifactId: image,
    cast: [{ id: "atlas", name: "Atlas", referenceArtifactId: image, performanceInstructions: "Frozen" }] }) });
  return acceptVisualScene(db, { sceneId: row.id, planHash: row.planHash, imageArtifactId: image, anchors: [], verifiedParticipantIds: ["atlas"] });
}

test("complete retrospective catalog requires exact captured canonical speech and rejects substitution or absence", async () => {
  const {gameId, events} = await fixture();
  const source = await readInfluenceProductionSource(db, gameId), retrospective = source.catalog.moments.filter(moment => moment.purpose === "retrospective");
  expect(retrospective).toHaveLength(4);
  expect(retrospective.map(moment => moment.actorId)).toEqual(events.flatMap(event => event.type === "retrospective.statement_recorded" ? [event.payload.actorId] : []));
  expect(retrospective.every(moment => moment.kind === "speech" && moment.source.kind === "influence-transcript")).toBeTrue();
  const speech = source.messages.find(message => message.retrospectiveSource)!;
  await db.update(schema.transcripts).set({text: "Substituted text"}).where(eq(schema.transcripts.id, speech.id));
  await expect(readInfluenceProductionSource(db, gameId)).rejects.toThrow("canonical speech");
  await db.delete(schema.transcripts).where(eq(schema.transcripts.id, speech.id));
  await expect(readInfluenceProductionSource(db, gameId)).rejects.toThrow("missing its captured dialogue");
});

test("a completed Influence game that entered a retrospective still requires its completion proof", async () => {
  const { gameId, events } = await fixture();
  const started = events.find(event => event.type === "game.phase_entered" && event.payload.phase === Phase.RETROSPECTIVE)!;
  await db.delete(schema.gameEvents).where(and(eq(schema.gameEvents.gameId, gameId), gt(schema.gameEvents.sequence, started.sequence)));
  await expect(readInfluenceProductionSource(db, gameId)).rejects.toThrow("retrospective completion proof");
});

test("two dialogue pointers for one statement cannot conceal another statement's missing captured dialogue",async () => {
  const {gameId,events} = await fixture("duplicate-retrospective-pointer",true,true);
  const first = events.find(event => event.type === "retrospective.statement_recorded")!;
  if (first.type !== "retrospective.statement_recorded") throw new Error("Missing fixture statement");
  await db.update(schema.transcripts).set({fromPlayerId:first.payload.actorId,speakerPlayerId:first.payload.actorId,
    text:first.payload.speech,firstDurableEventSequence:first.sequence}).where(eq(schema.transcripts.entrySequence,1001));
  await expect(readInfluenceProductionSource(db,gameId)).rejects.toThrow("captured dialogue");
});

test("bounded source and moment pages share one accepted snapshot and independent thought identity", async () => {
  const { gameId, events } = await fixture();
  const firstRow = await dialogue(gameId, 1);
  await dialogue(gameId, 2); await dialogue(gameId, 3); await dialogue(gameId, 4);
  const first = await readInfluenceProductionSource(db, gameId, { limit: 2 });
  expect(first.frames).toHaveLength(2); expect(first.messages).toHaveLength(2); expect(first.catalog.moments.length).toBeLessThanOrEqual(2);
  expect(first.snapshot.throughEventSequence).toBe(events.at(-1)!.sequence);
  expect(first.nextSequence).toBe(2); expect(first.nextMessageOffset).toBe(2);
  const second = await readInfluenceProductionSource(db, gameId, { limit: 2, snapshot: first.snapshot, afterSequence: first.nextSequence!, offset: first.nextMessageOffset!, catalogOffset: first.nextCatalogOffset! });
  expect(second.snapshot).toEqual(first.snapshot); expect(second.messages.map(row => row.text)).toEqual(["Speech 3", "Speech 4"]);
  expect(second.frames.map(row => row.sequence)).toEqual([3, 4]);
  const full = await db.transaction(tx => buildInfluenceProductionSourceSnapshot(tx, gameId, { snapshot: first.snapshot }), { isolationLevel: "repeatable read", accessMode: "read only" });
  const responseMoments = full.catalog.moments.filter(moment => moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(firstRow.id));
  expect(responseMoments.map(moment => moment.kind)).toEqual(["thinking", "speech"]);
  expect(responseMoments[0]!.id).not.toBe(responseMoments[1]!.id);
  await expect(readInfluenceProductionSource(db, gameId, { limit: 257 })).rejects.toThrow("1 to 256");
  await expect(readInfluenceProductionSource(db, gameId, { offset: -1 })).rejects.toThrow("page position");
});

test("late transcript/evidence and copy edits cannot advance or invalidate the pinned accepted source", async () => {
  const { gameId, events } = await fixture();
  await dialogue(gameId, 1);
  await db.insert(schema.gameEpisodePresentations).values({ gameId, title: "Original copy", status: "ready" });
  const first = await readInfluenceProductionSource(db, gameId);
  await dialogue(gameId, 2, { text: "LATE_SPEECH" });
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields({ id: "late", gameId, eventSequence: events[0]!.sequence, actorRole: "player", actorPlayerId: "atlas",
    artifactType: "thinking", action: "intro", payload: { thinking: "LATE_THOUGHT" }, payloadByteLength: 32, createdAt: new Date(Date.parse(first.snapshot.acceptedCutoff) + 1).toISOString() }, {"payload":"json-gzip"}));
  await db.update(schema.gameEpisodePresentations).set({ title: "Updated copy" }).where(eq(schema.gameEpisodePresentations.gameId, gameId));
  const pinned = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot });
  expect(pinned.snapshot).toEqual(first.snapshot); expect(pinned.title).toBe("Updated copy");
  expect(JSON.stringify(pinned)).not.toContain("LATE_SPEECH"); expect(JSON.stringify(pinned)).not.toContain("LATE_THOUGHT");
  const refreshed = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot, refreshVisuals: true });
  expect(refreshed.snapshot.acceptedSourceHash).toBe(first.snapshot.acceptedSourceHash);
  expect(refreshed.snapshot.transcriptPrefix).toEqual(first.snapshot.transcriptPrefix); expect(refreshed.snapshot.throughEventSequence).toBe(first.snapshot.throughEventSequence);
  expect(JSON.stringify(refreshed)).not.toContain("LATE_SPEECH"); expect(JSON.stringify(refreshed)).not.toContain("LATE_THOUGHT");
});

test("source allowlists accepted thinking and omits raw reasoning, scratch transcript and configuration", async () => {
  const { gameId, events, ownerEpoch } = await fixture();
  await dialogue(gameId, 1);
  const execution = createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } });
  const intent: GameTurnIntentV1 = { version: 1, gameId, turnId: "uncommitted", turnSequence: 1, seed: "fixture", baseHeads: execution.heads,
    branch: { version: 1, kind: "engine", action: "round_start" }, actorIds: [], targetIds: [], handles: [], participantIds: [], providerSubcalls: [] };
  await db.insert(schema.gameTurns).values(await storeFields({ id: intent.turnId, gameId, turnSequence: 1, plannedOwnerEpoch: ownerEpoch,
    baseEventSequence: 0, baseDialogueSequence: 0, basePublicationSequence: 0, intent, intentHash: `sha256:${"a".repeat(64)}`, status: "planned" }, {"intent":"json-gzip","commitResult":"json-gzip"}));
  await dialogue(gameId, 2, { gameTurnId: "uncommitted", gameTurnTranscriptOrdinal: 1, text: "SCRATCH_SPEECH" });
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields([
    { id: "accepted", gameId, eventSequence: events[0]!.sequence, actorRole: "player", actorPlayerId: "atlas", artifactType: "thinking", action: "intro",
      payload: { thinking: "Accepted extra thought", reasoningContext: "NATIVE_CONTEXT", providerRequest: "RAW_REQUEST" }, payloadByteLength: 100, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "pending", gameId, eventSequence: null, actorRole: "player", actorPlayerId: "atlas", artifactType: "thinking", action: "pending", payload: { thinking: "PENDING_THOUGHT" }, payloadByteLength: 50 },
    { id: "native", gameId, eventSequence: events[0]!.sequence, actorRole: "player", actorPlayerId: "atlas", artifactType: "reasoning", action: "intro", payload: { reasoningContext: "RAW_REASONING" }, payloadByteLength: 50 },
  ], {"payload":"json-gzip"}));
  const source = await readInfluenceProductionSource(db, gameId);
  expect(source.acceptedThoughts.map(thought => thought.thinking)).toEqual(["Accepted extra thought"]);
  expect(source.catalog.moments.some(moment => moment.source.kind === "influence-event" && moment.kind === "thinking" && moment.defaultIncluded === false)).toBe(true);
  const json = JSON.stringify(source);
  for (const text of ["NATIVE_CONTEXT", "RAW_REQUEST", "PENDING_THOUGHT", "RAW_REASONING", "SCRATCH_SPEECH", "CONFIG_SENTINEL", "currentAgent\":{"]) expect(json).not.toContain(text);
});

test("exact decision provenance attaches accepted thinking to a speech sibling without event duplication", async () => {
  const { gameId, events } = await fixture();
  const row = await dialogue(gameId, 1, { thinking: null, entrySequence: 1, speakerPlayerId: "atlas", audiencePlayerIds: [], captureVersion: 1,
    firstDurableEventSequence: events[0]!.sequence, safeContext: { version: 1, decisionId: "accepted-response" } });
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields({ id: "accepted-response-thought", gameId, eventSequence: events[0]!.sequence, decisionId: "accepted-response",
    actorRole: "player", actorPlayerId: "atlas", artifactType: "thinking", action: "intro", payload: { thinking: "Exactly accepted" }, payloadByteLength: 50, createdAt: "2026-01-01T00:00:00.000Z" }, {"payload":"json-gzip"}));
  const source = await readInfluenceProductionSource(db, gameId);
  expect(source.messages[0]!.thinking).toBe("Exactly accepted"); expect(source.acceptedThoughts).toEqual([]);
  expect(source.catalog.moments.filter(moment => moment.source.kind === "influence-transcript" && moment.source.transcriptId === String(row.id)).map(moment => moment.kind)).toEqual(["thinking", "speech"]);
  await db.update(schema.gameCognitiveArtifacts).set({ actorPlayerId: "echo" }).where(eq(schema.gameCognitiveArtifacts.id, "accepted-response-thought"));
  await expect(readInfluenceProductionSource(db, gameId)).rejects.toThrow("inconsistent actor provenance");
});

test("unrevealed accepted sealed-ballot thinking never enters source pages", async () => {
  const { gameId, events } = await fixture("sealed-influence", false);
  const vote = events.find(event => event.type === "vote.cast")!;
  await db.insert(schema.gameCognitiveArtifacts).values(await storeFields({ id: "sealed-thought", gameId, eventSequence: vote.sequence, actorRole: "player", actorPlayerId: "atlas",
    artifactType: "thinking", action: "vote", payload: { thinking: "SEALED_THOUGHT" }, payloadByteLength: 30, createdAt: "2026-01-01T00:00:00.000Z" }, {"payload":"json-gzip"}));
  const source = await readInfluenceProductionSource(db, gameId);
  expect(source.acceptedThoughts).toEqual([]); expect(JSON.stringify(source)).not.toContain("SEALED_THOUGHT");
});

test("pinned absent cast references and scene availability survive later backfill until explicit visual refresh", async () => {
  const { gameId } = await fixture(); await dialogue(gameId, 1);
  const first = await readInfluenceProductionSource(db, gameId);
  expect(first.visual.scenes).toEqual([]); expect(first.visual.fullBodies).toEqual({});
  const image = await asset(gameId), savedScene = await scene(gameId, image);
  await db.insert(schema.visualGameAssets).values({ gameId, profiles: [], cast: [{ id: "atlas", name: "Atlas", referenceArtifactId: image, portraitFallback: false, performanceInstructions: "Frozen" }], portraits: { atlas: image } });
  const pinned = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot });
  expect(pinned.snapshot).toEqual(first.snapshot); expect(pinned.visual.scenes).toEqual([]); expect(pinned.visual.fullBodies).toEqual({}); expect(pinned.visual.portraits).toEqual({});
  const refreshed = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot, refreshVisuals: true });
  expect(refreshed.snapshot.acceptedSourceHash).toBe(first.snapshot.acceptedSourceHash);
  expect(refreshed.visual.scenes.map(row => row.id)).toEqual([savedScene.id]);
  expect(refreshed.visual.fullBodies.atlas).toEndWith(image); expect(refreshed.visual.portraits.atlas).toEndWith(image);
  expect((await readInfluenceProductionSource(db, gameId, { snapshot: refreshed.snapshot })).snapshot).toEqual(refreshed.snapshot);
});

test("public and producer readers keep hidden-game media permission boundaries separate", async () => {
  const { gameId } = await fixture(); await dialogue(gameId, 1);
  const image = await asset(gameId); await scene(gameId, image);
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, gameId));
  expect((await readViewerMedia(db, gameId)).scenes).toEqual([]);
  const source = await readInfluenceProductionSource(db, gameId);
  expect(source.visual.scenes).toHaveLength(1); expect(source.visual.scenes[0]!.imageUrl).toContain("/api/admin/production/games/");
  const serialized = JSON.stringify(source);
  for (const secret of ["performanceInstructions", "backgroundArtifactId", "image\":", "agentConfig", "privateConfig"]) expect(serialized).not.toContain(secret);
});

test("visual publications pin exact original or numbered versions without automatic adoption", async () => {
  const { gameId } = await fixture(); await dialogue(gameId, 1);
  const image = await asset(gameId), saved = await scene(gameId, image);
  const first = await readInfluenceProductionSource(db, gameId);
  const changed = await asset(gameId, "#887766"), publishedAt = new Date().toISOString();
  await db.insert(schema.visualMediaVersions).values({ id: "fixed-version", gameId, sceneId: saved.id, version: 1, plan: saved.plan,
    imageArtifactId: changed, annotatedArtifactId: changed, localization: { count: 1, verifiedParticipantIds: ["atlas"], anchors: [] }, verificationVersion: "fixture", createdAt: publishedAt });
  await db.insert(schema.visualMediaPublications).values({ id: "fixed-publication", gameId, sceneId: saved.id, versionId: "fixed-version", revision: 1, operatorId: "fixture", createdAt: publishedAt });
  const pinned = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot });
  expect(pinned.visual.scenes[0]!.imageUrl).toEndWith(image); expect(pinned.visual.scenes[0]!.publicationRevision).toBe(0); expect(pinned.snapshot).toEqual(first.snapshot);
  const refreshed = await readInfluenceProductionSource(db, gameId, { snapshot: first.snapshot, refreshVisuals: true });
  expect(refreshed.visual.scenes[0]).toMatchObject({ mediaVersionId: "fixed-version", publicationRevision: 1 }); expect(refreshed.visual.scenes[0]!.imageUrl).toEndWith(changed);
  expect(refreshed.snapshot.sourceHash).not.toBe(first.snapshot.sourceHash);
});

test("validated visual pause freezes the accepted turn and excludes pending work", async () => {
  const gameId = await insertGame(db, { id: "paused", status: "in_progress" });
  const ownerEpoch = await insertOwner(db, gameId);
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  await initializeGameExecutionAuthority(db, createInitialGameExecutionStateV1({ gameId, ownerEpoch, xstateSnapshot: { value: "lobby" }, cursor: { version: 1, kind: "phase_enter", actor: "lobby" } }));
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visualMode: true, visualPause: { boundarySequence: 0, reason: "PRIVATE_PAUSE" } }) }).where(eq(schema.games.id, gameId));
  await dialogue(gameId, 1, { text: "PENDING_DRAFT" });
  const source = await readInfluenceProductionSource(db, gameId);
  expect(source.snapshot.throughTurnSequence).toBe(0); expect(source.snapshot.throughEventSequence).toBe(0); expect(source.frames).toEqual([]); expect(source.messages).toEqual([]);
  expect(JSON.stringify(source)).not.toContain("PRIVATE_PAUSE"); expect(JSON.stringify(source)).not.toContain("PENDING_DRAFT");
  await db.update(schema.games).set({ config: JSON.stringify({ visualMode: true, visualPause: { boundarySequence: 999, reason: "Forged" } }) }).where(eq(schema.games.id, gameId));
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: source.snapshot })).rejects.toThrow("validated visual pause");
});

test.each(["waiting", "in_progress", "cancelled", "suspended"] as const)("%s games do not acquire source authority", async status => {
  const gameId = await insertGame(db, { status });
  await expect(readInfluenceProductionSource(db, gameId)).rejects.toThrow("validated visual pause");
});

test("forged game, audience, head, hash and reference snapshots cannot enter a source", async () => {
  const { gameId } = await fixture(); await dialogue(gameId, 1);
  const first = await readInfluenceProductionSource(db, gameId);
  expect(() => decodeInfluenceProductionSnapshot({ ...first.snapshot, audience: "mystery" })).toThrow("Invalid Influence");
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: { ...first.snapshot, gameId: "another" } })).rejects.toThrow("another game");
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: { ...first.snapshot, throughEventSequence: 99999 } })).rejects.toThrow("accepted event prefix");
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: { ...first.snapshot, sourceHash: `sha256:${"0".repeat(64)}` } })).rejects.toThrow("production source changed");
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: { ...first.snapshot, mediaReferences: { ...first.snapshot.mediaReferences, fullBodies: { atlas: "https://example.test/forged.png" } } } })).rejects.toThrow("frozen reference");
  await expect(readInfluenceProductionSource(db, gameId, { snapshot: { ...first.snapshot, acceptedSourceHash: `sha256:${"0".repeat(64)}` }, refreshVisuals: true })).rejects.toThrow("accepted source changed");
});
