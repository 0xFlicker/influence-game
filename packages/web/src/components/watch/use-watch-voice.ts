"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublishedAudioClip, PublishedAudioTrack } from "@influence/engine/audio-track";
import type { AudioWatchCoordinate } from "@influence/engine/audio-watch";
import type { ProductionAudience } from "@influence/engine/production-moments";
import { anonymousApiFetch, resolveApiUrl } from "@/lib/api";
import type { PresentationDirector, WatchCue } from "./watch-director";
import { narrationWindow } from "./house-narration";
import { matchesAudioWatch } from "./audio-watch-coordinate";
export { matchesAudioWatch } from "./audio-watch-coordinate";

/** HTML audio follows the existing director clock, including exact in-clip seeks. */
export function useWatchVoice<C extends WatchCue>({ director, gameId, audience, thinking, coordinate, coordinateForCue, onPause, live = false }: {
  director: PresentationDirector<C>; gameId: string; audience: ProductionAudience; thinking: boolean;
  coordinate: AudioWatchCoordinate | null; coordinateForCue?: (cue:C)=>AudioWatchCoordinate|null; onPause: () => void; live?: boolean;
}) {
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const activeKey = director.getActiveCue()?.key;
  const player = useRef<HTMLAudioElement | null>(null);
  const resumePlayer = useRef<(() => void) | null>(null);
  const pausePlayback = useRef(onPause);
  useEffect(() => {pausePlayback.current = onPause;}, [onPause]);
  const controls = useRef({muted,volume});
  useEffect(() => {controls.current = {muted,volume};},[muted,volume]);
  const scope = `${gameId}:${audience}:${thinking}`;
  const [metadata, setMetadata] = useState<{scope:string; data:PublishedAudioTrack|null; error:string|null}>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!gameId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const data = await anonymousApiFetch<PublishedAudioTrack | null>(`/api/games/${encodeURIComponent(gameId)}/audio?audience=${audience}&thinking=${thinking ? "on" : "off"}`,{signal:controller.signal,cache:"no-store"});
        if (data !== null && (!data || !Array.isArray(data.clips))) throw new Error("Invalid voice track response");
        if (!controller.signal.aborted) setMetadata({scope,data,error:null});
      } catch (cause) {
        if (!controller.signal.aborted) setMetadata({scope,data:null,error:cause instanceof Error ? cause.message : "Voice track unavailable"});
      }
      if (live && !controller.signal.aborted) timer = setTimeout(() => void refresh(),2000);
    };
    void refresh();
    return () => {controller.abort();clearTimeout(timer);};
  },[gameId,audience,thinking,scope,live,retry]);
  const data = metadata?.scope === scope ? metadata.data : null;
  const metadataError = metadata?.scope === scope ? metadata.error : null;
  const loading = !!gameId && metadata?.scope !== scope;
  const coordinateKey = JSON.stringify(coordinate);
  const clipKey = JSON.stringify(useMemo(() => {
    const position = JSON.parse(coordinateKey) as AudioWatchCoordinate | null;
    return position ? data?.clips.filter(clip => matchesAudioWatch(clip.watch,position)) ?? [] : [];
  },[data,coordinateKey]));
  const clips = useMemo(() => JSON.parse(clipKey) as PublishedAudioClip[],[clipKey]);
  const speech = clips.filter(clip => clip.watch?.part === "speech"), thoughts = thinking ? clips.filter(clip => clip.watch?.part === "thinking") : [];
  const speechMs = speech.reduce((sum,clip) => sum+clip.durationMs,0), thinkingMs = thoughts.reduce((sum,clip) => sum+clip.durationMs,0);
  useEffect(() => {
    if (!coordinateForCue) return;
    let syncing=false;
    const sync = () => {
      if (syncing) return;syncing=true;
      for (const cue of director.getCues()) {
        const position = coordinateForCue(cue);
        const matches = position ? data?.clips.filter(clip => matchesAudioWatch(clip.watch,position)) ?? [] : [];
        const speechMs = matches.filter(clip => clip.watch?.part === "speech").reduce((sum,clip)=>sum+clip.durationMs,0);
        const thinkingMs = thinking ? matches.filter(clip => clip.watch?.part === "thinking").reduce((sum,clip)=>sum+clip.durationMs,0) : 0;
        director.setRecordings(cue.key,{...(speechMs && {speechMs}),...(thinkingMs && {thinkingMs})});
      }
      syncing=false;
    };
    sync();return director.subscribe(sync);
  },[director,data,thinking,coordinateForCue]);
  useEffect(() => {
    if (activeKey) director.setRecordings(activeKey,{...(speechMs && {speechMs}),...(thinkingMs && {thinkingMs})});
    if (metadataError) {director.pause();pausePlayback.current();}
    director.setAudioPending(loading);
    return () => director.setAudioPending(false);
  },[director,activeKey,speechMs,thinkingMs,loading,metadataError]);
  useEffect(() => {
    if (!clips.length) return;
    // Retain the element across cues so a user gesture unlocks the whole replay.
    const audio = player.current ?? new Audio(); player.current = audio; audio.preload = "auto";
    let frame = 0, disposed = false, selected: PublishedAudioClip | undefined, starting = false, wasSpeaking = false;
    let attempt = 0;
    const stop = () => {attempt++;starting=false;audio.pause(); director.setAudioPending(false); if (wasSpeaking) {wasSpeaking=false;setSpeaking(false);} };
    const pause = () => {stop();director.pause();pausePlayback.current();};
    const start = () => {
      if (!audio.paused || starting) return;
      starting = true;
      const currentAttempt = ++attempt;
      void audio.play().then(() => {
        if (!disposed && currentAttempt === attempt) starting = false;
      }, cause => {
        if (disposed || currentAttempt !== attempt) return;
        pause();
        // Browser permission and interruption are ordinary paused states.
        if (!(cause instanceof Error && ["NotAllowedError", "AbortError"].includes(cause.name))) {
          setError("Voice audio could not play. Press Play to retry.");
        }
      });
    };
    audio.onwaiting = () => { if (!disposed) director.setAudioPending(true); };
    audio.oncanplay = () => { if (!disposed) director.setAudioPending(false); };
    audio.onerror = () => { if (!disposed) {pause(); setError("Voice audio could not load. Press Play to retry.");} };
    const sample = (resuming = false) => {
      if (disposed) return;
      const position = director.getAudioPosition(), snapshot = director.getSnapshot();
      const candidates = position?.part === "thinking" ? clips.filter(clip => clip.watch?.part === "thinking") : clips.filter(clip => clip.watch?.part === "speech");
      let offset = position?.offsetMs ?? -1;
      const clip = position ? candidates.find(candidate => {if (offset < candidate.durationMs) return true; offset -= candidate.durationMs; return false;}) : undefined;
      if (!clip || snapshot.waitingAtTail) stop();
      else {
        if (selected?.versionId !== clip.versionId) {stop();selected=clip;audio.src=resolveApiUrl(clip.url);director.setAudioPending(true);audio.load();}
        audio.muted=controls.current.muted;audio.volume=controls.current.volume;audio.playbackRate=snapshot.speed;
        if (audio.readyState >= 1 && Math.abs(audio.currentTime-offset/1000) > .12) audio.currentTime=offset/1000;
        if (resuming || audio.readyState >= 2 && snapshot.isPlaying && director.isAnimating()) {
          if (!wasSpeaking) {wasSpeaking=true;setSpeaking(true);}
          start();
        } else if (!snapshot.isPlaying) {stop();}
        else if (!starting) {audio.pause();if (wasSpeaking) {wasSpeaking=false;setSpeaking(false);}}
      }
    };
    const tick = () => {sample();frame=requestAnimationFrame(tick);};
    resumePlayer.current = () => {if (audio.error) audio.load();sample(true);};
    tick();
    return () => {disposed=true;resumePlayer.current=null;cancelAnimationFrame(frame);audio.onwaiting=null;audio.oncanplay=null;audio.onerror=null;stop();audio.removeAttribute("src");audio.load();};
  },[director,activeKey,clips]);
  const houseNarrationAvailable = speech.some(clip => clip.speakerId === null);
  const position = director.getAudioPosition();
  const houseNarration = houseNarrationAvailable && position?.part === "speech" && !director.getSnapshot().waitingAtTail
    ? narrationWindow(position.offsetMs, speechMs) : null;
  return {available:!!data?.clips.length,houseNarrationAvailable,houseNarration,muted,volume,speaking,error: error ?? metadataError ?? null,setMuted,setVolume,
    resume:() => {setError(null);if (metadataError) setRetry(value => value+1);resumePlayer.current?.();}};
}
