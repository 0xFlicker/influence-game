import { expect, test } from "bun:test";
import { consumeEpisodePlayback, episodeSoundEnabled, playEpisodeVideo, rememberEpisodeSound, requestEpisodePlayback } from "../lib/episode-media";
import { gameDisplayName, gameHref } from "../lib/game-identity";

test("episode names can change without changing game links", () => {
  const game = { slug: "quiet-sage-room", episode: { title: "Good Company" } };
  expect(gameDisplayName(game)).toBe("Good Company"); expect(gameHref(game)).toBe("/games/quiet-sage-room");
});
test("play intent belongs to one deliberate navigation, not reload or another game", () => {
  requestEpisodePlayback("one"); expect(consumeEpisodePlayback("two")).toBe(false); expect(consumeEpisodePlayback("one")).toBe(true); expect(consumeEpisodePlayback("one")).toBe(false);
});
test("blocked sound-on playback falls back to muted without forgetting the preference", async () => {
  rememberEpisodeSound(true); let calls = 0;
  const video = { muted: true, play: async function () { calls++; if (!this.muted) throw new Error("NotAllowedError"); } } as HTMLVideoElement;
  expect(await playEpisodeVideo(video)).toBe(true); expect(video.muted).toBe(true); expect(calls).toBe(2); expect(episodeSoundEnabled()).toBe(true); rememberEpisodeSound(false);
});
test("blocked muted autoplay exposes manual playback instead of claiming success", async () => {
  rememberEpisodeSound(false);
  const video = { muted: false, play: async () => { throw new Error("NotAllowedError"); } } as unknown as HTMLVideoElement;
  expect(await playEpisodeVideo(video)).toBe(false); expect(video.muted).toBe(true);
});
