import { randomUUID } from "node:crypto";
import { type Context, type MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { GenerationOutputError } from "../services/generation-output-error.js";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { FAILURE_HEADER, REQUEST_ID_HEADER, edgeRequestId, failureDetails, operationalError, safeMethod, type ApiFailureCode } from "@influence/engine/operational-errors";

const failures = new WeakMap<Context, { code: ApiFailureCode; error: unknown }>();

export function markApiFailure(c: Context, code: ApiFailureCode, error?: unknown): void {
  failures.set(c, { code, error });
  c.header(FAILURE_HEADER, code);
}

export function generationFailure(c: Context, error: unknown): void {
  if (error instanceof APIConnectionTimeoutError) markApiFailure(c, "upstream_timeout", error);
  else if (error instanceof APIConnectionError) markApiFailure(c, "upstream_transport", error);
  else if (error instanceof APIError) markApiFailure(c, "upstream_rejected", error);
  else if (error instanceof GenerationOutputError) markApiFailure(c, "upstream_output", error.cause);
  else markApiFailure(c, "app_error", error);
}

export const requestDiagnostics: MiddlewareHandler = async (c, next) => {
  const requestId = randomUUID();
  await next();
  c.header(REQUEST_ID_HEADER, requestId);
  if (c.res.status < 500) return;
  const failure = failures.get(c);
  const code = failure?.code ?? (c.res.status === 503 ? "app_unavailable" : "app_error");
  c.header(FAILURE_HEADER, code);
  const route = routePath(c, -1);
  console.error("[request-error]", operationalError(process.env.INFLUENCE_API_ROLE === "game-worker" ? "game-worker-api" : "api",
    code, failureDetails[code][1], failure?.error ?? c.error, {
      request_id: requestId, edge_request_id: edgeRequestId(c.req.header("CF-Ray")),
      route: route && !route.includes("*") ? route : "unmatched", method: safeMethod(c.req.method), status: c.res.status,
    }));
};
