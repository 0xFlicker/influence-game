import { storeFields } from "../services/payload-storage.js";
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { completedWerewolfResultsFixture as werewolfResultsFixture, completedCurrentWerewolfFixture } from "@influence/engine/fixtures/werewolf-results";
import { replayWerewolf, werewolfActionPlans } from "@influence/engine/werewolf";
import { werewolfConversationScene } from "@influence/engine/werewolf/visual-scenes";
import { projectWerewolfProductionWatch } from "@influence/engine/werewolf/watch";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { resolveProductionMomentIds } from "@influence/engine/production-moments";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import { buildWerewolfProductionSourceSnapshot, decodeWerewolfProductionSnapshot, readWerewolfProductionCatalog, readWerewolfProductionCharacter, readWerewolfProductionMedia, readWerewolfProductionSource } from "../services/werewolf-production-source.js";
import { readWerewolfWatch } from "../services/werewolf-presentation.js";
import { sha256StableJson } from "../services/stable-hash.js";
import { WEREWOLF_AUTO_PUBLISHER } from "../services/werewolf-production.js";

let db: DrizzleDB;
beforeEach(async () => { db = await setupTestDB(); });

async function fixture() {
  const id = "production-werewolf";
  const events = await werewolfResultsFixture("saved", id, 2);
  await db.insert(schema.games).values({ id, slug: `${id}-slug`, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: '{"visibility":"public"}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  return { id, events };
}

test("production Studio source reads fresh v9 history without applying legacy thread rules", async () => {
  const id = "production-werewolf-v9", events = await completedCurrentWerewolfFixture(id);
  await db.insert(schema.games).values({ id, slug: `${id}-slug`, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: '{"visibility":"public","rulesVersion":9}' });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  const source = await readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false });
  expect(source.window.rulesVersion).toBe(9);
  expect(source.window.moments.some(moment => moment.entry.kind === "conversation")).toBe(true);
  expect(source.window.moments.some(moment => moment.entry.kind === "ballot")).toBe(true);
  expect(source.window.moments.some(moment => moment.entry.kind === "proposal")).toBe(false);
});

test("bounded Werewolf pages reproduce the complete shared catalog with each accepted thought and no staging", async () => {
  const { id } = await fixture();
  const complete = await db.transaction(tx => buildWerewolfProductionSourceSnapshot(tx, id, { audience: "omniscient", thinking: true }), { isolationLevel: "repeatable read", accessMode: "read only" });
  expect(complete.window.latestCursor).toBeGreaterThan(64);
  let fromCursor = 1;
  const ids: string[] = [], thoughts: typeof complete.thoughts = [];
  while (true) {
    const page = await readWerewolfProductionSource(db, id, { audience: "omniscient", thinking: true, snapshot: complete.snapshot, fromCursor, limit: 7 });
    expect(page.window.moments.length).toBeLessThanOrEqual(7);
    expect(page.provenance.every(row => row.cursor >= fromCursor && row.cursor <= page.window.throughCursor)).toBe(true);
    expect(page.thoughts.every(row => row.cursor >= fromCursor && row.cursor <= page.window.throughCursor)).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(/"staging"|"performanceInstructions"|"strategy"|acceptedValue|semanticCoordinate|"bytes"/);
    ids.push(...page.catalog.moments.map(moment => moment.id)); thoughts.push(...page.thoughts);
    if (page.nextCursor === null) break;
    fromCursor = page.nextCursor;
  }
  expect(ids).toEqual(complete.catalog.moments.map(moment => moment.id));
  expect(thoughts).toEqual(complete.thoughts);
  const revealCounts = new Map<number, number>();
  for (const thought of thoughts) revealCounts.set(thought.cursor, (revealCounts.get(thought.cursor) ?? 0) + 1);
  expect([...revealCounts.values()].some(count => count > 1)).toBe(true);
  expect(new Set(thoughts.map(thought => thought.eventSequence)).size).toBe(thoughts.length);
  await expect(readWerewolfProductionSource(db, id, { audience: "omniscient", thinking: true, limit: 65 })).rejects.toThrow("window");
});

test("Mystery excludes every private thought, pack ballot and night action, including crafted references", async () => {
  const { id } = await fixture();
  const mystery = await readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false });
  expect(mystery.thoughts).toEqual([]);
  expect(JSON.stringify(mystery)).not.toMatch(/SECRET_|"night"\s*:\s*\{|"thinking"\s*:\s*"|"part"\s*:\s*\{"kind":"(?:thinking|pack_vote|protect|investigate|hunt)"/);
  const omniscient = await readWerewolfProductionCatalog(db, id, { audience: "omniscient", thinking: true });
  const privateId = omniscient.catalog.moments.find(moment => moment.kind === "thinking")!.id;
  expect(() => resolveProductionMomentIds(mystery.catalog, [privateId])).toThrow();
  await expect(readWerewolfProductionSource(db, id, { audience: "mystery", thinking: true })).rejects.toThrow("Omniscient");
  await expect(readWerewolfProductionSource(db, id, { audience: "omniscient", thinking: false, snapshot: mystery.snapshot })).rejects.toThrow("snapshot");
});

test("source pin survives mutable copy and later publications, while fixed versions and artifact hashes remain exact", async () => {
  const f = await fixture();
  const moment = projectWerewolfProductionWatch(f.events, "mystery").moments.find(moment => moment.staging.roomId && moment.staging.purpose === "village")!;
  const members = moment.staging.participantIds.map(id => ({ id, name: id, referenceArtifactId: "old-art", performanceInstructions: "PRIVATE_RENDER_INSTRUCTIONS" }));
  const plan = { ...planVisualScene({ roomId: moment.staging.roomId!, backgroundArtifactId: null, cast: members }), direction: { purpose: "werewolf-village" as const, revision: "fixture", style: "", roomName: "Village", roomDirection: "" } };
  for (const id of ["old-art", "new-art"]) await db.insert(schema.visualArtifacts).values(await storeFields({ id, gameId: f.id, contentHash: id, image: Buffer.from(id), width: 1, height: 1 }, {"image":"binary"}));
  await db.insert(schema.visualScenes).values({ id: "scene", gameId: f.id, roomId: plan.roomId, boundarySequence: moment.staging.boundary, plan, planHash: sha256StableJson(plan) });
  const publish = async (version: number, at: string, operatorId: string) => {
    const artifact = version === 1 ? "old-art" : "new-art";
    await db.insert(schema.visualMediaVersions).values({ id: `version-${version}`, gameId: f.id, sceneId: "scene", version, plan, imageArtifactId: artifact, annotatedArtifactId: artifact, localization: { count: members.length, verifiedParticipantIds: members.map(member => member.id), anchors: [] }, verificationVersion: "fixture", createdAt: at });
    await db.insert(schema.visualMediaPublications).values({ id: `publication-${version}`, gameId: f.id, sceneId: "scene", versionId: `version-${version}`, revision: version, operatorId, createdAt: at });
  };
  await publish(1, "2026-09-01T00:00:00.000Z", WEREWOLF_AUTO_PUBLISHER);
  const pinned = await readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false });
  expect(Object.values(pinned.window.media)[0]!.imageUrl).toContain("/source/media/old-art?snapshot=");
  expect((await readWerewolfProductionMedia(db, f.id, "old-art", { snapshot: pinned.snapshot })).bytes).toEqual(new Uint8Array(Buffer.from("old-art")));
  const after = new Date(Date.parse(pinned.snapshot.publicationCutoff) + 1).toISOString();
  await publish(2, after, "operator");
  await db.update(schema.games).set({ config: '{"visibility":"public","visualRecoveryPublications":["publication-2"]}' }).where(eq(schema.games.id, f.id));
  await db.insert(schema.gameEpisodePresentations).values({ gameId: f.id, title: "New episode copy", description: "This is frozen separately by selection." });
  const reread = await readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false, snapshot: pinned.snapshot });
  expect(reread.snapshot).toEqual(pinned.snapshot);
  expect(Object.values(reread.window.media)[0]!.version).toBe(1);
  expect((await readWerewolfProductionMedia(db, f.id, "old-art", { snapshot: pinned.snapshot })).bytes).toEqual(new Uint8Array(Buffer.from("old-art")));
  await expect(readWerewolfProductionMedia(db, f.id, "new-art", { snapshot: pinned.snapshot })).rejects.toThrow("not available");
  // Existing live replay keeps its deliberate recovery override.
  expect(Object.values((await readWerewolfWatch(db, f.id, "mystery", 1, 64, pinned.snapshot.publicationCutoff)).media)[0]!.version).toBe(2);
  const refreshed = await readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false, snapshot: pinned.snapshot, refreshVisuals: true });
  expect(refreshed.snapshot.throughEventSequence).toBe(pinned.snapshot.throughEventSequence);
  expect(refreshed.snapshot.throughCursor).toBe(pinned.snapshot.throughCursor);
  expect(refreshed.snapshot.sourceHash).not.toBe(pinned.snapshot.sourceHash);
  expect(Object.values(refreshed.window.media)[0]!.version).toBe(2);
  await db.update(schema.visualArtifacts).set({ contentHash: "changed" }).where(eq(schema.visualArtifacts.id, "old-art"));
  await expect(readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false, snapshot: pinned.snapshot })).rejects.toThrow("snapshot changed");
});

test("paused previews validate the canonical frontier and keep the fixed accepted prefix", async () => {
  const f = await fixture();
  const boundary = f.events.findIndex((_event, index) => werewolfActionPlans(replayWerewolf(f.events.slice(0, index + 1))).some(plan => plan.request.action === "pack_talk"));
  expect(boundary).toBeGreaterThan(0);
  const prefix = f.events.slice(0, boundary + 1), state = replayWerewolf(prefix);
  const descriptor = werewolfConversationScene(state, "pack_talk")!;
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, f.id));
  await db.insert(schema.werewolfEvents).values(prefix.map(event => ({ gameId: f.id, sequence: event.sequence, event })));
  const pause = { kind: "werewolf", id: "pause", boundarySequence: state.sequence, reason: "Fixture repair", work: { kind: "scene", descriptor } };
  await db.update(schema.games).set({ status: "suspended", config: JSON.stringify({ visibility: "public", visualFailurePolicy: "require_visuals", visualPause: pause }) }).where(eq(schema.games.id, f.id));
  const pinned = await readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: true });
  expect(pinned.window.visualPaused).toBe(true);
  expect(pinned.snapshot.throughEventSequence).toBe(state.sequence);
  expect(pinned.window.moments.some(moment => moment.entry.kind === "result")).toBe(false);
  await db.update(schema.games).set({ config: JSON.stringify({ visibility: "public", visualPause: { ...pause, boundarySequence: state.sequence - 1 } }) }).where(eq(schema.games.id, f.id));
  await expect(readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: true, snapshot: pinned.snapshot })).rejects.toThrow("boundary changed");
  await db.update(schema.games).set({ status: "in_progress" }).where(eq(schema.games.id, f.id));
  await expect(readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: false })).rejects.toThrow("validated visual pause");
});

test("handcrafted stale or future source descriptors and unavailable completed sources fail closed", async () => {
  const f = await fixture();
  const source = await readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false });
  for (const snapshot of [{ ...source.snapshot, gameId: "another-game" }, { ...source.snapshot, throughCursor: source.snapshot.throughCursor + 1 }, { ...source.snapshot, sourceHash: `sha256:${"0".repeat(64)}` }, { ...source.snapshot, publicationCutoff: "2999-01-01T00:00:00.000Z" }]) {
    await expect(readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false, snapshot })).rejects.toThrow();
  }
  await db.delete(schema.werewolfEvents).where(eq(schema.werewolfEvents.sequence, f.events.at(-1)!.sequence));
  await expect(readWerewolfProductionSource(db, f.id, { audience: "mystery", thinking: false })).rejects.toThrow("retrospective completion proof");
});

test("producer source keeps existing hidden-game access without broadening public watch", async () => {
  const f = await fixture();
  await db.update(schema.games).set({ hiddenAt: new Date().toISOString() }).where(eq(schema.games.id, f.id));
  const source = await readWerewolfProductionSource(db, f.id, { audience: "omniscient", thinking: true });
  expect(source.thoughts.length).toBeGreaterThan(0);
  expect(source.window.players[0]!.avatarUrl).toContain("/source/characters/");
  await expect(readWerewolfWatch(db, f.id, "omniscient", 1, 64)).rejects.toThrow("not found");
});

test("snapshot decoder is exact and restored missing frozen character assets require an explicit refresh", async () => {
  const id = "restored-reference", events = await werewolfResultsFixture("saved", id);
  const started = events[0]!;
  if (started.type !== "werewolf.started") throw new Error("Fixture requires a start event");
  const player = started.payload.players[0]!;
  player.agentProfileId = "frozen-profile"; player.contentRevisionId = "frozen-revision";
  await db.insert(schema.users).values({ id: "owner" });
  await db.insert(schema.agentContentRevisions).values(await storeFields({ id: "frozen-revision", agentProfileId: "frozen-profile", userId: "owner", fingerprint: "fixture", snapshot: { avatarUrl: "frozen-portrait", fullBodyReferenceUrl: "frozen-body", assets: { "frozen-portrait": "portrait-hash", "frozen-body": "body-hash" } } }, {"snapshot":"json-gzip"}));
  await db.insert(schema.agentContentAssets).values(await storeFields({ hash: "portrait-hash", bytes: Buffer.from("portrait") }, {"bytes":"binary"}));
  await db.insert(schema.games).values({ id, slug: id, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00.000Z", config: "{}" });
  await db.insert(schema.werewolfEvents).values(events.map(event => ({ gameId: id, sequence: event.sequence, event })));
  const pinned = await readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false });
  expect(decodeWerewolfProductionSnapshot(JSON.parse(JSON.stringify(pinned.snapshot)))).toEqual(pinned.snapshot);
  expect(pinned.snapshot.availableCharacterAssets).toEqual(["portrait-hash"]);
  expect(pinned.window.players[0]!.fullBodyReferenceUrl).toBeNull();
  for (const value of [null, [], { ...pinned.snapshot, extra: true }, { ...pinned.snapshot, thinking: "false" }, { ...pinned.snapshot, throughCursor: "1" }, { ...pinned.snapshot, availableCharacterAssets: ["portrait-hash", "portrait-hash"] }]) expect(() => decodeWerewolfProductionSnapshot(value)).toThrow("snapshot");
  await db.insert(schema.agentContentAssets).values(await storeFields({ hash: "body-hash", bytes: Buffer.from("body") }, {"bytes":"binary"}));
  const reread = await readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false, snapshot: pinned.snapshot });
  expect(reread.snapshot).toEqual(pinned.snapshot);
  expect(reread.window.players[0]!.fullBodyReferenceUrl).toBeNull();
  await expect(readWerewolfProductionCharacter(db, id, player.id, { snapshot: pinned.snapshot, image: "body" })).rejects.toThrow("unavailable");
  expect((await readWerewolfProductionCharacter(db, id, player.id, { snapshot: pinned.snapshot })).bytes).toEqual(new Uint8Array(Buffer.from("portrait")));
  const refreshed = await readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false, snapshot: pinned.snapshot, refreshVisuals: true });
  expect(refreshed.snapshot.throughEventSequence).toBe(pinned.snapshot.throughEventSequence);
  expect(refreshed.snapshot.availableCharacterAssets).toEqual(["body-hash", "portrait-hash"]);
  expect(refreshed.window.players[0]!.fullBodyReferenceUrl).toContain("image=body");
  expect((await readWerewolfProductionCharacter(db, id, player.id, { snapshot: refreshed.snapshot, image: "body" })).bytes).toEqual(new Uint8Array(Buffer.from("body")));
  await expect(readWerewolfProductionSource(db, id, { audience: "mystery", thinking: false, snapshot: { ...pinned.snapshot, availableCharacterAssets: ["arbitrary-ref"] } })).rejects.toThrow("immutable game-start");
});
