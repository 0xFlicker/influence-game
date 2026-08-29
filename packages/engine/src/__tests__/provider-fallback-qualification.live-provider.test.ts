import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { createLlmClientFromEnv } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";

const MODEL_TIMEOUT_MS = 120_000;
const QUALIFICATION_MODELS = [
  { catalogId: "katana:grok-4-5", modelId: "grok-4-5" },
  { catalogId: "katana:glm-5-2", modelId: "glm-5-2" },
] as const;

function requiredKatanaClient(): OpenAI {
  const runtime = createLlmClientFromEnv(process.env, {
    providerProfileId: "katana",
    maxRetries: 0,
    timeout: MODEL_TIMEOUT_MS,
    flexProcessing: false,
  });
  if (!runtime) {
    throw new Error(
      "Katana fallback qualification requires API_KAT_IMGNAI_KEY and API_KAT_IMGNAI_SECRET.",
    );
  }
  return runtime.client;
}

describe("Daily fallback model qualification (live Katana)", () => {
  for (const candidate of QUALIFICATION_MODELS) {
    test(`${candidate.modelId} completes Influence speech, JSON schema, and tools with billing`, async () => {
      const catalog = modelCatalogEntryById(candidate.catalogId);
      expect(catalog).toMatchObject({
        providerProfileId: "katana",
        modelId: candidate.modelId,
        capabilities: { supportsStructuredOutput: true, supportsTools: true },
      });
      const client = requiredKatanaClient();
      const creditsBefore = await readKatanaCredits();

      const speech = await client.chat.completions.create({
        model: candidate.modelId,
        messages: [{
          role: "user",
          content: "You are in a social-strategy game. In one sentence, tell Mira you want to compare votes before Council.",
        }],
        max_tokens: 512,
      });
      logStage(candidate.catalogId, "speech", speech);
      expect(speech.choices[0]?.message.content?.trim().length).toBeGreaterThan(0);

      const decision = await client.chat.completions.create({
        model: candidate.modelId,
        messages: [{
          role: "user",
          content: "Choose exactly one legal target. Atlas is not eligible. Legal targets are Mira and Vera.",
        }],
        max_tokens: 512,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "influence_vote",
            strict: true,
            schema: voteSchema(),
          },
        },
      });
      logStage(candidate.catalogId, "json_schema", decision);
      const structured = JSON.parse(decision.choices[0]?.message.content ?? "null") as {
        target?: string;
        rationale?: string;
      } | null;
      expect(["Mira", "Vera"].includes(structured?.target ?? "")).toBeTrue();
      expect(structured?.rationale?.trim().length).toBeGreaterThan(0);

      const tool = await client.chat.completions.create({
        model: candidate.modelId,
        messages: [{
          role: "user",
          content: "Cast one legal vote. Atlas is not eligible. Legal targets are Mira and Vera. Use the provided tool.",
        }],
        max_tokens: 512,
        tools: [{
          type: "function",
          function: {
            name: "cast_vote",
            description: "Commit one legal Influence vote.",
            strict: true,
            parameters: voteSchema(),
          },
        }],
        tool_choice: { type: "function", function: { name: "cast_vote" } },
      });
      logStage(candidate.catalogId, "tool", tool);
      const call = tool.choices[0]?.message.tool_calls?.[0];
      expect(call?.type).toBe("function");
      expect(call?.function.name).toBe("cast_vote");
      const toolDecision = JSON.parse(call?.function.arguments ?? "null") as {
        target?: string;
        rationale?: string;
      } | null;
      expect(["Mira", "Vera"].includes(toolDecision?.target ?? "")).toBeTrue();
      expect(toolDecision?.rationale?.trim().length).toBeGreaterThan(0);

      const accounting = [speech, decision, tool].map(readAccounting);
      expect(accounting.every((usage) => usage.totalTokens > 0)).toBeTrue();
      const totalProviderCostUsd = accounting.reduce(
        (sum, usage) => sum + (usage.providerCostUsd ?? 0),
        0,
      );
      const totalNativeCredits = accounting.reduce(
        (sum, usage) => sum + (usage.nativeCredits ?? 0),
        0,
      );
      const creditsAfter = await readKatanaCredits();
      const measuredCreditsCharged = creditsBefore - creditsAfter;
      console.info(JSON.stringify({
        qualification: candidate.catalogId,
        calls: accounting.length,
        inputTokens: accounting.reduce((sum, usage) => sum + usage.inputTokens, 0),
        outputTokens: accounting.reduce((sum, usage) => sum + usage.outputTokens, 0),
        providerCostUsd: totalProviderCostUsd,
        nativeCredits: totalNativeCredits,
        measuredCreditsCharged,
      }));
      expect(measuredCreditsCharged).toBeGreaterThan(0);
    }, MODEL_TIMEOUT_MS * 4);
  }
});

function voteSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      target: { type: "string", enum: ["Mira", "Vera"] },
      rationale: { type: "string", minLength: 1, maxLength: 240 },
    },
    required: ["target", "rationale"],
    additionalProperties: false,
  };
}

function readAccounting(response: OpenAI.Chat.Completions.ChatCompletion): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerCostUsd: number | null;
  nativeCredits: number | null;
} {
  const usage = response.usage as unknown as Record<string, unknown> | undefined;
  const router = usage?.imgnai && typeof usage.imgnai === "object" && !Array.isArray(usage.imgnai)
    ? usage.imgnai as Record<string, unknown>
    : undefined;
  return {
    inputTokens: finiteNumber(usage?.prompt_tokens) ?? 0,
    outputTokens: finiteNumber(usage?.completion_tokens) ?? 0,
    totalTokens: finiteNumber(usage?.total_tokens) ?? 0,
    providerCostUsd: finiteNumber(router?.providerCostUsd)
      ?? finiteNumber(router?.provider_cost_usd)
      ?? finiteNumber(router?.cost_usd)
      ?? finiteNumber(router?.costUsd)
      ?? finiteNumber(router?.total_usd)
      ?? finiteNumber(router?.totalUsd)
      ?? finiteNumber(router?.amount_usd)
      ?? finiteNumber(router?.amountUsd)
      ?? finiteNumber(router?.usd)
      ?? finiteNumber(router?.paid_usdc)
      ?? finiteNumber(router?.paidUsdc)
      ?? null,
    nativeCredits: finiteNumber(router?.credits_charged)
      ?? finiteNumber(router?.creditsCharged)
      ?? finiteNumber(router?.credits)
      ?? null,
  };
}

function logStage(
  catalogId: string,
  stage: string,
  response: OpenAI.Chat.Completions.ChatCompletion,
): void {
  const message = response.choices[0]?.message as unknown as Record<string, unknown> | undefined;
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  const accounting = readAccounting(response);
  console.info(JSON.stringify({
    qualification: catalogId,
    stage,
    finishReason: response.choices[0]?.finish_reason ?? null,
    contentChars: typeof message?.content === "string" ? message.content.length : 0,
    reasoningChars: reasoning.length,
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0,
    ...accounting,
  }));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readKatanaCredits(): Promise<number> {
  const key = process.env.API_KAT_IMGNAI_KEY?.trim();
  const secret = process.env.API_KAT_IMGNAI_SECRET?.trim();
  if (!key || !secret) {
    throw new Error("Katana balance measurement requires configured credentials");
  }
  const response = await fetch("https://kat.imgnai.com/v1/me/balance", {
    headers: { Authorization: `Bearer ${key}:${secret}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Katana balance measurement failed with HTTP ${response.status}`);
  }
  const payload = await response.json() as { credits?: unknown };
  const credits = typeof payload.credits === "string"
    ? Number(payload.credits)
    : finiteNumber(payload.credits);
  if (credits === null || !Number.isFinite(credits)) {
    throw new Error("Katana balance response did not include numeric credits");
  }
  return credits;
}
