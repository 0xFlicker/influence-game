"use client";
import { useEffect, useState } from "react";
import { apiFetch, resolveApiUrl } from "@/lib/api";
import type { VisualWatchData } from "./visual-watch-model";

export function useVisualWatch(gameId: string, enabled: boolean, live: boolean) {
  const [snapshot, setSnapshot] = useState<{ gameId: string; data: VisualWatchData } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const data = await apiFetch<VisualWatchData>(`/api/games/${gameId}/visual`);
        if (!cancelled) setSnapshot({ gameId, data: { ...data,
          scenes: data.scenes.map((scene) => ({ ...scene, imageUrl: resolveApiUrl(scene.imageUrl) })),
          portraits: Object.fromEntries(Object.entries(data.portraits).map(([id, url]) => [id, resolveApiUrl(url)])),
        } });
      } catch (error) {
        // Preserve accepted images and animation during transient refresh failures.
        console.warn("Visual presentation refresh failed", error);
      } finally {
        if (!cancelled && live) timer = setTimeout(refresh, 2_000);
      }
    };
    void refresh();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [gameId, enabled, live]);
  return snapshot?.gameId === gameId ? snapshot.data : null;
}
