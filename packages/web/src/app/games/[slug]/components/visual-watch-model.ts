import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { GamePlayer, TranscriptEntry } from "@/lib/api";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import type { PresentationCue } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";

export interface VisualWatchData {
  publicationSnapshot?: Record<string, number>;
  bindings?: Record<string, string>;
  enabled: boolean;
  status: "preparing" | "recovery" | null;
  portraits: Record<string, string>;
  scenes: Array<Omit<AcceptedVisualScene, "annotatedImageUrl"> & { afterDialogueSequence: number; mediaVersionId?: string | null; publicationRevision?: number }>;
}

export function visualWatchPresentation(data: VisualWatchData, cue: PresentationCue | null, message: TranscriptEntry | null, players: readonly GamePlayer[]): { rooms: AcceptedVisualScene[]; beat: VisualPresentationBeat | null } {
  const rooms: AcceptedVisualScene[] = [];
  if (message?.entrySequence !== undefined) {
    for (const scene of data.scenes) {
      if (scene.afterDialogueSequence >= message.entrySequence) continue;
      const index = rooms.findIndex((room) => room.roomId === scene.roomId);
      const accepted = { ...scene, annotatedImageUrl: "" };
      if (index < 0) rooms.push(accepted);
      else if (rooms[index]!.version < scene.version) rooms[index] = accepted;
    }
  }
  let beat: VisualPresentationBeat | null = null;
  const portrait = (id: string, text: string, purpose: "Introduction" | "Ballot" | "Diary" | "Farewell" | "Conversation") => {
    const player = players.find((entry) => entry.id === id);
    if (player) beat = { kind: "portrait", purpose, player: { ...player, avatarUrl: data.portraits[id] ?? player.avatarUrl }, speech: { id: cue?.key ?? String(message?.id), playerId: id, speaker: player.name, text } };
  };
  if (cue?.source === "format") {
    if (cue.visualBallot) {
      const ballot = cue.visualBallot;
      const target = players.find((player) => player.id === ballot.targetId);
      if (target) portrait(ballot.voterId, `Vote to empower: ${target.name}.`, "Ballot");
    } else if (cue.kind === "format_roll_call") {
      const ballot = cue.ballot;
      const target = players.find((player) => player.id === ballot.targetId)?.name;
      const text = ballot.forfeited ? "Ballot forfeited." : target ? `Vote${ballot.polarity ? ` to ${ballot.polarity}` : ""}: ${target}.` : null;
      if (text) portrait(ballot.voterId, text, "Ballot");
    }
    return { rooms, beat };
  }
  if (cue?.source === "house") return { rooms, beat: { kind: "house", text: null, title: cue.title } };
  if (!message) return { rooms, beat };
  const speakerId = message.anonymous ? null : message.speakerPlayerId ?? message.fromPlayerId;
  if (message.acceptedBallot) {
    const ballot = message.acceptedBallot;
    const target = players.find((player) => player.id === ballot.targetId);
    if (target) portrait(ballot.voterId, `Vote${ballot.purpose === "winner" ? " for winner" : ` to ${ballot.purpose}`}: ${target.name}.`, "Ballot");
  }
  else if (message.presentationPurpose === "farewell" && speakerId) portrait(speakerId, message.text, "Farewell");
  else if (message.phase === "INTRODUCTION" && speakerId) portrait(speakerId, message.text, "Introduction");
  else if (message.scope === "diary" && speakerId) portrait(speakerId, message.text, "Diary");
  else {
    const binding = message.entrySequence !== undefined ? data.bindings?.[message.entrySequence] : undefined;
    const target = binding ? data.scenes.find(scene => scene.id === binding) : message.visualScene;
    if (target && rooms.some((room) => room.id === target.id)) beat = { kind: "scene", sceneId: target.id, roomId: target.roomId, speech: speakerId || message.anonymous ? {
      id: String(message.id), playerId: message.anonymous ? null : speakerId,
      speaker: message.anonymous ? "Anonymous" : players.find((player) => player.id === speakerId)?.name ?? message.fromPlayerName ?? "Player", text: message.text,
    } : null };
    if (!beat && message.anonymous) beat = { kind: "anonymous", speech: { id: String(message.id), playerId: null, speaker: "Anonymous", text: message.text } };
    else if (!beat && speakerId) portrait(speakerId, message.text, "Conversation");
    if (!speakerId && !message.anonymous) beat = { kind: "house", text: message.text };
  }
  return { rooms, beat };
}


/** Expand only at the canonical tally reveal, preserving the existing result cue. */
export function paceVisualBallots(cues: readonly PresentationCue[], players: readonly GamePlayer[]): PresentationCue[] {
  return cues.flatMap((cue): PresentationCue[] => {
    if (cue.source !== "format") return [cue];
    if (cue.kind === "empowered_tally") {
      const portraits = cue.receipts.map((receipt, index) => {
        const targetId = receipt.revoteTargetId ?? receipt.targetId;
        const name = players.find((player) => player.id === targetId)?.name ?? "Player";
        return { ...cue, key: `${cue.key}:visual-ballot:${index}`, before: cue.before, after: cue.before,
          visualBallot: { voterId: receipt.voterId, targetId, purpose: "empower" as const }, baseDurationMs: visualSpeechDurationMs(`Vote to empower: ${name}.`) };
      });
      return [...portraits, cue];
    }
    if (cue.kind === "format_roll_call") {
      const beat = visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cue, null, players).beat;
      if (beat?.kind === "portrait") return [{ ...cue, baseDurationMs: visualSpeechDurationMs(beat.speech.text) }];
    }
    return [cue];
  });
}
