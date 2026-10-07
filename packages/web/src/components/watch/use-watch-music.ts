"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {createBrowserMusicOutput, WatchMusic, type MusicInput, type MusicStatus} from "./watch-music";

/** Keeps resource ownership independent of cues, fullscreen and thinking re-renders. */
export function useWatchMusic(input: MusicInput & {preparing: boolean; holding: boolean; live: boolean; navigationRevision: number}) {
  const controller = useRef<WatchMusic | null>(null);
  const [status, setStatus] = useState<MusicStatus>("idle");
  const [scrubbing, setScrubbing] = useState(false);
  const [tailGain, setTailGain] = useState(1);
  const waiting = input.holding && input.live;
  useEffect(() => {
    if (!waiting) return;
    const start = performance.now();
    const timer = setInterval(() => {const gain = Math.max(0, Math.min(1, 1 - (performance.now() - start - 1000) / 700)); setTailGain(gain); if (gain === 0) clearInterval(timer);}, 40);
    return () => {clearInterval(timer); setTailGain(1);};
  }, [waiting]);
  useEffect(() => {
    const music = new WatchMusic(createBrowserMusicOutput, setStatus);
    controller.current = music;
    const hidden = () => { if (document.hidden) music.suspend(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {document.removeEventListener("visibilitychange", hidden); music.dispose(); controller.current = null;};
  }, []);
  const {section, playing, muted, volume, fadeGain, preparing, holding, live, navigationRevision} = input;
  const key = section?.key, src = section?.src, title = section?.title, repeat = section?.repeat, continueAtEnd = section?.continueAtEnd;
  useEffect(() => {
    // Freeze selection during scrubbing/loading: no downloads for intermediate destinations.
    if (scrubbing || preparing) {controller.current?.suspend(); return;}
    controller.current?.update({section: key && src && title && repeat !== undefined ? {key, src, title, repeat, continueAtEnd} : null, muted, volume, fadeGain: (fadeGain ?? 1) * (waiting ? Math.min(1,tailGain) : 1),
      playing: playing && !document.hidden && !(holding && (live ? tailGain <= 0 : !continueAtEnd))});
  }, [key, src, title, repeat, continueAtEnd, playing, muted, volume, fadeGain, preparing, holding, live, tailGain, waiting, scrubbing, navigationRevision]);
  return {
    status,
    unlock: useCallback(() => controller.current?.unlock(), []),
    suspend: useCallback(() => controller.current?.suspend(), []),
    restart: useCallback(() => controller.current?.restart(), []),
    beginScrub: useCallback(() => {controller.current?.suspend(); setScrubbing(true);}, []),
    endScrub: useCallback(() => setScrubbing(false), []),
  };
}
