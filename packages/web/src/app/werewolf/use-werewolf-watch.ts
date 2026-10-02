"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {WerewolfAudience} from "@influence/engine/werewolf/observation";
import type {WerewolfWatchWindow} from "@influence/engine/werewolf/watch-contract";
import {ApiError} from "@/lib/api";
import {getWerewolfWatch} from "@/lib/werewolf-api";
import {useWatchDirector} from "@/components/watch/use-watch-director";
import {consumedSilentTail, werewolfCues, werewolfWatchPolicy} from "./werewolf-watch-model";

/** One mounted session per game/audience. Cached head data is never the active snapshot. */
export function useWerewolfWatch(slug: string, audience: WerewolfAudience, cutoff: string) {
  const clock = useWatchDirector(werewolfWatchPolicy);
  const {director} = clock;
  const windows = useRef(new Map<number, WerewolfWatchWindow>());
  const [data, setData] = useState<WerewolfWatchWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [tail, setTail] = useState<WerewolfWatchWindow["moments"][number] | null>(null);
  const [follow, setFollow] = useState(true);
  const request = useRef<AbortController | null>(null);
  const intent = useRef(0);
  const target = useRef(1);
  const playIntent = useRef(true);
  const awaitingInitialCue = useRef(true);
  const [revision, setRevision] = useState(0);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const commitWindow = useCallback((value: WerewolfWatchWindow, active: number) => {
    // Validate overlaps before replacing a refreshed window.
    werewolfCues([...windows.current.values(), value]);
    windows.current.set(value.fromCursor, value);
    const anchor = director.getActiveCue()?.moment.cursor;
    const pinned = anchor === undefined ? null : Math.floor((anchor - 1) / 32) * 32 + 1;
    const keys = [...windows.current.keys()].sort((a,b) => a === pinned ? -1 : b === pinned ? 1 : Math.abs(a-active) - Math.abs(b-active));
    for (const key of keys.slice(3)) windows.current.delete(key);
    setData(value); setRevision(n => n + 1);
  }, [director]);
  const seek = useCallback(async (position: number, play = playIntent.current, previous = false, initial = false) => {
    playIntent.current = play;
    awaitingInitialCue.current = initial;
    target.current = position;
    setNavigationRevision(n => n + 1);
    const generation = ++intent.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    director.pause(); setFollow(play); setPreparing(true); setError(null);
    try {
      let next = Math.max(1, position), window: WerewolfWatchWindow;
      for (;;) {
        const start = Math.floor((next - 1) / 32) * 32 + 1;
        window = await getWerewolfWatch(slug, audience, start, controller.signal, cutoff);
        if (controller.signal.aborted || generation !== intent.current) return;
        if (next > window.latestCursor && window.latestCursor > 0) { next = window.latestCursor; continue; }
        commitWindow(window, next);
        const cues = werewolfCues([...windows.current.values()]);
        const selected = previous ? cues.findLastIndex(cue => cue.moment.cursor <= next) : cues.findIndex(cue => cue.moment.cursor >= next);
        if (selected >= 0) {
          awaitingInitialCue.current = false;
          director.load(cues); director.seek(selected); setTail(null);
          // Tail is always a scheduler holding state, even for terminal games.
          director.setFollowTail(true);
          if (playIntent.current) director.play();
          break;
        }
        if (previous && window.fromCursor > 1) {next = window.fromCursor - 1; continue;}
        if (!previous && window.throughCursor < window.latestCursor) { next = window.throughCursor + 1; continue; }
        director.load([]); setTail(window.moments.at(-1) ?? null); break;
      }
    } catch (cause) {
      if (!controller.signal.aborted && cause instanceof ApiError && [401,403,404].includes(cause.status)) { playIntent.current = false; setFollow(false); director.pause(); director.load([]); windows.current.clear(); setData(null); setTail(null); }
      if (!controller.signal.aborted && generation === intent.current) setError(cause instanceof Error ? cause.message : "Could not prepare replay");
    } finally { if (!controller.signal.aborted && generation === intent.current) setPreparing(false); }
  }, [slug, audience, cutoff, commitWindow, director]);
  const cancel = useCallback(() => { intent.current++; request.current?.abort(); }, []);
  useEffect(() => { void seek(1, playIntent.current, false, true); return cancel; }, [seek, cancel]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) {playIntent.current = false; setFollow(false);} };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  const activeCue = director.getActiveCue();
  const holding = clock.snapshot.waitingAtTail || !activeCue;
  const activeCursor = holding ? Math.max(activeCue?.moment.cursor ?? 1, tail?.cursor ?? 1) : activeCue.moment.cursor;
  // Only a playing/following session consumes new silent history. Paused inspectors stay frozen.
  useEffect(() => {
    if (preparing || !holding || !follow || activeCue && !clock.snapshot.isPlaying) return;
    const consumed = consumedSilentTail([...windows.current.values()], activeCursor);
    if (consumed) setTail(consumed);
  }, [preparing, holding, follow, activeCue, clock.snapshot.isPlaying, activeCursor, revision]);
  const latestCursor = data?.latestCursor, status = data?.status;
  // Prefetch one neighboring window, poll only while live. Neither operation seeks.
  useEffect(() => {
    if (latestCursor === undefined || preparing) return;
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      const generation = intent.current;
      try {
        const currentStart = Math.floor((activeCursor - 1) / 32) * 32 + 1;
        const nextStart = currentStart + 32;
        const nearEnd = activeCursor >= currentStart + 23 || director.getSnapshot().waitingAtTail || !director.getActiveCue();
        const from = nearEnd && latestCursor >= nextStart ? nextStart : currentStart;
        if (status !== "in_progress" && (windows.current.has(from) || !nearEnd)) return;
        const value = await getWerewolfWatch(slug, audience, from, controller.signal, cutoff);
        if (controller.signal.aborted || intent.current !== generation) return;
        commitWindow(value, activeCursor);
        const cues = werewolfCues([...windows.current.values()]);
        if (!director.getActiveCue() && awaitingInitialCue.current && cues.some(cue => cue.moment.cursor >= activeCursor)) {
          void seek(activeCursor, playIntent.current, false, true); return;
        }
        if (!director.getActiveCue() && follow && cues.some(cue => cue.moment.cursor > activeCursor)) {
          void seek(activeCursor + 1, true); return;
        }
        // An empty director can represent a deliberate silent seek. Do not resurrect older speech.
        if (director.getActiveCue()) director.append(cues);
      } catch (cause) {
        if (!controller.signal.aborted && intent.current === generation) {
          if (cause instanceof ApiError && [401,403,404].includes(cause.status)) {playIntent.current = false;setFollow(false);director.pause();director.load([]);windows.current.clear();setData(null);setTail(null);}
          setError(cause instanceof Error ? cause.message : "Could not refresh replay");
        }
      }
      finally { busy = false; }
    };
    void refresh();
    const timer = status === "in_progress" ? setInterval(() => { void refresh(); }, 3000) : null;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [activeCursor, latestCursor, status, preparing, slug, audience, cutoff, director, commitWindow, follow, seek]);
  const buffered = [...windows.current.values()];
  const active = holding && tail && tail.cursor >= (activeCue?.moment.cursor ?? 0) ? tail : activeCue?.moment ?? tail;
  useEffect(() => {
    if (!preparing && holding && data && data.status !== "in_progress" && activeCursor >= data.latestCursor) {playIntent.current = false; setFollow(false); director.pause();}
  }, [preparing, holding, data, activeCursor, director]);
  const media = Object.assign({}, ...buffered.map(w => w.media)) as WerewolfWatchWindow["media"];
  void revision;
  return {...clock, data, active, media, preparing, error, follow, holding, seek, navigationRevision,
    retry: () => void seek(target.current),
    toggle: () => { playIntent.current = !playIntent.current; setFollow(playIntent.current); if (!playIntent.current) director.pause(); else if (!preparing) director.play(); },
    previous: () => {
      const current = director.getSnapshot().cursor;
      if (current > 0) {setNavigationRevision(n => n + 1); cancel(); setPreparing(false); setError(null); director.pause(); setFollow(playIntent.current); setTail(null); director.seek(current - 1); if (playIntent.current) director.play(); target.current = director.getActiveCue()?.moment.cursor ?? 1;}
      else void seek(Math.max(1, activeCursor - 1), playIntent.current, true);
    },
    goLive: () => void seek(data?.latestCursor ?? 1, true, true),
  };
}
