import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("early browser listeners and real apiFetch report only while permitted", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { strict as assert } from "node:assert";
    import { Window } from "happy-dom";
    const dom = new Window({ url: "https://thehouse.game/season-1/create?secret=PRIVATE" });
    for (const key of ["window", "document", "navigator", "location", "localStorage", "ErrorEvent", "HTMLScriptElement", "CustomEvent"]) {
      Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
    }
    const transmitted = [];
    let config;
    mock.module("posthog-js", () => ({ default: {
      init: (_key, options) => { config = options; },
      capture: (event, properties) => {
        const clean = config.before_send({ event, properties: {...properties, cookie: "PRIVATE" }});
        if (clean) transmitted.push(clean);
      },
      captureException: error => {
        const clean = config.before_send({ event: "$exception", properties: {
          $exception_list: [{type: error.name, value: error.message}],
          $release_id: "01234567-89ab-cdef-0123-456789abcdef",
          $current_url: location.href,
        }});
        if (clean) transmitted.push(clean);
      },
      clear_opt_in_out_capturing: () => {}, get_property: () => null,
      stopSessionRecording: () => {}, opt_out_capturing: () => {},
    }}));
    const requests = [];
    globalThis.fetch = async (url, init) => {
      if (url === "/analytics-region") return Response.json({ country: "US" });
      requests.push({ url, init });
      const headers = url.endsWith("/anonymous")
        ? {"X-House-Request-Id": "01234567-89ab-cdef-0123-456789abcdef", "X-House-Failure": "upstream_output"}
        : {"CF-Ray": "0123456789abcdef-SJC"};
      return Response.json({ error: "PRIVATE provider body", token: "PRIVATE" }, { status: 502, headers });
    };
    const consent = await import("./src/lib/analytics-consent");
    await import("./src/instrumentation-client");
    const analytics = await import("./src/lib/product-analytics");
    const emit = () => dom.dispatchEvent(new dom.ErrorEvent("error", {
      message: "PRIVATE", filename: "/_next/static/chunks/0123456789abcdef.js", lineno: 12, colno: 20,
    }));
    emit();
    await consent.loadAnalyticsConsent();
    await analytics.initializeAnalytics("public-project-key", "https://invalid.example");
    analytics.setAnalyticsIdentity(null, false);
    assert.equal(transmitted.length, 0);
    emit();
    const rejection = new dom.Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: { message: "PRIVATE" } });
    dom.dispatchEvent(rejection);
    const { apiFetch } = await import("./src/lib/api");
    await assert.rejects(apiFetch("/api/agent-profiles/anonymous", { method: "POST", body: "PRIVATE" }));
    await assert.rejects(apiFetch("/api/agent-profiles/generate", { method: "POST", body: "PRIVATE" }));
    assert.equal(transmitted[0].properties.$exception_list[0].stacktrace.frames[0].lineno, 12);
    assert.equal(transmitted[0].properties.$release_id, "01234567-89ab-cdef-0123-456789abcdef");
    assert.equal(transmitted[1].properties.error_code, "unhandled_rejection");
    const failures = transmitted.filter(event => event.event === "api_request_failed").map(event => event.properties);
    assert.deepEqual(failures.map(event => [event.api_endpoint, event.error_origin]), [
      ["/api/agent-profiles/anonymous", "upstream"], ["/api/agent-profiles/generate", "unattributed"],
    ]);
    assert.equal(failures[0].request_id, "01234567-89ab-cdef-0123-456789abcdef");
    assert.equal(failures[1].edge_request_id, "0123456789abcdef-SJC");
    const funnel = transmitted.filter(event => event.event === "agent_generation_requested").map(event => event.properties);
    assert.equal(failures[0].attempt_id, funnel[0].attempt_id);
    assert.deepEqual(funnel.map(event => event.api_endpoint), ["/api/agent-profiles/anonymous", "/api/agent-profiles/generate"]);
    assert.ok(requests[0].init.headers["Idempotency-Key"]);
    assert.ok(!requests[0].init.headers["X-House-Request-Id"]);
    assert.ok(!JSON.stringify(transmitted.filter(event => event.event === "$exception" || event.event === "api_request_failed")).includes("PRIVATE"));
    const before = transmitted.length;
    consent.saveAnalyticsChoice({ analytics: false, advertising: true });
    emit();
    await assert.rejects(apiFetch("/api/agent-profiles/anonymous", { method: "POST", body: "PRIVATE" }));
    assert.equal(transmitted.length, before);
    assert.equal(requests.length, 3);
  `], { cwd: resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, NEXT_PUBLIC_GIT_SHA: "a".repeat(40) } });
  expect({ exit: result.exitCode, stderr: result.stderr.toString() }).toEqual({ exit: 0, stderr: "" });
});
