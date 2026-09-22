import { expect, test } from "bun:test";
import { visualWatchPresentation, type VisualWatchData } from "../app/games/[slug]/components/visual-watch-model";
import type { GamePlayer, TranscriptEntry } from "../lib/api";
const player: GamePlayer = { id: "a", name: "Ada", persona: "social", status: "alive", shielded: false };
const message: TranscriptEntry = { id: 10, gameId: "g", round: 1, phase: "LOBBY", fromPlayerId: "a", fromPlayerName: "Ada", scope: "public", toPlayerIds: null, text: "Let us talk.", timestamp: 1, entrySequence: 5, visualScene: { id: "old", roomId: "lobby" } };
const data: VisualWatchData = { enabled: true, status: null, portraits: { a: "/frozen.png" }, scenes: [
  { id: "old", roomId: "lobby", version: 1, afterDialogueSequence: 2, imageUrl: "/old.png", participantIds: ["a"], anchors: [] },
  { id: "new", roomId: "lobby", version: 2, afterDialogueSequence: 5, imageUrl: "/new.png", participantIds: ["a"], anchors: [] },
] };
test("selects saved scene versions by dialogue sequence, including backward seeking", () => {
  expect(visualWatchPresentation(data, null, message, [player]).beat).toMatchObject({ kind: "scene", sceneId: "old" });
  expect(visualWatchPresentation(data, null, { ...message, entrySequence: 6, visualScene: { id: "new", roomId: "lobby" } }, [player]).beat).toMatchObject({ kind: "scene", sceneId: "new" });
  expect(visualWatchPresentation(data, null, message, [player]).beat).toMatchObject({ sceneId: "old" });
  expect(visualWatchPresentation(data, null, { ...message, entrySequence: undefined }, [player]).rooms).toEqual([]);
});
test("farewells use accepted metadata and the frozen portrait, never words or current player status", () => {
  expect(visualWatchPresentation(data, null, { ...message, presentationPurpose: "farewell" }, [player]).beat).toMatchObject({ kind: "portrait", purpose: "Farewell", player: { avatarUrl: "/frozen.png" } });
  expect(visualWatchPresentation(data, null, { ...message, text: "Goodbye everyone" }, [{ ...player, status: "eliminated" }]).beat?.kind).toBe("scene");
});
test("anonymous speech cannot identify its author", () => {
  expect(visualWatchPresentation(data, null, { ...message, anonymous: true }, [player]).beat).toMatchObject({ speech: { playerId: null, speaker: "Anonymous" } });
});
test("ballot phases do not fall back to room imagery or invented ballot text", () => {
  expect(visualWatchPresentation(data, null, { ...message, phase: "VOTE", visualScene: undefined }, [player]).beat).toMatchObject({ kind: "portrait", speech: { text: message.text } });
});

test("games without generated media still present portraits and House text", () => {
  const plain: VisualWatchData = { enabled: false, status: null, portraits: {}, scenes: [] };
  expect(visualWatchPresentation(plain, null, { ...message, visualScene: undefined }, [player]).beat).toMatchObject({ kind: "portrait", speech: { text: message.text } });
  expect(visualWatchPresentation(plain, null, { ...message, visualScene: undefined, fromPlayerId: null, scope: "system", phase: "REVEAL" }, [player]).beat).toEqual({ kind: "house", text: message.text });
});
