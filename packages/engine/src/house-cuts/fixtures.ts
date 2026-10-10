/** Deliberately authored test dialogue; never evidence of real-game editorial quality. */
import { createEdgeSmokeDuskEvents } from "../fixtures/edge-smoke-dusk";
import { applyWerewolfEvent, nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import type { WerewolfDecision } from "../werewolf/types";
import { Phase } from "../types";
import type { TranscriptEntry } from "../game-runner.types";
import { influenceCutSource } from "./influence-source";
import { werewolfCutSource } from "./werewolf-source";
import { discoverCuts, type CutInvocation, type CutProposal } from "./editorial";

export function cutWerewolfFixture(night?: "save" | "miss" | "no_attack") {
  const names = ["Mara", "Ivo", "Sable", "Rowan", "Lyra", "Ash", "Nyx", "Fern"];
  const players = names.map((name, i) => ({ id: `p${i}`, name, personality: "Fixture", backstory: "Fixture", strategy: "PRIVATE_STRATEGY", avatarUrl: null }));
  const events = [startWerewolf("cut-fixture-werewolf", players, werewolfConfig("two_wolves", 1, night ? { playerCount: 8, wolves: 2, seer: true, doctor: true } : undefined), "cut-fixture")];
  let state = replayWerewolf(events);
  while (!state.outcome) {
    const step = nextWerewolfStep(state);
    if (step.kind === "complete") break;
    let data;
    if (step.kind === "event") data = step.event;
    else {
      const r = step.request;
      let decision: WerewolfDecision;
      if (r.action === "open_thread") decision = { kind: "opening", recipientIds: [], text: "You said you trusted everyone. Who would you actually protect?", cue: null };
      else if (r.action === "discuss") decision = { kind: "speech", text: "That is a very specific question for someone who promised not to ask questions.", cue: null };
      else if (r.action === "introduce") decision = { kind: "speech", text: "I brought tea. Trust will take a little longer.", cue: null };
      else if (r.action === "pack_talk") decision = { kind: "speech", text: state.pack && state.actions.length > 0 ? "Quietly? You just gave that plan a speech." : "Let them argue about certainty. We can agree on a target quietly.", cue: null };
      else if (night && r.action === "protect") decision = { kind: "target", thinking: "PRIVATE_THINKING", targetId: night === "save" ? state.pack?.targetId! : r.legalTargetIds.find(id => id !== state.pack?.targetId)! };
      else if (night === "no_attack" && r.action === "attack") decision = { kind: "target", thinking: "PRIVATE_THINKING", targetId: r.legalTargetIds[state.aliveIds.filter(id => state.roles[id] === "werewolf").indexOf(r.actorId)]! };
      else decision = { kind: "target", targetId: r.action === "vote" && r.voteMode === "majority" ? null : r.legalTargetIds[0]!, thinking: "PRIVATE_THINKING" };
      data = { type: "werewolf.action_accepted" as const, payload: { ...r, decision, fallback: null } };
    }
    const event = werewolfEvent(state, data);
    state = applyWerewolfEvent(state, event);
    events.push(event);
  }
  return events;
}

export function cutInfluenceFixture() {
  const events = createEdgeSmokeDuskEvents("cut-fixture-influence");
  const dialogue: TranscriptEntry[] = [
    { from: "lilith-voss", speakerPlayerId: "lilith-voss", text: "I trust you. I just prefer to count the votes myself.", entrySequence: 1 },
    { from: "kestrel", speakerPlayerId: "kestrel", text: "That is the warmest audit I have ever received.", entrySequence: 2 },
  ].map(entry => ({ ...entry, round: 1, phase: Phase.LOBBY, timestamp: 1, scope: "public" as const, dialogueKind: "public_speech" as const }));
  return { events, dialogue };
}

/** Fixture proposal generator tests the contract; it is explicitly not the proposed model algorithm. */
function fixtureResponse(request: CutInvocation) {
  const dialogue = request.window.evidence.filter(e => e.content.kind === "dialogue");
  const selected = dialogue.slice(0, 2);
  const pack = request.window.evidence[0]?.group.endsWith(":pack");
  const candidates: CutProposal[] = selected.length < 2 ? [] : [{ id: "exchange", title: request.window.game.kind === "influence" ? "The warmest audit" : pack ? "The quiet plan" : "A question about questions",
    context: pack ? "The pack negotiates away from the village." : "An exchange in the conversation.", angle: pack ? "Even a secret meeting has an audience." : "Trust sounds different when someone asks for specifics.", payoff: null,
    sourceRefs: selected.map(e => e.id), participantIds: [...new Set(selected.flatMap(e => e.participantIds))],
    quotes: selected.map(e => ({ sourceRef: e.id, excerpt: e.content.kind === "dialogue" ? e.content.text : "" })), factRefs: [],
    rationale: "Fixture-only example of dialogue without an elimination or forced payoff." }];
  return request.accept({ sourceHash: request.window.sourceHash, windowId: request.window.id, candidates });
}

export async function cutFixtureReports() {
  const influence = cutInfluenceFixture(), werewolf = cutWerewolfFixture();
  const sources = [influenceCutSource(influence.events, influence.dialogue, "fixture-influence"),
    werewolfCutSource(werewolf, "fixture-werewolf", "mystery"), werewolfCutSource(werewolf, "fixture-werewolf", "omniscient"),
    influenceCutSource(influence.events, [], "fixture-no-dialogue")];
  return Promise.all(sources.map(source => discoverCuts(source, async request => ({ decoded: fixtureResponse(request), kind: "fixture", costUsd: 0 }),
    { maxCalls: 100, maxInputBytesPerCall: 32_000, maxOutputTokensPerCall: 4_000 })));
}
