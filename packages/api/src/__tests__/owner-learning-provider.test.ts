import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import type { FlexProcessingObserver } from "@influence/engine";
import {
  createOwnerLearningOpenAIProvider,
  OwnerLearningProviderError,
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
  test("logs sanitized OpenAI rejection diagnostics without request content", async () => {
    const diagnostics: unknown[] = [];
    const provider = createOwnerLearningOpenAIProvider({
      apiKey: "sk-test",
      onProviderError: (diagnostic) => diagnostics.push(diagnostic),
      fetch: async () => new Response(JSON.stringify({
        error: {
          message: "Invalid schema for response_format owner_learning_turn.",
          type: "invalid_request_error",
          code: "invalid_json_schema",
          param: "text.format.schema",
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

    await expect(provider.invoke({
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
    })).rejects.toMatchObject({ code: "provider_error", retryable: true });

    expect(diagnostics).toEqual([{
      reviewId: "review-1",
      callOrdinal: 2,
      model: "gpt-5.6-luna",
      requestedTier: "flex",
      status: 400,
      requestId: "req-safe-diagnostic",
      type: "invalid_request_error",
      code: "invalid_json_schema",
      param: "text.format.schema",
      message: "Invalid schema for response_format owner_learning_turn.",
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_EVIDENCE_SENTINEL");
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
    expect(response.output).toEqual({ provisionalThemes: [], selectedMomentHandles: [] });
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
