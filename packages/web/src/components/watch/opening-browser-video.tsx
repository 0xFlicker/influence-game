"use client";
/* eslint-disable @next/next/no-img-element -- Packaged opening media also works outside Next. */
import {useEffect, useRef, useState} from "react";

export interface OpeningVideoProps {src: string; poster: string; timeMs: number; playing: boolean; speed: number}
/** Clock adapter only. The video never advances the presentation. */
export function OpeningBrowserVideo({src, poster, timeMs, playing, speed, className}: OpeningVideoProps & {className?: string}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;
    const sync = () => {
      if (video.readyState < 1) return;
      const seconds = Math.min(timeMs / 1000, Math.max(0, video.duration - 0.04));
      if (Math.abs(video.currentTime - seconds) > (playing ? 0.15 : 0.015)) video.currentTime = seconds;
      video.playbackRate = speed;
    };
    sync(); video.addEventListener("loadedmetadata", sync);
    if (!playing) video.pause();
    else if (video.paused) void video.play().catch(cause => {if (!(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);});
    return () => video.removeEventListener("loadedmetadata", sync);
  }, [timeMs, playing, speed, failed]);
  return failed ? <img src={poster} alt="" className={className} data-opening-video-unavailable="" /> :
    <video ref={ref} src={src} poster={poster} muted playsInline preload="auto" onError={() => setFailed(true)} className={className} />;
}
