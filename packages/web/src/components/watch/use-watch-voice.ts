"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PublishedAudioClip, PublishedAudioTrack } from "@influence/engine/audio-track";
import type { AudioWatchCoordinate } from "@influence/engine/audio-watch";
import type { ProductionAudience } from "@influence/engine/production-moments";
import { anonymousApiFetch, resolveApiUrl } from "@/lib/api";
import type { PresentationDirector, WatchCue } from "./watch-director";
import { narrationWindow } from "./house-narration";
import { indexAudioClips } from "./audio-watch-coordinate";
import {sampleWatch} from "./watch-sampling";
import {MediaAlignment} from "./media-alignment";
export { matchesAudioWatch } from "./audio-watch-coordinate";

/** HTML audio follows the existing director clock, including exact in-clip seeks. */
export function useWatchVoice<C extends WatchCue>({ director, gameId, audience, thinking, coordinate, coordinateForCue, onPause, onSpeech, masterMuted = false, suspended = false, live = false }: {
  director: PresentationDirector<C>; gameId: string; audience: ProductionAudience; thinking: boolean;
  coordinate: AudioWatchCoordinate | null; coordinateForCue?: (cue:C)=>AudioWatchCoordinate|null; onPause: () => void; onSpeech?: (speaking:boolean,speakerId:string|null)=>void; live?: boolean; masterMuted?: boolean; suspended?:boolean;
}) {
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [error, setError] = useState<string | null>(null);
  const speechObserver = useRef(onSpeech);
  useEffect(()=>{speechObserver.current=onSpeech;},[onSpeech]);
  const [speaking, setSpeaking] = useState(false);
  const activeKey = director.getActiveCue()?.key;
  const player = useRef<HTMLAudioElement | null>(null);
  const resumePlayer = useRef<(() => boolean) | null>(null);
  const generation = useRef(0);
  const unlocked = useRef(false);
  const priming = useRef(false);
  const suspendedRef=useRef(suspended);
  useLayoutEffect(()=>{
    suspendedRef.current=suspended;
    if(suspended)player.current?.pause();
  },[suspended]);
  const prime = () => {
    if(suspendedRef.current)return;
    if (unlocked.current || priming.current) return;
    const audio = player.current ?? new Audio(); player.current = audio;
    const current = ++generation.current;
    priming.current = true;
    audio.src = "/music/unlock.wav";
    audio.muted = false;
    void audio.play().then(() => {
      if (player.current === audio) unlocked.current = true;
      if (generation.current === current) {priming.current = false;audio.pause();}
    }, cause => {
      if (generation.current === current) priming.current = false;
      if (generation.current === current && !(cause instanceof Error && ["NotAllowedError", "AbortError"].includes(cause.name))) {
        setError("Voice audio could not play. Press Play to retry.");
      }
    });
  };
  useEffect(() => () => {
    generation.current++;
    const audio = player.current;
    if (audio) {audio.pause();audio.removeAttribute("src");audio.load();}
    player.current = null; unlocked.current = false; priming.current = false;
  }, []);
  const pausePlayback = useRef(onPause);
  useEffect(() => {pausePlayback.current = onPause;}, [onPause]);
  const effectiveMuted = muted || masterMuted;
  const controls = useRef({muted:effectiveMuted,volume});
  useEffect(() => {
    controls.current = {muted:effectiveMuted,volume};
    if (player.current) {player.current.muted=effectiveMuted;player.current.volume=volume;}
  },[effectiveMuted,volume]);
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
  const findClips = useMemo(() => indexAudioClips(data?.clips ?? []), [data]);
  const coordinateKey = JSON.stringify(coordinate);
  const clipKey = JSON.stringify(useMemo(() => {
    const position = JSON.parse(coordinateKey) as AudioWatchCoordinate | null;
    return findClips(position);
  },[findClips,coordinateKey]));
  const clips = useMemo(() => JSON.parse(clipKey) as PublishedAudioClip[],[clipKey]);
  const speech = clips.filter(clip => clip.watch?.part === "speech"), thoughts = thinking ? clips.filter(clip => clip.watch?.part === "thinking") : [];
  const speechMs = speech.reduce((sum,clip) => sum+clip.durationMs,0), thinkingMs = thoughts.reduce((sum,clip) => sum+clip.durationMs,0);
  useEffect(() => {
    if (!coordinateForCue) return;
    let previousCues: readonly C[] | undefined;
    const sync = () => {
      const cues = director.getCues();
      if (cues === previousCues) return;
      previousCues = cues;
      for (const cue of cues) {
        const position = coordinateForCue(cue);
        const matches = findClips(position);
        const speechMs = matches.filter(clip => clip.watch?.part === "speech").reduce((sum,clip)=>sum+clip.durationMs,0);
        const thinkingMs = thinking ? matches.filter(clip => clip.watch?.part === "thinking").reduce((sum,clip)=>sum+clip.durationMs,0) : 0;
        director.setRecordings(cue.key,{...(speechMs && {speechMs}),...(thinkingMs && {thinkingMs})});
      }
    };
    sync();return director.subscribe(sync);
  },[director,findClips,thinking,coordinateForCue]);
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
    let disposed = false, selected: PublishedAudioClip | undefined, starting = false, wasSpeaking = false;
    const alignment = new MediaAlignment();
    let pending = false;
    const hold = (value: boolean) => {pending = value;director.setAudioPending(value);};
    const speechClips = clips.filter(clip => clip.watch?.part === "speech");
    const thoughtClips = clips.filter(clip => clip.watch?.part === "thinking");
    let audible=false, mediaPlaying=false;
    const reportSpeech=()=>{
      const next=mediaPlaying && !priming.current && !audio.paused && !audio.muted && audio.volume>0;
      if(next===audible)return;
      audible=next;speechObserver.current?.(next, next ? selected?.speakerId ?? null : null);
    };
    audio.onpause=audio.onended=audio.onemptied=()=>{mediaPlaying=false;reportSpeech();};
    audio.onvolumechange=reportSpeech;
    let attempt = 0;
    const stop = () => {
      if (!audio.paused || starting) alignment.invalidate();
      attempt++;starting=false;audio.pause();mediaPlaying=false;reportSpeech();hold(false);
      if (wasSpeaking) {wasSpeaking=false;setSpeaking(false);}
    };
    const pause = () => {stop();director.pause();pausePlayback.current();};
    const start = () => {
      if (suspendedRef.current || !audio.paused || starting) return;
      starting = true;
      hold(true);
      const currentAttempt = ++attempt;
      void audio.play().then(() => {
        if (!disposed && currentAttempt === attempt) {starting = false;unlocked.current = true;if (!audio.seeking && audio.readyState >= 3) hold(false);}
      }, cause => {
        if (disposed || currentAttempt !== attempt) return;
        if(suspendedRef.current){stop();return;}
        pause();
        // Browser permission and interruption are ordinary paused states.
        if (!(cause instanceof Error && ["NotAllowedError", "AbortError"].includes(cause.name))) {
          setError("Voice audio could not play. Press Play to retry.");
        }
      });
    };
    audio.onwaiting = () => { if (!disposed && selected && director.getAudioPosition()) {
      // Seeking itself emits waiting. Do not turn its completion into another seek.
      if (!audio.seeking) alignment.waitForData();
      hold(true);
    } };
    const playable = () => {
      if (disposed) return;
      sample();
      if (!audio.paused && !audio.seeking && !starting && audio.readyState >= 3) hold(false);
    };
    audio.oncanplay = playable;
    audio.onplaying = () => {playable();mediaPlaying=true;reportSpeech();};
    audio.onloadedmetadata = () => sample();
    audio.onseeked = playable;
    audio.onerror = () => { if (!disposed) {pause(); setError("Voice audio could not load. Press Play to retry.");} };
    const sample = (resuming = false) => {
      if (disposed) return false;
      if(suspendedRef.current){stop();return false;}
      const position = director.getAudioPosition(), snapshot = director.getSnapshot();
      const candidates = position?.part === "thinking" ? thoughtClips : speechClips;
      let offset = position?.offsetMs ?? -1;
      const clip = position ? candidates.find(candidate => {if (offset < candidate.durationMs) return true; offset -= candidate.durationMs; return false;}) : undefined;
      if (!clip || snapshot.waitingAtTail) {if (!priming.current) stop();return false;}
      else {
        if (selected?.versionId !== clip.versionId || audio.getAttribute("src") !== resolveApiUrl(clip.url)) {stop();alignment.invalidate();selected=clip;generation.current++;priming.current=false;audio.src=resolveApiUrl(clip.url);hold(true);audio.load();}
        audio.muted=controls.current.muted;audio.volume=controls.current.volume;
        alignment.sync(audio, {time:offset/1000, playing:snapshot.isPlaying, speed:snapshot.speed, revision:director.getNavigationRevision()});
        if (audio.seeking || audio.readyState < 3) hold(true);
        else if (pending && !starting) hold(false);
        if (resuming || audio.readyState >= 3 && snapshot.isPlaying && director.isAnimating()) {
          if (!wasSpeaking) {wasSpeaking=true;setSpeaking(true);}
          start();
        } else if (!snapshot.isPlaying) {stop();}
        // A decoder's waiting state holds the director, not the media element.
        // Pausing here would abort recovery and repeatedly restart the clip.
        else if (!pending && !starting) {if (!audio.paused) {audio.pause();alignment.invalidate();} if (wasSpeaking) {wasSpeaking=false;setSpeaking(false);}}
      }
      return true;
    };
    resumePlayer.current = () => {if (audio.error) audio.load();return sample(true);};
    // Download during the cue's visual entrance, before its spoken window opens.
    const first = speechClips[0] ?? thoughtClips[0];
    if (first) {selected=first;generation.current++;priming.current=false;audio.src=resolveApiUrl(first.url);audio.load();}
    sample();
    const unsubscribe = sampleWatch(director, sample);
    return () => {disposed=true;resumePlayer.current=null;unsubscribe();audio.onwaiting=null;audio.oncanplay=null;audio.onplaying=null;audio.onloadedmetadata=null;audio.onseeked=null;audio.onerror=null;stop();audio.onpause=null;audio.onended=null;audio.onemptied=null;audio.onvolumechange=null;};
  },[director,activeKey,clips]);
  const houseNarrationAvailable = speech.some(clip => clip.speakerId === null);
  const getHouseNarration = () => {
    const position = director.getAudioPosition();
    return houseNarrationAvailable && position?.part === "speech" && !director.getSnapshot().waitingAtTail
      ? narrationWindow(position.offsetMs, speechMs) : null;
  };
  return {available:!!data?.clips.length,houseNarrationAvailable,getHouseNarration,muted,volume,speaking,error: error ?? metadataError ?? null,setMuted,setVolume,
    resume:() => {setError(null);if (metadataError) setRetry(value => value+1);if (!resumePlayer.current?.()) prime();}};
}
