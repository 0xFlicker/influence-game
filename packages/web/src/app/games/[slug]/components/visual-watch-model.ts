import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { GamePlayer, TranscriptEntry } from "@/lib/api";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import type { PresentationCue } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";
import { soloPresentationDurationMs } from "./solo-presentation-timing";

/** Reserve solo staging from committed transcript metadata, never image load timing. */
export function isSoloTranscript(message: TranscriptEntry): boolean {
  return Boolean(!message.anonymous && (message.acceptedBallot || ((message.speakerPlayerId || message.fromPlayerId)
    && (message.presentationPurpose === "farewell" || message.phase === "INTRODUCTION" || message.scope === "diary" || !message.visualScene))));
}

export function transcriptPresentationDurationMs(message: TranscriptEntry, players: readonly GamePlayer[] = []) {
  const text = message.acceptedBallot ? players.find(player => player.id === message.acceptedBallot!.targetId)?.name ?? message.text : message.text;
  return isSoloTranscript(message) ? soloPresentationDurationMs(text) : visualSpeechDurationMs(text);
}

export interface VisualWatchData {
  publicationSnapshot?: Record<string, number>;
  bindings?: Record<string, string>;
  enabled: boolean;
  status: "preparing" | "recovery" | null;
  portraits: Record<string, string>;
  fullBodyHeads?: Record<string, import("@influence/engine/character-portrait").HeadRectangle>;
  fullBodies?: Record<string, string>;
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
  const portrait = (id: string, text: string, purpose: "Introduction" | "Ballot" | "Diary" | "Farewell" | "Conversation" | "Plea", caption?: string) => {
    const player = players.find((entry) => entry.id === id);
    if (player) beat = { kind: "portrait", purpose, caption, player: { ...player, avatarUrl: data.portraits[id] ?? player.avatarUrl, fullBodyReferenceUrl: data.fullBodies?.[id], headRectangle: data.fullBodyHeads?.[id] }, speech: { id: cue?.key ?? String(message?.id), playerId: id, speaker: player.name, text } };
  };
  if (cue?.source === "endgame") {
    if (cue.ballot) {
      const target = players.find((player) => player.id === cue.ballot!.targetId);
      if (target) portrait(cue.ballot.voterId, target.name, "Ballot", cue.ballot.purpose === "winner" ? "Vote for winner" : cue.ballot.juryTiebreaker ? "Jury tiebreak · Vote to eliminate" : "Vote to eliminate");
    } else {
      const name = players.find((player) => player.id === cue.playerId)?.name ?? "Player";
      beat = { kind: "house", text: cue.kind === "endgame_winner" ? `${name} wins The House.` : `${name} is out.` };
    }
    return { rooms, beat };
  }
  if (cue?.source === "format") {
    if (cue.kind === "two_names_plea" && cue.status === "accepted" && cue.text) {
      portrait(cue.speakerId, cue.text, "Plea", `Final plea · ${cue.ordinal + 1} of 2`);
    } else if (cue.visualBallot) {
      const ballot = cue.visualBallot;
      const target = players.find((player) => player.id === ballot.targetId);
      if (target) portrait(ballot.voterId, target.name, "Ballot", ballot.revote ? "Revote to empower" : "Vote to empower");
    } else if (cue.kind === "format_roll_call") {
      const ballot = cue.ballot;
      const target = players.find((player) => player.id === ballot.targetId)?.name;
      const text = ballot.forfeited ? "Ballot forfeited." : target ? target : null;
      if (text) portrait(ballot.voterId, text, "Ballot", ballot.polarity === "save" ? "Vote to save" : "Vote to eliminate");
    }
    return { rooms, beat };
  }
  if (cue?.source === "house") return { rooms, beat: { kind: "house", text: null, title: cue.title } };
  if (!message) return { rooms, beat };
  const speakerId = message.anonymous ? null : message.speakerPlayerId ?? message.fromPlayerId;
  if (message.acceptedBallot) {
    const ballot = message.acceptedBallot;
    const target = players.find((player) => player.id === ballot.targetId);
    if (target) portrait(ballot.voterId, target.name, "Ballot", ballot.purpose === "winner" ? "Vote for winner" : `Vote to ${ballot.purpose}`);
  }
  else if (message.presentationPurpose === "farewell" && speakerId) portrait(speakerId, message.text, "Farewell");
  else if (message.phase === "INTRODUCTION" && speakerId) portrait(speakerId, message.text, "Introduction");
  else if (message.scope === "diary" && speakerId) portrait(speakerId, message.text, "Diary");
  else {
    const binding = message.entrySequence !== undefined ? data.bindings?.[message.entrySequence] : undefined;
    const target = data.scenes.find(scene => scene.id === (binding ?? message.visualScene?.id)
      && message.entrySequence !== undefined && scene.afterDialogueSequence < message.entrySequence);
    if (target) {
      // An explicit canonical binding wins over another version of this room.
      // A newer image may have a different cast, even at the same watch step.
      const index = rooms.findIndex(room => room.roomId === target.roomId);
      if (index >= 0) rooms[index] = { ...target, annotatedImageUrl: "" };
      else rooms.push({ ...target, annotatedImageUrl: "" });
      beat = { kind: "scene", sceneId: target.id, roomId: target.roomId, speech: speakerId || message.anonymous ? {
        id: String(message.id), playerId: message.anonymous ? null : speakerId,
        speaker: message.anonymous ? "Anonymous" : players.find((player) => player.id === speakerId)?.name ?? message.fromPlayerName ?? "Player", text: message.text,
      } : null };
    }
    if (!beat && message.anonymous) beat = { kind: "anonymous", speech: { id: String(message.id), playerId: null, speaker: "Anonymous", text: message.text } };
    else if (!beat && speakerId) portrait(speakerId, message.text, "Conversation");
    if (!speakerId && !message.anonymous) beat = { kind: "house", text: message.text };
  }
  return { rooms, beat };
}


/** Expand only at the canonical tally reveal, preserving the existing result cue. */
export function paceVisualBallots(cues: readonly PresentationCue[], players: readonly GamePlayer[]): PresentationCue[] {
  return cues.flatMap((cue): PresentationCue[] => {
    if (cue.source !== "format") return [{ ...cue, soloSpeech: cue.soloSpeech || (cue.source === "endgame" && Boolean(cue.ballot)) }];
    if (cue.kind === "empowered_tally") {
      const receipts = [
        ...cue.receipts.map(receipt => ({ voterId: receipt.voterId, targetId: receipt.targetId, revote: false })),
        ...cue.receipts.flatMap(receipt => receipt.revoteTargetId ? [{ voterId: receipt.voterId, targetId: receipt.revoteTargetId, revote: true }] : []),
      ];
      const portraits = receipts.map((receipt, index) => {
        const name = players.find((player) => player.id === receipt.targetId)?.name ?? "Player";
        return { ...cue, key: `${cue.key}:visual-ballot:${index}`, before: cue.before, after: cue.before,
          visualBallot: { ...receipt, purpose: "empower" as const }, soloSpeech: true, baseDurationMs: soloPresentationDurationMs(name) };
      });
      return [...portraits, cue];
    }
    if (cue.kind === "format_roll_call" || cue.kind === "two_names_plea") {
      const beat = visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cue, null, players).beat;
      if (beat?.kind === "portrait") return [{ ...cue, soloSpeech: true, baseDurationMs: soloPresentationDurationMs(beat.speech.text) }];
    }
    return [cue];
  });
}
