import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { TranscriptEntry } from "@/lib/api";
import type { ClassicPresentationCue, FormatPresentationCue, FormatPresentationRosterPlayer, ReplayScene } from "./types";
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

/** Index the latest revealed lobby row used for scene binding, without scanning every prior cue. */
export function compileSafetyBounceLobbyLookup(cues: readonly ClassicPresentationCue[], scenes: readonly ReplayScene[]) {
  const rounds = new Map<number, {sequence: number; index: number; message: TranscriptEntry}[]>();
  for (const [index, cue] of cues.entries()) {
    if (cue.phase !== "LOBBY" || cue.canonicalSequence === null) continue;
    const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
    if (!message || message.round !== cue.round || message.phase !== "LOBBY" || message.entrySequence === undefined) continue;
    const rows = rounds.get(cue.round) ?? [];
    rows.push({sequence: cue.canonicalSequence, index, message});
    rounds.set(cue.round, rows);
  }
  const boundaries = new Map<number, {sequence: number; messages: readonly TranscriptEntry[]}[]>();
  for (const [round, rows] of rounds) {
    let latest: (typeof rows)[number] | undefined;
    boundaries.set(round, rows.sort((a, b) => a.sequence - b.sequence).map(row => {
      if (!latest || row.message.entrySequence! > latest.message.entrySequence!
        || (row.message.entrySequence === latest.message.entrySequence && row.index < latest.index)) latest = row;
      return {sequence: row.sequence, messages: [latest.message]};
    }));
  }
  const empty: readonly TranscriptEntry[] = [];
  return (round: number, sequence: number): readonly TranscriptEntry[] => {
    const rows = boundaries.get(round);
    if (!rows || Number.isNaN(sequence)) return empty;
    let low = 0, high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rows[middle]!.sequence <= sequence) low = middle + 1;
      else high = middle;
    }
    return rows[low - 1]?.messages ?? empty;
  };
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
