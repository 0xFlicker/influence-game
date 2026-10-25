import type { PublishedAudioTrack } from "@influence/engine/audio-track";
import type { ProductionRecording } from "@influence/engine/production-moments/recordings";
import type { PresentationMoment } from "./presentation";
import type { CachedAsset } from "./assets";
import type { ExportCue } from "./cues";

export function recordingIdentity(cue: ExportCue) {
  if (cue.speech) return cue.speech;
  if (cue.picture.kind === "thinking" && cue.timing.thinking && cue.momentId) return {
    messageId: cue.momentId, speakerId: cue.picture.actor.id, text: cue.timing.thinking,
  };
  return null;
}
/** Both Studio and CLI bind the exact version to accepted text before preparing media. */
export async function attachGeneratedAudio(input: {
  source: readonly PresentationMoment[]; selectedIds: readonly string[]; publication: PublishedAudioTrack | null;
  hash: (text: string) => string | Promise<string>;
  asset: (clip: PublishedAudioTrack["clips"][number]) => Promise<CachedAsset>;
  signal?: AbortSignal; frozen?: readonly ProductionRecording[];
}) {
  const selected = new Set(input.selectedIds), assets: Record<string, CachedAsset> = {}, recordings: ProductionRecording[] = [];
  const clips = new Map(input.publication?.clips.map(clip => [clip.momentId, clip]));
  const frozen = new Map(input.frozen?.filter(r => r.versionId).map(r => [r.momentId, r]));
  for (const id of frozen.keys()) if (!clips.has(id)) throw new Error("Frozen audio version is unavailable for this audience");
  const source: PresentationMoment[] = [];
  for (const moment of input.source) {
    input.signal?.throwIfAborted();
    const clip = selected.has(moment.id) ? clips.get(moment.id) : undefined;
    if (!clip || input.frozen && !frozen.has(moment.id)) { source.push(moment); continue; }
    const candidates = moment.segments.filter(cue => recordingIdentity(cue));
    if (candidates.length !== 1) throw new Error(`Audio moment lacks one unambiguous accepted line: ${moment.id}`);
    const cue = candidates[0]!, identity = recordingIdentity(cue)!;
    if (identity.speakerId !== clip.speakerId || await input.hash(identity.text) !== clip.textHash) throw new Error("Generated audio text or speaker changed");
    const expected = frozen.get(moment.id);
    if (expected && (expected.versionId !== clip.versionId || expected.sha256 !== clip.sha256 || expected.textHash !== clip.textHash || expected.speakerId !== clip.speakerId || expected.durationMs !== clip.durationMs)) throw new Error("Frozen audio version changed");
    const asset = await input.asset(clip); input.signal?.throwIfAborted();
    if (asset.sha256 !== clip.sha256 || asset.mediaType !== "audio" || !asset.durationMs || Math.abs(asset.durationMs - clip.durationMs) > 50) throw new Error("Generated audio failed integrity validation");
    assets[asset.path] = asset;
    recordings.push({ momentId: moment.id, messageId: identity.messageId, speakerId: clip.speakerId, textHash: clip.textHash,
      sha256: clip.sha256, durationMs: clip.durationMs, versionId: clip.versionId });
    source.push({ ...moment, segments: moment.segments.map(segment => segment === cue ? { ...segment,
      timing: { ...segment.timing, recording: { assetId: asset.path, durationMs: clip.durationMs } } } : segment) });
  }
  return { source, assets, recordings };
}
