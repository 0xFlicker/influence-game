import { expect, test } from "bun:test";
import { buildInfluenceProductionSources, type InfluenceProductionFrame } from "./influence-source";
import { buildWerewolfProductionSources } from "./werewolf-source";
import { assembleProductionCatalog, selectProductionMoments } from "./index";
import { createFormatKernelViewerScenario } from "../fixtures/format-kernel-viewer";
import { completedWerewolfResultsFixture, werewolfResultsFixture } from "../fixtures/werewolf-results";
import { werewolfThinkingActions } from "../werewolf/thinking";
import { projectWerewolfProductionProvenance, projectWerewolfWatch } from "../werewolf/watch";
import { Phase } from "../types";
import type { ViewerDecisionEvent } from "../viewer-decision-events";

test("retrospectives are ordinary speech moments with canonical provenance and independent explicit cuts", async () => {
  const events = await completedWerewolfResultsFixture("village", "rt11-wolf");
  for (const audience of ["mystery", "omniscient"] as const) {
    const window = projectWerewolfWatch(events, audience), provenance = projectWerewolfProductionProvenance(events, audience);
    const catalog = assembleProductionCatalog({gameId: window.gameId, gameKind: "werewolf", audience,
      sources: buildWerewolfProductionSources({gameId: window.gameId, audience, moments: window.moments, provenance, thoughts: [], opening: false})});
    const retrospective = catalog.moments.filter(moment => moment.purpose === "retrospective"), result = catalog.moments.find(moment => moment.kind === "result")!;
    expect(retrospective).toHaveLength(6);
    expect(retrospective.every(moment => moment.kind === "speech" && moment.defaultIncluded && moment.order.anchor > result.order.anchor)).toBeTrue();
    expect(retrospective.map(moment => moment.retrospectiveSource!.ordinal)).toEqual([0,1,2,3,4,5]);
    const annotations = Object.fromEntries(retrospective.map(moment => [moment.id, {cut: "retrospective"}]));
    expect(selectProductionMoments(catalog, {mode: "tagged", thinking: false, predicate: {cut: "retrospective"}}, annotations)).toEqual(retrospective);
    expect(selectProductionMoments(catalog, {mode: "ids", thinking: false, ids: [...retrospective].reverse().map(moment => moment.id)})).toEqual(retrospective);
  }
  const transcripts = [{id: 10, timestamp: 10, round: 1, phase: "RETROSPECTIVE", scope: "public", fromPlayerId: "atlas", retrospectiveSource: {eventSequence: 10, ordinal: 0}}];
  const sources = buildInfluenceProductionSources({gameId: "rt11-influence", gameKernel: "format", frames: [], transcripts});
  const catalog = assembleProductionCatalog({gameId: "rt11-influence", gameKind: "influence", audience: "public", sources});
  expect(catalog.moments).toHaveLength(1); expect(catalog.moments[0]).toMatchObject({kind: "speech", purpose: "retrospective", actorId: "atlas", retrospectiveSource: {eventSequence: 10, ordinal: 0}});
  expect(() => buildInfluenceProductionSources({gameId: "rt11-influence", gameKernel: "format", frames: [], transcripts: [{...transcripts[0]!, retrospectiveSource: undefined}]})).toThrow("canonical provenance");
});

test("classic historical prose subparts stay inside a stable transcript-backed moment", () => {
  const transcripts = [
    { id: 7, timestamp: 10, round: 1, phase: "VOTE", scope: "public", fromPlayerId: "speaker" },
    { id: 9, timestamp: 20, round: 1, phase: "VOTE", scope: "thinking", fromPlayerId: "speaker", thinking: "Archived thinking row" },
  ];
  const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "classic", transcripts, frames: [] });
  const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
  expect(catalog.moments.map(m => m.part.kind)).toEqual(["speech"]);
  expect(catalog.moments[0]!.source).toEqual({ kind: "influence-transcript", transcriptId: "7" });
  const changed = buildInfluenceProductionSources({ gameId: "g", gameKernel: "classic", frames: [], transcripts: [{ ...transcripts[0]!, timestamp: 999, entrySequence: 300 }] });
  expect(assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources: changed }).moments[0]!.id).toBe(catalog.moments[0]!.id);
});

test("sealed thought identity remains accepted-action provenance while reveal follows its voter presentation", () => {
  const scenario = createFormatKernelViewerScenario("majority_elimination_clear");
  const frames: InfluenceProductionFrame[] = scenario.decisions.map(event => ({ sequence: event.sequence, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players: scenario.roster, viewerDecisionEvent: event }));
  const action = scenario.decisions.find(event => event.type === "format.ballot_cast")!;
  if (action.type !== "format.ballot_cast") throw new Error("Ballot fixture required");
  const thought = { eventSequence: action.sequence, actorId: action.payload.voterId, thinking: "An accepted sealed decision", defaultThinking: false };
  const sources = buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", transcripts: [], frames, thoughts: [thought] });
  const catalog = assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources });
  const position = catalog.moments.findIndex(m => m.kind === "thinking");
  expect(catalog.moments[position]!.source).toEqual({ kind: "influence-event", eventSequence: action.sequence });
  expect(catalog.moments[position + 1]!.part).toMatchObject({ kind: "influence-presentation", presentation: { kind: "format_roll_call", voterId: action.payload.voterId } });
  expect(selectProductionMoments(catalog, { mode: "full", thinking: true }).some(m => m.kind === "thinking")).toBe(false);
  const prefix = buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", transcripts: [], frames: frames.filter(frame => frame.sequence <= action.sequence), thoughts: [thought] });
  expect(assembleProductionCatalog({ gameId: "g", gameKind: "influence", audience: "public", sources: prefix }).moments.some(m => m.kind === "thinking")).toBe(false);
  expect(() => buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", transcripts: [], frames, thoughts: [{ ...thought, revealEventSequence: action.sequence }] })).toThrow("permitted ballot reveal");
});

test("source inventories reject ambiguous rows instead of accepting the last candidate", () => {
  const row = { id: 1, timestamp: 1, round: 1, phase: "INTRODUCTION", scope: "public", speakerPlayerId: "a" };
  expect(() => buildInfluenceProductionSources({ gameId: "g", gameKernel: "classic", frames: [], transcripts: [row, { ...row, timestamp: 2 }] })).toThrow("Ambiguous");
  const scenario = createFormatKernelViewerScenario("malformed_duplicate_ballot");
  const frames = scenario.decisions.map(event => ({ sequence: event.sequence, timestamp: Date.parse(event.timestamp), round: event.round, phase: event.phase ?? "INIT", players: scenario.roster, viewerDecisionEvent: event }));
  expect(() => buildInfluenceProductionSources({ gameId: "g", gameKernel: "format", frames, transcripts: [] })).toThrow("Ambiguous accepted format ballot");
});

test("classic sealed Empower thinking releases after canonical tally without expanding the full movie", () => {
  const players = [{ id: "a" }, { id: "b" }];
  const vote: ViewerDecisionEvent = { type: "vote.cast", sequence: 1, timestamp: new Date(10).toISOString(), round: 1, phase: Phase.VOTE, payload: { voterId: "a", empowerTarget: "b" } };
  const tally: ViewerDecisionEvent = { type: "vote.empower_tally_resolved", sequence: 2, timestamp: new Date(20).toISOString(), round: 1, phase: Phase.VOTE, payload: { counts: { b: 1 }, empowered: "b", tied: null, method: "plurality", cumulativeEmpowerVotes: { b: 1 } } };
  const frames = [vote, tally].map(viewerDecisionEvent => ({ sequence: viewerDecisionEvent.sequence, timestamp: Date.parse(viewerDecisionEvent.timestamp), round: 1, phase: "VOTE", players, viewerDecisionEvent }));
  const thought = { eventSequence: 1, actorId: "a", thinking: "Classic accepted ballot", defaultThinking: false };
  const catalog = (frames: InfluenceProductionFrame[]) => assembleProductionCatalog({ gameId: "classic", gameKind: "influence", audience: "public", sources: buildInfluenceProductionSources({ gameId: "classic", gameKernel: "classic", transcripts: [], frames, thoughts: [thought] }) });
  expect(catalog(frames.slice(0, 1)).moments).toHaveLength(0);
  expect(catalog(frames).moments).toHaveLength(1);
  expect(catalog(frames).moments[0]!.part).toEqual({ kind: "thinking", actorId: "a" });
  expect(selectProductionMoments(catalog(frames), { mode: "full", thinking: true })).toHaveLength(0);
});

test("producer-only Council, endgame and jury sealed slots remain absent until their exact resolution", () => {
  const players = [{ id: "a" }, { id: "b" }];
  const definitions: Array<{ ballot: NonNullable<InfluenceProductionFrame["productionBallot"]>; phase: Phase; resolution: ViewerDecisionEvent }> = [
    { ballot: { kind: "council", voterId: "a" }, phase: Phase.COUNCIL, resolution: { type: "council.elimination_resolved", sequence: 2, timestamp: new Date(20).toISOString(), round: 1, phase: Phase.COUNCIL, payload: { empoweredId: "b", candidates: ["a", "b"], tally: { votes: { a: "b" } }, eliminated: "b", method: "plurality" } } },
    { ballot: { kind: "eliminate", voterId: "a" }, phase: Phase.VOTE, resolution: { type: "endgame.elimination_resolved", sequence: 2, timestamp: new Date(20).toISOString(), round: 1, phase: Phase.VOTE, payload: { stage: "judgment", votes: { a: "b" }, juryTiebreakerVotes: {}, eliminatedId: "b" } } },
    { ballot: { kind: "winner", voterId: "a" }, phase: Phase.JURY_VOTE, resolution: { type: "jury.winner_determined", sequence: 2, timestamp: new Date(20).toISOString(), round: 1, phase: Phase.JURY_VOTE, payload: { votes: { a: "b" }, winnerId: "b" } } },
  ];
  for (const { ballot, phase, resolution } of definitions) {
    const frames: InfluenceProductionFrame[] = [{ sequence: 1, timestamp: 10, round: 1, phase, players, productionBallot: ballot }, { sequence: 2, timestamp: 20, round: 1, phase, players, viewerDecisionEvent: resolution }];
    const thought = { eventSequence: 1, actorId: "a", thinking: "Sealed accepted decision", defaultThinking: false };
    const catalog = (frames: InfluenceProductionFrame[]) => assembleProductionCatalog({ gameId: "classic", gameKind: "influence", audience: "public", sources: buildInfluenceProductionSources({ gameId: "classic", gameKernel: "classic", transcripts: [], frames, thoughts: [thought] }) });
    expect(catalog(frames.slice(0, 1)).moments.some(moment => moment.kind === "thinking")).toBe(false);
    expect(catalog(frames).moments.filter(moment => moment.kind === "thinking")).toHaveLength(1);
    expect(selectProductionMoments(catalog(frames), { mode: "full", thinking: true }).some(moment => moment.kind === "thinking")).toBe(false);
    expect(() => buildInfluenceProductionSources({ gameId: "classic", gameKernel: "classic", transcripts: [], frames, thoughts: [{ ...thought, actorId: "b" }] })).toThrow("accepted ballot");
  }
});

test("many-to-one canonical jury resolution keeps each juror's thought identity independent", () => {
  const resolution: ViewerDecisionEvent = { type: "endgame.elimination_resolved", sequence: 2, timestamp: new Date(20).toISOString(), round: 1, phase: Phase.VOTE, payload: { stage: "tribunal", votes: {}, juryTiebreakerVotes: { a: "target", b: "target" }, eliminatedId: "target" } };
  const frames = [{ sequence: 2, timestamp: 20, round: 1, phase: "VOTE", players: [{ id: "a" }, { id: "b" }, { id: "target" }], viewerDecisionEvent: resolution }];
  const thoughts = ["a", "b"].map(actorId => ({ eventSequence: 2, actorId, thinking: `${actorId}'s accepted tie ballot`, defaultThinking: false }));
  const catalog = assembleProductionCatalog({ gameId: "classic", gameKind: "influence", audience: "public", sources: buildInfluenceProductionSources({ gameId: "classic", gameKernel: "classic", transcripts: [], frames, thoughts }) });
  const moments = catalog.moments.filter(moment => moment.kind === "thinking");
  expect(moments).toHaveLength(2); expect(new Set(moments.map(moment => moment.id)).size).toBe(2);
  expect(moments.map(moment => moment.part)).toEqual([{ kind: "thinking", actorId: "a" }, { kind: "thinking", actorId: "b" }]);
  expect(selectProductionMoments(catalog, { mode: "full", thinking: true }).some(moment => moment.kind === "thinking")).toBe(false);
  expect(() => buildInfluenceProductionSources({ gameId: "classic", gameKernel: "classic", transcripts: [], frames, thoughts: [thoughts[0]!, thoughts[0]!] })).toThrow("ambiguous production moment");
});

test("Werewolf source keeps each released thought and never serializes Mystery private sources", async () => {
  const events = await werewolfResultsFixture("saved", "source-inventory");
  const thoughts = werewolfThinkingActions(events, 99999).flatMap(row => row.event.payload.decision.kind === "target" ? [{ eventSequence: row.event.sequence, cursor: row.cursor, day: row.day, actorId: row.event.payload.actorId, action: row.event.payload.action, thinking: row.event.payload.decision.thinking }] : []);
  const watch = projectWerewolfWatch(events, "omniscient", 1, 64);
  const sources = buildWerewolfProductionSources({ gameId: "source-inventory", audience: "omniscient", moments: watch.moments, provenance: projectWerewolfProductionProvenance(events, "omniscient"), thoughts, opening: true });
  const catalog = assembleProductionCatalog({ gameId: "source-inventory", gameKind: "werewolf", audience: "omniscient", sources });
  expect(catalog.moments.filter(m => m.kind === "thinking")).toHaveLength(thoughts.length);
  expect(selectProductionMoments(catalog, { mode: "full", thinking: true }).some(m => m.kind === "thinking")).toBe(false);
  const mystery = projectWerewolfWatch(events, "mystery", 1, 64);
  const publicSources = buildWerewolfProductionSources({ gameId: "source-inventory", audience: "mystery", moments: mystery.moments, provenance: projectWerewolfProductionProvenance(events, "mystery"), thoughts, opening: true });
  expect(JSON.stringify(publicSources)).not.toContain("SECRET_THINKING");
  expect(publicSources.some(s => s.kind === "werewolf-action" || s.kind === "werewolf-event" && s.entry.kind === "pack_vote")).toBe(false);
  expect(() => buildWerewolfProductionSources({ gameId: "source-inventory", audience: "omniscient", moments: watch.moments, provenance: [], thoughts: [], opening: true })).toThrow("lacks accepted provenance");
});
