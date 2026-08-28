import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import type { FlexProcessingObserver } from "@influence/engine";
import {
  createOwnerLearningOpenAIProvider,
  decodeOwnerLearningProviderOutput,
  OwnerLearningAttemptPersistenceError,
  OwnerLearningProviderError,
  recoverOwnerLearningProviderResponse,
} from "../services/owner-learning-provider.js";
import {
  OWNER_LEARNING_INPUT_TOKEN_LIMIT,
} from "../services/owner-learning-evidence.js";
import { estimateOwnerLearningProviderCallTokens } from "../services/owner-learning-provider-context.js";

const observer: FlexProcessingObserver = {
  async onDispatchIntent() {},
  async onTerminalOutcome() {},
};

describe("owner learning provider", () => {
  test("retains response-body read failure classification across durable recovery", () => {
    const recovered = recoverOwnerLearningProviderResponse({
      responseObservedAt: "2026-08-04T03:01:00.000Z",
      responseSha256: `sha256:${"b".repeat(64)}`,
      responseEvidence: {
        status: 429,
        headers: { "retry-after": "1" },
        bodyReadError: {
          name: "Error",
          message: "BODY_READ_FAILURE_SENTINEL",
          stack: "Error: BODY_READ_FAILURE_SENTINEL\n    at provider.test.ts:1:1",
        },
      },
      providerResponseId: null,
    }, { input: "BODY_READ_REQUEST_SENTINEL" }, { attemptedTier: "flex" });

    expect(recovered).toMatchObject({
      kind: "error",
      error: {
        code: "provider_error",
        internalCode: "response_body_read_failed",
        retryable: true,
      },
    });
    expect(JSON.stringify(recovered)).toContain("BODY_READ_FAILURE_SENTINEL");
  });

  test("logs only local OpenAI rejection diagnostics without provider-controlled strings", async () => {
    const diagnostics: unknown[] = [];
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      onProviderError: (diagnostic) => diagnostics.push(diagnostic),
      fetch: async () => new Response(JSON.stringify({
        error: {
          message: "PRIVATE_PROVIDER_MESSAGE_SENTINEL",
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "PRIVATE_PROVIDER_PARAM_SENTINEL",
        },
      }), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-safe-diagnostic",
        },
      }),
      wait: async () => undefined,
    });

    let failure: OwnerLearningProviderError | null = null;
    try {
      await provider.invoke({
        input: { privateEvidence: "PRIVATE_EVIDENCE_SENTINEL" },
        responseSchema: { type: "object" },
        diagnosticContext: { reviewId: "review-1", callOrdinal: 2 },
        observer,
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
      });
    } catch (error) {
      failure = error as OwnerLearningProviderError;
    }
    expect(failure).toMatchObject({ code: "provider_error", retryable: false });
    expect(failure?.cause).toBeInstanceOf(Error);
    expect(JSON.stringify(failure?.capture?.responseEvidence)).toContain(
      "PRIVATE_PROVIDER_MESSAGE_SENTINEL",
    );
    expect(JSON.stringify(failure?.capture?.responseEvidence)).toContain(
      "PRIVATE_PROVIDER_PARAM_SENTINEL",
    );

    expect(diagnostics).toEqual([{
      reviewId: "review-1",
      callOrdinal: 2,
      model: "gpt-5.6-luna",
      requestedTier: "flex",
      status: 400,
    }]);
    const serializedDiagnostics = JSON.stringify(diagnostics);
    expect(serializedDiagnostics).not.toContain("PRIVATE_EVIDENCE_SENTINEL");
    expect(serializedDiagnostics).not.toContain("PRIVATE_PROVIDER_MESSAGE_SENTINEL");
    expect(serializedDiagnostics).not.toContain("PRIVATE_PROVIDER_PARAM_SENTINEL");
    expect(serializedDiagnostics).not.toContain("req-safe-diagnostic");
    expect(serializedDiagnostics).not.toContain("invalid_request_error");
    expect(serializedDiagnostics).not.toContain("invalid_json_schema");
  });

  test("omits provider free text from the default console diagnostic", async () => {
    const logs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => {
      logs.push(values);
    };
    try {
      const provider = createOwnerLearningOpenAIProvider({
        apiKey: "sk-test",
        fetch: async () => new Response(JSON.stringify({
          error: {
            message: "PRIVATE_DEFAULT_LOG_MESSAGE_SENTINEL",
            type: "invalid_request_error",
            code: "invalid_json_schema",
            param: "PRIVATE_DEFAULT_LOG_PARAM_SENTINEL",
          },
        }), {
          status: 400,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req-default-log",
          },
        }),
        wait: async () => undefined,
      });

      await expect(provider.invoke({
        input: { privateEvidence: "PRIVATE_DEFAULT_LOG_EVIDENCE_SENTINEL" },
        responseSchema: { type: "object" },
        diagnosticContext: { reviewId: "review-default-log", callOrdinal: 3 },
        observer,
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
      })).rejects.toMatchObject({ code: "provider_error", retryable: false });
    } finally {
      console.error = originalError;
    }

    expect(logs).toEqual([[
      "[owner-learning] provider request rejected",
      JSON.stringify({
        reviewId: "review-default-log",
        callOrdinal: 3,
        model: "gpt-5.6-luna",
        requestedTier: "flex",
        status: 400,
      }),
    ]]);
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("PRIVATE_DEFAULT_LOG_EVIDENCE_SENTINEL");
    expect(serializedLogs).not.toContain("PRIVATE_DEFAULT_LOG_MESSAGE_SENTINEL");
    expect(serializedLogs).not.toContain("PRIVATE_DEFAULT_LOG_PARAM_SENTINEL");
    expect(serializedLogs).not.toContain("req-default-log");
    expect(serializedLogs).not.toContain("invalid_request_error");
    expect(serializedLogs).not.toContain("invalid_json_schema");
  });

  test("drops structurally safe-shaped private provider identifiers", async () => {
    const diagnostics: unknown[] = [];
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      onProviderError: (diagnostic) => diagnostics.push(diagnostic),
      fetch: async () => new Response(JSON.stringify({
        error: {
          message: "PRIVATE_SAFE_SHAPED_MESSAGE_SENTINEL",
          type: "PRIVATE_SAFE_SHAPED_TYPE_SENTINEL",
          code: "PRIVATE_SAFE_SHAPED_CODE_SENTINEL",
          param: "PRIVATE_SAFE_SHAPED_PARAM_SENTINEL",
        },
      }), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "x-request-id": "PRIVATE_SAFE_SHAPED_REQUEST_ID_SENTINEL",
        },
      }),
      wait: async () => undefined,
    });

    await expect(provider.invoke({
      input: { privateEvidence: "PRIVATE_SAFE_SHAPED_EVIDENCE_SENTINEL" },
      responseSchema: { type: "object" },
      diagnosticContext: { reviewId: "review-safe", callOrdinal: 4 },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    })).rejects.toMatchObject({ code: "provider_error", retryable: false });

    expect(diagnostics).toEqual([{
      reviewId: "review-safe",
      callOrdinal: 4,
      model: "gpt-5.6-luna",
      requestedTier: "flex",
      status: 400,
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_SAFE_SHAPED_");
  });

  test("reports the raw transport envelope before provider error parsing", async () => {
    const observed: unknown[] = [];
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-response-observer-sentinel",
      onProviderError: () => undefined,
      fetch: async () => new Response(JSON.stringify({
        error: { message: "RAW_PROVIDER_ERROR_SENTINEL" },
      }), {
        status: 500,
        headers: { "content-type": "application/json", "x-request-id": "req-observed" },
      }),
      wait: async () => undefined,
    });

    await expect(provider.invoke({
      input: { privateEvidence: "REQUEST_INPUT_SENTINEL" },
      responseSchema: { type: "object" },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
      async onResponseObserved(observation) {
        observed.push(observation);
      },
    })).rejects.toMatchObject({ code: "provider_error", retryable: true });

    expect(observed).toHaveLength(1);
    expect(JSON.stringify(observed[0])).toContain("RAW_PROVIDER_ERROR_SENTINEL");
    expect(observed[0]).toMatchObject({
      responseObservedAt: expect.any(String),
      responseSha256: expect.stringMatching(/^sha256:/),
      providerResponseId: null,
      redactionCredentialValues: ["sk-response-observer-sentinel"],
    });
  });

  test("retains response metadata and the cause chain when the body stream cannot be read", async () => {
    const observed: unknown[] = [];
    const bodyReadFailure = new Error("response stream failed after headers");
    const response = new Response("unused", {
      status: 502,
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-body-read-failure",
      },
    });
    Object.defineProperty(response, "clone", {
      value: () => ({ text: async () => { throw bodyReadFailure; } }),
    });
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-body-read-sentinel",
      fetch: async () => response,
      wait: async () => undefined,
      onProviderError: () => undefined,
    });

    let caught: unknown;
    try {
      await provider.invoke({
        input: { evidence: "BODY_READ_REQUEST_SENTINEL" },
        responseSchema: { type: "object" },
        observer,
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
        async onResponseObserved(observation) {
          observed.push(observation);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OwnerLearningProviderError);
    expect(caught).toMatchObject({
      code: "provider_error",
      retryable: true,
      internalCode: "response_body_read_failed",
      cause: bodyReadFailure,
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      responseObservedAt: expect.any(String),
      responseSha256: expect.stringMatching(/^sha256:/),
      responseEvidence: {
        status: 502,
        headers: expect.objectContaining({ "x-request-id": "req-body-read-failure" }),
        bodyReadError: expect.objectContaining({
          name: "Error",
          message: "response stream failed after headers",
        }),
      },
      providerResponseId: null,
    });
  });

  test("attaches the raw response capture when pre-parse persistence fails", async () => {
    const persistenceFailure = new Error("response staging database unavailable");
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-persistence-capture-sentinel",
      fetch: async () => new Response(JSON.stringify({
        id: "resp-persistence-capture",
        status: "completed",
        output: [],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      wait: async () => undefined,
    });

    let caught: unknown;
    try {
      await provider.invoke({
        input: { privateEvidence: "REQUEST_PERSISTENCE_SENTINEL" },
        responseSchema: { type: "object" },
        observer,
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
        async onResponseObserved() {
          throw persistenceFailure;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OwnerLearningAttemptPersistenceError);
    const persistenceError = caught as OwnerLearningAttemptPersistenceError;
    expect(persistenceError.cause).toBe(persistenceFailure);
    expect(persistenceError.capture).toMatchObject({
      providerResponseId: "resp-persistence-capture",
      responseObservedAt: expect.any(String),
      responseSha256: expect.stringMatching(/^sha256:/),
      redactionCredentialValues: ["sk-persistence-capture-sentinel"],
    });
    expect(JSON.stringify(persistenceError.capture.responseEvidence))
      .toContain("resp-persistence-capture");
  });

  test("captures each raw response before Flex handling and preserves terminal receipt failures", async () => {
    let fetchCount = 0;
    const observations: unknown[] = [];
    const terminalPersistenceFailure = new Error("terminal receipt database unavailable");
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-flex-capture-sentinel",
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(JSON.stringify({ error: { message: "capacity" } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({
          id: "resp-terminal-persistence",
          status: "completed",
          service_tier: "flex",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "{}" }],
          }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      wait: async () => undefined,
    });

    let caught: unknown;
    try {
      await provider.invoke({
        input: { evidence: "FLEX_CAPTURE_SENTINEL" },
        responseSchema: { type: "object" },
        observer: {
          async onDispatchIntent() {},
          async onTerminalOutcome(event) {
            if (event.httpStatus === 200) throw terminalPersistenceFailure;
          },
        },
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
        async onResponseObserved(observation) {
          observations.push(observation);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(observations).toHaveLength(2);
    expect(JSON.stringify(observations[0])).toContain('"status":429');
    expect(JSON.stringify(observations[1])).toContain("resp-terminal-persistence");
    expect(caught).toBeInstanceOf(OwnerLearningAttemptPersistenceError);
    const persistenceError = caught as OwnerLearningAttemptPersistenceError;
    expect(persistenceError.cause).toBe(terminalPersistenceFailure);
    expect(persistenceError.capture.providerResponseId).toBe("resp-terminal-persistence");
    expect(persistenceError.terminalOutcome).toMatchObject({
      transportOrdinal: 2,
      attemptedTier: "flex",
      httpStatus: 200,
    });
  });

  test("pins Luna, low reasoning, no storage, strict output, and the inclusive output ceiling", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      fetch: async (request) => {
        requestBody = await (request as Request).json() as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "resp-test",
          object: "response",
          created_at: 1,
          model: "gpt-5.6-luna",
          status: "completed",
          service_tier: "flex",
          output: [{
            id: "msg-test",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{
              type: "output_text",
              annotations: [],
              text: JSON.stringify({ provisionalThemes: [], selectedMomentHandles: [] }),
            }],
          }],
          usage: {
            input_tokens: 1_000,
            input_tokens_details: { cached_tokens: 200 },
            output_tokens: 500,
            output_tokens_details: { reasoning_tokens: 100 },
            total_tokens: 1_500,
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req-test" },
        });
      },
      wait: async () => undefined,
    });

    const response = await provider.invoke({
      input: { instructions: "Review.", games: [{ gameId: "game-1" }] },
      responseSchema: { type: "object", additionalProperties: false },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    });

    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      service_tier: "flex",
      max_output_tokens: 8_000,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(decodeOwnerLearningProviderOutput(response)).toEqual({
      provisionalThemes: [],
      selectedMomentHandles: [],
    });
    expect(response.effectiveTier).toBe("flex");
    expect(response.tokenReceipt).toEqual({
      inputTokens: 1_000,
      cachedInputTokens: 200,
      totalOutputTokens: 500,
      reasoningTokens: 100,
    });
    expect(response.costReceipt.costSource).toBe("estimated");
  });

  test("maps max-output incompletion to a retryable typed failure with its usage receipt", async () => {
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      fetch: async () => new Response(JSON.stringify({
        id: "resp-incomplete",
        object: "response",
        created_at: 1,
        model: "gpt-5.6-luna",
        status: "incomplete",
        service_tier: "flex",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: { input_tokens: 100, output_tokens: 8_000, total_tokens: 8_100 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      wait: async () => undefined,
    });

    try {
      await provider.invoke({
        input: { instructions: "Review.", games: [{ gameId: "game-1" }] },
        responseSchema: { type: "object" },
        observer,
        resumeTransport: {
          flex429Count: 0,
          nextTransportOrdinal: 1,
          nextTier: "flex",
          initialBackoffMs: 0,
        },
      });
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(OwnerLearningProviderError);
      expect(error).toMatchObject({
        code: "output_budget_exhausted",
        retryable: true,
        tokenReceipt: { inputTokens: 100, totalOutputTokens: 8_000 },
      });
    }
  });

  test("maps the OpenAI SDK timeout to provider_timeout", async () => {
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      onProviderError: () => undefined,
      fetch: async () => {
        throw new OpenAI.APIConnectionTimeoutError();
      },
      wait: async () => undefined,
    });

    await expect(provider.invoke({
      input: { instructions: "Review.", games: [{ gameId: "game-1" }] },
      responseSchema: { type: "object" },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    })).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
  });

  test("admits the exact complete-request ceiling and guards one token above it before transmission", async () => {
    let transmissionCount = 0;
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      fetch: async () => {
        transmissionCount += 1;
        return new Response(JSON.stringify({
          id: "resp-boundary",
          object: "response",
          created_at: 1,
          model: "gpt-5.6-luna",
          status: "completed",
          service_tier: "flex",
          output: [{
            id: "msg-boundary",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{
              type: "output_text",
              annotations: [],
              text: "{}",
            }],
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      wait: async () => undefined,
    });
    const responseSchema = { type: "object", additionalProperties: false };
    const emptyEstimate = estimateOwnerLearningProviderCallTokens({ padding: "" }, responseSchema);
    let paddingLength = (OWNER_LEARNING_INPUT_TOKEN_LIMIT - emptyEstimate) * 4;
    let atCeiling = { padding: "x".repeat(paddingLength) };
    while (estimateOwnerLearningProviderCallTokens(atCeiling, responseSchema) < OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
      paddingLength += 1;
      atCeiling = { padding: "x".repeat(paddingLength) };
    }
    while (estimateOwnerLearningProviderCallTokens(atCeiling, responseSchema) > OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
      paddingLength -= 1;
      atCeiling = { padding: "x".repeat(paddingLength) };
    }
    expect(estimateOwnerLearningProviderCallTokens(atCeiling, responseSchema))
      .toBe(OWNER_LEARNING_INPUT_TOKEN_LIMIT);

    await provider.invoke({
      input: atCeiling,
      responseSchema,
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    });
    expect(transmissionCount).toBe(1);

    let aboveCeiling = { padding: `${atCeiling.padding}x` };
    while (estimateOwnerLearningProviderCallTokens(aboveCeiling, responseSchema) <= OWNER_LEARNING_INPUT_TOKEN_LIMIT) {
      aboveCeiling = { padding: `${aboveCeiling.padding}x` };
    }
    expect(estimateOwnerLearningProviderCallTokens(aboveCeiling, responseSchema))
      .toBeGreaterThan(OWNER_LEARNING_INPUT_TOKEN_LIMIT);
    await expect(provider.invoke({
      input: aboveCeiling,
      responseSchema,
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    })).rejects.toThrow("internal input budget invariant");
    expect(transmissionCount).toBe(1);
  });
});
