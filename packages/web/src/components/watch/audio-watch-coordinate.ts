import type { AudioWatchCoordinate } from "@influence/engine/audio-watch";

/** Live publication IDs are negative UI keys, never persisted transcript IDs. */
export function influenceTranscriptAudioIdentity(message: {id:number;entrySequence?:number}) {
  const identity = {...(Number.isSafeInteger(message.id) && message.id > 0 && {transcriptId:String(message.id)}),
    ...(Number.isSafeInteger(message.entrySequence) && message.entrySequence! > 0 && {entrySequence:message.entrySequence})};
  return identity.transcriptId || identity.entrySequence !== undefined ? identity : null;
}

export function matchesAudioWatch(saved: AudioWatchCoordinate | undefined, requested: AudioWatchCoordinate) {
  if (!saved || saved.kind !== requested.kind || saved.actorId !== requested.actorId) return false;
  if (saved.kind === "werewolf" && requested.kind === "werewolf") return saved.cursor === requested.cursor
    && (saved.part === "thinking" || saved.action === requested.action);
  if (saved.kind === "influence" && requested.kind === "influence") {
    if (requested.transcriptId && saved.transcriptId) return requested.transcriptId === saved.transcriptId;
    if (requested.entrySequence !== undefined) return requested.entrySequence === saved.entrySequence;
    // An event can contain multiple speeches by the same actor. Never widen a
    // transcript lookup to event-level matching when its identity is absent.
    return !requested.transcriptId && !saved.transcriptId && saved.entrySequence === undefined
      && saved.eventSequence === requested.eventSequence;
  }
  return false;
}
