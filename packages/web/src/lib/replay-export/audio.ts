import type { ExportCue } from "./cues";
import type { CachedAsset } from "./assets";
import type { CompiledTiming, TimingProfile } from "./timing";

export interface AudioClip {
  asset: string;
  purpose: "music" | "speech";
  startMs: number;
  endMs: number;
  offsetMs: number;
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
}
export interface AudioSchedule {
  clips: AudioClip[];
  durationMs: number;
}
export const MUSIC_FADE_MS = 700;
export function compileAudio(
  cues: readonly Pick<ExportCue, "timing" | "music">[],
  timeline: CompiledTiming[],
  assets: Record<string, CachedAsset>,
  profile: TimingProfile,
  music: boolean,
  volume = 0.3,
): AudioSchedule {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    throw new Error("Music volume must be between 0 and 1");
  const last = timeline.at(-1);
  if (!last) throw new Error("Empty replay");
  let durationMs = last.endMs;
  const duration = (asset: string) => {
    const ms = assets[asset]?.durationMs;
    if (!ms || !Number.isFinite(ms))
      throw new Error(`Missing audio duration: ${asset}`);
    return ms;
  };
  const final = cues.at(-1)!;
  if (final.timing.kind === "result") {
    if (profile.ending === "finish-score") {
      if (music && final.music?.continueAtEnd)
        durationMs = Math.max(
          durationMs,
          last.startMs + duration(final.music.src),
        );
    } else durationMs += profile.ending.holdMs;
  }
  const clips: AudioClip[] = timeline.flatMap((cue) =>
    cue.recording
      ? [
          {
            asset: cue.recording.assetId,
            purpose: "speech" as const,
            startMs: cue.recording.startMs,
            endMs: cue.recording.startMs + cue.recording.durationMs,
            offsetMs: 0,
            gain: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
          },
        ]
      : [],
  );
  if (music)
    for (let i = 0; i < cues.length; ) {
      const section = cues[i]!.music;
      let next = i + 1;
      while (next < cues.length && cues[next]!.music?.key === section?.key)
        next++;
      if (section) {
        const end =
          next < timeline.length
            ? Math.min(durationMs, timeline[next]!.startMs + MUSIC_FADE_MS)
            : durationMs;
        const length = duration(section.src);
        let start = timeline[i]!.startMs;
        while (start < end) {
          const stop = Math.min(end, start + length);
          clips.push({
            asset: section.src,
            purpose: "music",
            startMs: start,
            endMs: stop,
            offsetMs: 0,
            gain: volume,
            fadeInMs: Math.min(MUSIC_FADE_MS, (stop - start) / 2),
            fadeOutMs: Math.min(MUSIC_FADE_MS, (stop - start) / 2),
          });
          if (!section.repeat || start + length >= end) break;
          start += Math.max(length / 2, length - MUSIC_FADE_MS);
        }
      }
      i = next;
    }
  return { clips, durationMs };
}
/** Pure envelopes apply equally to standalone frames and uninterrupted playback. */
export function audioGain(
  clip: AudioClip,
  timeMs: number,
  clips: readonly AudioClip[],
): number {
  if (timeMs < clip.startMs || timeMs >= clip.endMs) return 0;
  const fade = Math.min(
    1,
    clip.fadeInMs ? (timeMs - clip.startMs) / clip.fadeInMs : 1,
    clip.fadeOutMs ? (clip.endMs - timeMs) / clip.fadeOutMs : 1,
  );
  let duck = 1;
  if (clip.purpose === "music")
    for (const speech of clips) {
      if (speech.purpose !== "speech") continue;
      const attack = 150,
        release = 350;
      if (
        timeMs >= speech.startMs - attack &&
        timeMs <= speech.endMs + release
      ) {
        const amount = Math.min(
          1,
          (timeMs - speech.startMs + attack) / attack,
          (speech.endMs + release - timeMs) / release,
        );
        duck = Math.min(duck, 1 - 0.65 * Math.max(0, amount));
      }
    }
  return clip.gain * Math.max(0, fade) * duck;
}

/** Remotion's volume callback is relative to the visible Sequence, not the trimmed source. */
export function placeAudioClip(
  clip: AudioClip,
  range: { fromFrame: number; untilFrame: number },
  fps: number,
) {
  const start = Math.floor((clip.startMs * fps) / 1000),
    end = Math.ceil((clip.endMs * fps) / 1000);
  const from = Math.max(start, range.fromFrame),
    until = Math.min(end, range.untilFrame);
  if (until <= from) return null;
  return {
    fromFrame: from - range.fromFrame,
    durationInFrames: until - from,
    sourceOffsetFrames: Math.round((clip.offsetMs * fps) / 1000) + from - start,
    globalStartFrame: from,
  };
}
