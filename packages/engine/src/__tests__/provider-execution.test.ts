import { describe, expect, it } from "bun:test";
import { APIUserAbortError } from "openai";
import {
  ProviderAttemptError,
  ProviderExecutionCoordinator,
  classifyResponsesTerminalOutcome,
  createProviderEvidenceFetch,
  sanitizeProviderEvidence,
  type ProviderAttemptRecord,
  type ProviderLogicalCallCoordinate,
} from "../provider-execution";
import { Phase } from "../types";

const coordinate: ProviderLogicalCallCoordinate = {
  gameId: "game-1",
  actor: { id: "atlas-id", name: "Atlas", role: "player" },
  action: "vote",
  round: 2,
  phase: Phase.VOTE,
  logicalCallOrdinal: 1,
};

describe("ProviderExecutionCoordinator", () => {
  it("records one visible ordinal per dispatch and owns bounded retries", async () => {
    const records: ProviderAttemptRecord[] = [];
    const waits: number[] = [];
    let dispatches = 0;
    const coordinator = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    const call = coordinator.startCall(coordinate);

    const value = await call.execute({
      preparedRequest: {
        requestShape: "chat_completions",
        providerProfileId: "openai",
        model: "gpt-test",
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "Vote." }],
        },
      },
      maxAttempts: 2,
      dispatch: async () => {
        dispatches += 1;
        if (dispatches === 1) {
          throw Object.assign(new Error("temporarily unavailable"), {
            status: 503,
          });
        }
        return { choices: [{ message: { content: "ok" } }] };
      },
      validate: (response) => ({
        status: "usable",
        value: response.choices[0]!.message.content,
      }),
    });

    expect(value).toBe("ok");
    expect(dispatches).toBe(2);
    expect(waits).toEqual([1_000]);
    expect(records.map((record) => record.attemptOrdinal)).toEqual([1, 2]);
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "service_error",
      "usable",
    ]);
  });

  it.each([
    ["authentication", Object.assign(new Error("bad key"), { status: 401 })],
    ["rate_limit", Object.assign(new Error("slow down"), { status: 429 })],
    [
      "service_error",
      Object.assign(new Error("provider down"), { status: 500 }),
    ],
    [
      "transport_timeout",
      Object.assign(new Error("timed out"), { name: "APITimeoutError" }),
    ],
  ] as const)("keeps %s distinct", async (expectedKind, error) => {
    const records: ProviderAttemptRecord[] = [];
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          requestShape: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 1,
        dispatch: async () => {
          throw error;
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(records[0]?.outcome.kind).toBe(expectedKind);
  });

  it.each([
    ["empty_output", "empty_output"],
    ["malformed_output", "malformed_output"],
    ["wrong_tool", "wrong_tool"],
    ["undecodable_structured_output", "undecodable_structured_output"],
  ] as const)(
    "retains raw successful responses classified as %s",
    async (_label, kind) => {
      const records: ProviderAttemptRecord[] = [];
      const rawResponse = {
        id: "response-1",
        choices: [
          { finish_reason: "stop", message: { content: "not usable" } },
        ],
      };
      const call = new ProviderExecutionCoordinator({
        hooks: {
          onTerminal: (record) => {
            records.push(record);
          },
        },
      }).startCall(coordinate);

      await expect(
        call.execute({
          preparedRequest: {
            requestShape: "chat_completions",
            providerProfileId: "openai",
            model: "gpt-test",
            body: { model: "gpt-test" },
          },
          maxAttempts: 1,
          dispatch: async () => rawResponse,
          validate: () => ({ status: "unusable", kind, message: kind }),
        }),
      ).rejects.toBeInstanceOf(ProviderAttemptError);

      expect(records[0]?.rawResponse?.body).toEqual(rawResponse);
      expect(records[0]?.outcome.kind).toBe(kind);
    },
  );

  it("records refusals without retrying and preserves request/response evidence", async () => {
    const records: ProviderAttemptRecord[] = [];
    let dispatches = 0;
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);
    const error = Object.assign(new Error("invalid prompt"), {
      status: 400,
      code: "invalid_prompt",
      request_id: "req-123",
      headers: {
        "x-request-id": "req-123",
        "content-type": "application/json",
        authorization: "Bearer secret-token",
        "set-cookie": "session=secret",
      },
      error: {
        code: "invalid_prompt",
        message: "invalid prompt",
        api_key: "secret-token",
      },
    });

    await expect(
      call.execute({
        preparedRequest: {
          requestShape: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: {
            model: "gpt-test",
            messages: [{ role: "user", content: "exact rejected prompt" }],
            api_key: "secret-token",
          },
          credentialValues: ["secret-token"],
        },
        maxAttempts: 3,
        dispatch: async () => {
          dispatches += 1;
          throw error;
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(dispatches).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      requestId: "req-123",
      outcome: { kind: "refusal", retryable: false },
      preparedRequest: {
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "exact rejected prompt" }],
        },
      },
      rawResponse: {
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-123",
        },
        body: { code: "invalid_prompt", message: "invalid prompt" },
      },
    });
    expect(JSON.stringify(records[0])).not.toContain("secret-token");
  });

  it("captures the exact sanitized HTTP request and raw response before parsing", async () => {
    const records: ProviderAttemptRecord[] = [];
    let outboundRequest: Request | undefined;
    const evidenceFetch = createProviderEvidenceFetch(
      async (input) => {
        outboundRequest =
          input instanceof Request ? input : new Request(input.toString());
        return new Response(
          '{"error":{"code":"invalid_prompt","message":"blocked"},"echo":"key-value"}',
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "x-request-id": "req-http",
              "set-cookie": "private-cookie",
            },
          },
        );
      },
      ["key-value"],
    );
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          requestShape: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: {
            model: "gpt-test",
            messages: [{ role: "user", content: "exact prompt" }],
          },
          credentialValues: ["key-value"],
        },
        maxAttempts: 1,
        dispatch: async ({ requestOptions }) =>
          evidenceFetch(
            "https://api.openai.test/v1/chat/completions?trace=key-value",
            {
            method: "POST",
            headers: {
              ...requestOptions.headers,
              authorization: "Bearer key-value",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-test",
              messages: [{ role: "user", content: "exact prompt" }],
            }),
            },
          ),
        validate: () => ({
          status: "unusable",
          kind: "refusal",
          message: "blocked",
        }),
      }),
    ).rejects.toBeInstanceOf(ProviderAttemptError);

    expect(outboundRequest?.headers.has("authorization")).toBe(true);
    expect(
      outboundRequest?.headers.has("x-influence-provider-attempt-id"),
    ).toBe(false);
    expect(
      outboundRequest?.headers.has("x-influence-no-flex-transport-retry"),
    ).toBe(false);
    expect(records[0]).toMatchObject({
      requestId: "req-http",
      preparedRequest: {
        url: "https://api.openai.test/v1/chat/completions?trace=%5BREDACTED%5D",
        headers: { "content-type": "application/json" },
        body: {
          model: "gpt-test",
          messages: [{ role: "user", content: "exact prompt" }],
        },
      },
      rawResponse: {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-http",
        },
        body: {
          error: { code: "invalid_prompt", message: "blocked" },
          echo: "[REDACTED]",
        },
      },
    });
  });

  it("treats owner cancellation as terminal while provider timeouts can retry", async () => {
    const controller = new AbortController();
    controller.abort(new Error("owner lost"));
    const records: ProviderAttemptRecord[] = [];
    const call = new ProviderExecutionCoordinator({
      hooks: {
        onTerminal: (record) => {
          records.push(record);
        },
      },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          requestShape: "responses",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 3,
        cancellationSignal: controller.signal,
        dispatch: async () => {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
        validate: (response: unknown) => ({
          status: "usable",
          value: response,
        }),
      }),
    ).rejects.toMatchObject({ outcome: { kind: "cancellation" } });

    expect(records).toHaveLength(1);
  });

  it("classifies the pinned SDK's APIUserAbortError as timeout unless the owner signal aborted", async () => {
    const records: ProviderAttemptRecord[] = [];
    let dispatches = 0;
    const call = new ProviderExecutionCoordinator({
      hooks: { onTerminal: (record) => { records.push(record); } },
      wait: async () => undefined,
    }).startCall(coordinate);

    await expect(
      call.execute({
        preparedRequest: {
          requestShape: "chat_completions",
          providerProfileId: "openai",
          model: "gpt-test",
          body: { model: "gpt-test" },
        },
        maxAttempts: 2,
        dispatch: async () => {
          dispatches += 1;
          throw new APIUserAbortError();
        },
        validate: (response: unknown) => ({ status: "usable", value: response }),
      }),
    ).rejects.toMatchObject({ outcome: { kind: "transport_timeout" } });

    expect(dispatches).toBe(2);
    expect(records.map((record) => record.outcome.kind)).toEqual([
      "transport_timeout",
      "transport_timeout",
    ]);

    const controller = new AbortController();
    controller.abort(new Error("owner lost"));
    const cancelledRecords: ProviderAttemptRecord[] = [];
    await expect(
      new ProviderExecutionCoordinator({
        hooks: { onTerminal: (record) => { cancelledRecords.push(record); } },
      })
        .startCall(coordinate)
        .execute({
          preparedRequest: {
            requestShape: "chat_completions",
            providerProfileId: "openai",
            model: "gpt-test",
            body: { model: "gpt-test" },
          },
          maxAttempts: 2,
          cancellationSignal: controller.signal,
          dispatch: async () => {
            throw new APIUserAbortError();
          },
          validate: (response: unknown) => ({ status: "usable", value: response }),
        }),
    ).rejects.toMatchObject({ outcome: { kind: "cancellation" } });
    expect(cancelledRecords).toHaveLength(1);
  });
});

describe("classifyResponsesTerminalOutcome", () => {
  it.each([
    [
      "refusal",
      {
        status: "failed",
        error: { code: "invalid_prompt", message: "request rejected" },
      },
    ],
    [
      "rate_limit",
      {
        status: "failed",
        error: { code: "rate_limit_exceeded", message: "slow down" },
      },
    ],
    [
      "service_error",
      {
        status: "failed",
        error: { code: "server_error", message: "provider unavailable" },
      },
    ],
    [
      "transport_timeout",
      {
        status: "failed",
        error: { code: "request_timeout", message: "request timed out" },
      },
    ],
    [
      "refusal",
      {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
        output: [{ type: "message", content: [] }],
      },
    ],
    [
      "undecodable_structured_output",
      {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "message", content: [{ type: "output_text", text: "{\"partial\":" }] }],
      },
    ],
  ] as const)("maps terminal Responses payloads to %s", (kind, response) => {
    expect(classifyResponsesTerminalOutcome(response)).toMatchObject({ kind });
  });

  it("accepts completed Responses payloads for action-specific validation", () => {
    expect(
      classifyResponsesTerminalOutcome({ status: "completed", output: [] }),
    ).toBeUndefined();
  });
});

describe("sanitizeProviderEvidence", () => {
  it("removes credential fields and reflected secret values recursively", () => {
    const sanitized = sanitizeProviderEvidence(
      {
        authorization: "Bearer key-value",
        cookie: "sid=abc",
        nested: {
          apiKey: "key-value",
          "x-goog-api-key": "key-value",
          text: "provider reflected key-value",
          safe: "keep me",
        },
      },
      ["key-value"],
    );

    expect(sanitized).toEqual({
      nested: {
        text: "provider reflected [REDACTED]",
        safe: "keep me",
      },
    });
  });
});
