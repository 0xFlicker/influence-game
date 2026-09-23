import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { TranscriptEntry } from "@/lib/api";
import type { FormatPresentationCue, FormatPresentationRosterPlayer } from "./types";
import type { VisualWatchData } from "./visual-watch-model";

export type SafetyBounceSceneCue = Extract<FormatPresentationCue, { kind:
  "safety_bounce_started" | "safety_bounce_pointer" | "format_aggregate" | "format_tiebreak"
}>;
export interface SafetyBounceSceneBeat {
  kind: "safety-bounce";
  scene: AcceptedVisualScene;
  cue: SafetyBounceSceneCue;
  roster: readonly FormatPresentationRosterPlayer[];
}

/** Reuse only a lobby already available to this round's accepted dialogue prefix. */
export function safetyBounceLobbyScene(data: VisualWatchData, cue: FormatPresentationCue, priorMessages: readonly TranscriptEntry[]): AcceptedVisualScene | null {
  const board = cue.after.safetyBounce;
  if (cue.after.activeFormatId !== "safety_bounce" || !board) return null;
  const participants = [...board.safePlayerIds, ...board.vulnerablePlayerIds, ...board.benchPlayerIds];
  const lobbyMessages = priorMessages.filter(message => message.round === cue.round && message.phase === "LOBBY" && message.entrySequence !== undefined);
  const lastLobby = lobbyMessages.toSorted((a, b) => b.entrySequence! - a.entrySequence!)[0];
  if (!lastLobby) return null;
  const boundId = data.bindings?.[lastLobby.entrySequence!] ?? lastLobby.visualScene?.id;
  const candidates = data.scenes.filter(scene => scene.roomId === "lobby"
    && scene.afterDialogueSequence < lastLobby.entrySequence!
    && scene.participantIds.length === participants.length
    && participants.every(id => scene.participantIds.includes(id)));
  const scene = boundId ? candidates.find(scene => scene.id === boundId)
    : candidates.toSorted((a, b) => b.afterDialogueSequence - a.afterDialogueSequence || b.version - a.version)[0];
  return scene ? { ...scene, annotatedImageUrl: "" } : null;
}

export function isSafetyBounceSceneCue(cue: FormatPresentationCue): cue is SafetyBounceSceneCue {
  return cue.after.activeFormatId === "safety_bounce" && Boolean(cue.after.safetyBounce)
    && (cue.kind === "safety_bounce_started" || cue.kind === "safety_bounce_pointer"
      || cue.kind === "format_aggregate" || cue.kind === "format_tiebreak");
}

/** Endpoint geometry comes exclusively from clear, saved head rectangles. */
export function safetyBounceAnchors(scene: AcceptedVisualScene) {
  return new Map(scene.anchors.filter(anchor => anchor.confidence === "clear").map(anchor => [anchor.playerId, {
    x: anchor.head.x + anchor.head.width / 2,
    y: Math.min(.97, anchor.head.y + anchor.head.height + .025),
  }]));
}

export function bounceArrowPath(from: { x: number; y: number }, to: { x: number; y: number }, index: number) {
  const midX = (from.x + to.x) / 2;
  const bendY = Math.min(.98, Math.max(from.y, to.y) + .08 + (index % 3) * .025);
  return `M ${from.x * 1000} ${from.y * 1000} Q ${midX * 1000} ${bendY * 1000} ${to.x * 1000} ${to.y * 1000}`;
}
