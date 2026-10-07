import { describe, expect, test } from "bun:test";
import { exactStructuredOutputRegistry } from "../structured-output";
import { ProviderUnavailableError } from "../provider-execution";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfActionPlans, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { advanceWerewolf, runWerewolf, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";
import type { WerewolfPlayer, WerewolfState } from "../werewolf/types";

function setup(preset: "one_wolf" | "two_wolves" = "two_wolves", maxDays = 10) {
  const players: WerewolfPlayer[] = Array.from({ length: preset === "one_wolf" ? 6 : 8 }, (_, i) => ({
    id: `p${i}`, name: `Person ${i}`, personality: `Personality ${i}`, backstory: `Backstory ${i}`,
    strategy: `Private strategy ${i}`, avatarUrl: null,
  }));
  const events = [startWerewolf("test-werewolf", players, werewolfConfig(preset, maxDays), "test-seed")];
  const store: WerewolfStore = {
    read: async () => structuredClone(events),
    append: async (event) => { applyWerewolfEvent(replayWerewolf(events), event); events.push(structuredClone(event)); },
  };
  return { players, events, store };
}

const quietAgent: WerewolfAgent = {
  decide: async ({ request }) => request.action === "open_thread" ? { kind: "opening", text: null, cue: null, recipientIds: [] } : request.legalTargetIds.length
    ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE RATIONALE" }
    : { kind: "speech", cue: null, text: null },
};

async function until(ctx: ReturnType<typeof setup>, predicate: (state: WerewolfState) => boolean, agent = quietAgent) {
  let state = replayWerewolf(ctx.events);
  for (let i = 0; i < 600 && !predicate(state); i++) state = await advanceWerewolf(ctx.store, agent);
  expect(predicate(state)).toBe(true);
  return state;
}

describe("Werewolf authority and recovery", () => {
  test("admits exact presets, assigns roles once, and rejects corrupt setup", () => {
    for (const preset of ["one_wolf", "two_wolves"] as const) {
      const ctx = setup(preset);
      const state = replayWerewolf(ctx.events);
      expect(Object.values(state.roles).filter((role) => role === "werewolf")).toHaveLength(preset === "one_wolf" ? 1 : 2);
      expect(Object.values(state.roles).filter((role) => role === "seer")).toHaveLength(1);
      expect(() => startWerewolf("x", ctx.players.slice(1), werewolfConfig(preset), "seed")).toThrow();
      const event = structuredClone(ctx.events[0]!);
      if (event.type !== "werewolf.started") throw new Error("setup");
      event.payload.roles.p0 = event.payload.roles.p0 === "werewolf" ? "villager" : "werewolf";
      expect(() => replayWerewolf([event])).toThrow("role assignment");
    }
    expect(() => werewolfConfig("one_wolf", 0)).toThrow();
  });

  test("a complete match has identical replay and restart-after-each-commit results", async () => {
    const uninterrupted = setup();
    const first = await runWerewolf(uninterrupted.store, quietAgent);
    const restarted = setup();
    const second = await until(restarted, (state) => state.outcome !== null);
    expect(second).toEqual(first);
    expect(restarted.events).toEqual(uninterrupted.events);
    for (let length = 1; length <= restarted.events.length; length++) expect(() => replayWerewolf(restarted.events.slice(0, length))).not.toThrow();
    expect(() => applyWerewolfEvent(first, { ...restarted.events[1]!, sequence: first.sequence + 1 })).toThrow("already complete");
    expect(() => replayWerewolf([restarted.events[0]!, restarted.events[2]!])).toThrow("Discontinuous");
  });

  test("night actions resolve simultaneously; Doctor can survive its own attack", async () => {
    const ctx = setup();
    const roles = replayWerewolf(ctx.events).roles;
    const doctor = Object.keys(roles).find((id) => roles[id] === "doctor")!;
    const seer = Object.keys(roles).find((id) => roles[id] === "seer")!;
    const wolf = Object.keys(roles).find((id) => roles[id] === "werewolf")!;
    const agent: WerewolfAgent = { decide: async (input) => {
      if (input.request.action === "attack" || input.request.action === "protect") return { kind: "target", targetId: doctor, thinking: "" };
      if (input.request.action === "investigate") return { kind: "target", targetId: wolf, thinking: "" };
      return quietAgent.decide(input);
    } };
    const state = await until(ctx, (s) => s.phase === "night" && s.resolved, agent);
    expect(state.aliveIds).toHaveLength(8);
    expect(state.previousProtection).toBe(doctor);
    expect(observeWerewolf(state, wolf).packAttacks).toEqual([{ day: 1, targetId: doctor }]);
    expect(observeWerewolf(state, seer).investigations).toEqual([{ day: 1, targetId: wolf, isWolf: true }]);
    const other = state.aliveIds.find((id) => roles[id] === "villager")!;
    expect(observeWerewolf(state, other).investigations).toEqual([]);
    expect(observeWerewolf(state, other).packAttacks).toEqual([]);
  });

  test("sealed action acceptance cannot change another seat's knowledge or Mystery", async () => {
    const ctx = setup();
    const before = await until(ctx, (s) => s.phase === "night" && s.actions.length === 0);
    const seer = before.aliveIds.find((id) => before.roles[id] === "seer")!;
    const observation = observeWerewolf(before, seer);
    const after = await advanceWerewolf(ctx.store, quietAgent);
    expect(projectWerewolfView(after, "mystery")).toEqual(projectWerewolfView(before, "mystery"));
    expect(observeWerewolf(after, seer)).toEqual(observation);
    const serialized = JSON.stringify(projectWerewolfView(after, "omniscient"));
    expect(serialized).not.toContain("Private strategy");
    expect(serialized).not.toContain("PRIVATE RATIONALE");
    expect(serialized).not.toContain("test-seed");
  });

  test("a dead Seer keeps its final check but cannot act; Doctor cannot repeat protection", async () => {
    const ctx = setup();
    const roles = replayWerewolf(ctx.events).roles;
    const seer = Object.keys(roles).find((id) => roles[id] === "seer")!;
    const doctor = Object.keys(roles).find((id) => roles[id] === "doctor")!;
    const agent: WerewolfAgent = { decide: async (input) => {
      if (input.request.action === "attack" && input.request.legalTargetIds.includes(seer)) return { kind: "target", targetId: seer, thinking: "" };
      if (input.request.action === "protect") return { kind: "target", targetId: doctor, thinking: "" };
      if (input.request.action === "vote") {
        const alive = input.observation.board.players.filter((p) => p.alive).map((p) => p.id);
        return { kind: "target", targetId: alive[(alive.indexOf(input.request.actorId) + 1) % alive.length]!, thinking: "" };
      }
      return quietAgent.decide(input);
    } };
    const dawn = await until(ctx, (s) => s.phase === "night" && s.resolved, agent);
    expect(dawn.aliveIds).not.toContain(seer);
    expect(dawn.investigations[0]?.seerId).toBe(seer);
    expect(() => observeWerewolf(dawn, seer)).toThrow("Only living");
    const day2 = await until(ctx, (s) => s.day === 2 && s.phase === "night", agent);
    // Complete only wolf actions to reach the next Doctor decision.
    const doctorTurn = await until(ctx, (s) => {
      const step = nextWerewolfStep(s);
      return step.kind === "action" && step.request.action === "protect";
    });
    const next = nextWerewolfStep(doctorTurn);
    expect(day2.aliveIds).not.toContain(seer);
    expect(next.kind === "action" && next.request.legalTargetIds).not.toContain(doctor);
    expect(ctx.events.filter((e) => e.sequence > dawn.sequence && e.type === "werewolf.action_accepted")
      .some((e) => e.type === "werewolf.action_accepted" && e.payload.actorId === seer)).toBe(false);
  });

  test("a sacrificed wolf shares its surviving partner's faction victory", async () => {
    const ctx = setup();
    const roles = replayWerewolf(ctx.events).roles;
    const wolves = Object.keys(roles).filter((id) => roles[id] === "werewolf");
    const sacrificed = wolves[0]!;
    const agent: WerewolfAgent = { decide: async (input) => {
      const nonWolves = input.request.legalTargetIds.filter((id) => roles[id] !== "werewolf");
      if (input.request.action === "attack") {
        const victim = nonWolves.find((id) => roles[id] === "doctor") ?? nonWolves[0]!;
        return { kind: "target", targetId: victim, thinking: "" };
      }
      if (input.request.action === "protect") return { kind: "target", targetId: input.request.legalTargetIds.find((id) => roles[id] === "werewolf")!, thinking: "" };
      if (input.request.action === "vote") {
        const targetId = input.observation.board.day === 1 && input.request.legalTargetIds.includes(sacrificed)
          ? sacrificed : nonWolves[0]!;
        return { kind: "target", targetId, thinking: "" };
      }
      return quietAgent.decide(input);
    } };
    const result = await runWerewolf(ctx.store, agent);
    expect(result.aliveIds).not.toContain(sacrificed);
    expect(result.outcome?.faction).toBe("wolves");
    expect(result.outcome?.winnerIds.toSorted()).toEqual(wolves.toSorted());
  });

  test("pack speech is visible only to wolves and Omniscient, and false claims remain speech", async () => {
    const ctx = setup();
    const state = await until(ctx, (s) => s.phase === "pack" && s.actions.length === 1, {
      decide: async (input) => input.request.action === "pack_talk"
        ? { kind: "speech", cue: null, text: "I will pretend I checked Person 0 as the Seer." }
        : quietAgent.decide(input),
    });
    const village = state.aliveIds.find((id) => state.roles[id] === "villager")!;
    const wolf = state.aliveIds.find((id) => state.roles[id] === "werewolf")!;
    expect(JSON.stringify(projectWerewolfView(state, "mystery"))).not.toContain("pretend");
    expect(JSON.stringify(projectWerewolfView(state, "omniscient"))).toContain("pretend");
    expect(observeWerewolf(state, village).packDiscussion).toEqual([]);
    expect(observeWerewolf(state, wolf).packDiscussion).toHaveLength(1);
    expect(state.investigations).toEqual([]);
  });

  test("rule resolution cannot be replaced by a different victim", async () => {
    const ctx = setup();
    const state = await until(ctx, (s) => nextWerewolfStep(s).kind === "event" && s.phase === "night" && !s.resolved);
    const step = nextWerewolfStep(state);
    if (step.kind !== "event" || step.event.type !== "werewolf.night_resolved") throw new Error("resolution");
    const resolution = step.event;
    expect(() => werewolfEvent(state, { ...resolution, payload: { ...resolution.payload, killedId: "invented" } })).toThrow("contradicts");
  });

  test("day vote ties eliminate nobody and the day cap is an explicit draw", async () => {
    const ctx = setup("two_wolves", 1);
    const agent: WerewolfAgent = { decide: async (input) => {
      if (input.request.action === "vote") {
        const alive = input.observation.board.players.filter((p) => p.alive).map((p) => p.id);
        const next = alive[(alive.indexOf(input.request.actorId) + 1) % alive.length]!;
        return { kind: "target", targetId: next, thinking: "" };
      }
      return quietAgent.decide(input);
    } };
    const state = await runWerewolf(ctx.store, agent);
    const vote = state.history.find((e) => e.kind === "vote");
    expect(vote?.kind === "vote" && vote.result.eliminatedId).toBeNull();
    expect(state.outcome).toEqual({ faction: null, winnerIds: [], reason: "day_limit" });
  });
});

describe("Werewolf pack negotiation", () => {
  test.each([1, 2, 3, null])("unanimity on attempt %s controls the night, with three disagreements ending without an attack", async (agreementAttempt) => {
    const ctx = setup();
    const start = await until(ctx, state => state.phase === "pack");
    const wolves = start.aliveIds.filter(id => start.roles[id] === "werewolf");
    const villagers = start.aliveIds.filter(id => start.roles[id] !== "werewolf");
    const proposals: string[][] = [];
    const calls: string[] = [];
    const agent: WerewolfAgent = { decide: async input => {
      const { request, observation } = input;
      calls.push(request.action);
      if (request.action === "pack_talk" || request.action === "attack") {
        const negotiation = observation.packNegotiation!;
        const attempt = negotiation.attempt;
        expect(observation.packVotes).toHaveLength(attempt - 1);
        expect(negotiation.maxAttempts).toBe(3);
        if (request.action === "pack_talk") {
          expect(negotiation.stage).toBe("propose");
          const order = proposals[attempt - 1] ??= [];
          if (order.length) expect(observation.packDiscussion.at(-1)?.text).toBe(`Proposal ${attempt} from ${order[0]}`);
          order.push(request.actorId);
          return { kind: "speech", cue: null, text: `Proposal ${attempt} from ${request.actorId}` };
        }
        expect(negotiation.stage).toBe("vote");
        return { kind: "target", targetId: villagers[attempt === agreementAttempt ? 0 : wolves.indexOf(request.actorId)]!, thinking: "" };
      }
      if (request.action === "protect") return { kind: "target", targetId: villagers[1]!, thinking: "" };
      return quietAgent.decide(input);
    } };
    const dawn = await until(ctx, state => state.phase === "night" && state.resolved, agent);
    const attempts = agreementAttempt ?? 3;
    const ballots = dawn.history.filter(entry => entry.kind === "pack_vote");
    expect(ballots).toHaveLength(attempts);
    expect(ballots.map(entry => entry.result.attempt)).toEqual(Array.from({ length: attempts }, (_, i) => i + 1));
    expect(ballots.at(-1)?.result).toMatchObject({ targetId: agreementAttempt ? villagers[0] : null, endReason: agreementAttempt ? "agreed" : "attempt_limit" });
    expect(calls.filter(action => action === "pack_talk")).toHaveLength(attempts * 2);
    expect(calls.filter(action => action === "attack")).toHaveLength(attempts * 2);
    expect(calls.filter(action => action === "protect")).toHaveLength(1);
    expect(calls.filter(action => action === "investigate")).toHaveLength(1);
    for (let i = 1; i < proposals.length; i++) expect(proposals[i]).toEqual(proposals[i - 1]!.toReversed());
    const night = dawn.history.at(-1);
    expect(night?.kind === "night" && night.result.killedId).toBe(agreementAttempt ? villagers[0]! : null);
    expect(dawn.investigations).toHaveLength(1);
    expect(projectWerewolfView(dawn, "mystery").entries.some(entry => entry.kind === "pack_vote")).toBe(false);
    expect(projectWerewolfView(dawn, "omniscient").entries.filter(entry => entry.kind === "pack_vote")).toEqual(ballots);
    const survivor = dawn.aliveIds.find(id => dawn.roles[id] !== "werewolf")!;
    expect(observeWerewolf(dawn, survivor).packVotes).toEqual([]);
    expect(observeWerewolf(dawn, survivor).packNegotiation).toBeNull();
    for (let length = 1; length <= ctx.events.length; length++) expect(() => replayWerewolf(ctx.events.slice(0, length))).not.toThrow();
  });

  test("partial ballots stay sealed, recover the same observation, and cannot forge agreement", async () => {
    const ctx = setup();
    const start = await until(ctx, state => nextWerewolfStep(state).kind === "action" && state.phase === "pack" && state.actions.length === 2);
    const plans = werewolfActionPlans(start);
    expect(plans).toHaveLength(2);
    const before = projectWerewolfView(start, "omniscient");
    const observations = plans.map(plan => observeWerewolf(start, plan.request.actorId));
    let commits = 0;
    await expect(advanceWerewolf({ ...ctx.store, append: async event => {
      if (++commits === 2) throw new Error("Crash after first ballot");
      await ctx.store.append(event);
    } }, quietAgent)).rejects.toThrow("Crash after first ballot");
    const partial = replayWerewolf(ctx.events);
    expect(projectWerewolfView(partial, "omniscient")).toEqual(before);
    expect(plans.map(plan => observeWerewolf(partial, plan.request.actorId))).toEqual(observations);
    expect(werewolfActionPlans(partial)).toEqual(plans.slice(1));
    await expect(advanceWerewolf(ctx.store, { decide: async () => ({ kind: "target", targetId: "not-a-player", thinking: "" }) })).rejects.toThrow("Illegal Werewolf target");
    expect(replayWerewolf(ctx.events)).toEqual(partial);
    const sealed = await advanceWerewolf(ctx.store, quietAgent);
    expect(projectWerewolfView(sealed, "omniscient")).toEqual(before);
    const step = nextWerewolfStep(sealed);
    if (step.kind !== "event" || step.event.type !== "werewolf.pack_vote_resolved") throw new Error("Missing pack resolution");
    const resolution = step.event;
    expect(() => werewolfEvent(sealed, { ...resolution, payload: { ...resolution.payload, targetId: null } })).toThrow("contradicts");
    const revealed = await advanceWerewolf(ctx.store, quietAgent);
    expect(projectWerewolfView(revealed, "omniscient").cursor).toBe(before.cursor + 1);
    expect(observeWerewolf(revealed, plans[0]!.request.actorId).packVotes).toHaveLength(1);
  });

  test("provider-unavailable ballot fallbacks are stable across a partial-commit restart", async () => {
    const uninterrupted = setup();
    const restarted = setup();
    const atBallot = (state: WerewolfState) => state.phase === "pack" && state.actions.length === 2;
    await until(uninterrupted, atBallot);
    await until(restarted, atBallot);
    const unavailable: WerewolfAgent = { decide: async () => { throw new ProviderUnavailableError("Attempts exhausted", "malformed_output"); } };
    const expected = await advanceWerewolf(uninterrupted.store, unavailable);
    let commits = 0;
    await expect(advanceWerewolf({ ...restarted.store, append: async event => {
      if (++commits === 2) throw new Error("Interrupted fallback ballot");
      await restarted.store.append(event);
    } }, unavailable)).rejects.toThrow("Interrupted fallback ballot");
    const resumed = await advanceWerewolf(restarted.store, unavailable);
    expect(resumed).toEqual(expected);
    expect(restarted.events).toEqual(uninterrupted.events);
    for (const action of resumed.actions.filter(action => action.action === "attack")) {
      expect(action.fallback).toBe("provider_unavailable");
      expect(action.decision.kind === "target" && action.decision.targetId !== null && action.legalTargetIds.includes(action.decision.targetId)).toBe(true);
    }
  });

  test.each(["one_wolf", "two_wolves"] as const)("a lone living wolf chooses once without proposals (%s)", async preset => {
    const ctx = setup(preset);
    let start = replayWerewolf(ctx.events);
    if (preset === "two_wolves") {
      const victim = start.aliveIds.find(id => start.roles[id] === "werewolf")!;
      start = await until(ctx, state => state.day === 2 && state.phase === "pack", { decide: async input => input.request.action === "vote"
        ? { kind: "target", targetId: input.request.legalTargetIds.includes(victim) ? victim : input.request.legalTargetIds[0]!, thinking: "" }
        : quietAgent.decide(input) });
    } else start = await until(ctx, state => state.phase === "pack");
    expect(start.aliveIds.filter(id => start.roles[id] === "werewolf")).toHaveLength(1);
    const plans = werewolfActionPlans(start);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.request.action).toBe("attack");
    await advanceWerewolf(ctx.store, quietAgent);
    const resolved = await advanceWerewolf(ctx.store, quietAgent);
    expect(resolved.pack).toMatchObject({ attemptsCompleted: 1, ended: true });
    expect(resolved.history.at(-1)?.kind).toBe("pack_vote");
  });
});

describe("Werewolf exact decision contracts", () => {
  test.each(["attack", "pack_talk"] as const)("pack %s rejects malformed or incomplete structured decisions", action => {
    const artifact = werewolfDecisionArtifact({ actorId: "p0", action, legalTargetIds: action === "attack" ? ["p1", "p2"] : [] });
    const valid = action === "attack" ? { targetId: "p1", thinking: "Remove the anchor." } : { cue: null, text: "Choose p1.", thinking: "Propose the anchor." };
    for (const document of ["p1", "{}", `prefix ${JSON.stringify(valid)}`, `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, JSON.stringify({ ...valid, extra: true }), action === "attack" ? '{"targetId":"p1"}' : '{"text":"p1"}']) {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, document).status).toBe("invalid");
    }
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(valid)).status).toBe("valid");
  });
  const request = { actorId: "p0", action: "vote" as const, voteMode: "majority" as const, legalTargetIds: ["p1", "p2"] };
  const artifact = werewolfDecisionArtifact(request);
  for (const document of ["hello", "```json\n{}\n```", 'prefix {"targetId":"p1","thinking":""}', "{}", '{"targetId":"p1"}', '{"targetId":"p1","thinking":"","extra":true}', '{"targetId":"p0","thinking":""}']) {
    test(`rejects malformed decision ${document}`, () => {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, document).status).toBe("invalid");
    });
  }
  test("accepts one exact legal decision and explicit silence", () => {
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, '{"targetId":"p1","thinking":"A public vote contradiction."}').status).toBe("valid");
    const speech = werewolfDecisionArtifact({ actorId: "p0", action: "discuss", legalTargetIds: [] });
    expect(exactStructuredOutputRegistry.decodeJsonDocument(speech, '{"text":null,"cue":null,"thinking":"Wait for evidence."}').status).toBe("valid");
    expect(exactStructuredOutputRegistry.decodeJsonDocument(speech, '{"text":" ","thinking":""}').status).toBe("invalid");
  });
  test("discussion rejects malformed prose and incomplete or extra speech fields", () => {
    const speech = werewolfDecisionArtifact({ actorId: "p0", action: "discuss", legalTargetIds: [] });
    for (const document of ["Pass", "```json\n{}\n```", 'prefix {"text":null,"thinking":""}', "{}", '{"text":null}', '{"thinking":""}', '{"text":null,"thinking":"","extra":true}', '{"text":" ","thinking":""}']) {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(speech, document).status).toBe("invalid");
    }
  });
  test("malformed decisions cannot mutate the accepted prefix", async () => {
    const ctx = setup();
    const original = structuredClone(ctx.events);
    const bad: WerewolfAgent = { decide: async () => ({ kind: "target", targetId: "p0", thinking: "" }) };
    await expect(advanceWerewolf(ctx.store, bad)).rejects.toThrow();
    expect(ctx.events).toEqual(original);
  });
  test("typed provider exhaustion records legal absence and targets, while code errors fail", async () => {
    const ctx = setup("one_wolf", 2);
    const unavailable: WerewolfAgent = { decide: async () => { throw new ProviderUnavailableError("Malformed attempts exhausted", "malformed_output"); } };
    const result = await runWerewolf(ctx.store, unavailable);
    expect(result.outcome).not.toBeNull();
    for (const event of ctx.events) {
      if (event.type !== "werewolf.action_accepted") continue;
      expect(event.payload.fallback).toBe("provider_unavailable");
      if (event.payload.decision.kind !== "target") expect(event.payload.decision.text).toBeNull();
      else if (event.payload.action === "vote") expect(event.payload.decision.targetId).toBeNull();
      else {
        const target = event.payload.decision.targetId;
        if (target === null) throw new Error("Night targets must be present");
        expect(event.payload.legalTargetIds).toContain(target);
      }
    }
    const broken = setup();
    await expect(advanceWerewolf(broken.store, { decide: async () => { throw new Error("Programming error"); } })).rejects.toThrow("Programming error");
    expect(broken.events).toHaveLength(1);
  });
});


test("configurable villages preserve role counts and finish without disabled night roles", async () => {
  for (const playerCount of [6, 7, 8] as const) for (const wolves of [1, 2] as const) for (const seer of [false, true]) for (const doctor of [false, true]) {
    const players = Array.from({length: playerCount}, (_, i) => ({id:`p${i}`,name:`Player ${i}`,personality:"Calm",backstory:"",strategy:"",avatarUrl:null}));
    const config = werewolfConfig(wolves === 1 ? "one_wolf" : "two_wolves", 1, {playerCount,wolves,seer,doctor});
    const events = [startWerewolf("custom", players, config, "seed")];
    const roles = Object.values(replayWerewolf(events).roles);
    expect(roles.filter(role => role === "werewolf")).toHaveLength(wolves);
    expect(roles.filter(role => role === "seer")).toHaveLength(Number(seer));
    expect(roles.filter(role => role === "doctor")).toHaveLength(Number(doctor));
    expect(startWerewolf("custom", players, config, "seed")).toEqual(events[0]!);
    const store: WerewolfStore = {read:async()=>structuredClone(events),append:async event=>{applyWerewolfEvent(replayWerewolf(events),event);events.push(event);}};
    await runWerewolf(store, quietAgent);
    expect(replayWerewolf(events).outcome).not.toBeNull();
  }
});


test("Werewolf setup rejects incomplete, contradictory and unsupported configurations",()=>{
  const valid={playerCount:7,wolves:2,seer:true,doctor:false};
  for(const invalid of [null,{},[],{...valid,playerCount:9},{...valid,wolves:3},{...valid,seer:"yes"},{...valid,doctor:undefined},{...valid,extra:true}]) {
    expect(()=>werewolfConfig("two_wolves",10,invalid as import("../werewolf/types").WerewolfSetup)).toThrow();
  }
  expect(()=>werewolfConfig("one_wolf",10,{playerCount:7,wolves:2,seer:true,doctor:false})).toThrow("match");
});
