/** Sound preference lasts for this tab session, including reloads. */
let soundEnabled = false;
let playbackIntent: { slug: string; expires: number } | null = null;
export function episodeSoundEnabled() {
  if (typeof window !== "undefined") {
    try { soundEnabled = window.sessionStorage.getItem("episode-sound") === "on"; }
    catch (error) { console.warn("Unable to read trailer sound preference", error); }
  }
  return soundEnabled;
}
export function rememberEpisodeSound(enabled: boolean) {
  soundEnabled = enabled;
  if (typeof window !== "undefined") {
    try { window.sessionStorage.setItem("episode-sound", enabled ? "on" : "off"); }
    catch (error) { console.warn("Trailer sound preference will last until reload", error); }
  }
}
export function requestEpisodePlayback(slug: string) { playbackIntent = { slug, expires: Date.now() + 15_000 }; }
export function consumeEpisodePlayback(slug: string) {
  const requested = playbackIntent?.slug === slug && playbackIntent.expires > Date.now();
  if (requested) playbackIntent = null;
  return requested;
}
export async function playEpisodeVideo(video: HTMLVideoElement): Promise<boolean> {
  video.muted = !episodeSoundEnabled();
  try { await video.play(); return true; } catch {
    if (!video.muted) { video.muted = true; try { await video.play(); return true; } catch { return false; } }
    return false;
  }
}
