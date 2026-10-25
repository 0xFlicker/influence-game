import {beforeEach, expect, test} from "bun:test";
import {eq} from "drizzle-orm";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema, type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {previewAudioTrack, queueAudioBackfill, runAudioTrack, retryAudioTrack} from "../services/audio-tracks.js";
import {prepareRetrospectiveRetake, queueRetrospectiveRetake, readRetrospectivePresentation} from "../services/retrospective-retakes.js";
import {readAudioPublication} from "../services/audio-publication.js";
import {readWerewolfWatch} from "../services/werewolf-presentation.js";
import {buildWerewolfProductionSourceSnapshot} from "../services/werewolf-production-source.js";
import {readJson} from "../services/payload-storage.js";
import type {AudioProvider} from "../services/audio-provider.js";

let db: DrizzleDB;
beforeEach(async () => {db = await setupTestDB();});
const provider: AudioProvider = async recipe => ({bytes: new TextEncoder().encode(recipe.synthesisText), durationMs: 1000, evidence: {fixture: true}});

async function fixture() {
  const gameId = "retake-test", events = await completedCurrentWerewolfFixture(gameId, 10);
  await db.insert(schema.users).values({id: "operator"});
  await db.insert(schema.games).values({id: gameId, slug: gameId, gameKind: "werewolf", status: "completed", startedAt: "2026-09-01T00:00:00Z", config: '{"visibility":"public"}'});
  await db.insert(schema.werewolfEvents).values(events.map(event => ({gameId, sequence: event.sequence, event})));
  const preview = await previewAudioTrack(db, gameId);
  const trackId = await queueAudioBackfill(db, gameId, "operator", preview.previewHash);
  await runAudioTrack(db, provider, undefined, trackId);
  const original = events.find(event => event.type === "werewolf.retrospective_statement_recorded");
  if (original?.type !== "werewolf.retrospective_statement_recorded") throw new Error("Missing retrospective fixture");
  const state = await prepareRetrospectiveRetake(db, gameId, original.payload.actorId);
  const document = {version: 1 as const, context: state.context, catalogId: "fixture", speech: "I trusted the wrong argument. Next time I will test the evidence before committing my vote.", evidence: [{fixture: true}]};
  const request = {gameId, actorId: state.actorId, previewHash: state.previewHash, document, userId: "operator"};
  return {gameId, events, original, state, request, trackId};
}

test("retake publishes speech and one new recording together, retaining canonical originals and pinned presentations", async () => {
  const f = await fixture();
  const originalRows = await db.select().from(schema.werewolfEvents);
  const oldVersions = await db.select().from(schema.gameAudioVersions);
  const pin = await buildWerewolfProductionSourceSnapshot(db, f.gameId, {audience: "omniscient", thinking: true});
  const receipt = await queueRetrospectiveRetake(db, f.request);
  expect(receipt.generatedClips).toBe(1);
  expect(await readRetrospectivePresentation(db, f.gameId, f.events, new Date().toISOString())).toHaveLength(0);
  expect((await readAudioPublication(db, f.gameId, "omniscient", true))!.id).toBe(f.trackId);
  let calls = 0;
  await runAudioTrack(db, async recipe => {calls++; expect(recipe.text).toBe(f.request.document.speech); return provider(recipe);}, undefined, receipt.trackId);
  expect(calls).toBe(1);
  const presentation = await readRetrospectivePresentation(db, f.gameId, f.events, new Date().toISOString());
  expect(presentation.get(f.original.sequence)?.speech).toBe(f.request.document.speech);
  for (const audience of ["mystery", "omniscient"] as const) {
    const source = await buildWerewolfProductionSourceSnapshot(db, f.gameId, {audience, thinking: audience === "omniscient"});
    const moment = source.window.moments.find(moment => moment.retrospectiveRetakeId === receipt.retakeId)!;
    expect(moment.entry.kind === "speech" && moment.entry.text).toBe(f.request.document.speech);
    const watch = await readWerewolfWatch(db, f.gameId, audience, moment.cursor, 1);
    expect(watch.moments[0]!.entry).toEqual(moment.entry);
    const publication = (await readAudioPublication(db, f.gameId, audience, true && audience === "omniscient", true))!;
    expect(publication.id).toBe(receipt.trackId);
    expect(JSON.stringify(source)).not.toContain('"evidence"');
  }
  const historical = await buildWerewolfProductionSourceSnapshot(db, f.gameId, {audience: "omniscient", thinking: true, snapshot: pin.snapshot});
  expect(historical.window).toEqual(pin.window);
  expect(await db.select().from(schema.werewolfEvents)).toEqual(originalRows);
  for (const version of oldVersions) expect((await db.select().from(schema.gameAudioVersions).where(eq(schema.gameAudioVersions.id, version.id)))[0]).toEqual(version);
  const [saved] = await db.select().from(schema.productionRetrospectiveRetakes);
  expect(await readJson(saved!.document)).toEqual(f.request.document);
  await expect(queueRetrospectiveRetake(db, f.request)).rejects.toThrow("source changed");
}, 30000);

test("invalid source and failed TTS cannot replace the original; retry publishes the retained candidate", async () => {
  const f = await fixture();
  await expect(queueRetrospectiveRetake(db, {...f.request, document: {...f.request.document, speech: ""}})).rejects.toThrow("contract");
  await expect(queueRetrospectiveRetake(db, {...f.request, previewHash: "stale"})).rejects.toThrow("source changed");
  expect(await db.select().from(schema.productionRetrospectiveRetakes)).toHaveLength(0);
  const receipt = await queueRetrospectiveRetake(db, f.request);
  await runAudioTrack(db, async () => {throw new Error("fixture TTS failure");}, undefined, receipt.trackId);
  expect((await readAudioPublication(db, f.gameId, "omniscient", true))!.id).toBe(f.trackId);
  expect((await readRetrospectivePresentation(db, f.gameId, f.events, new Date().toISOString())).size).toBe(0);
  await expect(queueRetrospectiveRetake(db, f.request)).rejects.toThrow("successor already exists");
  await retryAudioTrack(db, f.gameId, receipt.trackId);
  await runAudioTrack(db, provider, undefined, receipt.trackId);
  expect((await readAudioPublication(db, f.gameId, "omniscient", true))!.id).toBe(receipt.trackId);
  expect((await readRetrospectivePresentation(db, f.gameId, f.events, new Date().toISOString())).size).toBe(1);
}, 30000);
