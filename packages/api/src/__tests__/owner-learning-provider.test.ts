import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import type { FlexProcessingObserver } from "@influence/engine";
import {
  createOwnerLearningOpenAIProvider,
  OwnerLearningProviderError,
} from "../services/owner-learning-provider.js";
import {
  OWNER_LEARNING_ENVELOPE_ALLOWANCE_TOKENS,
  OWNER_LEARNING_INPUT_TOKEN_LIMIT,
  OWNER_LEARNING_TOKEN_ESTIMATOR_CHARS_PER_TOKEN,
  estimateOwnerLearningInputTokens,
} from "../services/owner-learning-evidence.js";

const observer: FlexProcessingObserver = {
  async onDispatchIntent() {},
  async onTerminalOutcome() {},
};

describe("owner learning provider", () => {
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
              text: JSON.stringify({ provisionalThemes: [], selectedMomentIds: [] }),
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
    expect(response.output).toEqual({ provisionalThemes: [], selectedMomentIds: [] });
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

  test("admits the exact input ceiling and rejects one character above it before transmission", async () => {
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
    const serializedLimit = (
      OWNER_LEARNING_INPUT_TOKEN_LIMIT - OWNER_LEARNING_ENVELOPE_ALLOWANCE_TOKENS
    ) * OWNER_LEARNING_TOKEN_ESTIMATOR_CHARS_PER_TOKEN;
    const emptySerializedLength = JSON.stringify({ padding: "" }).length;
    const atCeiling = { padding: "x".repeat(serializedLimit - emptySerializedLength) };
    expect(estimateOwnerLearningInputTokens(atCeiling)).toBe(OWNER_LEARNING_INPUT_TOKEN_LIMIT);

    await provider.invoke({
      input: atCeiling,
      responseSchema: { type: "object", additionalProperties: false },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    });
    expect(transmissionCount).toBe(1);

    const aboveCeiling = { padding: `${atCeiling.padding}x` };
    expect(estimateOwnerLearningInputTokens(aboveCeiling)).toBe(
      OWNER_LEARNING_INPUT_TOKEN_LIMIT + 1,
    );
    await expect(provider.invoke({
      input: aboveCeiling,
      responseSchema: { type: "object", additionalProperties: false },
      observer,
      resumeTransport: {
        flex429Count: 0,
        nextTransportOrdinal: 1,
        nextTier: "flex",
        initialBackoffMs: 0,
      },
    })).rejects.toMatchObject({ code: "input_budget_exceeded" });
    expect(transmissionCount).toBe(1);
  });
});
