import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import type { LlmProviderRuntime } from "../llm-client";
import { createLlmClientFromEnv } from "../llm-client";
import type { ModelInvocation, ProviderModelOutcome } from "../model-invocation";
import { modelCatalogEntryById } from "../model-catalog";
import {
  createProviderAdapter,
  executeModelInvocation,
} from "../provider-adapters";
import { ProviderExecutionCoordinator } from "../provider-execution";

const MODEL_TIMEOUT_MS = 120_000;

const voteSchema = {
  type: "object",
  properties: {
    target: { type: "string", enum: ["Mira", "Vera"] },
    rationale: { type: "string", minLength: 1, maxLength: 240 },
  },
  required: ["target", "rationale"],
  additionalProperties: false,
} as const;

const toolInvocation: ModelInvocation = {
  messages: [{
    role: "user",
    content:
      "Cast one legal Influence vote. Atlas is not eligible. Legal targets are Mira and Vera. Use the provided tool.",
  }],
  result: {
    kind: "tool",
    tools: [{
      name: "cast_vote",
      description: "Commit one legal Influence vote.",
      strict: true,
      parameters: voteSchema,
    }],
    choice: { name: "cast_vote" },
    allowParallel: false,
  },
  outputTokenLimit: 512,
  reasoning: { effort: "low", summary: "auto" },
  temperature: 0.2,
};

const structuredInvocation: ModelInvocation = {
  messages: [{
    role: "user",
    content:
      "Choose exactly one legal Influence target. Atlas is not eligible. Legal targets are Mira and Vera.",
  }],
  result: {
    kind: "structured",
    name: "influence_vote",
    schema: voteSchema,
    strict: true,
  },
  outputTokenLimit: 512,
  temperature: 0.2,
};

describe("provider-native adapter acceptance", () => {
  test("OpenAI Luna executes a reasoning tool call through Responses", async () => {
    const result = await execute(
      [requiredRuntime("openai:gpt-5.6-luna")],
      toolInvocation,
      validToolOutcome,
    );

    expect(result.catalogId).toBe("openai:gpt-5.6-luna");
    expect(result.value.transport).toBe("openai.responses");
    expect(result.value.toolCalls[0]?.name).toBe("cast_vote");
    expect(result.value.accounting?.usage?.totalTokens).toBeGreaterThan(0);
  }, MODEL_TIMEOUT_MS);

  test("Katana Grok executes its native reasoning tool call", async () => {
    const result = await execute(
      [requiredRuntime("katana:grok-4-5")],
      toolInvocation,
      validToolOutcome,
    );

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(result.value.transport).toBe("katana.chat_completions");
    expect(result.value.toolCalls[0]?.name).toBe("cast_vote");
    expect(result.value.accounting?.usage?.totalTokens).toBeGreaterThan(0);
  }, MODEL_TIMEOUT_MS);

  test("Katana GLM executes strict structured output without Grok-only options", async () => {
    const result = await execute(
      [requiredRuntime("katana:glm-5-2")],
      structuredInvocation,
      (outcome) => {
        const parsed = parseVote(outcome.text);
        return parsed
          ? { status: "usable" as const, value: outcome }
          : {
              status: "unusable" as const,
              kind: "malformed_output" as const,
              message: "GLM did not return the requested vote schema",
              retryable: false,
            };
      },
    );

    expect(result.catalogId).toBe("katana:glm-5-2");
    expect(result.value.transport).toBe("katana.chat_completions");
    expect(parseVote(result.value.text)).not.toBeNull();
    expect(result.value.accounting?.usage?.totalTokens).toBeGreaterThan(0);
  }, MODEL_TIMEOUT_MS);

  test("a rejected OpenAI Responses attempt falls through to live Katana", async () => {
    const rejectedOpenAI = requiredRuntime("openai:gpt-5.6-luna", {
      responses: {
        create: async () => {
          throw Object.assign(new Error("forced invalid prompt"), {
            status: 400,
            code: "invalid_prompt",
          });
        },
      },
    } as unknown as OpenAI);
    const result = await execute(
      [rejectedOpenAI, requiredRuntime("katana:grok-4-5", undefined, 1)],
      toolInvocation,
      validToolOutcome,
    );

    expect(result.catalogId).toBe("katana:grok-4-5");
    expect(result.manifestPosition).toBe(1);
    expect(result.acceptedAttemptOrdinal).toBe(2);
    expect(result.value.transport).toBe("katana.chat_completions");
  }, MODEL_TIMEOUT_MS);
});

function requiredRuntime(
  catalogId: "openai:gpt-5.6-luna" | "katana:grok-4-5" | "katana:glm-5-2",
  clientOverride?: OpenAI,
  position = 0,
): LlmProviderRuntime {
  const model = modelCatalogEntryById(catalogId);
  if (!model) throw new Error(`Missing model catalog entry ${catalogId}`);
  const config = createLlmClientFromEnv(process.env, {
    providerProfileId: model.providerProfileId,
    maxRetries: 0,
    timeout: MODEL_TIMEOUT_MS,
    flexProcessing: false,
    openAIServiceTier: "auto",
  });
  if (!config) {
    throw new Error(
      `Live provider acceptance is missing credentials for ${model.providerProfileId}`,
    );
  }
  return {
    adapter: createProviderAdapter(
      model.providerProfileId,
      clientOverride ?? config.client,
    ),
    catalogId,
    providerProfileId: model.providerProfileId,
    modelId: model.modelId,
    modelCapabilities: model.capabilities,
    reasoningPolicy: "action-policy",
    toolChoiceMode: model.preferredToolChoiceMode ?? config.toolChoiceMode,
    ...(config.openAIReasoningSummary && {
      openAIReasoningSummary: config.openAIReasoningSummary,
    }),
    ...(config.openAIServiceTier && {
      openAIServiceTier: config.openAIServiceTier,
    }),
    position,
    role: position === 0 ? "primary" : "fallback",
    ...(position > 0 && { maxCallsPerGame: 10 }),
  };
}

async function execute(
  runtimes: readonly LlmProviderRuntime[],
  invocation: ModelInvocation,
  validate: Parameters<typeof executeModelInvocation<ProviderModelOutcome>>[0]["validate"],
) {
  const call = new ProviderExecutionCoordinator({ wait: async () => {} })
    .startCall({
      actor: { name: "Live acceptance", role: "house" },
      action: "provider-native-acceptance",
      logicalCallOrdinal: 1,
    });
  return executeModelInvocation({
    call,
    runtimes,
    invocation,
    maxAttempts: 1,
    validate,
  });
}

function validToolOutcome(outcome: ProviderModelOutcome) {
  const toolCall = outcome.toolCalls[0];
  const vote = parseVote(toolCall?.arguments);
  return toolCall?.name === "cast_vote" && vote
    ? { status: "usable" as const, value: outcome }
    : {
        status: "unusable" as const,
        kind: "wrong_tool" as const,
        message: "Provider did not return a valid cast_vote tool call",
        retryable: false,
      };
}

function parseVote(value: string | undefined): {
  target: "Mira" | "Vera";
  rationale: string;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      (parsed.target === "Mira" || parsed.target === "Vera") &&
      typeof parsed.rationale === "string" &&
      parsed.rationale.trim()
    ) {
      return {
        target: parsed.target,
        rationale: parsed.rationale.trim(),
      };
    }
  } catch {
    return null;
  }
  return null;
}
