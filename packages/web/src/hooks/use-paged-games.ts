"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { anonymousApiFetch } from "@/lib/api";
import { decodePagedGamesPage, type PagedGameItem, type PagedGamesPage } from "@/lib/paged-games";

/** Fetch the first bounded batch, then fetch further batches only on request. */
export function usePagedGames(query: string, initialPage?: PagedGamesPage) {
  const [items, setItems] = useState<PagedGameItem[]>(initialPage?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [loading, setLoading] = useState(!initialPage);

  const [error, setError] = useState<string | null>(null);
  const [stateQuery, setStateQuery] = useState(query);
  const version = useRef(0), active = useRef<AbortController | null>(null), busy = useRef(false);
  const initial = useRef(initialPage);
  const retryRequest = useRef<{ cursor: string | null; append: boolean }>({ cursor: null, append: false });

  const request = useCallback(async (cursor: string | null, append: boolean) => {
    if (busy.current) return;
    const current = version.current, controller = new AbortController();
    active.current = controller; busy.current = true; retryRequest.current = { cursor, append };
    setLoading(true); setError(null);
    const params = new URLSearchParams(query);
    params.delete("cursor");
    if (cursor) params.set("cursor", cursor);
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const page = decodePagedGamesPage(await anonymousApiFetch<unknown>(`/api/public-games/page?${params}`, { cache: "no-store", signal: controller.signal }));
      if (version.current !== current) return;
      if (controller.signal.aborted) throw new Error("Loading games took too long.");
      if (cursor && page.nextCursor === cursor) throw new Error("Invalid library response");
      setItems(previous => {
        if (!append) return page.items;
        const seen = new Set(previous.map(item => item.game.id));
        return [...previous, ...page.items.filter(item => { if (seen.has(item.game.id)) return false; seen.add(item.game.id); return true; })];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (version.current === current) {
        setError(controller.signal.aborted ? "Loading games took too long." : cause instanceof Error ? cause.message : "Could not load games.");
      }
    } finally {
      clearTimeout(timeout);
      if (version.current === current && active.current === controller) { active.current = null; busy.current = false; setLoading(false); }
    }
  }, [query]);

  useEffect(() => {
    const requestVersion = version;
    ++requestVersion.current; active.current?.abort(); active.current = null; busy.current = false;
    setStateQuery(query); setError(null);
    if (initial.current) { initial.current = undefined; setLoading(false); }
    else { setItems([]); setNextCursor(null); void request(null, false); }
    return () => { ++requestVersion.current; active.current?.abort(); active.current = null; busy.current = false; };
  }, [query, request]);

  const stale = stateQuery !== query;
  return {
    items: stale ? [] : items, nextCursor: stale ? null : nextCursor,
    loading: stale || loading, error: stale ? null : error,
    loadMore: () => !stale && nextCursor !== null && !loading ? request(nextCursor, true) : Promise.resolve(),
    retry: () => !stale && !loading ? request(retryRequest.current.cursor, retryRequest.current.append) : Promise.resolve(),
    refresh: () => {
      if (stale) return Promise.resolve();
      ++version.current; active.current?.abort(); active.current = null; busy.current = false;
      setItems([]); setNextCursor(null);
      return request(null, false);
    },
  };
}
