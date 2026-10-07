import {voteSceneIdentity} from "./vote-ledger-model";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { GamePlayer, TranscriptEntry } from "@/lib/api";
import { visualSpeechDurationMs } from "@influence/engine/visual-speech";
import type { PresentationCue } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";
import { soloPresentationDurationMs } from "./solo-presentation-timing";
import { sceneSpeechDurationMs } from "./scene-speech-timing";
import { isSafetyBounceSceneCue, safetyBounceLobbyScene } from "./safety-bounce-scene-model";

/** Historical speaker/audience fields are seat IDs or exact frozen names, never dialogue prose. */
export function resolveTranscriptPlayer(token: string | null | undefined, players: readonly GamePlayer[]) {
  if (!token) return undefined;
  const seat = players.find(player => player.id === token);
  if (seat) return seat;
  const matches = players.filter(player => player.name === token);
  return matches.length === 1 ? matches[0] : undefined;
}

function isMingleDialogue(message: TranscriptEntry) {
  return message.scope === "mingle" || (message.scope === "whisper" && (message.phase === "MINGLE" || message.phase === "FORMAT_MINGLE"));
}

/** Reserve solo staging from committed transcript metadata, never image load timing. */
export function isSoloTranscript(message: TranscriptEntry): boolean {
  return Boolean(!message.anonymous && (message.acceptedBallot || ((message.speakerPlayerId || message.fromPlayerId)
    && (message.presentationPurpose === "farewell" || message.phase === "INTRODUCTION" || message.scope === "diary" || (!message.visualScene && !isMingleDialogue(message))))));
}

export function transcriptPresentationDurationMs(message: TranscriptEntry, players: readonly GamePlayer[] = []) {
  const text = message.acceptedBallot ? players.find(player => player.id === message.acceptedBallot!.targetId)?.name ?? message.text : message.text;
  return isSoloTranscript(message) ? soloPresentationDurationMs(text)
    : message.anonymous || message.speakerPlayerId || message.fromPlayerId
      ? sceneSpeechDurationMs(text) : visualSpeechDurationMs(text);
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

export function visualWatchPresentation(data: VisualWatchData, cue: PresentationCue | null, message: TranscriptEntry | null, players: readonly GamePlayer[], priorMessages: readonly TranscriptEntry[] = []): { rooms: AcceptedVisualScene[]; beat: VisualPresentationBeat | null } {
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
    if (cue.kind === "endgame_winner") {
      const winner = players.find(player => player.id === cue.playerId);
      if (winner) beat = { kind: "winner", winner: { ...winner, avatarUrl: data.portraits[winner.id] ?? winner.avatarUrl, fullBodyReferenceUrl: data.fullBodies?.[winner.id] },
        standings: players.filter(player => player.id !== winner.id).map(player => ({ ...player,
          avatarUrl: data.portraits[player.id] ?? player.avatarUrl,
          placement: cue.standings?.find(entry => entry.playerId === player.id)?.placement ?? null,
          juryMember: cue.juryVoterIds?.includes(player.id) ?? false,
        })).sort((a, b) => (a.placement ?? Infinity) - (b.placement ?? Infinity)) };
    } else if (cue.ballot) {
      const target = players.find((player) => player.id === cue.ballot!.targetId);
      if (target) portrait(cue.ballot.voterId, target.name, "Ballot", cue.ballot.purpose === "winner" ? "Vote for winner" : cue.ballot.juryTiebreaker ? "Jury tiebreak · Vote to eliminate" : "Vote to eliminate");
    } else {
      const name = players.find((player) => player.id === cue.playerId)?.name ?? "Player";
      beat = { kind: "house", text: `${name} is out.` };
    }
    return { rooms, beat };
  }
  if (cue?.source === "format") {
    if (cue.kind === "format_tiebreak" || cue.kind === "format_deciding_vote") {
      const chooser = players.find(player => player.id === cue.tiebreakerId);
      const ids = cue.kind === "format_tiebreak" ? cue.tiedPlayerIds : cue.after.resolution?.tiedPlayerIds ?? [];
      if (chooser && ids.length) return {rooms, beat: {kind: "nominee-selection",
        chooser: {...chooser, avatarUrl: data.portraits[chooser.id] ?? chooser.avatarUrl, fullBodyReferenceUrl: data.fullBodies?.[chooser.id]},
        nominees: ids.flatMap(id => {const player = players.find(p => p.id === id);return player ? [{...player, avatarUrl: data.portraits[id] ?? player.avatarUrl}] : []}),
        selectedId: cue.kind === "format_deciding_vote" ? cue.targetId : null,
      }};
    }
    if (isSafetyBounceSceneCue(cue)) {
      const lobby = safetyBounceLobbyScene(data, cue, priorMessages);
      if (lobby) return { rooms: [lobby], beat: { kind: "safety-bounce", scene: lobby, cue, roster: players } };
    }
    if (cue.kind === "format_deciding_vote") {
      const target = players.find(player => player.id === cue.targetId);
      if (target) portrait(cue.tiebreakerId, target.name, "Ballot", "Deciding vote · Vote to eliminate");
    } else if (cue.kind === "two_names_plea" && cue.status === "accepted" && cue.text) {
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
  const speakerToken = message.anonymous ? null : message.speakerPlayerId ?? message.fromPlayerId;
  const speaker = resolveTranscriptPlayer(speakerToken, players);
  const speakerId = speaker?.id ?? speakerToken;
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
    if (isMingleDialogue(message) && speaker) {
      const audience = message.toPlayerIds ?? target?.participantIds ?? [];
      const ids = new Set([speaker.id, ...audience.flatMap(token => {
        const player = resolveTranscriptPlayer(token, players);
        return player ? [player.id] : [];
      })]);
      const participants = players.filter(player => ids.has(player.id));
      if (!target || participants.some(player => !data.fullBodies?.[player.id])) {
        return { rooms, beat: { kind: "portrait-room", roomNumber: message.roomId ?? null,
          participants: participants.map(player => ({ ...player, avatarUrl: data.portraits[player.id] ?? player.avatarUrl })),
          speech: { id: String(message.id), playerId: speaker.id, speaker: speaker.name, text: message.text } } };
      }
    }
    if (target) {
      // An explicit canonical binding wins over another version of this room.
      // A newer image may have a different cast, even at the same watch step.
      const index = rooms.findIndex(room => room.roomId === target.roomId);
      if (index >= 0) rooms[index] = { ...target, annotatedImageUrl: "" };
      else rooms.push({ ...target, annotatedImageUrl: "" });
      beat = { kind: "scene", sceneId: target.id, roomId: target.roomId, speech: speakerId || message.anonymous ? {
        id: String(message.id), playerId: message.anonymous ? null : speakerId,
        portrait: speakerId ? { avatarUrl: data.portraits[speakerId] ?? players.find(p => p.id === speakerId)?.avatarUrl, persona: players.find(p => p.id === speakerId)?.persona ?? "", personaKey: players.find(p => p.id === speakerId)?.personaKey } : undefined,
        speaker: message.anonymous ? "Anonymous" : players.find((player) => player.id === speakerId)?.name ?? message.fromPlayerName ?? "Player", text: message.text,
      } : null };
    }
    if (!beat && message.anonymous) beat = { kind: "anonymous", speech: { id: String(message.id), playerId: null, speaker: "Anonymous", text: message.text } };
    else if (!beat && speakerId) {
      portrait(speakerId, message.text, "Conversation");
    }
    if (!speakerId && !message.anonymous) beat = { kind: "house", text: message.text };
  }
  // Keep unresolved saved attribution readable in every speech phase without assigning it to a seat.
  if (!beat && speakerId) {
    const name = message.fromPlayerName ?? speakerId;
    const purpose = message.phase === "INTRODUCTION" ? "Introduction" : message.presentationPurpose === "farewell" ? "Farewell" : message.scope === "diary" ? "Diary" : "Conversation";
    beat = { kind: "portrait", purpose, player: { id: speakerId, name, persona: "" },
      speech: { id: String(message.id), playerId: null, speaker: name, text: message.text } };
  }
  return { rooms, beat };
}


/** Expand only at the canonical tally reveal, preserving the existing result cue. */
export function paceVisualBallots(cues: readonly PresentationCue[], players: readonly GamePlayer[]): PresentationCue[] {
  const expanded = cues.flatMap((cue): PresentationCue[] => {
    if (cue.source !== "format") return [cue.source === "endgame" && cue.ballot ? { ...cue, speechPresentation: "solo" } : cue];
    if (cue.kind === "empowered_tally" || cue.kind === "empowered_tie") {
      const revote = cue.kind === "empowered_tally" && Boolean(cue.resolutionMethod);
      const receipts = revote
        ? cue.receipts.flatMap(receipt => receipt.revoteTargetId ? [{ voterId: receipt.voterId, targetId: receipt.revoteTargetId, revote: true }] : [])
        : cue.receipts.map(receipt => ({ voterId: receipt.voterId, targetId: receipt.targetId, revote: false }));
      const portraits = receipts.map((receipt, index) => {
        const name = players.find((player) => player.id === receipt.targetId)?.name ?? "Player";
        return { ...cue, key: `${cue.key}:visual-ballot:${index}`, before: cue.before, after: cue.before,
          visualBallot: { ...receipt, purpose: "empower" as const }, speechPresentation: "solo" as const, baseDurationMs: soloPresentationDurationMs(name) };
      });
      return [...portraits, cue];
    }
    if (cue.kind === "format_tiebreak" || cue.kind === "format_deciding_vote") return [{...cue, baseDurationMs: cue.kind === "format_tiebreak" ? 3600 : 4400}];
    if (cue.kind === "format_roll_call" || cue.kind === "two_names_plea") {
      const beat = visualWatchPresentation({ enabled: true, status: null, portraits: {}, scenes: [] }, cue, null, players).beat;
      if (beat?.kind === "portrait") return [{ ...cue, speechPresentation: "solo", baseDurationMs: soloPresentationDurationMs(beat.speech.text) }];
    }
    return [cue];
  });
  return expanded.flatMap((cue, index) => {
    const group = voteSceneIdentity(cue);
    const next = expanded[index + 1];
    return group && (!next || voteSceneIdentity(next) !== group)
      ? [cue, {...cue, key: `${cue.key}:tally`, voteSummary: true, baseDurationMs: 3200}]
      : [cue];
  });
}
