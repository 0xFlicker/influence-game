"use client";
import { useEffect, useState } from "react";
import { apiFetch, resolveApiUrl } from "@/lib/api";
import type { VisualWatchData } from "./visual-watch-model";

/** Fetch current publications quietly; an active beat always keeps its initial media. */
export function useVisualWatch(gameId: string, enabled: boolean, live: boolean, beatKey: string | undefined) {
  const [snapshot, setSnapshot] = useState<{ gameId: string; data: VisualWatchData } | null>(null);
  const [choice, setChoice] = useState<{ gameId: string; beatKey: string | undefined; data: VisualWatchData | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (cancelled) return;
      try {
        const data = await apiFetch<VisualWatchData>(`/api/games/${gameId}/visual`);
        if (!cancelled) {
          setSnapshot({ gameId, data: { ...data,
            scenes: data.scenes.map(scene => ({ ...scene, imageUrl: resolveApiUrl(scene.imageUrl) })),
            fullBodies: Object.fromEntries(Object.entries(data.fullBodies ?? {}).map(([id, url]) => [id, resolveApiUrl(url)])),
            portraits: Object.fromEntries(Object.entries(data.portraits).map(([id, url]) => [id, resolveApiUrl(url)])),
          } });
        }
      } catch (error) {
        // A transient refresh failure must not clear cached media or interrupt playback.
        if (!cancelled) console.warn("Visual media refresh failed; retaining current images", error);
      } finally {
        if (!cancelled) timer = setTimeout(refresh, live ? 2_000 : 5_000);
      }
    };
    void refresh();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameId, enabled, live]);
  if (!choice || choice.gameId !== gameId || choice.beatKey !== beatKey || (enabled && !choice.data && snapshot?.gameId === gameId)) {
    const next = { gameId, beatKey, data: enabled && snapshot?.gameId === gameId ? snapshot.data : null };
    setChoice(next);
    return next.data;
  }
  return enabled ? choice.data : null;
}
