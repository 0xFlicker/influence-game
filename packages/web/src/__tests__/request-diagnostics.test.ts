import { expect, test } from "bun:test";
import { FAILURE_HEADER, REQUEST_ID_HEADER } from "@influence/engine/operational-errors";
import { requestFailure } from "../lib/request-diagnostics";
import { diagnosticEndpoint } from "../lib/diagnostic-endpoint";

test("request failures preserve distinct generation endpoints and evidence of the failing layer", () => {
  const request_id = "01234567-89ab-cdef-0123-456789abcdef";
  expect(diagnosticEndpoint("/api/agent-profiles/anonymous?private=secret")).toBe("/api/agent-profiles/anonymous");
  expect(diagnosticEndpoint("/api/agent-profiles/generate")).toBe("/api/agent-profiles/generate");
  expect(diagnosticEndpoint("/api/agent-profiles/private-agent-name/fail")).toBe("/api/agent-profiles/:operation");

  expect(requestFailure("http", new Response("provider body", { status: 502, headers: { [REQUEST_ID_HEADER]: request_id, [FAILURE_HEADER]: "upstream_output" } })))
    .toMatchObject({ request_id, error_origin: "upstream", error_code: "upstream_output", status: 502 });
  expect(requestFailure("http", new Response(null, { status: 502, headers: { [REQUEST_ID_HEADER]: request_id, [FAILURE_HEADER]: "app_error" } })))
    .toMatchObject({ request_id, error_origin: "app", error_code: "app_error", status: 502 });
  expect(requestFailure("http", new Response(null, { status: 403, headers: { "CF-Mitigated": "challenge", "CF-Ray": "0123456789abcdef-SJC" } })))
    .toMatchObject({ edge_request_id: "0123456789abcdef-SJC", error_origin: "proxy", error_code: "edge_challenge" });
  const unmarked = requestFailure("http", new Response("untrusted output", { status: 502, headers: { Server: "cloudflare", [REQUEST_ID_HEADER]: "secret", [FAILURE_HEADER]: "secret" } }));
  expect(unmarked).toMatchObject({ error_origin: "unattributed", error_code: "unattributed_gateway_response", status: 502 });
  expect(JSON.stringify(unmarked)).not.toMatch(/secret|untrusted/);
  expect(requestFailure("transport")).toMatchObject({ status: 0, error_code: "request_transport_failed" });
  expect(requestFailure("decode", new Response("junk", { status: 200 }))).toMatchObject({ status: 200, error_code: "api_decode_failed" });
});
