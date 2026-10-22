import type { WatchPreferences } from "@/components/watch/use-watch-preferences";

export { parseReplayShare, REPLAY_SHARE_KEYS, type ReplayShareState } from "@influence/engine/replay-share-state";
export function replayShareHref(href: string, cue: string, elapsedMs: number, speed: number, preferences: WatchPreferences): string {
  const url = new URL(href, "https://thehouse.game");
  url.searchParams.set("cue", cue);
  url.searchParams.set("t", (Math.max(0, Math.round(elapsedMs)) / 1000).toString());
  url.searchParams.set("speed", String(speed));
  url.searchParams.set("thinking", preferences.thinking ? "1" : "0");
  url.searchParams.set("muted", preferences.musicMuted ? "1" : "0");
  url.searchParams.set("volume", String(preferences.musicVolume));
  return `${url.pathname}${url.search}`;
}
