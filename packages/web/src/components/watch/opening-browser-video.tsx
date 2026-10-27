"use client";
/* eslint-disable @next/next/no-img-element -- Packaged opening media also works outside Next. */
import {useEffect, useRef, useState} from "react";
import {MediaAlignment} from "./media-alignment";

export interface OpeningVideoProps {src: string; poster: string; timeMs: number; playing: boolean; speed: number; navigationRevision: number}
/** Clock adapter only. The video never advances the presentation. */
export function OpeningBrowserVideo({src, poster, timeMs, playing, speed, navigationRevision, className}: OpeningVideoProps & {className?: string}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [alignment] = useState(() => new MediaAlignment());
  useEffect(() => alignment.invalidate(), [src, alignment]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;
    const sync = () => {
      alignment.sync(video, {time:timeMs / 1000, playing, speed, revision:navigationRevision});
    };
    const waiting = () => {if (!video.seeking) alignment.waitForData();};
    sync(); video.addEventListener("loadedmetadata", sync); video.addEventListener("canplay", sync); video.addEventListener("seeked", sync); video.addEventListener("waiting", waiting);
    if (!playing) video.pause();
    else if (video.paused) void video.play().catch(cause => {if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);});
    return () => {video.removeEventListener("loadedmetadata", sync); video.removeEventListener("canplay", sync); video.removeEventListener("seeked", sync); video.removeEventListener("waiting", waiting);};
  }, [timeMs, playing, speed, navigationRevision, alignment, failed]);
  return failed ? <img src={poster} alt="" className={className} data-opening-video-unavailable="" /> :
    <video ref={ref} src={src} poster={poster} muted playsInline preload="auto" onError={() => setFailed(true)} className={className} />;
}
