import {beforeEach, expect, test} from "bun:test";
import {eq} from "drizzle-orm";
import {completedWerewolfResultsFixture} from "@influence/engine/fixtures/werewolf-results";
import {HOUSE_VOICE, assignPlayerVoice} from "@influence/engine/voice-catalog";
import {schema, type DrizzleDB} from "../db/index.js";
import {setupTestDB} from "./test-utils.js";
import {audioRecipe, audioSourceHash, readAudioSource} from "../services/audio-source.js";
import {previewHouseAudioRefresh, queueHouseAudioRefresh} from "../services/audio-house-refresh.js";
import {runAudioTrack, retryAudioTrack} from "../services/audio-tracks.js";
import {readAudioPublication} from "../services/audio-publication.js";
import {audioReadySequence} from "../services/audio-frontier.js";
import {readWerewolfWatch} from "../services/werewolf-presentation.js";
import {readPayload, storeJson} from "../services/payload-storage.js";
import {sha256StableJson} from "../services/stable-hash.js";
import {AudioProviderFailure, type AudioProvider} from "../services/audio-provider.js";

let db: DrizzleDB;
beforeEach(async () => {db = await setupTestDB();});
async function fixture() {
  const id = "house-audio", events = await completedWerewolfResultsFixture("saved", id);
  await db.insert(schema.games).values({id, slug: id, gameKind: "werewolf", status: "completed", startedAt: "2026-10-25T00:00:00.000Z", config: '{"visibility":"public","audioMode":true}'});
  await db.insert(schema.werewolfEvents).values(events.map(event => ({gameId: id, sequence: event.sequence, event})));
  return {id, events};
}
const success: AudioProvider = async recipe => ({bytes: new TextEncoder().encode(recipe.synthesisText), durationMs: 1200, evidence: {fixture: true}});

test("House audio covers canonical actions while Mystery gets a separate spoiler-free dawn", async () => {
  const {id} = await fixture(), source = await readAudioSource(db, id);
  const house = source.lines.filter(line => line.speakerId === null);
  expect(house.some(line => line.text.includes("The pack agrees"))).toBe(true);
  for (const action of ["protect", "investigate", "hunt"] as const) {
    const line = house.find(line => line.watch?.omniscient?.kind === "werewolf" && line.watch.omniscient.action === action);
    expect(line).toBeDefined(); expect(line!.audiences).toEqual(["omniscient"]); expect(line!.watch?.mystery).toBeUndefined();
  }
  const save = house.find(line => line.text.includes("protection saved"))!;
  expect(save.audiences).toEqual(["omniscient"]);
  const publicDawn = house.find(line => line.productionMomentId === save.momentId)!;
  expect(publicDawn.audiences).toEqual(["mystery"]);
  expect(publicDawn.text).toContain("Everyone survived");
  expect(publicDawn.text).not.toMatch(/Doctor|protect|pack|investigat|wolf/);
  expect(house.some(line => line.text.includes("day limit"))).toBe(true);
  expect(new Set(source.lines.map(line => line.momentId)).size).toBe(source.lines.length);
});

test("refresh retains old publication on failure, reuses players, and atomically publishes complete House speech", async () => {
  const {id, events} = await fixture(), source = await readAudioSource(db, id);
  // The predecessor has all accepted contestants but no House narration.
  const oldSource = {...source, lines: source.lines.filter(line => line.speakerId !== null)};
  const voices = Object.fromEntries(oldSource.lines.map(line => [line.speakerId!, assignPlayerVoice(line.speakerId!, "female", "ara")]));
  voices.house = HOUSE_VOICE;
  const [prior] = await db.insert(schema.gameAudioTracks).values({gameId: id, mode: "backfill", voices: await storeJson(voices),
    manifest: await storeJson(oldSource), throughEventSequence: source.throughEventSequence, budgetUsd: 10}).returning();
  for (const line of oldSource.lines) {
    const recipe = audioRecipe(line, voices[line.speakerId!]!);
    await db.insert(schema.gameAudioClips).values({trackId: prior!.id, momentId: line.momentId, recipe: await storeJson(recipe), recipeHash: sha256StableJson(recipe), sourceHash: audioSourceHash(line)});
  }
  await runAudioTrack(db, success);
  const oldVersions = await db.select().from(schema.gameAudioVersions);
  const oldPublic = await readAudioPublication(db, id, "omniscient", true, true);
  const preview = await previewHouseAudioRefresh(db, id);
  expect(preview.reuse).toBe(oldSource.lines.length);
  await expect(queueHouseAudioRefresh(db, id, "stale")).rejects.toThrow("preview changed");
  const trackId = await queueHouseAudioRefresh(db, id, preview.previewHash);
  await expect(queueHouseAudioRefresh(db, id, preview.previewHash)).rejects.toThrow("already exists");
  await runAudioTrack(db, async () => {throw new AudioProviderFailure("fixture failure", false, {});});
  expect(await readAudioPublication(db, id, "omniscient", true, true)).toEqual(oldPublic);
  await retryAudioTrack(db, id, trackId);
  let generated = 0;
  await runAudioTrack(db, async recipe => {expect(recipe.speakerId).toBeNull(); generated++; return success(recipe);}, undefined, trackId);
  expect(generated).toBe(preview.generate.length);
  const next = await readAudioPublication(db, id, "omniscient", true, true);
  expect(next!.id).toBe(trackId);
  expect(await audioReadySequence(db, id)).toBe(source.throughEventSequence);
  const watch = await readWerewolfWatch(db, id, "omniscient", 1, 64);
  expect(watch.latestCursor).toBeGreaterThan(0);
  expect(watch.moments.length).toBeGreaterThan(0);
  for (const clip of oldPublic!.clips) expect(next!.clips.find(row => row.momentId === clip.momentId)?.sha256).toBe(clip.sha256);
  const mystery = await readAudioPublication(db, id, "mystery", false, true);
  const dawn = source.lines.find(line => line.productionMomentId)!;
  expect(mystery!.clips.some(clip => clip.momentId === dawn.productionMomentId)).toBe(true);
  expect(mystery!.clips.every(clip => clip.watch?.kind !== "werewolf" || !clip.watch.action)).toBe(true);
  for (const version of oldVersions) expect((await readPayload(version.audio)).length).toBeGreaterThan(0);
  expect((await db.select().from(schema.werewolfEvents).orderBy(schema.werewolfEvents.sequence)).map(row => row.event)).toEqual(events);
  expect((await db.select().from(schema.games).where(eq(schema.games.id, id)))[0]!.status).toBe("completed");
});
