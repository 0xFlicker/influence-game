import { expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { completedCurrentWerewolfFixture, werewolfResultsFixture } from "../fixtures/werewolf-results";
import { replayWerewolf } from "../werewolf/rules";
import { compileWerewolfRetrospective } from "../werewolf/retrospective";
import { assertWerewolfRetrospectivePerspective } from "../werewolf/retrospective-perspective";
import { assertRetrospectiveSpeakerContext, freezeRetrospectiveGame, materializeRetrospectiveContext } from "../retrospective-context";
import { applyRetrospectiveRecord, assertRetrospectiveInput, type RetrospectiveDefinitionV1 } from "../retrospective";

test.each(["village", "wolves", "saved", "disagreement", "unavailable", "current"] as const)("%s: personal reference preserves actual choices and separates private knowledge from revealed facts", async scenario => {
  const events = scenario === "current" ? await completedCurrentWerewolfFixture("perspective-current")
    : await werewolfResultsFixture(scenario, `perspective-${scenario}`);
  const source = compileWerewolfRetrospective(events), state = replayWerewolf(events);
  for (const speaker of source.speakers) {
    const perspective = speaker.werewolfPerspective;
    const known = perspective.knownDuringPlay;
    const revealed = (id: string) => ({id, name: state.players.find(p => p.id === id)!.name, role: state.roles[id]!});
    const summary = perspective.revealedAfterGame;
    expect(summary.winningFaction).toBe(state.outcome!.faction);
    expect(summary.reason).toBe(state.outcome!.reason);
    expect(summary.winners).toEqual(state.outcome!.winnerIds.map(revealed));
    expect(summary.survivors).toEqual(state.aliveIds.map(revealed));
    const eliminations: typeof summary.eliminations = [];
    const votes: typeof summary.dayVotes = [];
    let day = 0;
    for (const event of events) {
      if (event.type === "werewolf.phase_started") day = event.payload.day;
      if (event.type === "werewolf.night_resolved" && event.payload.killedId) eliminations.push({eventSequence: event.sequence, day, cause: "night", player: revealed(event.payload.killedId)});
      if (event.type === "werewolf.day_vote_resolved") {
        const result = event.payload;
        if (result.eliminatedId) eliminations.push({eventSequence: event.sequence, day, cause: "vote", player: revealed(result.eliminatedId)});
        votes.push({eventSequence: event.sequence, day, voteMode: result.voteMode, requiredVotes: result.requiredVotes,
          totals: Object.entries(result.totals).filter(([, votes]) => votes > 0).map(([id, votes]) => ({player: revealed(id), votes})),
          abstentions: result.ballots.filter(b => b.targetId === null).length, eliminated: result.eliminatedId ? revealed(result.eliminatedId) : null});
      }
    }
    expect(summary.eliminations).toEqual(eliminations);
    expect(summary.dayVotes).toEqual(votes);
    expect(summary.survivors.some(p => summary.eliminations.some(e => e.player.id === p.id))).toBe(false);
    if (scenario === "village") expect(summary.winners.some(p => summary.eliminations.some(e => e.player.id === p.id))).toBe(true);
    if (scenario === "current") {
      expect(summary.dayVotes).toHaveLength(1);
      expect(summary.dayVotes[0]).toMatchObject({eliminated: null, totals: [], abstentions: 5, requiredVotes: 3});
    }
    expect(known.role).toBe(state.roles[speaker.id]!);
    expect(known.faction).toBe(known.role === "werewolf" ? "wolves" : "village");
    expect(known.packMembers.map(p => p.id)).toEqual(known.role === "werewolf" ? state.players.filter(p => state.roles[p.id] === "werewolf").map(p => p.id) : []);
    for (const action of perspective.ownRecordedActions) {
      const event = events.find(e => e.sequence === action.eventSequence)!;
      if (event.type !== "werewolf.action_accepted") throw new Error("Expected recorded action");
      expect(event.payload.actorId).toBe(speaker.id);
      expect(event.payload.action).toBe(action.action);
      expect(action.unavailable).toBe(event.payload.fallback !== null);
      const decision = event.payload.decision;
      if (decision.kind !== "target" && decision.kind !== "spoken_target") throw new Error("Expected target decision");
      expect(action.target).toEqual(decision.targetId === null ? null : state.players.filter(p => p.id === decision.targetId).map(({id, name}) => ({id, name}))[0]!);
    }
    expect(perspective.ownRecordedActions).toHaveLength(events.filter(e => e.type === "werewolf.action_accepted" && e.payload.actorId === speaker.id && ["target", "spoken_target"].includes(e.payload.decision.kind)).length);
    const expectedChecks = events.flatMap(e => e.type === "werewolf.night_resolved" && e.payload.investigation?.seerId === speaker.id
      && (perspective.eliminatedAtEventSequence === null || e.sequence < perspective.eliminatedAtEventSequence) ? [e.sequence] : []);
    expect(known.investigations.map(result => result.eventSequence)).toEqual(expectedChecks);
    if (known.role !== "seer") expect(known.investigations).toEqual([]);
    for (const result of known.investigations) {
      const event = events.find(e => e.sequence === result.eventSequence)!;
      if (event.type !== "werewolf.night_resolved") throw new Error("Expected resolved night");
      expect(result.isWolf).toBe(event.payload.investigation!.isWolf);
      expect(result.target.id).toBe(event.payload.investigation!.targetId);
    }
    expect(JSON.stringify(perspective)).not.toContain("SECRET_THINKING");
    expect(JSON.stringify(perspective)).not.toContain("SECRET_STRATEGY");
  }
  if (scenario === "village") {
    const seer = source.speakers.find(s => s.werewolfPerspective.knownDuringPlay.role === "seer")!;
    expect(events.some(e => e.type === "werewolf.night_resolved" && e.payload.killedId === seer.id && e.payload.investigation?.seerId === seer.id)).toBe(true);
    expect(seer.werewolfPerspective.knownDuringPlay.investigations).toEqual([]);
    expect(source.input.sections.some(s => s.summary.includes('"seerId"'))).toBe(true);
  }
  if (scenario === "unavailable") expect(source.speakers.flatMap(s => s.werewolfPerspective.ownRecordedActions).some(a => a.unavailable)).toBe(true);
});

test.each([10, 11] as const)("v%s solo choices retain canonical targets and actor-only explanation provenance", async version => {
  const events = await completedCurrentWerewolfFixture(`solo-perspective-${version}`, version,
    { playerCount: 6, wolves: 1, seer: true, doctor: true });
  const source = compileWerewolfRetrospective(events);
  const solo = events.filter(event => event.type === "werewolf.action_accepted" && event.payload.decision.kind === "solo_target");
  expect(solo).toHaveLength(3);
  for (const event of solo) {
    if (event.type !== "werewolf.action_accepted" || event.payload.decision.kind !== "solo_target") throw new Error("Expected solo action");
    const { actorId, action, decision } = event.payload;
    const perspective = source.speakers.find(speaker => speaker.id === actorId)!.werewolfPerspective;
    expect(perspective.ownRecordedActions.find(item => item.eventSequence === event.sequence)).toMatchObject({
      action, target: { id: decision.targetId }, unavailable: false,
    });
    const section = source.input.sections.find(item => item.fromEventSequence <= event.sequence && item.throughEventSequence >= event.sequence)!;
    const fact = section.summary.split("\n").find(line => line.includes(`\"actorId\":\"${actorId}\"`) && line.includes(`\"action\":\"${action}\"`));
    expect(fact).toContain(`\"targetId\":\"${decision.targetId}\"`);
    const quote = source.input.dialogue.find(item => item.eventSequence === event.sequence)!;
    expect(quote).toMatchObject({ actorId, scope: "private", audiencePlayerIds: [actorId], text: decision.text });
    for (const audience of [null, [], [actorId, "another-player"], ["another-player"]]) {
      const invalid = structuredClone(source.input);
      invalid.dialogue.find(item => item.eventSequence === event.sequence)!.audiencePlayerIds = audience;
      expect(() => assertRetrospectiveInput(invalid)).toThrow("actor-only audience");
    }
  }
  expect(() => assertRetrospectiveInput(source.input)).not.toThrow();
});

test("historical solo retrospective adopts only the exact frozen account and speaker context", async () => {
  // Literal definition and hashes captured from 3e2eb45f before fixing solo provenance.
  const all = await completedCurrentWerewolfFixture("solo-retrospective-historical", 10,
    { playerCount: 6, wolves: 1, seer: true, doctor: true });
  const events = all.slice(0, all.findIndex(event => event.type === "werewolf.retrospective_started") + 1);
  const started = events.at(-1)!;
  if (started.type !== "werewolf.retrospective_started") throw new Error("Expected retrospective start");
  const historicalInputHash = "sha256:d82c2c3b1c800da6c117750bf0a0749d1c11906a81a19e060f0b21a4ce20a97e" as const;
  const definition: RetrospectiveDefinitionV1 = {
    version: 1, promptVersion: "retrospective.v1",
    outcome: { gameId: "solo-retrospective-historical", gameKind: "werewolf", eventSequence: 31,
      eventHash: "sha256:e1114623a04736e0bc45ac742506a7a7c0698dd1ec561439e0048b1f483a42a7" },
    inputHash: historicalInputHash,
    speakerIds: ["solo-retrospective-historical-p2", "solo-retrospective-historical-p0", "solo-retrospective-historical-p3",
      "solo-retrospective-historical-p4", "solo-retrospective-historical-p1", "solo-retrospective-historical-p5"],
    definitionHash: "sha256:4d341bf4dcf70f2c57926bffd5e6e19c573cc722e82f5d2145e27b8de415eef2",
  };
  started.payload = definition;
  const original = structuredClone(events);
  const source = compileWerewolfRetrospective(events);
  expect(hashCanonicalJson(source.input)).toBe(historicalInputHash);
  expect(hashCanonicalJson(source.speakers)).toBe("sha256:32a2fb95ffe42f80813c7abffe777ecdb7767b03b8400ca18c64e0dfb41fd485");
  const context = materializeRetrospectiveContext({ ...source, definition }, replayWerewolf(events).retrospective!);
  expect(hashCanonicalJson(context)).toBe("sha256:ca92d1462eeb47a8284ca32a291bb91cd0111597df4091c8e2033d50f90c6a1f");
  expect(events).toEqual(original);
  const corrupted = structuredClone(events);
  const corruptStart = corrupted.at(-1)!;
  if (corruptStart.type !== "werewolf.retrospective_started") throw new Error("Expected retrospective start");
  const { definitionHash: _hash, ...body } = { ...definition, inputHash: hashCanonicalJson("unavailable account") };
  corruptStart.payload = { ...body, definitionHash: hashCanonicalJson(body) };
  expect(() => compileWerewolfRetrospective(corrupted)).toThrow("source/order differs");
});

test("unavailable solo choices remain marked target facts without invented private speech", async () => {
  const all = await completedCurrentWerewolfFixture("solo-unavailable-perspective", 11,
    { playerCount: 6, wolves: 1, seer: true, doctor: true });
  const events = all.slice(0, all.findIndex(event => event.type === "werewolf.retrospective_started"));
  const soloSequences: number[] = [];
  for (const event of events) {
    if (event.type !== "werewolf.action_accepted" || event.payload.decision.kind !== "solo_target") continue;
    event.payload.fallback = "provider_unavailable";
    event.payload.decision.text = null;
    soloSequences.push(event.sequence);
  }
  const source = compileWerewolfRetrospective(events);
  const actions = source.speakers.flatMap(speaker => speaker.werewolfPerspective.ownRecordedActions)
    .filter(action => soloSequences.includes(action.eventSequence));
  expect(actions).toHaveLength(3);
  expect(actions.every(action => action.unavailable && action.target !== null)).toBe(true);
  expect(source.input.dialogue.some(quote => soloSequences.includes(quote.eventSequence))).toBe(false);
});

test("speaker context carries only its own detached perspective, rejects incompatible knowledge and preserves the speech-only account", async () => {
  const events = await werewolfResultsFixture("saved", "perspective-context");
  const source = compileWerewolfRetrospective(events);
  const frozen = freezeRetrospectiveGame(source.input, source.speakerIds, source.speakers, null, {effectiveModelIds: ["fixture"], models: [{modelId: "fixture", maxContextBytes: null}]});
  const state = applyRetrospectiveRecord(null, {kind: "started", payload: frozen.definition}, {outcome: source.input.outcome, rosterIds: source.speakerIds, eventSequence: source.input.outcome.eventSequence + 1});
  const context = materializeRetrospectiveContext(frozen, state);
  expect(context.self.werewolfPerspective).toEqual(source.speakers.find(s => s.id === context.self.id)!.werewolfPerspective);
  expect(context.game).toEqual(source.input);
  expect(JSON.stringify(context).match(/"werewolfPerspective"/g)).toHaveLength(1);
  assertRetrospectiveSpeakerContext(context);
  const original = structuredClone(frozen);
  context.self.werewolfPerspective!.ownRecordedActions.length = 0;
  expect(frozen).toEqual(original);
  const villager = structuredClone(source.speakers.find(s => s.werewolfPerspective.knownDuringPlay.role === "villager")!.werewolfPerspective);
  villager.knownDuringPlay.packMembers.push({id: "invented", name: "Invented"});
  expect(() => assertWerewolfRetrospectivePerspective(villager)).toThrow("knowledge");
  expect(() => assertWerewolfRetrospectivePerspective({...villager, thinking: "Not an output field"})).toThrow();
});
