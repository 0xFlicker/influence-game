/** Native media runs at the director's rate between transport changes. Comparing
 * its currentTime on every render can repeatedly seek a buffering Safari decoder,
 * preventing it from ever catching up. Align at actual clock discontinuities. */
export class MediaAlignment {
  private previous: {time: number; playing: boolean; speed: number; revision: number} | null = null;
  private pending = true;
  private buffering = false;
  invalidate() {this.pending = true;}
  waitForData() {this.buffering = true; this.pending = true;}
  sync(media: Pick<HTMLMediaElement, "readyState" | "seeking" | "currentTime" | "duration" | "playbackRate">,
    target: {time: number; playing: boolean; speed: number; revision: number}) {
    const previous = this.previous;
    if (!previous || previous.revision !== target.revision || previous.playing !== target.playing
      || previous.speed !== target.speed || !target.playing && previous.time !== target.time) this.pending = true;
    this.previous = target;
    if (media.playbackRate !== target.speed) media.playbackRate = target.speed;
    if (!this.pending || media.readyState < 1 || media.seeking || this.buffering && media.readyState < 3) return;
    this.buffering = false;
    const time = Math.max(0, Math.min(target.time, Number.isFinite(media.duration) ? Math.max(0, media.duration - .01) : target.time));
    if (Math.abs(media.currentTime - time) > .015) media.currentTime = time;
    this.pending = false;
  }
}
