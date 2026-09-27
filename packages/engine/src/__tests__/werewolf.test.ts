import { describe, expect, test } from "bun:test";
import { exactStructuredOutputRegistry } from "../structured-output";
import { ProviderUnavailableError } from "../provider-execution";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfActionPlans, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { advanceWerewolf, runWerewolf, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";
import type { WerewolfDecision, WerewolfPlayer, WerewolfState } from "../werewolf/types";

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
  decide: async ({ request }) => request.legalTargetIds.length
    ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "PRIVATE RATIONALE" }
    : { kind: "speech", text: null, thinking: "PRIVATE RATIONALE" },
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
      if (input.request.action === "attack") return { kind: "target", targetId: seer, thinking: "" };
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
        ? { kind: "speech", text: "I will pretend I checked Person 0 as the Seer.", thinking: "PRIVATE RATIONALE" }
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

describe("Werewolf simultaneous discussion", () => {
  test("concurrent decisions share a frozen public beat and reveal only as one batch", async () => {
    const ctx = setup();
    const start = await until(ctx, (s) => s.phase === "day");
    const plans = werewolfActionPlans(start);
    const before = projectWerewolfView(start, "mystery");
    const ready = Promise.withResolvers<void>();
    const pending: Array<ReturnType<typeof Promise.withResolvers<WerewolfDecision>>> = [];
    const inputs: Array<Parameters<WerewolfAgent["decide"]>[0]> = [];
    const running = advanceWerewolf(ctx.store, { decide: (input) => {
      inputs.push(input);
      const response = Promise.withResolvers<WerewolfDecision>();
      pending.push(response);
      if (pending.length === plans.length) ready.resolve();
      return response.promise;
    } });
    await ready.promise;
    expect(inputs.map((input) => input.actionSlot)).toEqual(plans.map((plan) => plan.sequence));
    for (const input of inputs) {
      expect(input.observation.board).toEqual(before);
      if (input.observation.self.role !== "werewolf") expect(input.observation.packIds).toEqual([]);
      if (input.observation.self.role !== "seer") expect(input.observation.investigations).toEqual([]);
    }
    // Fast responses cannot leak to a slower player or either spectator audience.
    for (let i = pending.length - 1; i >= 1; i--) pending[i]!.resolve({ kind: "speech", text: `Claim ${i}`, thinking: "PRIVATE RATIONALE" });
    await Promise.resolve();
    expect(replayWerewolf(ctx.events)).toEqual(start);
    pending[0]!.resolve({ kind: "speech", text: "Claim 0", thinking: "PRIVATE RATIONALE" });
    const sealed = await running;
    for (const audience of ["mystery", "omniscient"] as const) expect(projectWerewolfView(sealed, audience)).toEqual(projectWerewolfView(start, audience));
    for (const input of inputs) expect(observeWerewolf(sealed, input.request.actorId)).toEqual(input.observation);
    const revealed = await advanceWerewolf(ctx.store, quietAgent);
    const view = projectWerewolfView(revealed, "mystery");
    expect(view.cursor).toBe(before.cursor + 1);
    const beat = view.entries.at(-1);
    expect(beat?.kind).toBe("discussion");
    if (beat?.kind !== "discussion") throw new Error("missing beat");
    expect(beat.result.contributions.map((entry) => entry.text)).toEqual(plans.map((_, i) => `Claim ${i}`));
    expect(Object.values(beat.result.messagesRemaining).every((remaining) => remaining === 3)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("PRIVATE RATIONALE");
    expect(() => werewolfEvent(sealed, { type: "werewolf.discussion_revealed", payload: { ...beat.result, beat: 6 } })).toThrow("contradicts");
  });

  test("an all-pass opening gets one more beat; a second all-pass beat ends with all messages unspent", async () => {
    const ctx = setup();
    await until(ctx, (s) => s.phase === "day");
    await advanceWerewolf(ctx.store, quietAgent);
    const first = await advanceWerewolf(ctx.store, quietAgent);
    expect(first.discussion).toMatchObject({ beatsCompleted: 1, ended: false });
    expect(nextWerewolfStep(first).kind).toBe("action");
    await advanceWerewolf(ctx.store, quietAgent);
    const second = await advanceWerewolf(ctx.store, quietAgent);
    expect(second.discussion).toMatchObject({ beatsCompleted: 2, ended: true });
    expect(Object.values(second.discussion!.messagesRemaining).every((remaining) => remaining === 4)).toBe(true);
    expect(nextWerewolfStep(second)).toEqual({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "vote", day: 1 } } });
  });

  test("two passes preserve four messages; exhausted players stop being called and six beats close the day", async () => {
    const ctx = setup();
    const start = await until(ctx, (s) => s.phase === "day");
    const patient = start.aliveIds[0]!;
    const turns: Record<string, number[]> = {};
    const agent: WerewolfAgent = { decide: async (input) => {
      const beat = input.observation.board.discussion!.beat;
      (turns[input.request.actorId] ??= []).push(beat);
      return { kind: "speech", text: input.request.actorId === patient && beat <= 2 ? null : `My contribution at beat ${beat}.`, thinking: "" };
    } };
    const finished = await until(ctx, (s) => s.discussion?.ended === true, agent);
    expect(turns[patient]).toEqual([1, 2, 3, 4, 5, 6]);
    for (const id of start.aliveIds.filter((id) => id !== patient)) expect(turns[id]).toEqual([1, 2, 3, 4]);
    expect(Object.values(finished.discussion!.messagesRemaining).every((remaining) => remaining === 0)).toBe(true);
    const beats = finished.history.filter((entry) => entry.kind === "discussion");
    expect(beats).toHaveLength(6);
    expect(beats[1]!.result.messagesRemaining[patient]).toBe(4);
    expect(beats.at(-1)!.result.endReason).toBe("beat_limit");
    expect(werewolfActionPlans(finished)).toEqual([]);
  });

  test("sparse speakers can pass more than twice but cannot extend the six-beat limit", async () => {
    const ctx = setup();
    const start = await until(ctx, (s) => s.phase === "day");
    const speakers = start.aliveIds.slice(0, 2);
    const finished = await until(ctx, (s) => s.discussion?.ended === true, { decide: async (input) => ({
      kind: "speech", text: input.request.actorId === speakers[input.observation.board.discussion!.beat % 2] ? "A new question." : null, thinking: "",
    }) });
    expect(finished.discussion!.beatsCompleted).toBe(6);
    expect(finished.discussion!.messagesRemaining[speakers[0]!]).toBe(1);
    expect(finished.discussion!.messagesRemaining[start.aliveIds[2]!]).toBe(4);
  });

  test("spending all messages closes after four beats, with a fresh budget the next day", async () => {
    const ctx = setup();
    const agent: WerewolfAgent = { decide: async (input) => {
      if (input.request.action === "discuss") return { kind: "speech", text: "My current view.", thinking: "" };
      if (input.request.action === "vote") {
        const alive = input.observation.board.players.filter((p) => p.alive).map((p) => p.id);
        return { kind: "target", targetId: alive[(alive.indexOf(input.request.actorId) + 1) % alive.length]!, thinking: "" };
      }
      return quietAgent.decide(input);
    } };
    const first = await until(ctx, (s) => s.discussion?.ended === true, agent);
    const beat = first.history.at(-1);
    expect(beat?.kind === "discussion" && beat.result.endReason).toBe("message_limit");
    expect(first.discussion!.beatsCompleted).toBe(4);
    const second = await until(ctx, (s) => s.day === 2 && s.phase === "day", agent);
    expect(second.discussion!.beatsCompleted).toBe(0);
    expect(Object.keys(second.discussion!.messagesRemaining)).toEqual(second.aliveIds);
    expect(Object.values(second.discussion!.messagesRemaining).every((remaining) => remaining === 4)).toBe(true);
  });

  test("one malformed concurrent decision prevents any new commitment or reveal", async () => {
    const ctx = setup();
    const start = await until(ctx, (s) => s.phase === "day");
    await expect(advanceWerewolf(ctx.store, { decide: async ({ request }) => request.actorId === start.aliveIds[0]
      ? { kind: "target", targetId: "invalid", thinking: "" }
      : { kind: "speech", text: "A valid message.", thinking: "" },
    })).rejects.toThrow("speech decision");
    expect(replayWerewolf(ctx.events)).toEqual(start);
  });

  test("provider failure remains distinguishable from deliberate passing", async () => {
    const ctx = setup();
    await until(ctx, (s) => s.phase === "day");
    await advanceWerewolf(ctx.store, { decide: async () => { throw new ProviderUnavailableError("Unavailable", "malformed_output"); } });
    const state = await advanceWerewolf(ctx.store, quietAgent);
    const beat = state.history.at(-1);
    expect(beat?.kind === "discussion" && beat.result.contributions.every((entry) => entry.unavailable && entry.text === null)).toBe(true);
    expect(state.discussion!.ended).toBe(false);
  });

  test("every living faction votes and eliminating the last wolf wins for the village", async () => {
    const ctx = setup("one_wolf");
    const wolf = Object.entries(replayWerewolf(ctx.events).roles).find(([, role]) => role === "werewolf")![0];
    const state = await runWerewolf(ctx.store, { decide: async (input) => input.request.action === "vote"
      ? { kind: "target", targetId: input.request.legalTargetIds.includes(wolf) ? wolf : input.request.legalTargetIds[0]!, thinking: "" }
      : quietAgent.decide(input),
    });
    const vote = state.history.find((entry) => entry.kind === "vote");
    expect(vote?.kind === "vote" && vote.result.ballots.some((ballot) => ballot.voterId === wolf)).toBe(true);
    expect(vote?.kind === "vote" && vote.result.ballots.length).toBe(5);
    expect(state.outcome?.faction).toBe("village");
    expect(state.outcome?.winnerIds).toHaveLength(5);
  });
});

describe("Werewolf exact decision contracts", () => {
  const request = { actorId: "p0", action: "vote" as const, legalTargetIds: ["p1", "p2"] };
  const artifact = werewolfDecisionArtifact(request);
  for (const document of ["hello", "```json\n{}\n```", 'prefix {"targetId":"p1","thinking":""}', "{}", '{"targetId":"p1"}', '{"targetId":"p1","thinking":"","extra":true}', '{"targetId":"p0","thinking":""}']) {
    test(`rejects malformed decision ${document}`, () => {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, document).status).toBe("invalid");
    });
  }
  test("accepts one exact legal decision and explicit silence", () => {
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, '{"targetId":"p1","thinking":"A public vote contradiction."}').status).toBe("valid");
    const speech = werewolfDecisionArtifact({ actorId: "p0", action: "discuss", legalTargetIds: [] });
    expect(exactStructuredOutputRegistry.decodeJsonDocument(speech, '{"text":null,"thinking":"Listen first."}').status).toBe("valid");
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
      if (event.payload.decision.kind === "speech") expect(event.payload.decision.text).toBeNull();
      else expect(event.payload.legalTargetIds).toContain(event.payload.decision.targetId);
    }
    const broken = setup();
    await expect(advanceWerewolf(broken.store, { decide: async () => { throw new Error("Programming error"); } })).rejects.toThrow("Programming error");
    expect(broken.events).toHaveLength(1);
  });
});
