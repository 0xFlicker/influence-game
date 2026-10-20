import type {GamePlayer} from "@/lib/api";
import type {InfluenceOpeningCue} from "./types";
import {INFLUENCE_MUSIC} from "./influence-music";

const root = "/visual/influence/opening-v1";
export const INFLUENCE_OPENING_ASSETS = {
  background: `${root}/house-salon.jpg`,
  entrance: `${root}/house-entrance.mp4`,
  entrancePoster: `${root}/house-door.jpg`,
  logo: "/home/influence-logo.png",
};
export const INFLUENCE_ENTRANCE_MS = 20_000;

/** Copy identity only. Current standings, shields, strategy and outcomes never enter the opening. */
export function influenceOpening(gameId: string, players: readonly Pick<GamePlayer, "id" | "name" | "avatarUrl">[]): InfluenceOpeningCue[] {
  if (!players.length) return [];
  const shots: Array<{shot: InfluenceOpeningCue["opening"]["shot"]; duration: number; player?: InfluenceOpeningCue["opening"]["player"]; castIndex?: number}> = [
    {shot: "house", duration: 12_000},
    {shot: "title", duration: INFLUENCE_ENTRANCE_MS - 12_000},
    ...players.map((player, castIndex) => ({
      shot: "cast" as const, duration: 2800, castIndex,
      player: {id: player.id, name: player.name, ...(player.avatarUrl ? {avatarUrl: player.avatarUrl} : {})},
    })),
    {shot: "enter", duration: 3000},
  ];
  const totalMs = shots.reduce((sum, shot) => sum + shot.duration, 0);
  let startMs = 0;
  return shots.map(({shot, duration, player, castIndex}) => {
    const cue: InfluenceOpeningCue = {
      source: "opening", kind: "influence_opening", key: `${gameId}:opening:${shot}:${player?.id ?? ""}`,
      canonicalSequence: null, round: 0, phase: "INTRODUCTION", baseDurationMs: duration,
      opening: {shot, startMs, totalMs, castCount: players.length,
        backgroundUrl: INFLUENCE_OPENING_ASSETS.background, entranceVideoUrl: INFLUENCE_OPENING_ASSETS.entrance,
        posterUrl: INFLUENCE_OPENING_ASSETS.entrancePoster, logoUrl: INFLUENCE_OPENING_ASSETS.logo,
        musicUrl: INFLUENCE_MUSIC.opening.src, ...(player ? {player, castIndex} : {})},
    };
    startMs += duration;
    return cue;
  });
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Pure sampling keeps motion and exact seeks on the presentation clock. */
export function sampleInfluenceOpening(cue: InfluenceOpeningCue, elapsedMs: number, reduced = false) {
  const time = Math.max(0, Math.min(cue.baseDurationMs, elapsedMs));
  const progress = time / cue.baseDurationMs;
  const globalTime = cue.opening.startMs + time;
  const entrance = cue.opening.shot === "house" || cue.opening.shot === "title";
  const textStart = cue.opening.shot === "house" ? 800 : 12_200;
  const textEnd = cue.opening.shot === "house" ? 4_800 : 17_500;
  return {
    opacity: entrance
      ? Math.min(clamp((globalTime - textStart) / 800), clamp((textEnd - globalTime) / 800))
      : Math.min(clamp(time / 350), clamp((cue.baseDurationMs - time) / 350)),
    entrance,
    videoMs: Math.min(globalTime, INFLUENCE_ENTRANCE_MS),
    entranceOpacity: clamp(globalTime / 1200),
    scale: reduced || entrance ? 1 : 1 + clamp((globalTime - INFLUENCE_ENTRANCE_MS) / (cue.opening.totalMs - INFLUENCE_ENTRANCE_MS)) * 0.025,
    portraitY: reduced ? 0 : 12 * (1 - clamp(time / 800)),
    ruleScale: reduced ? 1 : clamp(time / 1000),
    exitOpacity: cue.opening.shot === "enter" ? clamp((1 - progress) * 3) : 1,
  };
}
