import { expect, test } from "bun:test";
import { browserDiagnostic, sdkExceptionFrames } from "../lib/analytics-errors";

const host = "https://thehouse.game";
const chunkId = "01234567-89ab-cdef-0123-456789abcdef";

test("V8 and mobile browser frames retain only usable first-party coordinates", () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'private content')");
  error.stack = [
    "TypeError: private agent prompt",
    "privateFunction@/_next/static/chunks/0123456789abcdef.js?token=secret:12:34",
    "    at name (https://thehouse.game/_next/static/chunks/fedcba9876543210.js#secret:4:8)",
    "    at chrome-extension://private-extension/00000000abcdef00.js:1:1",
    "    at https://thehouse.game/players/private-name:1:1",
    "    at https://untrusted.example/_next/static/chunks/evil.js:1:1",
    "    at https://thehouse.game/_next/static/chunks/../not-a-frame.js:1:1",
  ].join("\n");
  const diagnostic = browserDiagnostic(error, "window_error", "/season-1/create");
  expect(diagnostic.type).toBe("TypeError");
  expect(diagnostic.properties).toMatchObject({ error_source: "window_error", error_code: "nullish_property_access", diagnostic_route: "/season-:number/create" });
  expect(diagnostic.properties.no_frames_reason).toBeUndefined();
  expect(diagnostic.frames).toEqual([
    { filename: host + "/_next/static/chunks/fedcba9876543210.js", lineno: 4, colno: 8, in_app: true, platform: "web:javascript" },
    { filename: host + "/_next/static/chunks/0123456789abcdef.js", lineno: 12, colno: 34, in_app: true, platform: "web:javascript" },
  ]);
  expect(JSON.stringify(diagnostic)).not.toMatch(/private|secret|evil/);
});

test("a browser event location survives when the browser supplies no Error stack", () => {
  const result = browserDiagnostic("Script error.", "window_error", "/", { filename: "./_next/static/chunks/00000000abcdef00.js", lineno: 2, colno: 90 });
  expect(result.frames[0]).toMatchObject({ filename: host + "/_next/static/chunks/00000000abcdef00.js", lineno: 2, colno: 90 });
  expect(result.properties.error_code).toBe("opaque_script_error");
  expect(result.properties.no_frames_reason).toBeUndefined();
});

test("controlled descriptions distinguish frameless errors and never reuse the supplied text", () => {
  const denied = new Proxy({}, { get() { throw new Error("secret"); } });
  const missing = browserDiagnostic(denied, "unhandled_rejection", "/profile/private-account");
  expect(missing.properties).toMatchObject({
    diagnostic_route: "/profile/:page", error_code: "unhandled_rejection", no_frames_reason: "stack_unavailable",
  });
  const foreign = browserDiagnostic({ stack: "f@safari-extension://private/content.js:2:4" }, "window_error", "/");
  expect(foreign.properties.no_frames_reason).toBe("no_first_party_coordinates");
  const server = browserDiagnostic({ digest: "12345", stack: "f@/_next/static/chunks/private.js:1:1" }, "route_boundary", "/");
  expect(server.properties).toMatchObject({ error_digest: "12345", error_code: "server_render", no_frames_reason: "server_render" });
  expect(server.frames).toEqual([]);
  expect(JSON.stringify([missing, foreign, server])).not.toMatch(/private|secret/);
});

test("only coordinates and valid native debug IDs survive SDK frame enrichment", () => {
  expect(sdkExceptionFrames([{ stacktrace: { frames: [
    { filename: "/_next/static/chunks/00000000abcdef00.js?key=secret", lineno: 1, colno: 4, chunk_id: chunkId,
      function: "private description", context_line: "private code", vars: { secret: true } },
    { filename: "https://thehouse.game/path/00000000abcdef00.js", lineno: 1, colno: 4, chunk_id: chunkId },
  ] } }])).toEqual([{
    filename: host + "/_next/static/chunks/00000000abcdef00.js", lineno: 1, colno: 4, chunk_id: chunkId,
    in_app: true, platform: "web:javascript",
  }]);
});
