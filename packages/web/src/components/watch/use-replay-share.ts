"use client";
import {useMemo, useSyncExternalStore} from "react";
import {parseReplayShare} from "@/lib/replay-share";
const subscribe = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;
/** Hydrate the URL before preferences and the clock initialize; no storage required. */
export function useReplayShare(enabled = true) {
  const search = useSyncExternalStore(subscribe, clientSearch, serverSearch);
  return useMemo(() => {
    if (!enabled) return {ready:true};
    if (search === null) return {ready:false};
    try { return {ready:true, state:parseReplayShare(new URLSearchParams(search))}; }
    catch (error) { return {ready:true, error:error instanceof Error ? error.message : "Invalid replay link."}; }
  },[search,enabled]);
}
