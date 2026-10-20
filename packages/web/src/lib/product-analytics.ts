"use client";

import { sanitizeAnalyticsProperties } from "./analytics-privacy";
import { scrubExceptionProperties } from "./analytics-errors";
import { getAnalyticsConsent, subscribeAnalyticsConsent } from "./analytics-consent";
import type { PostHog } from "posthog-js";
let posthog: PostHog;
let initializing: Promise<void> | null = null;

type Properties = Record<string, string | number | boolean | null>;
let initialized = false;
let excluded = true;
let identity: string | null = null;
const activityListeners = new Set<() => void>();
export function analyticsActive() { return initialized && !excluded && getAnalyticsConsent().analytics; }
export function subscribeAnalyticsActivity(listener: () => void) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}
function notifyActivity() { activityListeners.forEach(listener => listener()); }
export function suspendAnalytics() {
  excluded = true;
  identity = null;
  if (initialized) {
    posthog.stopSessionRecording();
    // Route/staff exclusions are tab-local. Only a privacy preference may write
    // the SDK's shared opt-out marker and clear its persistence.
    if (!getAnalyticsConsent().analytics) posthog.opt_out_capturing();
  }
  notifyActivity();
}

// Stop immediately on local or cross-tab rejection, before React's next effect.
subscribeAnalyticsConsent(() => {
  if (!getAnalyticsConsent().analytics) suspendAnalytics();
  else if (!getAnalyticsConsent().recordings && initialized) posthog.stopSessionRecording();
});

export async function initializeAnalytics(key: string, host: string): Promise<void> {
  if (initialized || !key || !getAnalyticsConsent().analytics) return;
  if (initializing) return initializing;
  initializing = import("posthog-js").then(module => {
    if (!getAnalyticsConsent().analytics) return;
    posthog = module.default;
    posthog.init(key, {
      api_host: host,
      defaults: "2026-05-30",
      autocapture: false,
      capture_pageview: false,
      // SPA pageviews already carry previous-page duration; capture the final
      // page on browser exit through the SDK's pagehide/beacon handling.
      capture_pageleave: true,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // Leave capture_performance unset so Web Vitals follows project settings.
      disable_surveys: true,
      respect_dnt: true,
      disable_session_recording: true,
      enable_recording_console_log: false,
      person_profiles: "identified_only",
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        blockSelector: '[data-analytics-private], form, input, textarea, video, canvas, img, iframe, [role="dialog"]',
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: request => {
          // The recorder also uses this hook for rrweb Meta.href and SPA URLs;
          // these aren't ordinary analytics properties passed to our sanitizer.
          try {
            const url = new URL(request.name);
            if (!["https:", "http:"].includes(url.protocol)) return undefined;
            return { ...request, name: `${url.origin}${url.pathname}` };
          } catch { return undefined; }
        },
      },
      before_send: event => {
        if (!event || excluded || !getAnalyticsConsent().analytics) return null;
        // SDK-generated events must use the same dashboard filters as ours.
        event.properties.channel = "web";
        event.properties.environment = "production";
        if (event.event === "$exception") scrubExceptionProperties(event.properties);
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
  if (internal || !getAnalyticsConsent().analytics) { suspendAnalytics(); return; }
  if (getAnalyticsConsent().choice?.analytics === true) {
    posthog.opt_in_capturing({ captureEventName: false });
  } else {
    // Default-on US collection is not an affirmative consent grant.
    posthog.clear_opt_in_out_capturing();
  }
  const previousId = identity ?? posthog.get_property("$user_id");
  if (previousId && previousId !== publicId) posthog.reset();
  if (publicId && identity !== publicId) posthog.identify(publicId);
  identity = publicId;
  notifyActivity();
}

export function captureProductEvent(event: string, properties: Properties = {}): void {
  if (!analyticsActive()) return;
  try { posthog.capture(event, { ...properties, channel: "web", environment: "production" }); }
  catch { console.warn("[Analytics] Event capture unavailable"); }
}

export function captureProductException(error: Error): void {
  if (!analyticsActive()) return;
  try { posthog.captureException(error); }
  catch { console.warn("[Analytics] Exception capture unavailable"); }
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
  if (enabled && analyticsActive() && getAnalyticsConsent().recordings) posthog.startSessionRecording();
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
