"use client";

import { useSyncExternalStore } from "react";
import { analyticsPermission, parseAnalyticsChoice, visitAnalyticsNotice, type AnalyticsChoice, type AnalyticsNotice } from "./analytics-policy";

const key = "house:analytics-consent";
const noticeKey = "house:analytics-us-notice-shown";
const listeners = new Set<() => void>();
const initial = { ready: false, country: null as string | null, choice: null as AnalyticsChoice | null, blocked: false, analytics: false, recordings: false, notice: { seen: false, path: null } as AnalyticsNotice };
let state = initial;
let loading: Promise<void> | null = null;

function refresh() {
  let choice: AnalyticsChoice | null = null;
  let blocked = navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  let seen = state.notice.seen;
  try {
    choice = parseAnalyticsChoice(localStorage.getItem(key));
    seen = localStorage.getItem(noticeKey) === "true";
  }
  catch { blocked = true; }
  state = { ...state, choice, blocked, notice: { ...state.notice, seen }, ...analyticsPermission(state.country, choice, blocked) };
  listeners.forEach(listener => listener());
}

export function getAnalyticsConsent() { return state; }
export const subscribeAnalyticsConsent = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useAnalyticsConsent() { return useSyncExternalStore(subscribeAnalyticsConsent, getAnalyticsConsent, () => initial); }

export function loadAnalyticsConsent(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    let country: string | null = null;
    try {
      const response = await fetch("/analytics-region", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Region lookup: ${response.status}`);
      const data = await response.json();
      country = typeof data.country === "string" && /^[A-Z]{2}$/.test(data.country) ? data.country : null;
    } catch { console.warn("[Analytics] Region unavailable; consent required"); }
    state = { ...state, ready: true, country };
    refresh();
    window.addEventListener("storage", event => { if (event.key === key || event.key === noticeKey || event.key === null) refresh(); });
  })();
  return loading;
}

/** Notice acknowledgement is deliberately separate from an analytics choice. */
export function showAnalyticsNotice(pathname: string): void {
  const notice = visitAnalyticsNotice(state.notice, pathname);
  if (notice === state.notice) return;
  try { localStorage.setItem(noticeKey, "true"); }
  catch { console.warn("[Analytics] Notice acknowledgement could not be saved"); }
  state = { ...state, notice };
  listeners.forEach(listener => listener());
}

export function dismissAnalyticsNotice(): void {
  state = { ...state, notice: { seen: true, path: null } };
  listeners.forEach(listener => listener());
}

/** Updates in memory even if persistence is unavailable. Never reload an unsaved agent form. */
export function saveAnalyticsChoice(choice: AnalyticsChoice): boolean {
  let saved = true;
  try { localStorage.setItem(key, JSON.stringify({ version: 1, ...choice })); }
  catch { saved = false; }
  state = { ...state, choice, ...analyticsPermission(state.country, choice, state.blocked) };
  listeners.forEach(listener => listener());
  return saved;
}
