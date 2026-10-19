import { expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { werewolfResultsFixture, type WerewolfResultScenario } from "../fixtures/werewolf-results";
import { fixtureRetrospectiveCapacity, RetrospectiveStatementFixture } from "../fixtures/retrospective-agent";
import { advanceWerewolf, runWerewolf, werewolfExecutionFinished, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";
import { applyWerewolfEvent, replayWerewolf } from "../werewolf/rules";
import { werewolfRetrospectivePerspective } from "../werewolf/retrospective-perspective";
import { compileWerewolfRetrospective } from "../werewolf/retrospective";
import { projectWerewolfView } from "../werewolf/observation";
import { ProviderUnavailableError } from "../provider-execution";
import { createRetrospectiveDefinition, type RetrospectiveInputV1 } from "../retrospective";

test("v7 retains its original completion boundary without appending or dispatching a retrospective", async () => {
  const events = await werewolfResultsFixture("village", "v7-existing");
  const source = compileWerewolfRetrospective(events);
  const initial = events[0]!;
  if (initial.type !== "werewolf.started") throw new Error("Fixture requires its setup event");
  initial.payload.config.rulesVersion = 7;
  const original = structuredClone(events);
  const state = events.reduce((previous, event) => applyWerewolfEvent(previous, event), null as ReturnType<typeof applyWerewolfEvent> | null)!;
  expect(state.config.rulesVersion).toBe(7);
  expect(state.phase).toBe("complete");
  expect(state.retrospective).toBeNull();
  expect(state.retrospectiveOutcomeSource).toBeNull();
  expect(werewolfExecutionFinished(state)).toBeTrue();
  const unexpected = async (): Promise<never> => { throw new Error("A completed v7 game must not dispatch or append"); };
  const agent: WerewolfAgent = { prepareRetrospectiveCapacity: unexpected, getRetrospectiveStatement: unexpected, decide: unexpected };
  const store: WerewolfStore = { read: async () => structuredClone(events), append: unexpected };
  expect(await advanceWerewolf(store, agent)).toEqual(state);
  expect(await runWerewolf(store, agent)).toEqual(state);
  expect(() => compileWerewolfRetrospective(events)).toThrow("canonical outcome");
  expect(() => applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1,
    type: "werewolf.retrospective_started", payload: createRetrospectiveDefinition(source.input, source.speakerIds) })).toThrow("rules v7");
  const corrupt = structuredClone(initial);
  const playerId = state.players[0]!.id;
  corrupt.payload.roles[playerId] = initial.payload.roles[playerId] === "werewolf" ? "villager" : "werewolf";
  expect(() => applyWerewolfEvent(null, corrupt)).toThrow("role assignment");
  expect(events).toEqual(original);
});

test.each<WerewolfResultScenario>(["village", "wolves", "saved", "disagreement", "unavailable"])("%s: resumes every postgame boundary with complete context and exact priors", async scenario => {
  const events = await werewolfResultsFixture(scenario, `rt05-${scenario}`), before = replayWerewolf(events);
  let input: RetrospectiveInputV1 | null = null, admissions = 0;
  const fixture = new RetrospectiveStatementFixture(before.players.map((_, i) => ({ speech: `  Statement ${i}: changed my mind. 😀\n ` })));
  const agent: WerewolfAgent = {
    async prepareRetrospectiveCapacity(signal) { admissions++; return fixtureRetrospectiveCapacity(signal); },
    getRetrospectiveStatement: ({ context, signal }) => fixture.emit(context, signal),
    async decide() { throw new Error("Gameplay cannot resume after an outcome"); },
  };
  const store = (): WerewolfStore => ({
    read: async () => structuredClone(events), readRetrospectiveInput: async () => structuredClone(input),
    async append(event, dossier) { applyWerewolfEvent(replayWerewolf(events), event); if (dossier) input = structuredClone(dossier); events.push(event); },
  });
  expect(before.phase).toBe("retrospective"); expect(werewolfExecutionFinished(before)).toBeFalse();
  let state = await advanceWerewolf(store(), agent);
  const definition = structuredClone(state.retrospective!.definition);
  while (!werewolfExecutionFinished(state)) state = await advanceWerewolf(store(), agent);
  expect(admissions).toBe(1); expect(state.retrospective!.definition).toEqual(definition);
  expect(state.retrospective!.statements.map(statement => statement.actorId)).toEqual(compileWerewolfRetrospective(events).speakerIds);
  for (const [ordinal, context] of fixture.contexts.entries()) {
    expect(context.game).toEqual(input!);
    expect(context.priorStatements.map(prior => prior.speech)).toEqual(state.retrospective!.statements.slice(0, ordinal).map(statement => statement.speech));
    expect(context.self).toEqual(before.players.filter(player => player.id === context.request.actorId).map(({ id, name, personality, backstory, strategy }) => ({ id, name, personality, backstory, strategy, werewolfPerspective: werewolfRetrospectivePerspective(events, before, id) }))[0]!);
    expect(state.retrospective!.statements[ordinal]!.requestHash).toBe(hashCanonicalJson(context.request));
  }
  expect(state.outcome).toEqual(before.outcome); expect(state.roles).toEqual(before.roles);
  expect(state.aliveIds).toEqual(before.aliveIds); expect(state.openingCursor).toEqual(before.openingCursor);
  expect(state.history.slice(0, before.history.length)).toEqual(before.history);
  for (const audience of ["mystery", "omniscient"] as const) {
    const view = projectWerewolfView(state, audience);
    expect(view.entries.filter(entry => entry.kind === "speech" && entry.purpose === "retrospective")).toHaveLength(before.players.length);
    expect(JSON.stringify(view)).not.toContain("SECRET_STRATEGY");
  }
  expect(await runWerewolf(store(), agent)).toEqual(state); expect(fixture.contexts).toHaveLength(before.players.length);
});

test("required speech failure and cancelled capacity admission leave the same frontier", async () => {
  const events = await werewolfResultsFixture("village", "rt05-failure");
  const store: WerewolfStore = { read: async () => structuredClone(events), async append(event) { applyWerewolfEvent(replayWerewolf(events), event); events.push(event); } };
  const unavailable: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity,
    async getRetrospectiveStatement() { throw new ProviderUnavailableError("Required speech exhausted", "malformed_output"); },
    async decide() { throw new Error("Gameplay call"); } };
  const controller = new AbortController();
  await expect(advanceWerewolf(store, { ...unavailable, async prepareRetrospectiveCapacity(signal) { controller.abort(new Error("Drain")); return fixtureRetrospectiveCapacity(signal); } }, controller.signal)).rejects.toThrow("Drain");
  expect(replayWerewolf(events).retrospective).toBeNull();
  await advanceWerewolf(store, unavailable);
  const before = structuredClone(events);
  await expect(advanceWerewolf(store, unavailable)).rejects.toMatchObject({ stage: "statement", code: "malformed_output" });
  expect(events).toEqual(before); expect(werewolfExecutionFinished(replayWerewolf(events))).toBeFalse();
});

test("a validly hashed reordered roster cannot replace the canonical death and survivor order", async () => {
  const events = await werewolfResultsFixture("village", "rt05-order"), state = replayWerewolf(events), source = compileWerewolfRetrospective(events);
  const reversed = createRetrospectiveDefinition(source.input, [...source.speakerIds].reverse());
  expect(() => applyWerewolfEvent(state, { gameId: state.gameId, sequence: state.sequence + 1, type: "werewolf.retrospective_started", payload: reversed })).toThrow("speaker order");
  expect(state.retrospective).toBeNull();
});
