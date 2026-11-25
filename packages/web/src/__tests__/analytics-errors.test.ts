import { expect, test } from "bun:test";
import { scrubExceptionProperties } from "../lib/analytics-errors";

const chunkId = "01234567-89ab-cdef-0123-456789abcdef";
test("exception scrubbing retains symbolication and the opted-in message without attachments", () => {
  const properties: Record<string, unknown> = {
    $release_id: chunkId,
    $exception_message: "Bearer secret",
    $exception_values: ["email@example.com"],
    $exception_fingerprint: "private prompt",
    $exception_steps: [{ message: "wallet", token: "secret" }],
    $exception_list: [{
      type: "TypeError", value: "Cannot load replay for email@example.com", module: "secret",
      mechanism: { handled: false, synthetic: false, exception_id: 0, source: "secret" },
      stacktrace: { type: "raw", frames: [{
        filename: "https://user:password@thehouse.game/_next/static/chunks/abc.js?token=secret#secret",
        function: "private prompt", vars: { secret: true }, context_line: "private prompt",
        lineno: 12, colno: 34, chunk_id: chunkId,
      }, { filename: "https://elsewhere.example/secret.js" }, { filename: "https://thehouse.game/users/private-prompt" }] },
    }],
  };
  scrubExceptionProperties(properties, true);
  expect(properties).toEqual({
    $release_id: chunkId, $exception_level: "error",
    $exception_list: [{
      type: "TypeError", value: "Cannot load replay for [redacted]",
      mechanism: { type: "generic", handled: false, synthetic: false, exception_id: 0 },
      stacktrace: { type: "raw", frames: [{
        platform: "web:javascript", filename: "https://thehouse.game/_next/static/chunks/abc.js",
        in_app: true, lineno: 12, colno: 34, chunk_id: chunkId,
      }] },
    }],
  });
});

test("exception messages retain diagnostic details around sensitive fields", () => {
  const messages = [
    ["Frozen room image is missing: https://user:password@assets.example/room.png?signature=secret#secret", "Frozen room image is missing: https://assets.example/room.png"],
    ["Request failed at /auth/callback?code=secret (401)", "Request failed at /auth/callback (401)"],
    ['Auth failed (401): Authorization: Bearer secret, client_secret="secret", OAuth code=secret', 'Auth failed (401): Authorization: [redacted], client_secret=[redacted], OAuth code=[redacted]'],
    ['Generation failed: prompt="private strategy" (HTTP 422)', 'Generation failed: prompt=[redacted] (HTTP 422)'],
    ['Unsupported visual presentation: {"text":"private dialogue"}', 'Unsupported visual presentation: [redacted]'],
    [`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, `Unexpected token '<', [redacted] is not valid JSON`],
  ];
  const properties = { $exception_list: messages.map(([value]) => ({ type: "ApiError", value })) };
  scrubExceptionProperties(properties, true);
  expect(properties.$exception_list.map(({ value }) => value)).toEqual(messages.map(([, expected]) => expected));
  expect(properties.$exception_list[0]?.type).toBe("ApiError");
});

test("malformed exception fields cannot leak or crash the scrubber", () => {
  for (const value of [null, "secret", { type: "secret", value: { secret: true }, stacktrace: { frames: [null, { filename: "data:secret" }, { filename: "/secret" }] } }]) {
    const properties: Record<string, unknown> = { $exception_list: [value], $release_id: "secret" };
    scrubExceptionProperties(properties, true);
    expect(JSON.stringify(properties)).not.toContain("secret");
    expect(properties.$release_id).toBeUndefined();
  }
});
