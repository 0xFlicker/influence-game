import { expect, test } from "bun:test";
import { buildStoryScenes, isStoryDialogue, withHouseBridges } from "../app/games/[slug]/components/house-story";
import { buildClassicPresentationCues, comparePresentationCues, isFormatSocialTranscriptMessage } from "../app/games/[slug]/components/dramatic-replay-viewer";
import { findPresentationCueIndexForSequence } from "../app/games/[slug]/components/presentation-sequence";
import type { TranscriptEntry } from "../lib/api";
import { compileFormatPresentationPrefix } from "../app/games/[slug]/components/format-presentation-model";
import { createMajorityEliminationTieViewerDecisions, FORMAT_KERNEL_VIEWER_GAME_ID, FORMAT_KERNEL_VIEWER_ROSTER } from "@influence/engine/fixtures/format-kernel-viewer";

function entry(id: number, patch: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return { id, entrySequence: id, firstDurableEventSequence: id, gameId: "game", round: 1, phase: "LOBBY", scope: "public", fromPlayerId: "p1", fromPlayerName: "Atlas", toPlayerIds: null, text: "37", timestamp: id, ...patch };
}
function compile(messages: TranscriptEntry[]) {
  const scenes = buildStoryScenes(messages);
  return withHouseBridges(buildClassicPresentationCues(scenes, []).sort(comparePresentationCues), scenes);
}
const summary = (id: number, patch: Partial<TranscriptEntry> = {}) => entry(id, { dialogueKind: "house_summary", scope: "system", fromPlayerId: null, text: "The room is listening.", ...patch });

test("late-authored alliance introductions play immediately before their exact conversation", () => {
  const speech = entry(10, { phase: "FORMAT_MINGLE", scope: "huddle", firstDurableEventSequence: 20 });
  const other = entry(11, { phase: "FORMAT_MINGLE", scope: "huddle", firstDurableEventSequence: 21 });
  const introduction = summary(12, { phase: "FORMAT_MINGLE", firstDurableEventSequence: 25,
    allianceIntroduction: { sessionId: "session", allianceId: "alliance", allianceName: "Night Shift", memberIds: ["p1", "p2"], beforeEntrySequence: 10 } });
  const scenes = buildStoryScenes([speech, other, introduction]);
  expect(scenes.flatMap(scene => scene.messages.map(message => message.id))).toEqual([12, 10, 11]);
  const cues = buildClassicPresentationCues(scenes, []).sort(comparePresentationCues);
  expect(cues.map(cue => cue.key)).toEqual(["classic:12:done", "classic:10:done", "classic:11:done"]);
  expect(cues.map(cue => cue.canonicalSequence)).toEqual([20, 20, 21]);
  // A partial page must not play the introduction at its authoring position.
  expect(buildStoryScenes([introduction])).toEqual([]);
});

test("operational records never occupy a beat, regardless of their prose", () => {
  const kinds = ["system_phase_banner", "system_room_allocation", "system_announcement", "system_elimination"] as const;
  for (const dialogueKind of kinds) expect(isStoryDialogue(entry(1, { scope: "system", fromPlayerId: null, dialogueKind, text: "The room is listening." }))).toBe(false);
  expect(isStoryDialogue(summary(1, { text: "====" }))).toBe(true);
  expect(isStoryDialogue(entry(2, { text: "=== FORMAT MINGLE PHASE ===" }))).toBe(true);
  expect(isStoryDialogue(entry(3, { anonymous: true, fromPlayerId: null }))).toBe(true);
});

test("room movement preserves every speech, and adds no allocation or transition beat", () => {
  const cues = compile([entry(1, { phase: "FORMAT_MINGLE", roomId: 1 }), entry(2, { phase: "FORMAT_MINGLE", roomId: 2 }), entry(3, { phase: "FORMAT_MINGLE", scope: "system", dialogueKind: "system_room_allocation" }), entry(4, { phase: "FORMAT_MINGLE", roomId: 3 })]);
  expect(cues.map((cue) => cue.key)).toEqual(["classic:1:done", "classic:2:done", "classic:4:done"]);
});

test("one outgoing summary replaces the title bridge without borrowing future narration", () => {
  const cues = compile([entry(1), summary(2), entry(3, { phase: "FORMAT_MINGLE" }), entry(4, { phase: "FORMAT_RESOLVE", presentationPurpose: "farewell" }), summary(5, { phase: "FORMAT_RESOLVE" })]);
  expect(cues.map((cue) => cue.key)).toEqual(["classic:1:done", "classic:2:done", "classic:3:done", "house-bridge:classic:4:done", "classic:4:done", "classic:5:done"]);
  expect(cues.find((cue) => cue.source === "house")?.baseDurationMs).toBe(2000);
  expect(findPresentationCueIndexForSequence(cues, 4)).toBe(3);
});

test("title keys stay stable as later content and new Mingle rooms arrive", () => {
  const prefix = [entry(1), entry(2, { phase: "FORMAT_MINGLE" })];
  const first = compile(prefix);
  const next = compile([...prefix, entry(3, { phase: "FORMAT_MINGLE", roomId: 3 })]);
  expect(next.slice(0, first.length)).toEqual(first);
});

test("farewells and summaries survive format exclusions while diaries retain their separate archive", () => {
  for (const phase of ["VOTE", "FORMAT_MENU", "FORMAT_PICK", "FORMAT_RESOLVE"] as const) {
    expect(isFormatSocialTranscriptMessage(summary(1, { phase }))).toBe(true);
  }
  const messages = [entry(1, { phase: "FORMAT_RESOLVE", presentationPurpose: "farewell" }), entry(2, { phase: "DIARY_ROOM", scope: "diary" })];
  expect(buildStoryScenes(messages).flatMap((scene) => scene.messages)).toEqual([messages[0]!]);
  expect(messages.every(isFormatSocialTranscriptMessage)).toBe(true);
});

test("stored sequence overrides wall clock and summaries follow every stage of the matching reveal", () => {
  const compilation = compileFormatPresentationPrefix({ gameId: FORMAT_KERNEL_VIEWER_GAME_ID, gameKernel: "format", roster: FORMAT_KERNEL_VIEWER_ROSTER, decisions: createMajorityEliminationTieViewerDecisions() });
  expect(compilation.cues.length).toBeGreaterThan(0);
  const reveal = compilation.cues.at(-1)!;
  const scenes = buildStoryScenes([summary(99, { firstDurableEventSequence: reveal.canonicalSequence, phase: reveal.phase, round: reveal.round, timestamp: 0 })]);
  const [house] = buildClassicPresentationCues(scenes, []);
  expect(house?.canonicalSequence).toBe(reveal.canonicalSequence);
  const ordered = [...compilation.cues, house!].sort(comparePresentationCues);
  expect(ordered.at(-1)?.key).toBe(house?.key);
  expect(findPresentationCueIndexForSequence(ordered, reveal.canonicalSequence)).toBeLessThan(ordered.length - 1);
});

test("operational-only seek targets advance to the next presentable cue", () => {
  const cues = compile([entry(1), entry(2, { scope: "system", dialogueKind: "system_announcement" }), entry(3)]);
  expect(cues[findPresentationCueIndexForSequence(cues, 2)]?.key).toBe("classic:3:done");
});
