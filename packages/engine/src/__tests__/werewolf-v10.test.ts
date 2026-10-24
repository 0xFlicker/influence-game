import {expect, test} from "bun:test";
import {completedCurrentWerewolfFixture} from "../fixtures/werewolf-results";
import {applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, validateWerewolfAction, werewolfConfig, werewolfEvent} from "../werewolf/rules";
import {werewolfDecisionArtifact} from "../werewolf/agent";
import {werewolfFallback} from "../werewolf/runner";
import {observeWerewolf} from "../werewolf/observation";
import {projectWerewolfWatch} from "../werewolf/watch";
import {werewolfThinkingActions} from "../werewolf/thinking";
import type {WerewolfEvent, WerewolfRequest, WerewolfState} from "../werewolf/types";

const soloRequests: WerewolfRequest[] = [
  {actorId: "a", action: "protect", solo: true, legalTargetIds: ["b"], messageBytes: 320},
  {actorId: "a", action: "investigate", solo: true, legalTargetIds: ["b"], messageBytes: 320},
  {actorId: "a", action: "pack_propose", solo: true, targetRequired: true, legalTargetIds: ["b"], messageBytes: 320},
];
for (const request of soloRequests) test(`${request.action}: exact solo contract requires one explanation, no thinking`, () => {
  const artifact = werewolfDecisionArtifact(request);
  expect(artifact.schema).toMatchObject({required: ["targetId", "text", "cue"], additionalProperties: false});
  expect(JSON.stringify(artifact.schema)).not.toContain('"thinking"');
  const body = {targetId: "b", text: "I choose Bea because her next contribution matters.", cue: null};
  const accepted = artifact.decodeProviderPayload(body);
  expect(accepted).toEqual({status: "valid", value: {...body, kind: "solo_target"}});
  if (accepted.status !== "valid") throw new Error("Missing accepted value");
  expect(artifact.decodeAcceptedValue(accepted.value)).toEqual(accepted);
  for (const invalid of [{}, {...body, thinking: "duplicate"}, {...body, text: null}, {...body, text: " "}, {...body, targetId: "stranger"}, {...body, targetId: null}, {...body, text: "é".repeat(161)}]) {
    expect(artifact.decodeProviderPayload(invalid).status).toBe("invalid");
  }
});

test("v10 freezes solo night slots, retains messages and hides them from all other contestants and Mystery", async () => {
  expect(werewolfConfig("one_wolf").rulesVersion).toBe(10);
  const events = await completedCurrentWerewolfFixture("v10-solo", 10, {playerCount: 6, wolves: 1, seer: true, doctor: true});
  let state: WerewolfState | null = null;
  const soloEvents: WerewolfEvent[] = [];
  for (const event of events) {
    if (event.type === "werewolf.action_accepted" && "solo" in event.payload && event.payload.solo) {
      soloEvents.push(event);
      expect(event.payload.decision.kind).toBe("solo_target");
      expect(event.payload.decision).not.toHaveProperty("thinking");
      if (event.payload.action !== "pack_propose") {
        const before = state!;
        const after = applyWerewolfEvent(before, event);
        for (const player of before.players) expect(observeWerewolf(after, player.id)).toEqual(observeWerewolf(before, player.id));
      }
    }
    state = applyWerewolfEvent(state, event);
  }
  expect(soloEvents.map(e => e.type === "werewolf.action_accepted" ? e.payload.action : "").sort()).toEqual(["investigate", "pack_propose", "protect"]);
  const omni = projectWerewolfWatch(events, "omniscient", 1, 64);
  const night = omni.moments.find(m => m.entry.kind === "night")!;
  expect(night.night!.actions.filter(a => a.kind !== "hunt").map(a => a.speech?.text)).toEqual(["My protect choice tonight.", "My investigate choice tonight."]);
  expect(omni.playback.find(p => p.cursor === night.cursor)?.keys.map(k => k.split(":").slice(3).join(":"))).toHaveLength(6);
  expect(omni.navigation.filter(n => n.cursor === night.cursor).map(n => n.step)).toEqual([0, 2, 4, 5]);
  const mystery = projectWerewolfWatch(events, "mystery", 1, 64);
  expect(JSON.stringify(mystery)).not.toContain("choice tonight");
  expect(mystery.moments.every(m => !m.night)).toBe(true);
  const release = werewolfThinkingActions(events, omni.latestCursor);
  expect(release.filter(r => r.event.payload.action === "protect" || r.event.payload.action === "investigate").every(r => r.cursor === night.cursor)).toBe(true);
});

test("v9 night slots keep their original required thinking and no extra replay clips", async () => {
  const events = await completedCurrentWerewolfFixture("v9-night", 9, {playerCount: 6, wolves: 1, seer: true, doctor: true});
  expect(replayWerewolf(events).config.rulesVersion).toBe(9);
  const nightActions = events.filter(e => e.type === "werewolf.action_accepted" && ["protect", "investigate"].includes(e.payload.action));
  for (const event of nightActions) {
    if (event.type !== "werewolf.action_accepted") throw new Error("Missing action");
    expect(event.payload.decision.kind).toBe("target");
    expect(event.payload).not.toHaveProperty("solo");
    const {decision: _decision, fallback: _fallback, ...request} = event.payload;
    expect(werewolfDecisionArtifact(request).schema).toMatchObject({required: ["targetId", "thinking"]});
  }
  const watch = projectWerewolfWatch(events, "omniscient", 1, 64);
  const night = watch.moments.find(m => m.entry.kind === "night")!;
  expect(watch.playback.find(p => p.cursor === night.cursor)?.steps).toBe(4);
});

test("two wolves still negotiate with private thinking; solo fallback is legal and never fabricates speech", () => {
  const players = Array.from({length: 8}, (_, i) => ({id: `p${i}`, name: `Player ${i}`, personality: "", backstory: "", strategy: "", avatarUrl: null}));
  let state = applyWerewolfEvent(null, startWerewolf("v10-pack", players, werewolfConfig("two_wolves"), "seed"));
  while (state.phase !== "pack") {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") throw new Error("Unexpected completion");
    state = applyWerewolfEvent(state, werewolfEvent(state, step.kind === "event" ? step.event : {type: "werewolf.action_accepted", payload: {...step.request, decision: werewolfFallback(state, step.request), fallback: "provider_unavailable"}}));
  }
  const step = nextWerewolfStep(state);
  if (step.kind !== "action") throw new Error("Missing pack proposal");
  expect(step.request).not.toHaveProperty("solo");
  expect(werewolfDecisionArtifact(step.request).schema).toMatchObject({required: ["text", "cue", "thinking", "targetId"]});
  for (const request of soloRequests) {
    const decision = werewolfFallback(state, request);
    expect(decision).toEqual({kind: "solo_target", targetId: "b", text: null, cue: null});
    expect(() => validateWerewolfAction(request, {...request, decision, fallback: "provider_unavailable"})).not.toThrow();
    expect(() => validateWerewolfAction(request, {...request, decision, fallback: null})).toThrow();
  }
});
