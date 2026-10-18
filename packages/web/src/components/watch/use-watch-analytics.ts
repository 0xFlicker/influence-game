"use client";

import { useEffect } from "react";
import { captureProductEvent } from "@/lib/product-analytics";
import { WatchAnalytics } from "@/lib/watch-analytics";
import type { PresentationDirector, WatchCue } from "./watch-director";

export function useWatchAnalytics<C extends WatchCue>(director: PresentationDirector<C>, gameId: string, gameKind: "influence" | "werewolf", mode: "live" | "replay" | null) {
  useEffect(() => {
    if (mode === null) return;
    const tracker = new WatchAnalytics();
    const watchId = crypto.randomUUID();
    const properties = { game_id: gameId, game_kind: gameKind, watch_mode: mode, watch_id: watchId };
    let started = false;
    let ended = false;
    let navigation = director.getNavigationRevision();
    const sample = () => {
      const state = director.getSnapshot();
      const active = !document.hidden && state.isPlaying && !state.waitingAtTail && director.isAnimating();
      tracker.sample({ now: performance.now(), active, key: state.activeKey, elapsed: director.getElapsedBaseMs(), navigation: director.getNavigationRevision() });
      if (active && !started) { started = true; captureProductEvent("watch_started", properties); }
      if (navigation !== director.getNavigationRevision()) {
        navigation = director.getNavigationRevision();
        captureProductEvent("watch_seeked", { ...properties, position: state.position });
      }
      if (started && !ended && mode === "replay" && state.waitingAtTail) {
        ended = true;
        captureProductEvent("watch_buffer_end_reached", { ...properties, position: state.position });
      }
    };
    const flush = () => {
      sample();
      const values = tracker.flush();
      if (values.active_seconds > 0) captureProductEvent("watch_progress", {
        ...properties, ...values, position: director.getSnapshot().position,
      });
    };
    captureProductEvent("watch_opened", properties);
    const sampleTimer = setInterval(sample, 250);
    const flushTimer = setInterval(flush, 15000);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      flush(); clearInterval(sampleTimer); clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [director, gameId, gameKind, mode]);
}
