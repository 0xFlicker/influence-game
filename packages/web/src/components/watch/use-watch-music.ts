"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {createBrowserMusicOutput, WatchMusic, type MusicInput, type MusicStatus} from "./watch-music";

/** Keeps resource ownership independent of cues, fullscreen and thinking re-renders. */
export function useWatchMusic(input: MusicInput & {preparing: boolean; holding: boolean; live: boolean; navigationRevision: number}) {
  const controller = useRef<WatchMusic | null>(null);
  const [status, setStatus] = useState<MusicStatus>("idle");
  const [scrubbing, setScrubbing] = useState(false);
  useEffect(() => {
    const music = new WatchMusic(createBrowserMusicOutput, setStatus);
    controller.current = music;
    return () => {music.dispose(); controller.current = null;};
  }, []);
  const {section, playing, muted, volume, preparing, holding, live, navigationRevision} = input;
  const key = section?.key, src = section?.src, title = section?.title, repeat = section?.repeat, continueAtEnd = section?.continueAtEnd;
  useEffect(() => {
    // Freeze selection during scrubbing/loading: no downloads for intermediate destinations.
    if (scrubbing || preparing) {controller.current?.suspend(); return;}
    controller.current?.update({section: key && src && title && repeat !== undefined ? {key, src, title, repeat, continueAtEnd} : null, muted, volume,
      playing: playing && !(holding && !live && !continueAtEnd)});
  }, [key, src, title, repeat, continueAtEnd, playing, muted, volume, preparing, holding, live, scrubbing, navigationRevision]);
  return {
    status,
    unlock: useCallback(() => controller.current?.unlock(), []),
    suspend: useCallback(() => controller.current?.suspend(), []),
    restart: useCallback(() => controller.current?.restart(), []),
    beginScrub: useCallback(() => {controller.current?.suspend(); setScrubbing(true);}, []),
    endScrub: useCallback(() => setScrubbing(false), []),
  };
}
