import { expect, test } from "bun:test";
import { scrubExceptionProperties } from "../lib/analytics-errors";

const chunkId = "01234567-89ab-cdef-0123-456789abcdef";
test("exception scrubbing removes free text and attachments while retaining symbolication", () => {
  const properties: Record<string, unknown> = {
    $release_id: chunkId,
    $exception_message: "Bearer secret",
    $exception_values: ["email@example.com"],
    $exception_fingerprint: "private prompt",
    $exception_steps: [{ message: "wallet", token: "secret" }],
    $exception_list: [{
      type: "TypeError", value: "private prompt email@example.com", module: "secret",
      mechanism: { handled: false, synthetic: false, exception_id: 0, source: "secret" },
      stacktrace: { type: "raw", frames: [{
        filename: "https://user:password@thehouse.game/_next/static/chunks/abc.js?token=secret#secret",
        function: "private prompt", vars: { secret: true }, context_line: "private prompt",
        lineno: 12, colno: 34, chunk_id: chunkId,
      }, { filename: "https://elsewhere.example/secret.js" }, { filename: "https://thehouse.game/users/private-prompt" }] },
    }],
  };
  scrubExceptionProperties(properties);
  expect(properties).toEqual({
    $release_id: chunkId, $exception_level: "error",
    $exception_list: [{
      type: "TypeError", value: "Error details redacted",
      mechanism: { type: "generic", handled: false, synthetic: false, exception_id: 0 },
      stacktrace: { type: "raw", frames: [{
        platform: "web:javascript", filename: "https://thehouse.game/_next/static/chunks/abc.js",
        in_app: true, lineno: 12, colno: 34, chunk_id: chunkId,
      }] },
    }],
  });
});

test("malformed and user-defined error fields cannot leak or crash the scrubber", () => {
  for (const value of [null, "secret", { type: "secret", value: "secret", stacktrace: { frames: [null, { filename: "data:secret" }, { filename: "/secret" }] } }]) {
    const properties: Record<string, unknown> = { $exception_list: [value], $release_id: "secret" };
    scrubExceptionProperties(properties);
    expect(JSON.stringify(properties)).not.toContain("secret");
    expect(properties.$release_id).toBeUndefined();
  }
});
