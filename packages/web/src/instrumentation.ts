import type { Instrumentation } from "next";
import { operationalError, safeMethod } from "@influence/engine/operational-errors";
import { diagnosticRoute } from "./lib/analytics-errors";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error("[server-error]", operationalError("web-server", "next_request_failed", "Next.js could not complete the request.", error, {
    route: diagnosticRoute(context.routePath), method: safeMethod(request.method), route_type: context.routeType,
  }));
};
