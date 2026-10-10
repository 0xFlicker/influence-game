import { expect, test } from "bun:test";
import { createFormatKernelViewerScenario, FORMAT_KERNEL_VIEWER_SCENARIO_IDS } from "@influence/engine/fixtures/format-kernel-viewer";
import { assembleProductionCatalog, productionMomentKey } from "@influence/engine/production-moments";
import { buildInfluenceProductionSources } from "@influence/engine/production-moments/influence-source";
import { compileFormatPresentationPrefix } from "../../app/games/[slug]/components/format-presentation-model";
import { paceVisualBallots } from "../../app/games/[slug]/components/visual-watch-model";
import { withHouseBridges } from "../../app/games/[slug]/components/house-story";
import { buildStoryScenes } from "../../app/games/[slug]/components/house-story";
import { buildClassicPresentationCues, comparePresentationCues } from "../../app/games/[slug]/components/influence-replay-cues";
import { buildEndgamePresentationCues } from "../../app/games/[slug]/components/endgame-presentation";
import type { PresentationCue, ReplayScene } from "../../app/games/[slug]/components/types";
import type { GameWatchReplayFrame, TranscriptEntry, ViewerDecisionEvent } from "../api";
import { Phase } from "@influence/engine";
import { influenceProductionReference } from "./influence-production-reference";

function referenceKeys(cues: readonly PresentationCue[], scenes: readonly ReplayScene[] = []): string[] {
  const byKey = new Map(cues.map(cue => [cue.key, cue]));
  return cues.map(cue => {
    const ref = influenceProductionReference(cue, key => byKey.get(key), current => current.source === "classic"
      ? scenes[current.sceneIndex]?.messages[current.messageIndex] : undefined);
    return productionMomentKey("g", ref.source, ref.part);
  });
}

test("production inventory preserves classic history, endgame ballots and both jury tally groups", () => {
  const players = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase(), persona: "", status: "alive" as const, shielded: false, currentAgent: null }));
  const events: ViewerDecisionEvent[] = [
    { sequence: 1, timestamp: "2026-10-09T00:00:01Z", round: 1, phase: Phase.VOTE, type: "endgame.elimination_resolved", payload: { stage: "reckoning", votes: { a: "c", b: "c" }, juryTiebreakerVotes: { c: "b" }, eliminatedId: "b" } },
    { sequence: 2, timestamp: "2026-10-09T00:00:02Z", round: 1, phase: Phase.VOTE, type: "player.eliminated", payload: { playerId: "b", playerName: "B" } },
    { sequence: 3, timestamp: "2026-10-09T00:00:03Z", round: 2, phase: Phase.JURY_VOTE, type: "jury.winner_determined", payload: { votes: { b: "a" }, winnerId: "a" } },
  ];
  const frames: GameWatchReplayFrame[] = events.map(event => ({ schemaVersion: 3, gameId: "g", slug: "g", sequence: event.sequence, eventType: event.type, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players,
    counts: { totalPlayers: 3, alivePlayers: 3, eliminatedPlayers: 0, unknownPlayers: 0 }, viewerDecisionEvent: event }));
  const messages: TranscriptEntry[] = [
    { id: 10, gameId: "g", round: 1, phase: "INTRODUCTION", scope: "public", fromPlayerId: "a", fromPlayerName: "A", toPlayerIds: null, text: "Legacy narration contains words about a vote, with no canonical ballot provenance.", timestamp: Date.parse("2026-10-09T00:00:00Z") },
    { id: 11, gameId: "g", round: 2, phase: "JURY_VOTE", scope: "system", fromPlayerId: null, fromPlayerName: null, toPlayerIds: null, dialogueKind: "house_summary", firstDurableEventSequence: 3, text: "The game has ended.", timestamp: Date.parse("2026-10-09T00:00:04Z") },
  ];
  const scenes = buildStoryScenes(messages);
  const cues = withHouseBridges(paceVisualBallots([...buildClassicPresentationCues(scenes, frames, players), ...buildEndgamePresentationCues(frames)].sort(comparePresentationCues), players), scenes);
  const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "classic", transcripts: messages, frames });
  const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
  expect(catalog.moments.map(m => m.id)).toEqual(referenceKeys(cues, scenes));
  expect(catalog.moments.filter(m => m.kind === "tally")).toHaveLength(3);
  expect(catalog.moments[0]!.part.kind).toBe("speech");
});

for (const scenarioId of FORMAT_KERNEL_VIEWER_SCENARIO_IDS.filter(id => !id.startsWith("malformed_"))) {
  test(`production inventory binds exact existing format cue coverage: ${scenarioId}`, () => {
    const scenario = createFormatKernelViewerScenario(scenarioId);
    const players = scenario.roster.map(player => ({ ...player, persona: "", status: "alive" as const, shielded: false }));
    const compilation = compileFormatPresentationPrefix({ gameId: "g", gameKernel: "format", roster: players, decisions: scenario.decisions });
    expect(compilation.diagnostic).toBeNull();
    const cues = withHouseBridges(paceVisualBallots(compilation.cues, players), []);
    const frames = scenario.decisions.map(event => ({ sequence: event.sequence, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players, viewerDecisionEvent: event }));
    const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", transcripts: [], frames });
    const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
    const expected = referenceKeys(cues);
    expect(catalog.moments.map(m => m.id)).toEqual(expected);
  });
}
