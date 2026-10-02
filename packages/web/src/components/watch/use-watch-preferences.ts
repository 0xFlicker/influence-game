"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {ThinkingOrder} from "./watch-director";

export type WatchPreferenceScope = "viewer" | "production";
export interface WatchPreferences { thinking: boolean; thinkingOrder: ThinkingOrder }
const defaults: WatchPreferences = {thinking:false, thinkingOrder:"thinking-first"};
const changed = "house-watch-preferences-changed";
export const watchPreferenceKey = (scope: WatchPreferenceScope) => `house:watch:${scope}:v1`;
function read(scope: WatchPreferenceScope): WatchPreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(watchPreferenceKey(scope)) ?? "null");
    if (value && typeof value === "object" && "thinking" in value && typeof value.thinking === "boolean"
      && "thinkingOrder" in value && (value.thinkingOrder === "thinking-first" || value.thinkingOrder === "speech-first")) {
      return {thinking:value.thinking, thinkingOrder:value.thinkingOrder};
    }
  } catch { /* Blocked storage or invalid saved data must not prevent playback. */ }
  return defaults;
}

/** Read before mounting a player; unavailable controls never overwrite saved choices. */
export function useWatchPreferences(scope: WatchPreferenceScope = "viewer") {
  const current = useRef(defaults);
  const [state,setState] = useState<{scope:WatchPreferenceScope; value:WatchPreferences} | null>(null);
  useEffect(() => {
    const refresh = () => {current.current = read(scope);setState({scope,value:current.current});};
    const storage = (event: StorageEvent) => {if(event.key === null || event.key === watchPreferenceKey(scope))refresh();};
    refresh();
    window.addEventListener("storage",storage);
    window.addEventListener(changed,refresh);
    return () => {window.removeEventListener("storage",storage);window.removeEventListener(changed,refresh);};
  },[scope]);
  const update = useCallback((patch: Partial<WatchPreferences>) => {
    const value = {...current.current,...patch};
    current.current = value;
    try {
      window.localStorage.setItem(watchPreferenceKey(scope),JSON.stringify(value));
      window.dispatchEvent(new Event(changed));
    } catch { console.warn("Player preferences could not be saved on this device."); }
    setState({scope,value});
  },[scope]);
  return {ready:state?.scope === scope, ...(state?.scope === scope ? state.value : defaults),
    setThinking:useCallback((thinking:boolean)=>update({thinking}),[update]),
    setThinkingOrder:useCallback((thinkingOrder:ThinkingOrder)=>update({thinkingOrder}),[update])};
}
