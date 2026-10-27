"use client";
import {useOpeningAudio as useSharedOpeningAudio} from "../../watch/use-opening-audio";
import type {PresentationDirector} from "../../watch/watch-director";
import {sampleOpening, type WerewolfPlaybackCue, type WerewolfOpeningCue} from "./werewolf-opening";

export function useOpeningAudio(input: {cue: WerewolfOpeningCue | null; director: PresentationDirector<WerewolfPlaybackCue>; playing: boolean; muted: boolean; volume: number; speed: number}) {
  return useSharedOpeningAudio({...input, tracks: () => {
    const frame = input.cue ? sampleOpening(input.cue, input.director.getElapsedBaseMs()) : null;
    return input.cue && frame ? [
      {src:input.cue.opening.musicUrl, time:frame.timeMs / 1000, gain:frame.musicGain},
      ...(input.cue.opening.effectUrl ? [{src:input.cue.opening.effectUrl, time:frame.videoMs / 1000, gain:frame.effectGain}] : []),
    ] : [];
  }}, input.director);
}
