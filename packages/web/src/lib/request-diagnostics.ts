import { FAILURE_HEADER, REQUEST_ID_HEADER, edgeRequestId, failureDetails, releaseSha, safeErrorField, safeMethod, uuid, type ApiFailureCode } from "@influence/engine/operational-errors";
import { browserDiagnostic } from "./analytics-errors";
import { analyticsActive, captureRequestFailure, markReportedRequest } from "./product-analytics";

import { diagnosticEndpoint } from "./diagnostic-endpoint";

type RequestStage = "setup" | "transport" | "timeout" | "http" | "decode";

export function requestFailure(stage: RequestStage, response?: Response) {
  const status = response?.status ?? 0;
  const marker = response?.headers.get(FAILURE_HEADER);
  const requestId = uuid(response?.headers.get(REQUEST_ID_HEADER));
  const edgeId = edgeRequestId(response?.headers.get("CF-Ray"));
  const ids = { ...(requestId ? { request_id: requestId } : {}), ...(edgeId ? { edge_request_id: edgeId } : {}) };
  if (stage === "http" && marker && (requestId || marker === "app_unavailable" || marker === "app_error") && Object.hasOwn(failureDetails, marker)) {
    const [error_origin, error_summary] = failureDetails[marker as ApiFailureCode];
    return { ...ids, status, error_origin, error_code: marker, error_summary };
  }
  if (stage === "http" && response?.headers.get("CF-Mitigated") === "challenge") {
    return { ...ids, status, error_origin: "proxy", error_code: "edge_challenge", error_summary: "The edge proxy challenged the request." };
  }
  if (stage === "http" && !requestId && [502, 503, 504].includes(status)) {
    return { ...ids, status, error_origin: "unattributed", error_code: "unattributed_gateway_response",
      error_summary: "A gateway-status response arrived without application diagnostics." };
  }
  const [error_code, error_summary] = {
    setup: ["request_setup_failed", "The browser could not prepare the API request."],
    transport: ["request_transport_failed", "The browser did not receive an API response."],
    timeout: ["request_timed_out", "The browser waited too long for the API response."],
    http: ["api_http_error", "The request returned an HTTP error."],
    decode: ["api_decode_failed", "The browser could not decode the API response."],
  }[stage];
  return { ...ids, status, error_origin: stage === "http" ? (requestId ? "app" : "unattributed") : "browser", error_code, error_summary };
}

export type RequestObservation = { stage: RequestStage; response?: Response };

export async function observeApiRequest<T>(
  path: string, options: RequestInit | undefined, attemptId: string | undefined,
  run: (observation: RequestObservation) => Promise<T>,
): Promise<T> {
  const observation: RequestObservation = { stage: "setup" };
  const started = performance.now();
  try {
    return await run(observation);
  } catch (error) {
    const errorName = safeErrorField(error, "name");
    const timedOut = errorName === "TimeoutError" || safeErrorField(options?.signal?.reason, "name") === "TimeoutError";
    const aborted = options?.signal?.aborted || errorName === "AbortError";
    if (analyticsActive() && typeof location !== "undefined" && (!aborted || timedOut)) {
      try {
        const { frames, properties } = browserDiagnostic(error, "route_boundary", location.pathname);
        captureRequestFailure({
          error_source: "api_request", ...requestFailure(timedOut ? "timeout" : observation.stage, observation.response),
          diagnostic_route: properties.diagnostic_route, release_sha: releaseSha(process.env.NEXT_PUBLIC_GIT_SHA) ?? "unknown",
          api_endpoint: diagnosticEndpoint(path), method: safeMethod(options?.method ?? "GET"),
          duration_ms: Math.round(performance.now() - started),
          ...(attemptId ? { attempt_id: attemptId } : {}),
          ...(frames.length ? { stack_frames: JSON.stringify(frames) } : { no_frames_reason: properties.no_frames_reason ?? "stack_unavailable" }),
        });
        markReportedRequest(error);
      } catch { console.warn("[Analytics] request_diagnostics_failed"); }
    }
    throw error;
  }
}

/** Observe browser requests that need their own credential and response semantics. */
export function observeApiResponse<T>(
  path: string, options: RequestInit, request: () => Promise<Response>, decode: (response: Response) => Promise<T>,
): Promise<T> {
  return observeApiRequest(path, options, undefined, async observation => {
    observation.stage = "transport";
    const response = observation.response = await request();
    observation.stage = response.ok ? "decode" : "http";
    return decode(response);
  });
}
