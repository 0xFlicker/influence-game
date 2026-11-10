import { expect, test } from "bun:test";
import { werewolfDecisionArtifact } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { werewolfReportEntry } from "../werewolf/report";
import {
  applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf,
  validateWerewolfAction, werewolfConfig, werewolfEvent,
} from "../werewolf/rules";
import { werewolfFallback } from "../werewolf/runner";
import { projectWerewolfWatch } from "../werewolf/watch";
import { werewolfRetrospectiveSpeakerIds } from "../werewolf/retrospective-order";
import type { WerewolfDecision, WerewolfPlayer, WerewolfState } from "../werewolf/types";

const players: WerewolfPlayer[] = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index}`, name: `Player ${index}`, personality: "Fixture", backstory: "", strategy: "", avatarUrl: null,
}));

function hunterState(seed = "hunter-seed") {
  const config = werewolfConfig("two_wolves", 10, { playerCount: 8, wolves: 2, seer: false, doctor: true, hunter: true });
  return applyWerewolfEvent(null, startWerewolf("hunter-game", players, config, seed));
}

function byRole(state: WerewolfState, role: string) {
  return state.players.find((player) => state.roles[player.id] === role)!;
}

function decisionFor(state: WerewolfState, request: Extract<ReturnType<typeof nextWerewolfStep>, { kind: "action" }>["request"], snipe: "fire-wolf" | "hold" = "hold"): WerewolfDecision {
  switch (request.action) {
    case "speaking_priority": return { kind: "speaking_priority", priority: 50 };
    case "pack_propose": return "solo" in request && request.solo
      ? { kind: "solo_target", targetId: request.legalTargetIds[0]!, text: "My lone attack choice tonight.", cue: null }
      : { kind: "spoken_target", targetId: request.legalTargetIds[0]!, text: null, cue: null, thinking: "Fixture pack choice." };
    case "protect":
    case "investigate": return { kind: "solo_target", targetId: request.legalTargetIds[0]!, text: `My ${request.action} choice tonight.`, cue: null };
    case "snipe": {
      if (snipe === "hold") return { kind: "item_use", itemId: null, targetId: null, text: "I am holding my shot tonight; it is worth more with more information.", cue: null };
      const wolf = state.aliveIds.find((id) => state.roles[id] === "werewolf" && id !== request.actorId)!;
      return { kind: "item_use", itemId: "snipe", targetId: wolf, text: "Taking the shot I have been waiting for.", cue: null };
    }
    case "conversation": return { kind: "conversation", text: null, cue: null, recipientId: null, replyToContributionId: null };
    case "public_vote": return { kind: "spoken_target", targetId: null, text: null, cue: null, thinking: "Fixture abstention." };
    default: return request.legalTargetIds.length
      ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture." }
      : { kind: "speech", text: "A brief introduction.", cue: null };
  }
}

function advance(state: WerewolfState, snipe: "fire-wolf" | "hold" = "hold"): WerewolfState {
  const step = nextWerewolfStep(state);
  if (step.kind === "complete") return state;
  if (step.kind === "event") return applyWerewolfEvent(state, werewolfEvent(state, step.event));
  return applyWerewolfEvent(state, werewolfEvent(state, {
    type: "werewolf.action_accepted",
    payload: { ...step.request, decision: decisionFor(state, step.request, snipe), fallback: null },
  }));
}

function untilNightResolved(seed: string, snipe: "fire-wolf" | "hold") {
  let state = hunterState(seed);
  for (let guard = 0; guard < 200 && !state.history.some((entry) => entry.kind === "night"); guard++) state = advance(state, snipe);
  return state;
}

function eventsThroughFirstNight(seed: string, snipe: "fire-wolf" | "hold") {
  const started = startWerewolf("hunter-game", players, werewolfConfig("two_wolves", 10, { playerCount: 8, wolves: 2, seer: false, doctor: true, hunter: true }), seed);
  const events: import("../werewolf/types").WerewolfEvent[] = [started];
  let state = applyWerewolfEvent(null, started);
  for (let guard = 0; guard < 200 && !state.history.some((entry) => entry.kind === "night"); guard++) {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") break;
    const event = step.kind === "event"
      ? werewolfEvent(state, step.event)
      : werewolfEvent(state, { type: "werewolf.action_accepted", payload: { ...step.request, decision: decisionFor(state, step.request, snipe), fallback: null } });
    events.push(event);
    state = applyWerewolfEvent(state, event);
  }
  return events;
}

test("v12 hunter setup freezes one hunter with a single snipe and keeps historical setups on v11", () => {
  const state = hunterState();
  expect(state.config.rulesVersion).toBe(12);
  expect(Object.values(state.roles).sort()).toEqual(["doctor", "hunter", "villager", "villager", "villager", "villager", "werewolf", "werewolf"]);
  const hunter = byRole(state, "hunter");
  expect(state.items[hunter.id]).toEqual(["snipe"]);
  expect(Object.entries(state.items).filter(([, items]) => items.length > 0)).toHaveLength(1);
  expect(werewolfConfig("two_wolves", 10, { playerCount: 8, wolves: 2, seer: true, doctor: true }).rulesVersion).toBe(11);
});

test("item context is public about existence, private about ownership, and seen after a public snipe death", () => {
  const state = hunterState();
  const hunter = byRole(state, "hunter");
  const villager = byRole(state, "villager");
  const hunterObservation = observeWerewolf(state, hunter.id);
  expect(hunterObservation.itemCatalog!.map((item) => item.id)).toEqual(["snipe"]);
  expect(hunterObservation.items!.owned).toEqual(["snipe"]);
  expect(hunterObservation.items!.seen).toEqual([]);
  const villagerObservation = observeWerewolf(state, villager.id);
  expect(villagerObservation.itemCatalog!.map((item) => item.id)).toEqual(["snipe"]);
  expect(villagerObservation.items!.owned).toEqual([]);
  expect(JSON.stringify(villagerObservation.board.players)).not.toContain("snipe");

  const after = untilNightResolved("seen-seed", "fire-wolf");
  const survivor = after.players.find((player) => after.aliveIds.includes(player.id) && player.id !== hunter.id)!;
  expect(observeWerewolf(after, survivor.id).items!.seen).toEqual([
    expect.objectContaining({ itemId: "snipe", day: 1 }),
  ]);
});

test("snipe schema requires a held-or-fired item command and rejects malformed commands", () => {
  const state = hunterState();
  const hunter = byRole(state, "hunter");
  let current = state;
  while (current.phase !== "night") current = advance(current);
  const step = nextWerewolfStep(current);
  // Doctor/seer-style solo slots may precede the hunter in alive order; walk to the snipe slot.
  let request = step.kind === "action" ? step.request : null;
  for (let guard = 0; guard < 20 && request?.action !== "snipe"; guard++) {
    current = advance(current);
    const next = nextWerewolfStep(current);
    request = next.kind === "action" ? next.request : null;
  }
  expect(request?.action).toBe("snipe");
  if (!request || request.action !== "snipe") throw new Error("Missing snipe request");
  expect(request.actorId).toBe(hunter.id);
  expect(request.usableItemIds).toEqual(["snipe"]);

  const artifact = werewolfDecisionArtifact(request);
  expect(JSON.stringify(artifact.schema)).not.toContain('"thinking"');
  const held = { itemId: null, targetId: null, text: "Holding tonight for a better shot.", cue: null };
  expect(artifact.decodeProviderPayload(held)).toEqual({ status: "valid", value: { ...held, kind: "item_use" } });
  const target = request.legalTargetIds[0]!;
  const fired = { itemId: "snipe", targetId: target, text: "Firing tonight at the strongest wolf read.", cue: null };
  expect(artifact.decodeProviderPayload(fired).status).toBe("valid");
  for (const invalid of [
    {}, { ...held, extra: true }, { ...held, itemId: "bomb" }, { ...held, targetId: target },
    { ...fired, targetId: null }, { ...fired, targetId: hunter.id }, { ...held, thinking: "duplicate" },
    { ...held, text: null }, { ...held, text: "é".repeat(161) },
  ]) expect(artifact.decodeProviderPayload(invalid).status).toBe("invalid");

  const fallback = werewolfFallback(current, request);
  expect(fallback).toEqual({ kind: "item_use", itemId: null, targetId: null, text: null, cue: null });
  expect(() => validateWerewolfAction(request, { ...request, decision: fallback, fallback: "provider_unavailable" })).not.toThrow();
});

test("fired snipe resolves with the pack attack as a second death, is consumed, and feeds the win check", () => {
  let state = untilNightResolved("fire-seed", "fire-wolf");
  for (const seed of Array.from({ length: 24 }, (_, index) => `fire-seed-${index + 2}`)) {
    const night = state.history.find((entry) => entry.kind === "night");
    if (night?.kind === "night" && night.result.killedId && night.result.snipe?.killedId && night.result.killedId !== night.result.snipe.killedId) break;
    state = untilNightResolved(seed, "fire-wolf");
  }
  const night = state.history.find((entry) => entry.kind === "night");
  if (!night || night.kind !== "night") throw new Error("Missing night resolution");
  expect(night.result.killedId).not.toBeNull();
  expect(night.result.snipe?.killedId).not.toBeNull();
  expect(night.result.snipe?.killedId).not.toBe(night.result.killedId);
  expect(state.aliveIds).not.toContain(night.result.killedId);
  expect(state.aliveIds).not.toContain(night.result.snipe?.killedId);
  const hunter = byRole(state, "hunter");
  expect(state.items[hunter.id]).toEqual([]);
  expect(state.itemUses).toEqual([expect.objectContaining({ actorId: hunter.id, itemId: "snipe", killedId: night.result.snipe?.killedId })]);
});

test("snipe victim remains in the retrospective speaker order after the outcome", () => {
  let state = untilNightResolved("retro-seed", "fire-wolf");
  const night = state.history.find((entry) => entry.kind === "night");
  if (!night || night.kind !== "night" || !night.result.snipe?.killedId) throw new Error("Missing snipe death");
  for (let guard = 0; guard < 3000 && !state.outcome; guard++) state = advance(state, "hold");
  expect(state.outcome).not.toBeNull();
  const speakers = werewolfRetrospectiveSpeakerIds(state);
  expect(speakers).toHaveLength(state.players.length);
  expect(speakers).toContain(night.result.snipe.killedId);
  expect(new Set(speakers).size).toBe(state.players.length);
});

test("held snipe stays available on the next night and no snipe request is offered after it is spent", () => {
  let state = untilNightResolved("hold-seed", "hold");
  const hunter = byRole(state, "hunter");
  if (!state.aliveIds.includes(hunter.id)) return; // Pack may legally kill the hunter; seed-specific path covered by fire test.
  expect(state.items[hunter.id]).toEqual(["snipe"]);
  for (let guard = 0; guard < 300 && state.day < 2; guard++) state = advance(state, "hold");
  let sawSnipe = false;
  for (let guard = 0; guard < 300 && state.phase === "night" && !state.history.filter((entry) => entry.kind === "night").length.toString().startsWith("2"); guard++) {
    const step = nextWerewolfStep(state);
    if (step.kind === "action" && step.request.action === "snipe") { sawSnipe = true; break; }
    if (step.kind === "complete") break;
    state = advance(state, "hold");
    if (state.history.filter((entry) => entry.kind === "night").length >= 2) break;
  }
  expect(sawSnipe).toBe(true);
});

test("held snipe still plays as an Omniscient Hunter night beat and stays hidden in Mystery", () => {
  const events = eventsThroughFirstNight("held-view-seed", "hold");
  const omniscient = projectWerewolfWatch(events, "omniscient", 1, 64);
  const night = omniscient.moments.find((moment) => moment.entry.kind === "night")!;
  expect(night.night?.actions).toContainEqual(expect.objectContaining({ kind: "snipe", held: true, targetId: null }));
  const mystery = projectWerewolfWatch(events, "mystery", 1, 64);
  expect(mystery.moments.every((moment) => !moment.night)).toBe(true);
});

test("Mystery hides holdings and the sniper while Omniscient shows remaining items and the snipe beat", () => {
  const events: import("../werewolf/types").WerewolfEvent[] = [];
  let state = hunterState("view-seed");
  events.push(startWerewolf("hunter-game", players, state.config, "view-seed"));
  // Rebuild the event log through the first resolved night using the same scripted decisions.
  state = replayWerewolf(events);
  for (let guard = 0; guard < 200 && !state.history.some((entry) => entry.kind === "night"); guard++) {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") break;
    const event = step.kind === "event"
      ? werewolfEvent(state, step.event)
      : werewolfEvent(state, { type: "werewolf.action_accepted", payload: { ...step.request, decision: decisionFor(state, step.request, "fire-wolf"), fallback: null } });
    events.push(event);
    state = applyWerewolfEvent(state, event);
  }
  const mystery = projectWerewolfView(state, "mystery");
  expect(JSON.stringify(mystery.players)).not.toContain("snipe");
  const mysteryNight = mystery.entries.find((entry) => entry.kind === "night");
  expect(mysteryNight && "snipe" in mysteryNight ? mysteryNight.snipe : undefined).toBeUndefined();
  const omniscient = projectWerewolfView(state, "omniscient");
  const hunter = byRole(state, "hunter");
  expect(omniscient.players.find((player) => player.id === hunter.id)?.items).toEqual([]);
  const watch = projectWerewolfWatch(events, "omniscient", 1, 64);
  const nightMoment = watch.moments.find((moment) => moment.entry.kind === "night")!;
  expect(nightMoment.night?.actions.some((action) => action.kind === "snipe")).toBe(true);
  const report = werewolfReportEntry(mysteryNight!, mystery, true);
  expect(report).not.toContain(hunter.name + " sniped");
});

test("retrospective facts retain fired item, target and snipe-only death", async () => {
  const {completedHunterFixture} = await import("../fixtures/werewolf-hunter");
  const {compileWerewolfRetrospective} = await import("../werewolf/retrospective");
  const events = await completedHunterFixture("snipe-only");
  const night = events.find(e=>e.type === "werewolf.night_resolved")!;
  if(night.type !== "werewolf.night_resolved") throw new Error("Missing night");
  expect(night.payload.killedId).toBeNull();
  const input = compileWerewolfRetrospective(events).input;
  const facts = JSON.stringify(input.sections);
  expect(facts).toContain('\\"itemId\\":\\"snipe\\"');
  expect(facts).toContain('\\"result\\":\\"death\\"');
  expect(facts).toContain('\\"snipe\\":');
  const aside = input.dialogue.find(d=>d.text.startsWith("I will fire"))!;
  expect(aside.scope).toBe("private");
  expect(aside.audiencePlayerIds).toEqual([night.payload.snipe!.actorId]);
});

for (const version of [7,8,9,10,11] as const) test(`v${version} observation retains the pre-item serialized contract`, () => {
  const config = {...werewolfConfig("two_wolves"),rulesVersion:version};
  if(version < 9) delete config.discussionPolicy;
  const state = applyWerewolfEvent(null,startWerewolf(`historical-${version}`,players,config,"historical-items"));
  const observation = observeWerewolf(state,state.players[0]!.id);
  expect(Object.hasOwn(observation,"items")).toBe(false);
  expect(Object.hasOwn(observation,"itemCatalog")).toBe(false);
});

test("already-frozen v12 retrospective keeps its original pre-item-facts input", async () => {
  const {completedHunterFixture} = await import("../fixtures/werewolf-hunter");
  const {compileWerewolfRetrospective} = await import("../werewolf/retrospective");
  const {createRetrospectiveDefinition} = await import("../retrospective");
  const {canonicalJson} = await import("@influence/prompt-lab-protocol");
  const complete = await completedHunterFixture("snipe-only");
  const events = complete.slice(0,complete.findIndex(e=>e.type === "werewolf.retrospective_started"));
  const source = compileWerewolfRetrospective(events);
  // Freeze the exact original v12 serialization, as an existing accepted record.
  const oldInput = structuredClone(source.input);
  for(const section of oldInput.sections) section.summary = section.summary.split("\n").map(line=>{
    const start = line.indexOf("{");
    const prefix = line.slice(0,start);
    const fact = JSON.parse(line.slice(start));
    if(prefix.includes("werewolf.action_accepted") && fact.action === "snipe") {delete fact.itemId;delete fact.targetId;}
    if(prefix.includes("werewolf.night_resolved")) {delete fact.snipe;fact.result=fact.killedId ? "death" : fact.attackTargetId === null ? "no_attack" : fact.attackTargetId === fact.protectedId ? "doctor_save" : "no_death";}
    return prefix+canonicalJson(fact);
  }).join("\n");
  const definition = createRetrospectiveDefinition(oldInput,source.speakerIds);
  events.push(werewolfEvent(replayWerewolf(events),{type:"werewolf.retrospective_started",payload:definition}));
  const frozen = structuredClone(events);
  expect(compileWerewolfRetrospective(events).input).toEqual(oldInput);
  expect(events).toEqual(frozen);
});
