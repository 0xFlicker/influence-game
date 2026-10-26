import { describe, expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import {
  applyRetrospectiveRecord, assertRetrospectiveDefinition, assertRetrospectiveInput,
  assertRetrospectiveInputBinding, assertRetrospectiveRequest, createRetrospectiveDefinition,
  prepareRetrospectiveRequest, retrospectiveCompletionProof, retrospectiveSpeechArtifact,
  RETROSPECTIVE_MAX_SPEECH_CHARACTERS,
  type RetrospectiveInputV1, type RetrospectiveStateV1, type RetrospectiveStatementV1,
} from "../retrospective";
import { exactStructuredOutputRegistry } from "../structured-output";
import { GameState } from "../game-state";
import { applyCanonicalEvent, replayCanonicalEvents } from "../game-projection";
import { CanonicalEventLog } from "../canonical-event-log";
import { Phase, PlayerStatus } from "../types";
import { werewolfResultsFixture } from "../fixtures/werewolf-results";
import { applyWerewolfEvent, replayWerewolf, werewolfActionPlans } from "../werewolf/rules";
import { compileWerewolfRetrospective } from "../werewolf/retrospective";

const outcome = { gameId: "retro", gameKind: "influence" as const, eventSequence: 4, eventHash: hashCanonicalJson({ outcome: true }) };
function input(): RetrospectiveInputV1 {
  return { version: 1, outcome: { ...outcome }, sections: [
    { phase: "opening", fromEventSequence: 1, throughEventSequence: 2, summary: "Everyone introduced themselves." },
    { phase: "result", fromEventSequence: 3, throughEventSequence: 4, summary: "Atlas won; Echo and Mira exited." },
  ], dialogue: [{ eventSequence: 2, source: { kind: "canonical_event", sequence: 2 }, actorId: "echo",
    scope: "public", audiencePlayerIds: [], text: "I promised Mira my vote." }] };
}
const rosterIds = ["atlas", "echo", "mira"];
const boundary = (eventSequence: number) => ({ outcome, rosterIds, eventSequence });
function start(): RetrospectiveStateV1 {
  return applyRetrospectiveRecord(null, { kind: "started", payload: createRetrospectiveDefinition(input(), ["echo", "mira", "atlas"]) }, boundary(5));
}
function statement(state: RetrospectiveStateV1): RetrospectiveStatementV1 {
  const request = prepareRetrospectiveRequest(state);
  return { version: 1, definitionHash: request.definitionHash, actorId: request.actorId, ordinal: request.ordinal,
    priorStatementsHash: request.priorStatementsHash, requestHash: hashCanonicalJson(request),
    providerLogicalCallId: `accepted-${request.ordinal}`, speech: `I was ${request.actorId} in this game.` };
}

describe("retrospective contracts", () => {
  test("GameState rejects invalid postgame effects before appending them", () => {
    const game = new GameState(rosterIds.map(id => ({ id, name: id })), { gameId: "retro-state" });
    game.eliminatePlayer("echo");
    game.eliminatePlayer("mira");
    const source = game.getDomainProjection().retrospectiveOutcomeSource!;
    const definition = createRetrospectiveDefinition({ version: 1, outcome: source, dialogue: [],
      sections: [{ phase: "fixture", fromEventSequence: 1, throughEventSequence: source.eventSequence, summary: "Atlas won." }] }, ["echo", "mira", "atlas"]);
    game.recordRetrospective("retrospective.started", definition);
    const accepted = game.getCanonicalEvents();
    const state = game.getDomainProjection().retrospective!;
    expect(() => game.recordRetrospective("retrospective.statement_recorded", { ...statement(state), ordinal: 2, actorId: "atlas" })).toThrow();
    expect(game.getCanonicalEvents()).toEqual(accepted);
    expect(() => game.recordRetrospective("retrospective.completed", { version: 1, definitionHash: definition.definitionHash,
      statementCount: 3, statementsHash: hashCanonicalJson([]) })).toThrow("whole original roster");
    expect(game.getCanonicalEvents()).toEqual(accepted);
  });

  test("only complete bounded outcome-pinned input can bind the frozen definition", () => {
    const original = input(), definition = createRetrospectiveDefinition(original, rosterIds);
    expect(() => assertRetrospectiveInputBinding(original, definition)).not.toThrow();
    expect(() => assertRetrospectiveInputBinding({ ...original, dialogue: [] }, definition)).toThrow("frozen definition");
    expect(() => assertRetrospectiveInput({ ...original, sections: original.sections.slice(1) })).toThrow("contiguous");
    expect(() => assertRetrospectiveInput({ ...original, sections: original.sections.slice(0, 1) })).toThrow("exactly");
    expect(() => assertRetrospectiveInput({ ...original, dialogue: [{ ...original.dialogue[0]!, eventSequence: 5 }] })).toThrow("original outcome");
    const large = { ...original, sections: [{ ...original.sections[0]!, throughEventSequence: 4, summary: "界".repeat(120_000) }] };
    expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(256 * 1024);
    expect(() => assertRetrospectiveInputBinding(large, createRetrospectiveDefinition(large, rosterIds))).not.toThrow();
    expect(() => assertRetrospectiveDefinition({ ...definition, inputHash: outcome.eventHash })).toThrow("hash");
    expect(() => assertRetrospectiveDefinition({ ...definition, speakerIds: [...rosterIds].reverse() })).toThrow("hash");
    expect(() => assertRetrospectiveInput({ ...original, version: 2 })).toThrow("shape");
  });

  test("definition requires an earlier canonical outcome and exactly the original roster", () => {
    for (const speakerIds of [["echo", "atlas"], ["atlas", "echo", "outsider"]]) {
      expect(() => applyRetrospectiveRecord(null, { kind: "started", payload: createRetrospectiveDefinition(input(), speakerIds) }, boundary(5))).toThrow("original contestant");
    }
    expect(() => createRetrospectiveDefinition(input(), ["atlas", "atlas", "mira"])).toThrow();
    const record = { kind: "started" as const, payload: start().definition };
    expect(() => applyRetrospectiveRecord(null, record, { ...boundary(5), outcome: null })).toThrow("earlier canonical outcome");
    expect(() => applyRetrospectiveRecord(null, record, boundary(4))).toThrow("earlier canonical outcome");
    expect(() => applyRetrospectiveRecord(null, record, { ...boundary(5), outcome: { ...outcome, eventHash: hashCanonicalJson("other") } })).toThrow("canonical authority");
    expect(() => applyRetrospectiveRecord(start(), record, boundary(6))).toThrow("already frozen");
  });

  test("a statement cannot skip, repeat, change actor, context, request or accepted provider value", () => {
    const state = start(), valid = statement(state);
    for (const change of [
      { actorId: "outsider" }, { ordinal: 1 }, { requestHash: outcome.eventHash },
      { priorStatementsHash: outcome.eventHash }, { definitionHash: outcome.eventHash }, { inputHash: outcome.eventHash },
    ]) expect(() => applyRetrospectiveRecord(state, { kind: "statement", payload: { ...valid, ...change } }, boundary(6))).toThrow();
    expect(() => applyRetrospectiveRecord(null, { kind: "statement", payload: valid }, boundary(6))).toThrow();
    const next = applyRetrospectiveRecord(state, { kind: "statement", payload: valid }, boundary(6));
    expect(state.statements).toHaveLength(0);
    expect(() => applyRetrospectiveRecord(next, { kind: "statement", payload: valid }, boundary(7))).toThrow("prepared slot");
    expect(() => applyRetrospectiveRecord(next, { kind: "statement", payload: { ...statement(next), providerLogicalCallId: valid.providerLogicalCallId } }, boundary(7))).toThrow("two statements");
    const request = prepareRetrospectiveRequest(next);
    expect(request.priorStatements).toEqual([{ eventSequence: 6, ordinal: 0, actorId: "echo", speechHash: hashCanonicalJson({ speech: valid.speech }) }]);
    expect(() => assertRetrospectiveRequest(request)).not.toThrow();
    expect(() => assertRetrospectiveRequest({ ...request, priorStatements: [] })).toThrow("prefix");
    expect(() => assertRetrospectiveRequest({ ...request, extras: true })).toThrow("shape");
  });

  test.each([" ", "\t\n", "\u00a0\u2003"])("canonical replay rejects blank speech %j without advancing the speaker", speech => {
    const state = start();
    const before = structuredClone(state);
    expect(() => applyRetrospectiveRecord(state, {
      kind: "statement", payload: { ...statement(state), speech },
    }, boundary(6))).toThrow("must not be blank");
    expect(state).toEqual(before);
  });

  test("the final boundary requires all statements and their exact immutable prefix", () => {
    let state = start();
    expect(() => retrospectiveCompletionProof(state)).toThrow("whole original roster");
    expect(() => applyRetrospectiveRecord(state, { kind: "completed", payload: { version: 1, definitionHash: state.definition.definitionHash, statementCount: 3, statementsHash: outcome.eventHash } }, boundary(6))).toThrow("whole original roster");
    for (let sequence = 6; sequence <= 8; sequence++) state = applyRetrospectiveRecord(state, { kind: "statement", payload: statement(state) }, boundary(sequence));
    const proof = retrospectiveCompletionProof(state);
    expect(() => prepareRetrospectiveRequest(state)).toThrow("unfinished");
    expect(() => applyRetrospectiveRecord(state, { kind: "completed", payload: { ...proof, statementsHash: outcome.eventHash } }, boundary(9))).toThrow("completion proof");
    const completed = applyRetrospectiveRecord(state, { kind: "completed", payload: proof }, boundary(9));
    expect(completed.completedAtEventSequence).toBe(9);
    expect(() => applyRetrospectiveRecord(completed, { kind: "statement", payload: statement(start()) }, boundary(10))).toThrow("further records");
    expect(() => applyRetrospectiveRecord(completed, { kind: "completed", payload: proof }, boundary(10))).toThrow("further records");
  });

  test("native output and journal replay reject malformed speech without permissive parsing", () => {
    const invalid = ["Plain text", '```json\n{"speech":"Hello",}\n```', 'prefix {"speech":"Hello"} {"speech":"Other"}', "{}",
      '{"speech":null}', '{"speech":"  "}', '{"speech":"ok","actorId":"atlas"}',
      JSON.stringify({ speech: "x".repeat(RETROSPECTIVE_MAX_SPEECH_CHARACTERS + 1) })];
    for (const document of invalid) expect(exactStructuredOutputRegistry.decodeJsonDocument(retrospectiveSpeechArtifact, document).status).toBe("invalid");
    for (const value of [null, {}, { speech: " " }, { speech: "ok", thinking: "secret" }]) {
      expect(exactStructuredOutputRegistry.decodeProviderPayload(retrospectiveSpeechArtifact, value).status).toBe("invalid");
      expect(exactStructuredOutputRegistry.decodeAcceptedValue(retrospectiveSpeechArtifact, value).status).toBe("invalid");
    }
    const value = { speech: "  My exact speech.  " };
    expect(exactStructuredOutputRegistry.decodeProviderPayload(retrospectiveSpeechArtifact, value)).toMatchObject({ status: "valid", value, audioDelivery: { fields: [{ path: ["speech"], delivery: { cleanText: value.speech } }] } });
  });
});

test("Influence canonical projection validates the epilogue without changing winner/eligibility", () => {
  const game = new GameState(rosterIds.map(id => ({ id, name: id })), { gameId: "retro" });
  game.eliminatePlayer("echo"); game.eliminatePlayer("mira");
  const events = game.getCanonicalEvents(), projection = replayCanonicalEvents(events);
  const source = projection.retrospectiveOutcomeSource!;
  const dossier: RetrospectiveInputV1 = { ...input(), outcome: source, sections: [{ phase: "game", fromEventSequence: 1, throughEventSequence: source.eventSequence, summary: "Atlas survived both eliminations." }] };
  const log = new CanonicalEventLog(); log.replaceAll(events);
  const started = log.append({ gameId: "retro", round: projection.round, phase: Phase.RETROSPECTIVE, type: "retrospective.started",
    payload: createRetrospectiveDefinition(dossier, ["echo", "mira", "atlas"]), visibility: "public", timestamp: new Date().toISOString() });
  applyCanonicalEvent(projection, started);
  const frozen = structuredClone(projection);
  expect(() => applyCanonicalEvent(projection, { ...started, sequence: started.sequence + 1 })).toThrow("already frozen");
  expect(projection).toEqual(frozen);
  expect(() => applyCanonicalEvent(projection, { ...events[0]!, sequence: started.sequence + 1 })).toThrow("Gameplay cannot resume");
  expect(projection.players.atlas?.status).toBe(PlayerStatus.ALIVE);
  expect(projection.players.echo?.status).toBe(PlayerStatus.ELIMINATED);
  for (let ordinal = 0; ordinal < rosterIds.length; ordinal++) {
    const accepted = log.append({ gameId: "retro", round: projection.round, phase: Phase.RETROSPECTIVE,
      type: "retrospective.statement_recorded", payload: statement(projection.retrospective!), visibility: "public", timestamp: new Date().toISOString() });
    applyCanonicalEvent(projection, accepted);
  }
  const complete = log.append({ gameId: "retro", round: projection.round, phase: Phase.RETROSPECTIVE,
    type: "retrospective.completed", payload: retrospectiveCompletionProof(projection.retrospective!), visibility: "public", timestamp: new Date().toISOString() });
  applyCanonicalEvent(projection, complete);
  expect(projection.retrospective?.completedAtEventSequence).toBe(complete.sequence);
  expect(replayCanonicalEvents(log.list())).toEqual(projection);
  expect(() => applyCanonicalEvent(projection, { ...complete, sequence: complete.sequence + 1 })).toThrow("further records");
});

test("Werewolf reducer accepts only validated post-result records, preserving faction/deaths", async () => {
  const events = await werewolfResultsFixture("village", "retro-werewolf"), before = replayWerewolf(events);
  const source = before.retrospectiveOutcomeSource!;
  const dossier: RetrospectiveInputV1 = { version: 1, outcome: source, sections: [{ phase: "game", fromEventSequence: 1,
    throughEventSequence: source.eventSequence, summary: "The village eliminated the wolf." }], dialogue: [] };
  let state = applyWerewolfEvent(before, { gameId: before.gameId, sequence: before.sequence + 1, type: "werewolf.retrospective_started",
    payload: createRetrospectiveDefinition(dossier, compileWerewolfRetrospective(events).speakerIds) });
  expect(state.phase).toBe("retrospective");
  expect(werewolfActionPlans(state)).toEqual([]);
  const unchanged = structuredClone(state);
  expect(() => applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1, type: "werewolf.retrospective_statement_recorded", payload: { ...statement(state.retrospective!), actorId: "foreign" } })).toThrow("prepared slot");
  expect(state).toEqual(unchanged);
  expect(() => applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1, type: "werewolf.phase_started", payload: { phase: "night", day: state.day + 1 } })).toThrow("already complete");
  for (const _player of before.players) {
    state = applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1, type: "werewolf.retrospective_statement_recorded", payload: statement(state.retrospective!) });
  }
  state = applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1, type: "werewolf.retrospective_completed", payload: retrospectiveCompletionProof(state.retrospective!) });
  expect(state.phase).toBe("complete");
  expect(state.outcome).toEqual(before.outcome); expect(state.aliveIds).toEqual(before.aliveIds);
  expect(state.roles).toEqual(before.roles); expect(state.history.slice(0, before.history.length)).toEqual(before.history);
  expect(state.history.slice(before.history.length).map(entry => entry.kind === "speech" && entry.purpose)).toEqual(before.players.map(() => "retrospective"));
});
