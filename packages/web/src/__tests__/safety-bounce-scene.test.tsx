import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createFormatKernelViewerScenario } from "@influence/engine/fixtures/format-kernel-viewer";
import { compileFormatPresentationPrefix } from "../app/games/[slug]/components/format-presentation-model";
import { visualWatchPresentation, type VisualWatchData } from "../app/games/[slug]/components/visual-watch-model";
import { SafetyBounceScene } from "../app/games/[slug]/components/safety-bounce-scene";
import { safetyBounceLobbyScene, safetyBounceAnchors, isSafetyBounceSceneCue } from "../app/games/[slug]/components/safety-bounce-scene-model";
import type { GamePlayer, TranscriptEntry } from "../lib/api";

const scenario = createFormatKernelViewerScenario("safety_bounce_tie");
const players: GamePlayer[] = scenario.roster.map(player => ({ ...player, persona: "test", status: "alive", shielded: false }));
const compile = (count = scenario.decisions.length) => compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: scenario.roster, decisions: scenario.decisions.slice(0, count), formatManifest: ["safety_bounce", "vote_bomb"] });
const data: VisualWatchData = { enabled: true, status: null, portraits: {}, scenes: [{
  id: "lobby", roomId: "lobby", imageUrl: "/lobby.png", version: 1, afterDialogueSequence: 2,
  participantIds: players.map(player => player.id), anchors: players.map((player, index) => ({ playerId: player.id, label: index + 1, confidence: index === 3 ? "uncertain" : "clear", head: { x: .1 + index * .2, y: .2, width: .05, height: .1 } })),
}] };
const lobby: TranscriptEntry = { id: 3, entrySequence: 3, firstDurableEventSequence: 29, gameId: "g", round: 2, phase: "LOBBY", scope: "public", fromPlayerId: "atlas", fromPlayerName: "Atlas", toPlayerIds: null, text: "Invented words do not classify Rex as safe.", timestamp: 1, visualScene: { id: "lobby", roomId: "lobby" } };

test("canonical prefix retains only accepted chain links, including backward seeks", () => {
  const { cues, diagnostic } = compile();
  expect(diagnostic).toBeNull();
  const start = cues.find(cue => cue.kind === "safety_bounce_started")!;
  const pointers = cues.filter(cue => cue.kind === "safety_bounce_pointer");
  expect(start.after.safetyBounce?.pointers).toEqual([]);
  expect(pointers.map(cue => cue.after.safetyBounce?.pointers.length)).toEqual([1, 2, 3]);
  expect(pointers[1]!.after.safetyBounce?.pointers).toEqual([
    { actorId: "atlas", targetId: "lyra", classification: "vulnerable" },
    { actorId: "lyra", targetId: "echo", classification: "safe" },
  ]);
  expect(compile(4).snapshot.safetyBounce?.pointers).toEqual(pointers[0]!.after.safetyBounce?.pointers);
  expect(pointers[0]!.before.safetyBounce?.pointers).toEqual([]);
});

test("lobby selection respects prefix, exact cast, binding, and immutable image version", () => {
  const cue = compile().cues.find(cue => cue.kind === "safety_bounce_pointer")!;
  const future = { ...data.scenes[0]!, id: "future", version: 2, afterDialogueSequence: 10 };
  const published = { ...data, scenes: [...data.scenes, future] };
  expect(safetyBounceLobbyScene(published, cue, [lobby])?.id).toBe("lobby");
  expect(safetyBounceLobbyScene(published, cue, [])).toBeNull();
  expect(safetyBounceLobbyScene(published, cue, [{ ...lobby, round: 3 }])).toBeNull();
  expect(safetyBounceLobbyScene(published, cue, [{ ...lobby, entrySequence: 2 }])).toBeNull();
  expect(safetyBounceLobbyScene({ ...data, scenes: [{ ...data.scenes[0]!, participantIds: ["atlas", "lyra", "echo"] }] }, cue, [lobby])).toBeNull();
  expect(safetyBounceLobbyScene({ ...data, bindings: { 3: "future" } }, cue, [lobby])).toBeNull();
  expect(safetyBounceLobbyScene({ ...data, bindings: { 3: "lobby" } }, cue, [{ ...lobby, visualScene: undefined }])?.id).toBe("lobby");
});

test("a rejected pointer cannot add an arrow to the accepted chain", () => {
  const decisions = scenario.decisions.map(decision => decision.type === "format.safety_bounce_pointer" && decision.sequence === 34
    ? { ...decision, payload: { ...decision.payload, actorId: "rex" } } : decision);
  const result = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: scenario.roster, decisions, formatManifest: ["safety_bounce", "vote_bomb"] });
  expect(result.diagnostic).not.toBeNull();
  expect(result.snapshot.safetyBounce?.pointers).toEqual([{ actorId: "atlas", targetId: "lyra", classification: "vulnerable" }]);
});

test("image-backed classification, tally and tie use canonical states; ballots keep their speech", () => {
  const cues = compile().cues;
  for (const cue of cues.filter(isSafetyBounceSceneCue)) {
    const result = visualWatchPresentation(data, cue, null, players, [lobby]);
    expect(result.beat?.kind).toBe("safety-bounce");
    expect(visualWatchPresentation({ ...data, scenes: [] }, cue, null, players, [lobby]).beat).toBeNull();
    if (result.beat?.kind !== "safety-bounce") throw new Error("Expected image presentation");
    const html = renderToString(<SafetyBounceScene beat={result.beat} elapsedMs={1000} paused reducedMotion={false} />);
    expect(html).toContain("Safety Bounce lobby");
    expect(html).not.toContain("Invented words");
    expect(html.match(/data-chain-member=/g)?.length).toBe(4);
    if (cue.kind === "safety_bounce_pointer" && cue.targetId === "rex") expect(html).toContain("Chain complete");
    if (cue.kind === "format_tiebreak") expect(html).toContain("Atlas breaks the tie");
  }
  const elimination = cues.find(cue => cue.kind === "format_elimination")!;
  expect(visualWatchPresentation(data, elimination, null, players, [lobby]).beat).toBeNull();
  const ballot = cues.find(cue => cue.kind === "format_roll_call")!;
  expect(visualWatchPresentation(data, ballot, null, players, [lobby]).beat?.kind).toBe("portrait");
});

test("uncertain heads never become geometric endpoints", () => {
  const scene = { ...data.scenes[0]!, annotatedImageUrl: "" };
  const anchors = safetyBounceAnchors(scene);
  expect(anchors.has("rex")).toBe(false);
  expect(anchors.size).toBe(3);
  expect(anchors.get("atlas")!.x).toBeCloseTo(.125);
  expect(anchors.get("atlas")!.y).toBeCloseTo(.325);
});
