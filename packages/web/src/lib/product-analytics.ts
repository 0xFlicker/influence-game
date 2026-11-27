"use client";

import { sanitizeAnalyticsProperties } from "./analytics-privacy";
import {
  campaignAttributionProperties,
  campaignTouchProperties,
  getStoredCampaignAttribution,
  retainCampaignTouch,
} from "./campaign-attribution";
import { browserDiagnostic, diagnosticSdkContext, sdkExceptionFrames, type ErrorSource } from "./analytics-errors";
import { uuid } from "@influence/engine/operational-errors";
import { getAnalyticsConsent, subscribeAnalyticsConsent } from "./analytics-consent";
import type { PostHog, PostHogConfig } from "posthog-js";
let posthog: PostHog;
let retryOnNamedInstance = false;
let initializing: Promise<boolean> | null = null;

type Properties = Record<string, string | number | boolean | null | Record<string, string>>;
let initialized = false;
let excluded = true;
let allowedRevision: number | undefined;
let identity: string | null = null;
const activityListeners = new Set<() => void>();
export function analyticsExcludedPath(pathname: string) {
  return /^\/(admin|auth|oauth|discord|sign-in|sign-up|callback|embed)(\/|$)/.test(pathname);
}

export function analyticsActive() {
  const consent = getAnalyticsConsent();
  return initialized && !excluded && consent.analytics && consent.choiceRevision === allowedRevision &&
    (typeof location === "undefined" || !analyticsExcludedPath(location.pathname));
}

/** Use the SDK's current browser session under the same gate as pageviews. */
export function getConversionSessionId(): string | undefined {
  if (!analyticsActive()) return undefined;
  try {
    return uuid(posthog.get_session_id());
  } catch {
    warnOnce("sdk_session_id_failed");
    return undefined;
  }
}

let sendingException: ReturnType<typeof browserDiagnostic> | undefined;
let sendingRequest: Properties | undefined;
const reported = new WeakSet<object>();
const operationalWarnings = new Set<string>();
function warnOnce(code: string) {
  if (operationalWarnings.has(code)) return;
  operationalWarnings.add(code);
  console.warn("[Analytics]", code);
}

function sdkOperation(code: string, work: () => void): boolean {
  try { work(); return true; }
  catch { warnOnce(code); return false; }
}
export function subscribeAnalyticsActivity(listener: () => void) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}
function notifyActivity() {
  activityListeners.forEach(listener => sdkOperation("activity_listener_failed", listener));
}
export function suspendAnalytics() {
  excluded = true;
  identity = null;
  if (initialized) {
    // Route/staff exclusions are tab-local. Only a privacy preference may write
    // the SDK's shared opt-out marker and clear its persistence.
    if (!getAnalyticsConsent().analytics) sdkOperation("sdk_opt_out_failed", () => posthog.opt_out_capturing());
    sdkOperation("recording_stop_failed", () => posthog.stopSessionRecording());
  }
  notifyActivity();
}

/** Deletion must not attribute subsequent anonymous browsing to the old account. */
export function clearDeletedAccountAnalytics() {
  suspendAnalytics();
  if (initialized) sdkOperation("sdk_reset_failed", () => posthog.reset());
}

// Stop immediately on local or cross-tab rejection, before React's next effect.
subscribeAnalyticsConsent(() => {
  if (!getAnalyticsConsent().analytics) suspendAnalytics();
  else if (!getAnalyticsConsent().recordings && initialized) recordBrowserSession(false);
});

export async function initializeAnalytics(key: string, host: string): Promise<boolean> {
  const projectToken = key.trim();
  if (!projectToken || !getAnalyticsConsent().analytics) return false;
  if (initialized) return true;
  if (initializing) return initializing;
  initializing = import("posthog-js").then(module => {
    if (!getAnalyticsConsent().analytics) return false;
    const sdk = module.default;
    const config: Partial<PostHogConfig> = {
      api_host: host,
      ui_host: "https://us.posthog.com",
      defaults: "2026-05-30",
      autocapture: false,
      on_request_error: () => warnOnce("sdk_delivery_failed"),
      capture_pageview: false,
      // SPA pageviews already carry previous-page duration; capture the final
      // page on browser exit through the SDK's pagehide/beacon handling.
      capture_pageleave: true,
      // Next's early browser entry point captures with House-controlled data.
      capture_exceptions: false,
      // Leave capture_performance unset so Web Vitals follows project settings.
      disable_surveys: true,
      respect_dnt: true,
      opt_out_persistence_by_default: true,
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
        if (!event || !analyticsActive()) return null;
        if (event.event === "$exception") {
          const diagnostic = sendingException;
          if (!diagnostic) return null;
          const sdkFrames = sdkExceptionFrames(event.properties.$exception_list);
          const frames = diagnostic.frames.map(original => {
            const match = sdkFrames.find(candidate => candidate.filename === original.filename &&
              candidate.lineno === original.lineno && candidate.colno === original.colno);
            return match ?? original;
          });
          const releaseId = uuid(event.properties.$release_id);
          return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties: {
            ...diagnosticSdkContext(event.properties), ...diagnostic.properties, token: projectToken,
            channel: "web", environment: "production",
            ...(releaseId ? { $release_id: releaseId } : {}),
            $exception_level: "error",
            ...(!frames.length ? { $exception_fingerprint: [diagnostic.properties.error_code,
              diagnostic.properties.diagnostic_route, diagnostic.properties.error_source,
              diagnostic.properties.error_digest ?? diagnostic.type].join(":") } : {}),
            $exception_list: [{
              type: diagnostic.type, value: diagnostic.summary,
              mechanism: { type: "generic", handled: !["window_error", "unhandled_rejection"].includes(diagnostic.properties.error_source) },
              stacktrace: { type: "raw", frames },
            }],
          } };
        }
        if (event.event === "api_request_failed") {
          if (!sendingRequest) return null;
          return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties: {
            ...diagnosticSdkContext(event.properties), ...sendingRequest, token: projectToken, channel: "web", environment: "production",
          } };
        }
        // SDK-generated events must use the same dashboard filters as ours.
        event.properties.channel = "web";
        event.properties.environment = "production";
        // SDK defaults can contain full URLs; never send query strings, fragments,
        // OAuth codes, private editor text or request bodies.
        sanitizeAnalyticsProperties(event.properties);
        return event;
      },
    };
    if (retryOnNamedInstance) {
      // The SDK marks a primary instance loaded before initialization finishes.
      // A failed primary init cannot be retried on that same instance.
      posthog = sdk.init(projectToken, config, "houseAnalyticsRecovery");
    } else {
      try {
        sdk.init(projectToken, config);
        posthog = sdk;
      } catch (error) {
        retryOnNamedInstance = true;
        throw error;
      }
    }
    initialized = true;
    return true;
  }).catch(() => { warnOnce("sdk_initialization_failed"); return false; }).finally(() => { initializing = null; });
  return initializing;
}

export function setAnalyticsIdentity(publicId: string | null, internal: boolean): boolean {
  if (!initialized || internal || !getAnalyticsConsent().analytics) { suspendAnalytics(); return false; }
  const ready = sdkOperation("sdk_identity_failed", () => {
    if (getAnalyticsConsent().choice?.analytics === true) {
      posthog.opt_in_capturing({ captureEventName: false });
    } else {
      posthog.clear_opt_in_out_capturing();
    }
    const previousId = identity ?? posthog.get_property("$user_id");
    if (previousId && previousId !== publicId) posthog.reset();
    // Opt-in/out and resets run behind the gate. Identify needs capture active
    // to preserve first-touch attribution and anonymous-to-account stitching.
    allowedRevision = getAnalyticsConsent().choiceRevision;
    excluded = false;
    if (publicId && identity !== publicId) {
      const firstTouch = campaignTouchProperties(getStoredCampaignAttribution().firstTouch, "initial_");
      posthog.identify(publicId, undefined, firstTouch);
    }
    identity = publicId;
  });
  if (ready) notifyActivity();
  else suspendAnalytics();
  return ready;
}

export function captureProductEvent(event: string, properties: Properties = {}, timestamp?: Date): void {
  if (!analyticsActive()) return;
  try {
    posthog.capture(event, {
      ...campaignAttributionProperties(),
      ...properties,
      channel: "web",
      environment: "production",
    }, timestamp ? { timestamp } : undefined);
  } catch { console.warn("[Analytics] Event capture unavailable"); }
}

export function captureProductException(
  error: unknown, source: ErrorSource = "route_boundary",
  locationHint?: { filename: string; lineno: number; colno: number },
): void {
  if (!analyticsActive() || sendingException) return;
  if (error && typeof error === "object" && reported.has(error)) return;
  sdkOperation("exception_capture_failed", () => {
    const diagnostic = browserDiagnostic(error, source, globalThis.location?.pathname ?? "/", locationHint);
    const safe = new Error(diagnostic.summary);
    safe.name = diagnostic.type;
    // Reparse the sanitized coordinates with the installed SDK so native
    // debug IDs can be associated with the exact compiled filenames.
    safe.stack = [`${safe.name}: ${safe.message}`,
      ...[...diagnostic.frames].reverse().map(frame => `    at ${frame.filename}:${frame.lineno}:${frame.colno}`)].join("\n");
    sendingException = diagnostic;
    try {
      posthog.captureException(safe);
      if (error && typeof error === "object") reported.add(error);
    } finally { sendingException = undefined; }
  });
}

export function markReportedRequest(error: unknown): void {
  if (error && typeof error === "object") reported.add(error);
}

export function captureRequestFailure(properties: Properties): void {
  if (!analyticsActive() || sendingRequest) return;
  sdkOperation("request_capture_failed", () => {
    sendingRequest = properties;
    try { posthog.capture("api_request_failed", properties); }
    finally { sendingRequest = undefined; }
  });
}

export function capturePage(pathname: string): void {
  const params = new URLSearchParams(location.search);
  // Consent-gated first-party retention: no pre-consent queue or backfill.
  // Server conversions remain authoritative; this only attributes interaction.
  if (analyticsActive()) retainCampaignTouch(location.search);
  const stored = getStoredCampaignAttribution();
  const firstTouchOnce = campaignTouchProperties(stored.firstTouch, "initial_");
  captureProductEvent("$pageview", {
    $current_url: `${location.origin}${pathname}`,
    ...(Object.keys(firstTouchOnce).length ? { $set_once: firstTouchOnce } : {}),
  });
  if (pathname === "/agents/create") captureProductEvent("agent_creation_opened", {
    flow: ["manage", "join_game", "daily_free"].includes(params.get("flow") ?? "") ? params.get("flow")! : "manage",
  });
}

export function recordBrowserSession(enabled: boolean): void {
  if (!initialized) return;
  if (enabled && analyticsActive() && getAnalyticsConsent().recordings) sdkOperation("recording_start_failed", () => posthog.startSessionRecording());
  else sdkOperation("recording_stop_failed", () => posthog.stopSessionRecording());
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

export async function measureProductRequest<T>(operation: string | null, request: (attemptId?: string) => Promise<T>, endpoint?: string): Promise<T> {
  if (!operation) return request();
  let attemptId: string | undefined;
  try { attemptId = globalThis.crypto?.randomUUID?.(); }
  catch { warnOnce("attempt_id_unavailable"); }
  const started = performance.now();
  const attempt: Properties = {
    ...(attemptId ? { attempt_id: attemptId } : {}),
    ...(endpoint ? { api_endpoint: endpoint } : {}),
  };
  captureProductEvent(`${operation}_requested`, attempt);
  try {
    const result = await request(attemptId);
    captureProductEvent(`${operation}_succeeded`, { ...attempt, duration_ms: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    let status = 0;
    try {
      if (error && typeof error === "object" && "status" in error && typeof error.status === "number") status = error.status;
    } catch { /* Preserve the original request failure. */ }
    captureProductEvent(`${operation}_failed`, { ...attempt, duration_ms: Math.round(performance.now() - started), status });
    throw error;
  }
}
