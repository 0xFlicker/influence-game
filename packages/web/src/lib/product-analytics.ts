"use client";

import { sanitizeAnalyticsProperties } from "./analytics-privacy";
import type { PostHog } from "posthog-js";
let posthog: PostHog;
let initializing: Promise<void> | null = null;
const pending: { event: string; properties: Properties }[] = [];

type Properties = Record<string, string | number | boolean | null>;
let initialized = false;
let excluded = true;
let identity: string | null = null;
const preferenceKey = "house:analytics-disabled";

export function analyticsDisabled(): boolean {
  try { return localStorage.getItem(preferenceKey) === "true"; }
  catch { return true; }
}

export function setAnalyticsDisabled(disabled: boolean): void {
  localStorage.setItem(preferenceKey, String(disabled));
  window.location.reload();
}

export async function initializeAnalytics(key: string, host: string): Promise<void> {
  if (initialized || !key || analyticsDisabled() || navigator.doNotTrack === "1") return;
  if (initializing) return initializing;
  initializing = import("posthog-js").then(module => {
    posthog = module.default;
    posthog.init(key, {
      api_host: host,
      defaults: "2026-05-30",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_surveys: true,
      disable_session_recording: true,
      enable_recording_console_log: false,
      person_profiles: "identified_only",
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        blockSelector: '[data-analytics-private], form, input, textarea, video, canvas, img, iframe, [role="dialog"]',
        recordHeaders: false,
        recordBody: false,
      },
      before_send: event => {
        if (!event || excluded) return null;
        // SDK defaults can contain full URLs; never send query strings, fragments,
        // OAuth codes, private editor text or request bodies.
        sanitizeAnalyticsProperties(event.properties);
        return event;
      },
    });
    initialized = true;
  }).catch(() => { console.warn("[Analytics] SDK unavailable"); }).finally(() => { initializing = null; });
  return initializing;
}

export function setAnalyticsIdentity(publicId: string | null, internal: boolean): void {
  excluded = internal;
  if (!initialized) return;
  if (internal) { pending.length = 0; posthog.stopSessionRecording(); return; }
  if ((identity && identity !== publicId) || (!publicId && posthog.get_property("$user_id"))) posthog.reset();
  if (publicId && identity !== publicId) posthog.identify(publicId);
  identity = publicId;
  for (const item of pending.splice(0)) captureProductEvent(item.event, item.properties);
}

export function captureProductEvent(event: string, properties: Properties = {}): void {
  if (!initialized) {
    if (typeof window !== "undefined" && pending.length < 100) pending.push({ event, properties });
    return;
  }
  if (excluded) return;
  try { posthog.capture(event, { ...properties, channel: "web", environment: "production" }); }
  catch { console.warn("[Analytics] Event capture unavailable"); }
}

export function capturePage(pathname: string): void {
  const campaigns: Properties = {};
  const params = new URLSearchParams(location.search);
  for (const name of ["utm_source", "utm_medium", "utm_campaign"]) {
    const value = params.get(name);
    if (value && /^[a-zA-Z0-9_. -]{1,100}$/.test(value)) campaigns[name] = value;
  }
  captureProductEvent("$pageview", { $current_url: `${location.origin}${pathname}`, ...campaigns });
  if (pathname === "/agents/create") captureProductEvent("agent_creation_opened", {
    flow: ["manage", "join_game", "daily_free"].includes(params.get("flow") ?? "") ? params.get("flow")! : "manage",
  });
}

export function recordBrowserSession(enabled: boolean): void {
  if (!initialized) return;
  if (enabled && !excluded) posthog.startSessionRecording();
  else posthog.stopSessionRecording();
}

/** Explicit route allowlist. Never capture request/response bodies or raw errors. */
export function analyticsOperation(path: string, method: string): string | null {
  if (method !== "POST") return null;
  if (path === "/api/agent-profiles") return "agent_save";
  if (["/api/agent-profiles/generate", "/api/agent-profiles/anonymous"].includes(path)) return "agent_generation";
  if (path === "/api/agent-profiles/creation-assistant") return "agent_creation_turn";
  if (path === "/api/agent-profiles/avatar/generate-draft") return "agent_portrait";
  if (path === "/api/free-queue/join") return "daily_entry";
  if (/^\/api\/games\/[^/]+\/join$/.test(path)) return "influence_join";
  if (/^\/api\/werewolf\/[^/]+\/join$/.test(path)) return "werewolf_join";
  return null;
}

export async function measureProductRequest<T>(operation: string | null, request: () => Promise<T>): Promise<T> {
  if (!operation) return request();
  const attemptId = crypto.randomUUID();
  const started = performance.now();
  captureProductEvent(`${operation}_requested`, { attempt_id: attemptId });
  try {
    const result = await request();
    captureProductEvent(`${operation}_succeeded`, { attempt_id: attemptId, duration_ms: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 0;
    captureProductEvent(`${operation}_failed`, { attempt_id: attemptId, duration_ms: Math.round(performance.now() - started), status });
    throw error;
  }
}
