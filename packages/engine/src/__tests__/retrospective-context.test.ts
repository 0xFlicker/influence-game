import { describe, expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { GameState } from "../game-state";
import { CanonicalEventLog } from "../canonical-event-log";
import { replayCanonicalEvents } from "../game-projection";
import { Phase } from "../types";
import type { TranscriptEntry } from "../game-runner.types";
import { freezeInfluenceRetrospective, type InfluenceRetrospectiveSeat } from "../influence-retrospective";
import { freezeWerewolfRetrospective } from "../werewolf/retrospective";
import { werewolfResultsFixture, type WerewolfResultScenario } from "../fixtures/werewolf-results";
import { replayWerewolf } from "../werewolf/rules";
import { applyRetrospectiveRecord, assertRetrospectiveInput, prepareRetrospectiveRequest,
  type RetrospectiveStateV1 } from "../retrospective";
import { materializeRetrospectiveContext, preflightRetrospectiveContext,
  serializeRetrospectiveContext, type FrozenRetrospectiveGame } from "../retrospective-context";

const capacities = { effectiveModelIds: ["fixture-primary", "fixture-fallback"], models: [
  { modelId: "fixture-primary", maxContextBytes: 1_000_000 }, { modelId: "fixture-fallback", maxContextBytes: 1_000_000 },
] };
const seats: InfluenceRetrospectiveSeat[] = ["atlas", "echo", "mira", "rex"].map(id => ({ id, name: id,
  personality: `${id} personality`, backstory: `${id} backstory`, influenceStrategy: `${id} ORIGINAL_STRATEGY` }));

function classicFixture() {
  const game = new GameState(seats.map(({ id, name }) => ({ id, name })), { gameId: "rt02-classic" });
  game.startRound();
  game.recordPhaseEntered(Phase.INTRODUCTION);
  const introduction = game.getCanonicalEvents().at(-1)!.sequence;
  game.recordPhaseEntered(Phase.LOBBY);
  game.recordPhaseEntered(Phase.MINGLE);
  const mingle = game.getCanonicalEvents().at(-1)!.sequence;
  game.recordPhaseEntered(Phase.POWER);
  game.setEmpowered("atlas"); game.setPowerAction({ action: "pass", target: "atlas" });
  game.recordPhaseEntered(Phase.COUNCIL); game.eliminatePlayer("echo");
  game.recordPhaseEntered(Phase.PLEA);
  game.recordEliminationMessage("echo", "I leave before Mira's turn.", Phase.PLEA);
  game.eliminatePlayer("mira");
  game.setEndgameStage("judgment"); game.recordPhaseEntered(Phase.CLOSING_ARGUMENTS);
  game.recordJudgmentSpeech({ playerId: "rex", speechKind: "closing_argument", text: "I did not betray anyone.", provenance: "agent", phase: Phase.CLOSING_ARGUMENTS });
  const closing = game.getCanonicalEvents().at(-1)!.sequence;
  game.recordPhaseEntered(Phase.JURY_VOTE);
  game.recordJuryVote("echo", "rex"); game.recordJuryVote("mira", "atlas");
  game.tallyJuryVotes(() => 0.9);
  const transcript: TranscriptEntry[] = [
    { entrySequence: 1, speakerPlayerId: "echo", from: "a duplicate display name", scope: "public", round: 1,
      phase: Phase.INTRODUCTION, timestamp: 1, text: "I promise Atlas my vote.", thinking: "SECRET_THINKING", reasoningContext: "SECRET_NATIVE_REASONING" },
    { entrySequence: 2, speakerPlayerId: "atlas", from: "not an authority", scope: "whisper", audiencePlayerIds: ["atlas", "rex"],
      round: 1, phase: Phase.MINGLE, timestamp: 2, text: "We can work together." },
    { entrySequence: 3, speakerPlayerId: "rex", from: "rex", scope: "public", round: 1,
      phase: Phase.CLOSING_ARGUMENTS, timestamp: 3, text: "Late game statement after Echo left." },
    { entrySequence: 4, speakerPlayerId: "atlas", from: "atlas", scope: "public", round: 1,
      phase: Phase.RETROSPECTIVE, timestamp: 4, text: "FUTURE_RETROSPECTIVE" },
    { from: "echo", scope: "thinking", round: 1, phase: Phase.COUNCIL, timestamp: 2, text: "SECRET_DIARY", thinking: "SECRET_COGNITION" },
  ];
  return { events: game.getCanonicalEvents(), transcript, transcriptThroughSequence: 3,
    dialogueAnchors: [{ entrySequence: 1, eventSequence: introduction }, { entrySequence: 2, eventSequence: mingle }, { entrySequence: 3, eventSequence: closing }], seats, capacities };
}

function started(frozen: FrozenRetrospectiveGame): RetrospectiveStateV1 {
  return applyRetrospectiveRecord(null, { kind: "started", payload: frozen.definition }, {
    outcome: frozen.input.outcome, rosterIds: frozen.definition.speakerIds, eventSequence: frozen.input.outcome.eventSequence + 1,
  });
}
function accept(state: RetrospectiveStateV1, speech: string): RetrospectiveStateV1 {
  const request = prepareRetrospectiveRequest(state);
  return applyRetrospectiveRecord(state, { kind: "statement", payload: { version: 1, definitionHash: request.definitionHash,
    actorId: request.actorId, ordinal: request.ordinal, priorStatementsHash: request.priorStatementsHash,
    requestHash: hashCanonicalJson(request), providerLogicalCallId: `rt02-${request.ordinal}`, speech } }, {
    outcome: state.definition.outcome, rosterIds: state.definition.speakerIds, eventSequence: state.startedAtEventSequence + state.statements.length + 1,
  });
}

describe("frozen Influence account", () => {
  test("covers every phase through a tied finale, in exit/finalist/winner order", () => {
    const fixture = classicFixture(), frozen = freezeInfluenceRetrospective(fixture);
    expect(frozen.definition.speakerIds).toEqual(["echo", "mira", "atlas", "rex"]);
    expect(() => assertRetrospectiveInput(frozen.input)).not.toThrow();
    const account = frozen.input.sections.map(section => section.summary).join("\n");
    expect(account).toContain('"action":"pass"');
    expect(account).toContain('"method":"random_tiebreaker"');
    expect(account).toContain('"winnerId":"rex"');
    expect(account).not.toContain("I promise Atlas");
    for (const event of fixture.events) expect(account).toContain(`[event ${event.sequence}]`);
    for (const phase of [Phase.INTRODUCTION, Phase.LOBBY, Phase.MINGLE, Phase.POWER, Phase.COUNCIL, Phase.PLEA, Phase.CLOSING_ARGUMENTS, Phase.JURY_VOTE]) {
      expect(frozen.input.sections.some(section => section.phase.endsWith(`/${phase}`))).toBe(true);
    }
    const context = materializeRetrospectiveContext(frozen, started(frozen));
    expect(context.self.id).toBe("echo");
    expect(context.game.dialogue.some(quote => quote.text === "Late game statement after Echo left.")).toBe(true);
    expect(context.game.dialogue.find(quote => quote.scope === "whisper")?.audiencePlayerIds).toEqual(["atlas", "rex"]);
    const rendered = serializeRetrospectiveContext(context);
    expect(rendered).toContain("echo ORIGINAL_STRATEGY");
    for (const forbidden of ["SECRET_THINKING", "SECRET_NATIVE_REASONING", "SECRET_DIARY", "SECRET_COGNITION", "atlas ORIGINAL_STRATEGY", "FUTURE_RETROSPECTIVE"]) expect(rendered).not.toContain(forbidden);
    expect(freezeInfluenceRetrospective(fixture)).toEqual(frozen);
  });

  test("requires complete dialogue and exact source identity, never display-name inference", () => {
    const fixture = classicFixture();
    expect(() => freezeInfluenceRetrospective({ ...fixture, transcript: fixture.transcript.slice(1) })).toThrow("complete ordered");
    expect(() => freezeInfluenceRetrospective({ ...fixture, dialogueAnchors: fixture.dialogueAnchors.slice(1) })).toThrow("source anchor");
    expect(() => freezeInfluenceRetrospective({ ...fixture, dialogueAnchors: [...fixture.dialogueAnchors, fixture.dialogueAnchors[0]!] })).toThrow("source anchors");
    expect(() => freezeInfluenceRetrospective({ ...fixture, dialogueAnchors: fixture.dialogueAnchors.map(anchor => ({ ...anchor, eventSequence: 99999 })) })).toThrow("source anchors");
    expect(() => freezeInfluenceRetrospective({ ...fixture, transcript: fixture.transcript.map(entry => ({ ...entry, speakerPlayerId: null })) })).toThrow("speaker identity");
    expect(() => freezeInfluenceRetrospective({ ...fixture, transcript: fixture.transcript.map(entry => ({ ...entry, phase: Phase.RETROSPECTIVE })) })).toThrow("outside the original game account");
    expect(() => freezeInfluenceRetrospective({ ...fixture, transcript: fixture.transcript.map(entry => ({ ...entry, audiencePlayerIds: ["foreign-owner"] })) })).toThrow("outside the original roster");
    expect(() => freezeInfluenceRetrospective({ ...fixture, seats: seats.map(seat => ({ ...seat, name: "Current profile name" })) })).toThrow("original seat identity");
  });

  test("a format ending with one survivor keeps tie aggregates and excludes production internals", () => {
    const game = new GameState(seats.slice(0, 3), { gameId: "rt02-format" });
    game.recordPhaseEntered(Phase.FORMAT_RESOLVE);
    game.recordFormatBallot({ formatId: "vote_bomb", voterId: "atlas", targetId: "echo" });
    game.recordFormatResolution({ formatId: "vote_bomb", empoweredId: "atlas", eliminatedId: "echo", resolutionKind: "clear",
      tiedPlayerIds: ["echo", "mira"], tiebreakerId: "atlas", aggregate: { capability: "sealed_elim", totals: { echo: 2, mira: 2 }, eligiblePlayerIds: ["echo", "mira"] } });
    game.eliminatePlayer("echo"); game.eliminatePlayer("mira");
    const frozen = freezeInfluenceRetrospective({ events: game.getCanonicalEvents(), transcript: [], transcriptThroughSequence: 0, dialogueAnchors: [], seats: seats.slice(0, 3), capacities });
    expect(frozen.definition.speakerIds).toEqual(["echo", "mira", "atlas"]);
    expect(frozen.input.sections.map(section => section.summary).join("\n")).toContain('"tiedPlayerIds":["echo","mira"]');
    expect(frozen.input.sections.at(-1)?.summary).toContain("outcome winner=atlas");
    const ballotLine = frozen.input.sections.flatMap(section => section.summary.split("\n")).find(line => line.includes("format.ballot_cast"))!;
    expect(ballotLine).toContain("sealed_ballot_recorded");
    expect(ballotLine).not.toContain("targetId");
  });

  test("restart reuses the committed definition and rejects source drift", () => {
    const fixture = classicFixture(), frozen = freezeInfluenceRetrospective(fixture);
    const log = new CanonicalEventLog(); log.replaceAll(fixture.events);
    log.append({ gameId: frozen.input.outcome.gameId, phase: Phase.RETROSPECTIVE, round: 1, visibility: "public",
      type: "retrospective.started", payload: frozen.definition, timestamp: new Date().toISOString() });
    const adopted = { ...fixture, events: log.list() };
    expect(freezeInfluenceRetrospective(adopted)).toEqual(frozen);
    expect(() => freezeInfluenceRetrospective({ ...adopted, transcript: fixture.transcript.map(entry => ({ ...entry, text: "CHANGED_SOURCE" })) })).toThrow("already frozen");
    expect(replayCanonicalEvents(log.list()).retrospective?.definition).toEqual(frozen.definition);
  });
});

test("formal transcript correlation keeps one exact quote instead of guessing from text", () => {
  const fixture = classicFixture(), game = GameState.fromCanonicalEvents(fixture.events.slice(0, -1));
  game.recordPhaseEntered(Phase.PLEA);
  game.recordEndgameSpeech({ playerId: "atlas", speechKind: "plea", text: "A formal plea", provenance: "agent", phase: Phase.PLEA, correlationKey: "formal-plea" });
  game.tallyJuryVotes(() => 0.9);
  const events = game.getCanonicalEvents(), formal = events.find(event => event.type === "endgame.speech_recorded")!;
  const transcript: TranscriptEntry[] = [{ from: "atlas", speakerPlayerId: "atlas", entrySequence: 1, scope: "public", round: 1,
    phase: Phase.PLEA, timestamp: 1, text: "A formal plea", dialogueContext: { version: 1, formalSpeechCorrelationKey: "formal-plea" } }];
  const frozen = freezeInfluenceRetrospective({ events, transcript, transcriptThroughSequence: 1,
    dialogueAnchors: [{ entrySequence: 1, eventSequence: formal.sequence }], seats, capacities });
  expect(frozen.input.dialogue.filter(quote => quote.text === "A formal plea")).toHaveLength(1);
  expect(frozen.input.dialogue.find(quote => quote.text === "A formal plea")?.source).toEqual({ kind: "canonical_event", sequence: formal.sequence });
  expect(() => freezeInfluenceRetrospective({ events, transcript: transcript.map(entry => ({ ...entry, text: "Changed speech" })), transcriptThroughSequence: 1,
    dialogueAnchors: [{ entrySequence: 1, eventSequence: formal.sequence }], seats, capacities })).toThrow("correlated product speech differ");
});

describe("frozen Werewolf account", () => {
  for (const scenario of ["village", "wolves", "saved", "disagreement", "unavailable"] satisfies WerewolfResultScenario[]) {
    test(`${scenario}: complete facts, death order, stable survivors and no cognition`, async () => {
      const events = await werewolfResultsFixture(scenario, `rt02-${scenario}`), original = replayWerewolf(events), before = structuredClone(original);
      const frozen = freezeWerewolfRetrospective({ events, capacities });
      const deaths = events.flatMap(event => event.type === "werewolf.night_resolved" && event.payload.killedId ? [event.payload.killedId]
        : event.type === "werewolf.day_vote_resolved" && event.payload.eliminatedId ? [event.payload.eliminatedId] : []);
      expect(frozen.definition.speakerIds.slice(0, deaths.length)).toEqual(deaths);
      expect(new Set(frozen.definition.speakerIds.slice(deaths.length))).toEqual(new Set(original.aliveIds));
      expect(new Set(frozen.definition.speakerIds).size).toBe(original.players.length);
      const account = frozen.input.sections.map(section => section.summary).join("\n");
      for (const event of events) expect(account).toContain(`[event ${event.sequence}]`);
      expect(account).toContain(`"reason":"${original.outcome!.reason}"`);
      expect(account).not.toContain("SECRET_THINKING"); expect(account).not.toContain("SECRET_STRATEGY"); expect(account).not.toContain("SECRET_SEED");
      if (scenario === "saved") expect(account).toContain('"result":"doctor_save"');
      if (scenario === "disagreement") expect(account).toContain('"endReason":"attempt_limit"');
      if (scenario === "unavailable") expect(account).toContain('"unavailable":true');
      if (["saved", "disagreement", "unavailable"].includes(scenario)) expect(account).toContain('"faction":null');
      if (scenario === "village") expect(original.outcome!.winnerIds.some(id => !original.aliveIds.includes(id))).toBe(true);
      expect(frozen.input.dialogue.some(quote => quote.scope === "pack" && quote.text === "SECRET_PACK")).toBe(scenario !== "village");
      const resumedEvents = [...events, { gameId: original.gameId, sequence: original.sequence + 1,
        type: "werewolf.retrospective_started" as const, payload: frozen.definition }];
      expect(freezeWerewolfRetrospective({ events: resumedEvents, capacities })).toEqual(frozen);
      expect(replayWerewolf(events)).toEqual(before);
    });
  }
});

test("later speakers receive exact committed priors and only their original character", () => {
  const frozen = freezeInfluenceRetrospective(classicFixture());
  let state = started(frozen);
  state = accept(state, "  Echo: I was wrong about the winner.\n ");
  state = accept(state, "Mira: I disagree with Echo. 😀");
  const context = materializeRetrospectiveContext(frozen, state);
  expect(context.self.id).toBe("atlas");
  expect(context.priorStatements.map(statement => statement.speech)).toEqual(["  Echo: I was wrong about the winner.\n ", "Mira: I disagree with Echo. 😀"]);
  expect(serializeRetrospectiveContext(context)).not.toContain("echo ORIGINAL_STRATEGY");
  context.game.dialogue.length = 0;
  expect(frozen.input.dialogue.length).toBeGreaterThan(0);
  expect(materializeRetrospectiveContext(frozen, state).priorStatements).toHaveLength(2);
});

test("preflight reserves worst-case JSON speech bytes for all speakers and fallback models", () => {
  const frozen = freezeInfluenceRetrospective(classicFixture()), receipts = preflightRetrospectiveContext(frozen, capacities);
  expect(receipts).toHaveLength(seats.length * capacities.models.length);
  const worst = receipts.filter(receipt => receipt.modelId === "fixture-primary").at(-1)!;
  expect(worst.actorId).toBe("rex");
  let state = started(frozen);
  for (let i = 0; i < 3; i++) state = accept(state, "\u0000".repeat(2000));
  expect(new TextEncoder().encode(serializeRetrospectiveContext(materializeRetrospectiveContext(frozen, state))).byteLength).toBeLessThanOrEqual(worst.requiredBytes);
  const constrained = preflightRetrospectiveContext(frozen, { effectiveModelIds: ["fixture-primary", "limited-fallback"],
    models: [capacities.models[0]!, { modelId: "limited-fallback", maxContextBytes: worst.requiredBytes - 1 }] });
  expect(constrained.find(receipt => receipt.modelId === "limited-fallback" && receipt.actorId === "rex"))
    .toMatchObject({ requiredBytes: worst.requiredBytes, availableBytes: worst.requiredBytes - 1 });
  expect(() => preflightRetrospectiveContext(frozen, { ...capacities, models: [] })).toThrow("admitted input budget");
  expect(() => preflightRetrospectiveContext(frozen, { ...capacities, models: [capacities.models[0]!] })).toThrow("admitted input budget");
  expect(() => preflightRetrospectiveContext(frozen, { effectiveModelIds: ["unknown"], models: [{ modelId: "unknown", maxContextBytes: Number.NaN }] })).toThrow("admitted input budget");
});

test("long games retain their complete social account despite storage and estimated context sizes", async () => {
  const events = await werewolfResultsFixture("saved", "rt02-long", 4), frozen = freezeWerewolfRetrospective({ events, capacities });
  expect(frozen.input.sections.some(section => section.phase === "day:4/vote")).toBe(true);
  expect(frozen.input.dialogue.length).toBeGreaterThan(8);
  expect(freezeWerewolfRetrospective({ events, capacities: { effectiveModelIds: ["too-small"], models: [{ modelId: "too-small", maxContextBytes: 500 }] } }).input).toEqual(frozen.input);
  expect(freezeWerewolfRetrospective({ events, capacities }).input).toEqual(frozen.input);
  const fixture = classicFixture();
  const text = "界".repeat(120_000);
  const large = freezeInfluenceRetrospective({ ...fixture, transcript: fixture.transcript.map(entry => ({ ...entry, text })) });
  expect(new TextEncoder().encode(JSON.stringify(large.input)).byteLength).toBeGreaterThan(256 * 1024);
  expect(large.input.dialogue.some(entry => entry.text === text)).toBeTrue();
  expect(() => assertRetrospectiveInput(large.input)).not.toThrow();
});
