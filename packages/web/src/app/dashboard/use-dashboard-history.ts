"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ParticipationFilter } from "@influence/engine/house-participation";
import { getAuthToken, getPlayerGamesPage, type PlayerGameResult } from "@/lib/api";

const HISTORY_PAGE_SIZE = 3;

type HistoryState = {
  ownerId: string | null;
  kind: ParticipationFilter;
  entries: PlayerGameResult[];
  cursors: (string | null)[];
  page: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  hasAnyHistory: boolean;
};

const emptyHistory: HistoryState = {
  ownerId: null, kind: "all", entries: [], cursors: [null], page: 0,
  nextCursor: null, loading: true, error: null, hasAnyHistory: false,
};

export function useDashboardHistory(ownerId: string | undefined, authenticated: boolean) {
  const [state, setState] = useState<HistoryState>(emptyHistory);
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const invalidate = useCallback(() => { ++requestId.current; inFlight.current = false; }, []);

  const load = useCallback((owner: string, kind: ParticipationFilter, cursors: (string | null)[], page: number, resetHistory = false) => {
    const request = ++requestId.current;
    const cursor = cursors[page];
    inFlight.current = true;
    setState(previous => ({
      ownerId: owner, kind, entries: [], cursors, page, nextCursor: null,
      loading: true, error: null,
      hasAnyHistory: resetHistory || previous.ownerId !== owner ? false : previous.hasAnyHistory,
    }));
    void getPlayerGamesPage(cursor ?? undefined, HISTORY_PAGE_SIZE, kind).then(result => {
      if (request !== requestId.current) return;
      if (result.nextCursor && result.nextCursor === cursor) throw new Error("History cursor did not advance");
      setState(previous => ({
        ...previous, entries: result.items, nextCursor: result.nextCursor, loading: false,
        hasAnyHistory: kind === "all" && page === 0 ? result.items.length > 0 : previous.hasAnyHistory || result.items.length > 0,
      }));
    }).catch(() => {
      if (request === requestId.current) setState(previous => ({ ...previous, loading: false, error: "Could not load your game history." }));
    }).finally(() => { if (request === requestId.current) inFlight.current = false; });
  }, []);

  const reload = useCallback(() => {
    if (authenticated && ownerId && getAuthToken()) load(ownerId, "all", [null], 0, true);
  }, [authenticated, load, ownerId]);

  useEffect(() => {
    const timer = window.setTimeout(reload, 0);
    window.addEventListener("auth:session-ready", reload);
    return () => { invalidate(); window.clearTimeout(timer); window.removeEventListener("auth:session-ready", reload); };
  }, [invalidate, reload]);

  const visible = authenticated && ownerId && state.ownerId === ownerId ? state : emptyHistory;
  return {
    ...visible,
    reload,
    setKind: (kind: ParticipationFilter) => { if (ownerId && authenticated) load(ownerId, kind, [null], 0); },
    previous: () => { if (ownerId && !inFlight.current && visible.page > 0) load(ownerId, visible.kind, visible.cursors, visible.page - 1); },
    next: () => {
      if (ownerId && !inFlight.current && visible.nextCursor) {
        load(ownerId, visible.kind, [...visible.cursors.slice(0, visible.page + 1), visible.nextCursor], visible.page + 1);
      }
    },
    retry: () => { if (ownerId && !inFlight.current) load(ownerId, visible.kind, visible.cursors, visible.page); },
  };
}
