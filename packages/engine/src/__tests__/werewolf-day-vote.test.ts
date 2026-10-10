import { describe, expect, test } from "bun:test";
import { exactStructuredOutputRegistry } from "../structured-output";
import { ProviderUnavailableError } from "../provider-execution";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { werewolfReportEntry } from "../werewolf/report";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { advanceWerewolf, werewolfFallback, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";

async function setup(preset: "one_wolf" | "two_wolves" = "two_wolves", maxDays = 2) {
  const players = Array.from({ length: preset === "one_wolf" ? 6 : 8 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, personality: "", backstory: "", strategy: "", avatarUrl: null }));
  const events = [startWerewolf("day-vote", players, werewolfConfig(preset, maxDays), "checkpoint-seed")];
  const initial = replayWerewolf(events);
  const protectedTarget = initial.aliveIds.find(id => initial.roles[id] !== "werewolf")!;
  const store: WerewolfStore = { read: async () => structuredClone(events), append: async event => {
    applyWerewolfEvent(replayWerewolf(events), event); events.push(event);
  } };
  const quiet: WerewolfAgent = { decide: async ({ request, observation }) => request.action === "vote" && request.voteMode === "plurality"
    ? { kind: "target", targetId: observation.board.players.filter(p => p.alive).map(p => p.id)[(observation.board.players.filter(p => p.alive).findIndex(p => p.id === request.actorId) + 1) % observation.board.players.filter(p => p.alive).length]!, thinking: "" }
    : request.action === "attack" || request.action === "protect"
    ? { kind: "target", targetId: protectedTarget, thinking: "" }
    : werewolfFallback(replayWerewolf(events), request) };
  let state = initial;
  while (state.phase !== "day") state = await advanceWerewolf(store, quiet);
  return { store, events, state, quiet };
}

async function checkpoint(ctx: Awaited<ReturnType<typeof setup>>, targetId: string, count: number) {
  let state = replayWerewolf(ctx.events);
  while (state.phase !== "vote") state = await advanceWerewolf(ctx.store, ctx.quiet);
  const voters = state.aliveIds.filter(id => id !== targetId).slice(0, count);
  const originalView = projectWerewolfView(state, "mystery");
  const observer = state.aliveIds[0]!;
  const originalObservation = observeWerewolf(state, observer);
  const agent: WerewolfAgent = { decide: async ({ request }) => ({ kind: "target", targetId: voters.includes(request.actorId) ? targetId : null, thinking: "PRIVATE BALLOT" }) };
  while (!state.resolved) {
    const step = nextWerewolfStep(state);
    if (step.kind === "action") {
      state = await advanceWerewolf(ctx.store, agent);
      expect(projectWerewolfView(state, "mystery")).toEqual(originalView);
      expect(observeWerewolf(state, observer)).toEqual(originalObservation);
    } else {
      expect(step.kind === "event" && step.event.type).toBe("werewolf.day_vote_resolved");
      state = await advanceWerewolf(ctx.store, agent);
    }
  }
  const last = state.history.at(-1);
  if (last?.kind !== "vote") throw new Error("Expected revealed checkpoint");
  expect(last.result.ballots).toHaveLength(originalView.players.filter(p => p.alive).length);
  expect(JSON.stringify(projectWerewolfView(state, "omniscient"))).not.toContain("PRIVATE BALLOT");
  return { state, result: last.result };
}

describe("Werewolf day vote checkpoints", () => {
  test.each([{ preset: "one_wolf", count: 2, required: 3, ends: false }, { preset: "one_wolf", count: 3, required: 3, ends: true },
    { preset: "two_wolves", count: 4, required: 5, ends: false }, { preset: "two_wolves", count: 5, required: 5, ends: true }] as const)(
    "$count votes with $preset uses all living players, not cast ballots", async ({ preset, count, required, ends }) => {
      const ctx = await setup(preset);
      const target = ctx.state.aliveIds.find(id => ctx.state.roles[id] === "villager")!;
      const { state, result } = await checkpoint(ctx, target, count);
      expect(result).toMatchObject({ thread: 1, requiredVotes: required, eliminatedId: ends ? target : null, dayEnded: ends });
      expect(result.ballots.filter(b => b.targetId === null)).toHaveLength(ctx.state.aliveIds.length - count);
      expect(nextWerewolfStep(state)).toEqual({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: ends ? "pack" : "day", day: ends ? 2 : 1 } } });
      expect(state.history.filter(e => e.kind === "discussion")).toHaveLength(1);
      expect(replayWerewolf(ctx.events)).toEqual(state);
      const continued = await advanceWerewolf(ctx.store, ctx.quiet);
      if (!ends) expect(continued.discussion).toMatchObject({ threadIndex: 1, checkpointPending: false, ended: false });
      const report = werewolfReportEntry({ kind: "vote", day: 1, result }, projectWerewolfView(state, "omniscient"));
      expect(report).toContain("Abstain (hear more)");
      expect(report).toContain(ends ? "Day ends." : "continue discussion");
    });

  test("every completed thread polls; old votes expire, and mandatory tied final ballot ends day without elimination", async () => {
    const ctx = await setup("two_wolves", 1);
    const target = ctx.state.aliveIds[0]!;
    await checkpoint(ctx, target, 4);
    let state = await advanceWerewolf(ctx.store, ctx.quiet);
    while (!state.outcome) state = await advanceWerewolf(ctx.store, ctx.quiet);
    const votes = state.history.filter(e => e.kind === "vote");
    expect(votes).toHaveLength(8);
    expect(votes.map(e => e.result.thread)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(votes[0]!.result.totals[target]).toBe(4);
    expect(votes.slice(1, -1).every(e => e.result.ballots.every(b => b.targetId === null))).toBe(true);
    expect(votes.slice(0, -1).every(e => !e.result.dayEnded)).toBe(true);
    expect(votes.at(-1)!.result).toMatchObject({ voteMode: "plurality", requiredVotes: null, dayEnded: true, eliminatedId: null });
    expect(votes.at(-1)!.result.ballots.every(b => b.targetId !== null)).toBe(true);
    expect(state.aliveIds).toEqual(ctx.state.aliveIds);
    expect(state.outcome?.reason).toBe("day_limit");
  });

  test("early elimination of the last wolf completes the game without more speeches or a second vote", async () => {
    const ctx = await setup("one_wolf");
    const wolf = ctx.state.aliveIds.find(id => ctx.state.roles[id] === "werewolf")!;
    const { state } = await checkpoint(ctx, wolf, 3);
    expect(nextWerewolfStep(state)).toMatchObject({ kind: "event", event: { type: "werewolf.completed", payload: { faction: "village" } } });
    expect(state.history.filter(e => e.kind === "vote")).toHaveLength(1);
  });

  test("malformed ballots cannot commit, fallback abstains, and forged majority events are rejected", async () => {
    const ctx = await setup();
    let state = ctx.state;
    while (state.phase !== "vote") state = await advanceWerewolf(ctx.store, ctx.quiet);
    const before = structuredClone(ctx.events);
    await expect(advanceWerewolf(ctx.store, { decide: async ({ request }) => ({ kind: "target", targetId: request.actorId, thinking: "" }) })).rejects.toThrow("Illegal");
    expect(ctx.events).toEqual(before);
    const unavailable: WerewolfAgent = { decide: async () => { throw new ProviderUnavailableError("Exhausted", "malformed_output"); } };
    state = await advanceWerewolf(ctx.store, unavailable);
    const next = nextWerewolfStep(state);
    if (next.kind !== "event" || next.event.type !== "werewolf.day_vote_resolved") throw new Error("Missing checkpoint");
    expect(next.event.payload.ballots.every(b => b.targetId === null && b.unavailable)).toBe(true);
    const resolution = next.event;
    expect(() => werewolfEvent(state, { ...resolution, payload: { ...resolution.payload, eliminatedId: state.aliveIds[0]! } })).toThrow("contradicts");
    const report = werewolfReportEntry({ kind: "vote", day: 1, result: next.event.payload }, projectWerewolfView(state, "mystery"));
    expect(report).toContain("Abstain (unavailable)");
  });

  test("final ballot eliminates a unique plurality below a majority and rejects voluntary abstention", async () => {
    const ctx = await setup();
    let state = ctx.state;
    while (!(state.phase === "vote" && state.discussion?.ended)) state = await advanceWerewolf(ctx.store, ctx.quiet);
    const before = structuredClone(ctx.events);
    await expect(advanceWerewolf(ctx.store, { decide: async () => ({ kind: "target", targetId: null, thinking: "Hear more" }) })).rejects.toThrow("Illegal");
    expect(ctx.events).toEqual(before);
    const target = state.aliveIds.find(id => state.roles[id] === "villager")!;
    const ids = [target, ...state.aliveIds.filter(id => id !== target)];
    const choices = [ids[1]!, ids[0]!, ids[0]!, ids[0]!, ids[2]!, ids[1]!, ids[3]!, ids[4]!];
    state = await advanceWerewolf(ctx.store, { decide: async ({ request }) => ({ kind: "target", targetId: choices[ids.indexOf(request.actorId)]!, thinking: "" }) });
    const step = nextWerewolfStep(state);
    if (step.kind !== "event" || step.event.type !== "werewolf.day_vote_resolved") throw new Error("final resolution");
    expect(step.event.payload).toMatchObject({ voteMode: "plurality", requiredVotes: null, eliminatedId: target, dayEnded: true });
    expect(step.event.payload.totals[target]).toBe(3);
    const finalResolution = step.event;
    expect(() => werewolfEvent(state, { ...finalResolution, payload: { ...finalResolution.payload, eliminatedId: null } })).toThrow("contradicts");
    state = await advanceWerewolf(ctx.store, ctx.quiet);
    expect(state.aliveIds).not.toContain(target);
    expect(nextWerewolfStep(state)).toMatchObject({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "pack", day: 2 } } });
    const report = werewolfReportEntry({ kind: "vote", day: 1, result: step.event.payload }, projectWerewolfView(state, "mystery"));
    expect(report).toContain("unique highest vote count wins");
    expect(report).not.toContain("Majority required");
  });

  test("final ballot provider exhaustion is a marked absence, never a fabricated target", async () => {
    const ctx = await setup();
    let state = ctx.state;
    while (!(state.phase === "vote" && state.discussion?.ended)) state = await advanceWerewolf(ctx.store, ctx.quiet);
    const step = nextWerewolfStep(state);
    if (step.kind !== "action" || step.request.action !== "vote") throw new Error("final ballot");
    const artifact = werewolfDecisionArtifact(step.request);
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, '{"targetId":null,"thinking":"wait"}').status).toBe("invalid");
    state = await advanceWerewolf(ctx.store, { decide: async () => { throw new ProviderUnavailableError("Exhausted", "malformed_output"); } });
    const resolution = nextWerewolfStep(state);
    if (resolution.kind !== "event" || resolution.event.type !== "werewolf.day_vote_resolved") throw new Error("resolution");
    expect(resolution.event.payload).toMatchObject({ voteMode: "plurality", eliminatedId: null, dayEnded: true });
    expect(resolution.event.payload.ballots.every(b => b.unavailable && b.targetId === null)).toBe(true);
    expect(replayWerewolf(ctx.events)).toEqual(state);
  });

  test("only daytime ballots admit null; strict schema still rejects malformed, missing and extra fields", () => {
    for (const action of ["vote", "attack", "investigate", "protect"] as const) {
      const artifact = werewolfDecisionArtifact({ actorId: "p0", ...(action === "vote" ? { action, voteMode: "majority" as const } : { action }), legalTargetIds: ["p1"] });
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, '{"targetId":null,"thinking":"Hear more"}').status).toBe(action === "vote" ? "valid" : "invalid");
      for (const text of ["hear more", "{}", '{"targetId":null}', '{"targetId":null,"thinking":"","extra":true}', 'prefix {"targetId":null,"thinking":""}', '```json\n{"targetId":null,"thinking":""}\n```']) {
        expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, text).status).toBe("invalid");
      }
    }
  });
});
