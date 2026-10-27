import type { AudioWatchCoordinate } from "@influence/engine/audio-watch";
import type { PublishedAudioClip } from "@influence/engine/audio-track";

/** Index candidates by canonical identity, then retain the exact matcher below.
 * In particular, transcript identity must still win over event/entry aliases. */
export function indexAudioClips(clips: readonly PublishedAudioClip[]) {
  const buckets = new Map<string, Set<number>>();
  const keys = (watch: AudioWatchCoordinate): string[] => watch.kind === "werewolf"
    ? [JSON.stringify([watch.kind, watch.actorId, watch.cursor])]
    : [watch.transcriptId && ["transcript", watch.transcriptId],
      watch.entrySequence !== undefined && ["entry", watch.entrySequence],
      !watch.transcriptId && watch.entrySequence === undefined && ["event", watch.eventSequence]]
      .filter(Boolean).map(identity => JSON.stringify([watch.kind, watch.actorId, identity]));
  clips.forEach((clip, index) => {
    if (!clip.watch) return;
    for (const key of keys(clip.watch)) {
      let bucket = buckets.get(key);
      if (!bucket) {bucket = new Set(); buckets.set(key, bucket);}
      bucket.add(index);
    }
  });
  return (watch: AudioWatchCoordinate | null): PublishedAudioClip[] => {
    if (!watch) return [];
    const candidates = new Set(keys(watch).flatMap(key => [...buckets.get(key) ?? []]));
    return [...candidates].sort((a,b) => a-b).map(index => clips[index]!).filter(clip => matchesAudioWatch(clip.watch, watch));
  };
}

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
