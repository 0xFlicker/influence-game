import { describe, expect, test } from "bun:test";
import { exactStructuredOutputRegistry } from "../structured-output";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfActionPlans, werewolfConfig, werewolfDayInitiative } from "../werewolf/rules";
import { advanceWerewolf, werewolfFallback, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";
import type { WerewolfDecision } from "../werewolf/types";

async function dawn(rounds = 1) {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Curious", backstory: "", strategy: "PRIVATE", avatarUrl: null }));
  const events = [startWerewolf("thread-test", players, werewolfConfig("one_wolf", 1, rounds), "thread-seed")];
  const store: WerewolfStore = { read: async () => structuredClone(events), append: async event => {
    applyWerewolfEvent(replayWerewolf(events), event); events.push(event);
  } };
  const quiet: WerewolfAgent = { decide: async ({ request }) => werewolfFallback(replayWerewolf(events), request) };
  let state = replayWerewolf(events);
  while (state.phase !== "day") state = await advanceWerewolf(store, quiet);
  return { store, events, state, quiet };
}

describe("Werewolf sequential public threads", () => {
  test.each([1, 2, 3])("%s response rounds bound calls and give each living player exactly one opening", async rounds => {
    const ctx = await dawn(rounds);
    const order = ctx.state.discussion!.initiativeIds;
    expect(order.toSorted()).toEqual(ctx.state.aliveIds.toSorted());
    expect(order).toEqual(werewolfDayInitiative(replayWerewolf(ctx.events)));
    expect(order).not.toContain(ctx.state.players.find(p => !ctx.state.aliveIds.includes(p.id))!.id);
    let state = ctx.state;
    const calls: Parameters<WerewolfAgent["decide"]>[0][] = [];
    const agent: WerewolfAgent = { decide: async input => {
      calls.push(input);
      return { kind: "speech", text: `Move ${calls.length}.`, cue: null };
    } };
    while (!state.discussion!.ended) {
      expect(werewolfActionPlans(state)).toHaveLength(1);
      state = await advanceWerewolf(ctx.store, agent);
    }
    expect(calls).toHaveLength(order.length * (1 + rounds * order.length));
    for (const [index, opener] of order.entries()) {
      const thread = calls.filter(call => call.observation.turnReminder!.thread === index + 1);
      expect(thread.map(call => call.request.actorId)).toEqual([opener, ...Array.from({ length: rounds }, () => [...order.filter(id => id !== opener), opener]).flat()]);
      expect(thread[0]!.observation.turnReminder).toMatchObject({ stage: "opening", openingStatement: null, hasUsedOwnOpening: false, remainingOpportunitiesThisThread: rounds + 1 });
      expect(thread.at(-1)!.observation.turnReminder).toMatchObject({ stage: "answer", responseRound: rounds, hasUsedOwnOpening: true, remainingOpportunitiesThisThread: 1 });
    }
    expect(nextWerewolfStep(state)).toEqual({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "vote", day: 1 } } });
    expect(replayWerewolf(ctx.events)).toEqual(state);
  });

  test("the next speaker sees exactly the accepted public prefix, with engine-owned identifiers", async () => {
    const ctx = await dawn();
    let state = ctx.state;
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const before = projectWerewolfView(state, "mystery");
      state = await advanceWerewolf(ctx.store, { decide: async input => {
        seen.push(input.observation.board.entries.flatMap(e => e.kind === "discussion" && e.contribution.text !== null ? [e.contribution.text] : []));
        expect(input.observation.board).toEqual(before);
        expect(input.observation.turnReminder!.latestStatement?.text ?? null).toBe(i === 0 ? null : `Accepted ${i - 1}.`);
        if (i > 0) expect(input.observation.turnReminder!.openingStatement).toBe("Accepted 0.");
        return { kind: "speech", text: `Accepted ${i}.`, cue: "Hesitates before answering." };
      } });
      const publicView = projectWerewolfView(state, "mystery");
      const last = publicView.entries.at(-1);
      expect(publicView.cursor).toBe(before.cursor + 1);
      expect(last).toMatchObject({ kind: "discussion", contribution: { text: `Accepted ${i}.`, turn: i + 1, publicHistoryPosition: publicView.cursor } });
      expect(last?.kind === "discussion" && Object.keys(last.contribution).sort()).toEqual(["actorId", "cue", "openerId", "publicHistoryPosition", "responseRound", "stage", "text", "thread", "turn", "unavailable"]);
    }
    expect(seen).toEqual([[], ["Accepted 0."], ["Accepted 0.", "Accepted 1."]]);
    const order = state.discussion!.initiativeIds;
    const respondents = order.filter(id => id !== order[0]);
    expect(observeWerewolf(state, respondents[0]!).turnReminder!.remainingOpportunitiesThisThread).toBe(0);
    expect(observeWerewolf(state, respondents[2]!).turnReminder!.remainingOpportunitiesThisThread).toBe(1);
    expect(observeWerewolf(state, order[0]!).turnReminder!.remainingOpportunitiesThisThread).toBe(1);
  });

  test("one pending contribution cannot dispatch a later speaker or expose uncommitted text", async () => {
    const ctx = await dawn();
    const ready = Promise.withResolvers<void>();
    const response = Promise.withResolvers<WerewolfDecision>();
    let calls = 0;
    const advancing = advanceWerewolf(ctx.store, { decide: async () => { calls++; ready.resolve(); return response.promise; } });
    await ready.promise;
    expect(calls).toBe(1);
    expect(replayWerewolf(ctx.events)).toEqual(ctx.state);
    response.resolve({ kind: "speech", text: "One pointed question?", cue: null });
    const after = await advancing;
    expect(calls).toBe(1);
    expect(projectWerewolfView(after, "mystery").entries.at(-1)).toMatchObject({ kind: "discussion", contribution: { text: "One pointed question?" } });
  });

  test("opening passes skip threads and preserve optional production moments", async () => {
    const ctx = await dawn(3);
    let state = ctx.state;
    let calls = 0;
    while (!state.discussion!.ended) state = await advanceWerewolf(ctx.store, { decide: async input => {
      expect(input.observation.turnReminder!.stage).toBe("opening");
      calls++;
      return { kind: "speech", text: null, cue: "A brittle laugh." };
    } });
    expect(calls).toBe(ctx.state.aliveIds.length);
    expect(state.history.filter(e => e.kind === "discussion").every(e => e.contribution.text === null && e.contribution.cue === "A brittle laugh.")).toBe(true);
  });

  test("an all-pass reply round still offers the opener an answer, then closes only that thread", async () => {
    const ctx = await dawn(3);
    let state = await advanceWerewolf(ctx.store, { decide: async () => ({ kind: "speech", text: "Who changed their story?", cue: null }) });
    const stages: string[] = [];
    while (state.discussion!.threadIndex === 0) state = await advanceWerewolf(ctx.store, { decide: async input => {
      stages.push(input.observation.turnReminder!.stage);
      return { kind: "speech", text: null, cue: "Pauses." };
    } });
    expect(stages).toEqual([...ctx.state.aliveIds.slice(1).map(() => "reply"), "answer"]);
    expect(state.discussion).toMatchObject({ threadIndex: 1, stage: "opening", ended: false });
    expect(observeWerewolf(state, state.discussion!.initiativeIds[1]!).turnReminder!.hasUsedOwnOpening).toBe(false);
  });

  test("tiny speech contracts reject extra model identities, gaze and thinking", () => {
    const artifact = werewolfDecisionArtifact({ actorId: "p0", action: "discuss", legalTargetIds: [] });
    const valid = { text: "Why did you change your vote?", cue: "A brittle laugh." };
    for (const payload of [valid, { text: null, cue: "Hesitates." }, { text: null, cue: null }]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("valid");
    for (const payload of [{ ...valid, actorId: "p0" }, { ...valid, thinking: "secret" }, { ...valid, lookAtPlayerId: "p1" }, { ...valid, thread: 2 }, { text: valid.text }, {}, { ...valid, text: "x".repeat(301) }, { ...valid, cue: "" }]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("invalid");
    for (const rounds of [0, 4, 1.5, NaN]) expect(() => werewolfConfig("one_wolf", 1, rounds)).toThrow("responseRounds");
  });
});
