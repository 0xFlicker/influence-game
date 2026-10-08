import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import type {WatchPolicy} from "../../watch/watch-director";
import {werewolfWatchPolicy, type WerewolfWatchCue} from "./werewolf-watch-model";

const root = "/visual/werewolf/opening-v1";
export const OPENING_ASSETS = {
  logo: "/logo.png", alley: `${root}/alley.jpg`, music: `${root}/lantern-shadows.mp3`,
  lantern: `${root}/lantern.mp4`, lanternPoster: `${root}/lantern.jpg`, lanternEffects: `${root}/lantern-effects.mp3`,
  door: `${root}/door.mp4`, doorPoster: `${root}/door.jpg`, doorEffects: `${root}/door-effects.mp3`,
};
export interface OpeningPlayer { id: string; name: string; imageUrl: string | null; role?: string }
export interface WerewolfOpeningCue {
  key: string;
  baseDurationMs: number;
  opening: {
    shot: "house" | "title" | "cast" | "door";
    startMs: number; totalMs: number; title: string;
    backgroundUrl: string; videoUrl?: string; effectUrl?: string; transitionUrl?: string;
    logoUrl: string; musicUrl: string; player?: OpeningPlayer;
  };
}
export type WerewolfPlaybackCue = WerewolfWatchCue | WerewolfOpeningCue;
export function isOpeningCue(cue: WerewolfPlaybackCue | null): cue is WerewolfOpeningCue { return !!cue && "opening" in cue; }

/** Only initial audience-projected facts enter the opening, never a final roster snapshot. */
export function werewolfOpening(window: WerewolfWatchWindow, title?: string): WerewolfOpeningCue[] {
  if (window.fromCursor !== 1 || !window.moments.length) return [];
  const initial = window.moments[0]!.snapshot;
  const players: OpeningPlayer[] = window.players.map(identity => {
    const role = window.audience === "omniscient" ? initial.players.find(p => p.id === identity.id)?.role : undefined;
    return {id: identity.id, name: identity.name, imageUrl: identity.fullBodyReferenceUrl ?? identity.avatarUrl,
      ...(role ? {role} : {})};
  });
  const shots: Array<{duration: number; shot: WerewolfOpeningCue["opening"]["shot"]; player?: OpeningPlayer}> = [
    {shot: "house", duration: 5000}, {shot: "title", duration: 3000},
    ...players.map(player => ({shot: "cast" as const, duration: 2500, player})),
    {shot: "door", duration: 5300},
  ];
  const totalMs = shots.reduce((sum, shot) => sum + shot.duration, 0);
  let startMs = 0;
  return shots.map(({shot, duration, player}) => {
    const cue: WerewolfOpeningCue = {key: `${window.gameId}:opening:${shot}:${player?.id ?? ""}`, baseDurationMs: duration,
      opening: {shot, startMs, totalMs, title: title?.trim() || "Werewolf", logoUrl: OPENING_ASSETS.logo, musicUrl: OPENING_ASSETS.music,
        backgroundUrl: shot === "house" ? OPENING_ASSETS.lanternPoster : shot === "door" ? OPENING_ASSETS.doorPoster : OPENING_ASSETS.alley,
        ...(shot === "house" ? {videoUrl: OPENING_ASSETS.lantern, effectUrl: OPENING_ASSETS.lanternEffects, transitionUrl: OPENING_ASSETS.alley} :
          shot === "door" ? {videoUrl: OPENING_ASSETS.door, effectUrl: OPENING_ASSETS.doorEffects} : {}), ...(player ? {player} : {})}};
    startMs += duration;
    return cue;
  });
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function sampleOpening(cue: WerewolfOpeningCue, elapsedMs: number, reduced = false) {
  const t = Math.max(0, Math.min(cue.baseDurationMs, elapsedMs));
  const shot = cue.opening.shot;
  const exit = shot === "door" ? clamp((5000 - t) / 2000) : 1;
  const dissolve = shot === "house" ? clamp((t - cue.baseDurationMs + 900) / 900) : 0;
  const transitionOpacity = dissolve * dissolve * (3 - 2 * dissolve);
  // Settle into the alley during the title, then retain that framing for the cast.
  const alleyProgress = reduced ? 0 : shot === "title" ? t / cue.baseDurationMs : shot === "cast" ? 1 : 0;
  const camera = alleyProgress * alleyProgress * (3 - 2 * alleyProgress);
  return {timeMs: cue.opening.startMs + t, videoMs: Math.min(t, 5000),
    opacity: shot === "house" ? clamp(t / 700) : exit,
    transitionOpacity,
    textOpacity: clamp(t / 400) * (1 - transitionOpacity),
    scale: 1 + camera * 0.12, panX: -camera * 1.5, panY: -camera * 0.5,
    musicGain: clamp((cue.opening.startMs + t) / 700) * clamp((cue.opening.totalMs - 300 - cue.opening.startMs - t) / 2000),
    effectGain: shot === "house" ? 0.7 * clamp(t / 250) * clamp((5000 - t) / 500) : shot === "door" ? 0.4 * clamp(t / 150) * clamp((5000 - t) / 400) : 0};
}
export const werewolfPlaybackPolicy: WatchPolicy<WerewolfPlaybackCue> = {
  position: cue => isOpeningCue(cue) ? null : werewolfWatchPolicy.position(cue),
  speech: cue => isOpeningCue(cue) ? null : werewolfWatchPolicy.speech(cue),
  scrubAtMs: cue => isOpeningCue(cue) ? cue.opening.shot === "door" ? 0 : cue.opening.shot === "house" ? 700 : 400 : werewolfWatchPolicy.scrubAtMs?.(cue) ?? 0,
  isCatchUp: () => false, acceptAtWatermark: () => false, reconcile: cues => cues,
};
