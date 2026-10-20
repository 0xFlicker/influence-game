import { describe, expect, it } from "bun:test";
import { createLlmClientFromEnv, type LlmProviderRuntime } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";
import type { ModelInvocation } from "../model-invocation";
import { Phase } from "../types";
import { ProviderExecutionCoordinator } from "../provider-execution";
import { createProviderAdapter, executeModelInvocation } from "../provider-adapters";
import { createExactStructuredOutputArtifact } from "../structured-output";

/**
 * Opt-in paid qualification for the Meta Muse adapter. Run with:
 * doppler run --project social-strategy-agent --config dev -- bun run test:live-provider
 * Uses the Contributor model (cheapest) for generation probes.
 */

const voteArtifact = createExactStructuredOutputArtifact<
  { target: string },
  { target: string }
>({
  action: "test.meta-muse-cast-vote.v1",
  name: "cast_vote",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["target"],
    properties: { target: { type: "string" } },
  },
  acceptedValueUsesProviderSchema: true,
  decodeProviderPayload: (value) => ({ status: "valid", value }),
  decodeAcceptedValue: (value) => ({
    status: "valid",
    value: value as { target: string },
  }),
});

function metaRuntime(catalogId: string): LlmProviderRuntime {
  const config = createLlmClientFromEnv(process.env, {
    providerProfileId: "meta-muse",
    maxRetries: 0,
    timeout: 90_000,
  });
  if (!config) {
    throw new Error("Meta Muse live-provider tests require META_MUSE_API_KEY.");
  }
  const entry = modelCatalogEntryById(catalogId);
  if (!entry) throw new Error(`Missing catalog entry ${catalogId}`);
  return {
    adapter: createProviderAdapter("meta-muse", config.client),
    catalogId,
    providerProfileId: "meta-muse",
    modelId: entry.modelId,
    modelCapabilities: entry.capabilities,
    reasoningPolicy: "low",

    position: 0,
    role: "primary",
  };
}

async function execute<TValue>(
  runtime: LlmProviderRuntime,
  invocation: ModelInvocation<{ target: string }>,
): Promise<TValue> {
  const call = new ProviderExecutionCoordinator({ wait: async () => {} }).startCall({
    actor: { name: "MetaProbe", role: "player" },
    action: "test.meta-muse-probe.v1",
    semantic: { version: 1, kind: "phase_call", phase: Phase.VOTE, round: 0, canonicalEventSequence: 0, callSlot: 1 },
  });
  const result = await executeModelInvocation({
    call,
    runtimes: [runtime],
    invocation,
    maxAttempts: 2,
    validate: (outcome, decoded) => {
      if (invocation.result.kind === "text") {
        return outcome.text?.trim()
          ? { status: "usable", value: outcome.text as TValue }
          : { status: "unusable", kind: "empty_output", message: "no text" };
      }
      return decoded
        ? { status: "usable", value: decoded as TValue }
        : { status: "unusable", kind: "malformed_output", message: "missing decoded value" };
    },
  });
  return result.value;
}

const messages = [
  { role: "system" as const, content: "You are playing a social strategy game." },
  { role: "user" as const, content: "Vote for player-7." },
];

describe("Meta Muse adapter (live provider)", () => {
  it("lists every static Meta Muse text model", async () => {
    const config = createLlmClientFromEnv(process.env, {
      providerProfileId: "meta-muse",
      maxRetries: 0,
      timeout: 15_000,
    });
    if (!config) throw new Error("Meta Muse live-provider tests require META_MUSE_API_KEY.");
    const listed = (await config.client.models.list()).data.map((model) => model.id);
    expect(listed).toContain("muse-spark-1.3");
    expect(listed).toContain("muse-spark-1.3-contributor");
    expect(listed).toContain("muse-wonder-1.0");
  }, 30_000);

  it("returns text through the Responses adapter", async () => {
    const text = await execute<string>(metaRuntime("meta-muse:muse-spark-1.3-contributor"), {
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      result: { kind: "text" },
      outputTokenLimit: 2_048,
      reasoning: { effort: "low" },
    });
    expect(text).toContain("OK");
  }, 120_000);

  it("decodes an exact tool vote under auto tool choice", async () => {
    const value = await execute<{ target: string }>(metaRuntime("meta-muse:muse-spark-1.3-contributor"), {
      messages,
      result: { kind: "structured", artifact: voteArtifact },
      outputTokenLimit: 2_048,
      reasoning: { effort: "low" },
    });
    expect(value).toEqual({ target: "player-7" });
  }, 120_000);

  it("decodes strict structured output", async () => {
    const value = await execute<{ target: string }>(metaRuntime("meta-muse:muse-spark-1.3-contributor"), {
      messages,
      result: { kind: "structured", artifact: voteArtifact },
      outputTokenLimit: 2_048,
      reasoning: { effort: "low" },
    });
    expect(value).toEqual({ target: "player-7" });
  }, 120_000);
});
