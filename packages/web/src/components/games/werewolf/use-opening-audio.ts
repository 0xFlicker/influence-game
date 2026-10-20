"use client";
import {useOpeningAudio as useSharedOpeningAudio} from "../../watch/use-opening-audio";
import {sampleOpening, type WerewolfOpeningCue} from "./werewolf-opening";

export function useOpeningAudio(input: {cue: WerewolfOpeningCue | null; elapsedMs: number; playing: boolean; muted: boolean; volume: number; speed: number}) {
  const frame = input.cue ? sampleOpening(input.cue, input.elapsedMs) : null;
  return useSharedOpeningAudio({...input, tracks: input.cue && frame ? [
    {src:input.cue.opening.musicUrl, time:frame.timeMs / 1000, gain:frame.musicGain},
    ...(input.cue.opening.effectUrl ? [{src:input.cue.opening.effectUrl, time:frame.videoMs / 1000, gain:frame.effectGain}] : []),
  ] : []});
}
