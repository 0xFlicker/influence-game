import { describe, expect, test } from "bun:test";
import { exactStructuredOutputRegistry } from "../structured-output";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { projectWerewolfView } from "../werewolf/observation";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfActionPlans, werewolfConfig, werewolfDayInitiative, werewolfEvent } from "../werewolf/rules";
import { advanceWerewolf, werewolfFallback, type WerewolfAgent, type WerewolfStore } from "../werewolf/runner";
import type { WerewolfDecision } from "../werewolf/types";
import { werewolfConversationTurn } from "../werewolf/conversation";

async function dawn() {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Curious", backstory: "", strategy: "PRIVATE", avatarUrl: null }));
  const events = [startWerewolf("thread-test", players, werewolfConfig("one_wolf", 3), "thread-seed")];
  const store: WerewolfStore = { read: async () => structuredClone(events), append: async event => {
    applyWerewolfEvent(replayWerewolf(events), event); events.push(event);
  } };
  const quiet: WerewolfAgent = { decide: async ({ request }) => werewolfFallback(replayWerewolf(events), request) };
  let state = replayWerewolf(events);
  while (state.phase !== "day") state = await advanceWerewolf(store, quiet);
  return { store, events, state, quiet };
}

describe("Werewolf ordered recipient threads", () => {
  test.each([0, 1, 3])("%s chosen recipients lead a complete causal queue, with one opener answer per spoken reply", async count => {
    const ctx = await dawn();
    const order = ctx.state.discussion!.initiativeIds;
    expect(order.toSorted()).toEqual(ctx.state.aliveIds.toSorted());
    expect(order).toEqual(werewolfDayInitiative(ctx.state));
    const calls: Parameters<WerewolfAgent["decide"]>[0][] = [];
    let state = ctx.state;
    const agent: WerewolfAgent = { decide: async input => {
      if (input.request.action === "vote") return { kind: "target", targetId: null, thinking: "Hear more" };
      calls.push(input);
      const turn = input.observation.turnReminder!;
      const focus = werewolfConversationTurn(input.observation);
      const history = input.observation.board.entries.flatMap(e => e.kind === "discussion" && e.contribution.thread === turn.thread ? [e.contribution] : []);
      expect(history).toHaveLength(calls.filter(c => c.observation.turnReminder!.thread === turn.thread).length - 1);
      if (input.request.action === "open_thread") {
        expect(focus.messageToAnswer).toBeNull();
        return { kind: "opening", text: `Opening ${turn.thread}.`, cue: null, recipientIds: input.request.legalRecipientIds.toReversed().slice(0, count) };
      }
      if (turn.stage === "answer") {
        expect(focus.messageToAnswer).toMatchObject({ speaker: { id: history.at(-1)!.actorId }, text: history.at(-1)!.text });
        expect(focus.nextPossibleSpeaker?.id ?? null).toBe(turn.nextSpeakerId);
      } else expect(focus.messageToAnswer?.speaker.id).toBe(turn.openerId);
      return { kind: "speech", text: `Move ${calls.length}.`, cue: "Hesitates." };
    } };
    while (!state.discussion!.ended) {
      if (nextWerewolfStep(state).kind === "action") expect(werewolfActionPlans(state)).toHaveLength(state.phase === "vote" ? state.aliveIds.length : 1);
      state = await advanceWerewolf(ctx.store, agent);
    }
    expect(calls).toHaveLength(order.length * (1 + 2 * (order.length - 1)));
    for (const [index, opener] of order.entries()) {
      const thread = calls.filter(call => call.observation.turnReminder!.thread === index + 1);
      const reminder = thread[1]!.observation.turnReminder!;
      expect(reminder.recipientIds).toHaveLength(count);
      expect(reminder.respondentIds.slice(0, count)).toEqual(reminder.recipientIds);
      expect(reminder.respondentIds.toSorted()).toEqual(order.filter(id => id !== opener).toSorted());
      expect(thread.map(call => call.request.actorId)).toEqual([opener, ...reminder.respondentIds.flatMap(id => [id, opener])]);
      expect(thread.at(-1)!.observation.turnReminder).toMatchObject({ stage: "answer", nextSpeakerId: null, remainingOpportunitiesThisThread: 1 });
      if (count === 3) expect(thread[6]!.observation.turnReminder!.nextSpeakerId).toBe(reminder.respondentIds[3]!);
    }
    expect(nextWerewolfStep(state)).toMatchObject({ kind: "event", event: { type: "werewolf.phase_started", payload: { phase: "vote" } } });
    expect(replayWerewolf(ctx.events)).toEqual(state);
    for (let end = 1; end <= ctx.events.length; end++) expect(() => replayWerewolf(ctx.events.slice(0, end))).not.toThrow();
  });

  test("passes skip answers in both invited and open floor stages, while opener passes retain reply focus", async () => {
    const ctx = await dawn();
    const opener = ctx.state.discussion!.initiativeIds[0]!;
    const recipients = ctx.state.aliveIds.filter(id => id !== opener).slice(0, 3);
    let state = await advanceWerewolf(ctx.store, { decide: async () => ({ kind: "opening", text: "Why did you choose Vera?", cue: null, recipientIds: recipients }) });
    const queue = state.discussion!.respondentIds;
    const spoken = queue[1]!;
    const actors: string[] = [];
    while (!state.discussion!.checkpointPending) state = await advanceWerewolf(ctx.store, { decide: async input => {
      actors.push(input.request.actorId);
      const focus = werewolfConversationTurn(input.observation);
      expect(focus.messageToAnswer?.text).toBe(input.request.actorId === opener ? "My reason." : "Why did you choose Vera?");
      return { kind: "speech", text: input.request.actorId === spoken ? "My reason." : null, cue: "A brittle laugh." };
    } });
    expect(actors).toEqual([queue[0]!, spoken, opener, ...queue.slice(2)]);
    expect(state.history.filter(e => e.kind === "discussion").filter(e => e.contribution.text === null)).toHaveLength(queue.length);
    expect(state.discussion!.threadIndex).toBe(1);
  });

  test("one pending contribution cannot dispatch later speakers or expose uncommitted text", async () => {
    const ctx = await dawn();
    const ready = Promise.withResolvers<void>();
    const response = Promise.withResolvers<WerewolfDecision>();
    let calls = 0;
    const advancing = advanceWerewolf(ctx.store, { decide: async () => { calls++; ready.resolve(); return response.promise; } });
    await ready.promise;
    expect(calls).toBe(1);
    expect(replayWerewolf(ctx.events)).toEqual(ctx.state);
    response.resolve({ kind: "opening", text: "One pointed question?", cue: null, recipientIds: [] });
    const after = await advancing;
    expect(calls).toBe(1);
    expect(projectWerewolfView(after, "mystery").entries.at(-1)).toMatchObject({ kind: "discussion", contribution: { text: "One pointed question?", turn: 1 } });
  });

  test("opening passes advance the persistent ring and skip threads, while eliminated seats are skipped next day", async () => {
    const ctx = await dawn();
    let state = await advanceWerewolf(ctx.store, ctx.quiet);
    const first = ctx.state.discussion!.initiativeIds[0]!;
    expect(state.openingCursor).toBe((state.openingOrderIds.indexOf(first) + 1) % state.openingOrderIds.length);
    expect(state.discussion).toMatchObject({ threadIndex: 1, checkpointPending: true });
    const eliminated = ctx.state.discussion!.initiativeIds.slice(1).find(id => state.roles[id] === "villager")!;
    const vote: WerewolfAgent = { decide: async input => input.request.action === "vote"
      ? { kind: "target", targetId: input.request.actorId === eliminated ? null : eliminated, thinking: "" }
      : ctx.quiet.decide(input) };
    while (!(state.phase === "day" && state.day === 2)) state = await advanceWerewolf(ctx.store, vote);
    const ring = ctx.state.openingOrderIds;
    const cursor = (ring.indexOf(first) + 1) % ring.length;
    expect(state.openingCursor).toBe(cursor);
    expect(state.openingOrderIds).toEqual(ring);
    expect(state.discussion!.initiativeIds).toEqual([...ring.slice(cursor), ...ring.slice(0, cursor)].filter(id => state.aliveIds.includes(id)));
    expect(state.discussion!.initiativeIds).not.toContain(eliminated);
    expect(state.discussion!.initiativeIds[0]).not.toBe(first);
  });

  test("strict opening contracts reject illegal recipients and malformed speech without advancing the queue", async () => {
    const ctx = await dawn();
    const step = nextWerewolfStep(ctx.state);
    if (step.kind !== "action" || step.request.action !== "open_thread") throw new Error("opening");
    const request = step.request;
    const artifact = werewolfDecisionArtifact(request);
    const valid = { text: "Why did you change your vote?", cue: "A brittle laugh.", recipientIds: request.legalRecipientIds.slice(0, 3) };
    for (const payload of [valid, { text: null, cue: "Hesitates.", recipientIds: [] }]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("valid");
    const invalid = [{ ...valid, recipientIds: [request.actorId] }, { ...valid, recipientIds: ["dead-or-unknown"] },
      { ...valid, recipientIds: [valid.recipientIds[0], valid.recipientIds[0]] }, { ...valid, recipientIds: request.legalRecipientIds },
      { ...valid, text: null }, { text: valid.text, cue: null }, { ...valid, actorId: request.actorId }, { ...valid, thinking: "secret" },
      { ...valid, text: "x".repeat(301) }, { ...valid, cue: "" }, {}];
    for (const payload of invalid) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("invalid");
    for (const payload of ["hello", "{}", `prefix ${JSON.stringify(valid)}`, '```json\n'+JSON.stringify(valid)+'\n```']) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, payload).status).toBe("invalid");
    const before = structuredClone(ctx.events);
    await expect(advanceWerewolf(ctx.store, { decide: async () => ({ kind: "opening", ...valid, recipientIds: [request.actorId] }) })).rejects.toThrow("recipients");
    expect(ctx.events).toEqual(before);
    expect(() => werewolfEvent(ctx.state, { type: "werewolf.action_accepted", payload: { ...request, decision: { kind: "speech", text: "hello", cue: null }, fallback: null } })).toThrow("speech");
  });

  test("tiny reply contracts reject model identities, gaze and private thinking", () => {
    const artifact = werewolfDecisionArtifact({ actorId: "p0", action: "discuss", legalTargetIds: [] });
    const valid = { text: "Why?", cue: "Hesitates." };
    for (const payload of [valid, { text: null, cue: null }]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("valid");
    for (const payload of [{ ...valid, actorId: "p0" }, { ...valid, thinking: "secret" }, { ...valid, lookAtPlayerId: "p1" }, { ...valid, recipientIds: [] }, { text: valid.text }, {}]) expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify(payload)).status).toBe("invalid");
  });
});
