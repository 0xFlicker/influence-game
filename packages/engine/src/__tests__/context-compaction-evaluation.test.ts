import { expect, test } from "bun:test";
import { COMPACTION_SCENARIOS, compactionEvaluationFixtureHash, evaluateCompactionLane, evaluationUsage, scenarioInvocation } from "../context-compaction-evaluation";
import type { LlmProviderRuntime } from "../llm-client";
import type { ModelInvocation } from "../model-invocation";
import { classifyProviderError } from "../provider-execution";
import { modelCatalogEntryById } from "../model-catalog";

for (const scenario of COMPACTION_SCENARIOS) {
  test(`paired evaluation uses actual adaptation and records evidence: ${scenario.id}`, async () => {
    const requests: ModelInvocation[] = [];
    const model = modelCatalogEntryById("openai:gpt-6-luna")!;
    const runtime: LlmProviderRuntime = { catalogId: model.id, providerProfileId: model.providerProfileId, modelId: model.modelId,
      modelCapabilities: model.capabilities, reasoningPolicy: "low",  position: 0, role: "primary",
      adapter: { id: "evaluation-fixture", validate: () => ({ compatible: true }), classifyError: classifyProviderError,
        compile: invocation => ({ transport: "fixture", body: invocation }),
        dispatch: async request => {
          const invocation = request.body as ModelInvocation; requests.push(invocation);
          const summary = invocation.result.kind !== "text" && invocation.result.artifact.name === "context_summary";
          return { transport: "fixture", nativeResponse: {}, toolCalls: [], text: JSON.stringify(summary
            ? { summary: "Mira withdrew her promise. The accusation remains disputed. Keep attribution and chronology." }
            : { choice: scenario.preferredChoice, reason: "Fixture explanation", evidence: scenario.expected }) };
        },
      } };
    const full = await evaluateCompactionLane({ runtime, scenario, mode: "full", sample: 1 });
    const compacted = await evaluateCompactionLane({ runtime, scenario, mode: "compacted", sample: 1 });
    expect(full.error).toBeUndefined(); expect(compacted.error).toBeUndefined();
    expect(full.injectedOverflows).toBe(0); expect(compacted.injectedOverflows).toBe(1);
    expect(full.calls).toHaveLength(1);
    expect(compacted.calls.some(call => call.kind === "summary")).toBe(true);
    expect(compacted.calls.at(-1)!.characters).toBeLessThan(full.calls[0]!.characters);
    expect(compacted.probeMatches).toEqual({ commitment: true, accusation: true, latestSpeaker: true });
    const summary = requests.find(request => request.result.kind !== "text" && request.result.artifact.name === "context_summary")!;
    expect(JSON.parse(summary.messages[1]!.content!).orientation.actor).toEqual(scenario.actor);
    const expected = scenarioInvocation(scenario).result;
    const actual = requests.at(-1)!.result;
    expect(actual.kind).toBe(expected.kind);
    if (actual.kind !== "text" && expected.kind !== "text") expect(actual.artifact.schema).toEqual(expected.artifact.schema);
    let dispatches = 0;
    const budgeted = await evaluateCompactionLane({ runtime, scenario, mode: "full", sample: 1,
      beforeProviderCall: () => { dispatches++; throw new Error("stop before paid dispatch"); } });
    expect(budgeted.error).toBeDefined(); expect(budgeted.calls).toHaveLength(0); expect(dispatches).toBeLessThanOrEqual(2);
  });
}
test("synthetic fixture identity is deterministic and includes both actor kinds", () => {
  expect(compactionEvaluationFixtureHash()).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(compactionEvaluationFixtureHash()).toBe(compactionEvaluationFixtureHash());
  expect(COMPACTION_SCENARIOS.map(scenario => scenario.actor.role)).toEqual(["player", "player", "house"]);
});

test("evaluation accounting retains separate cache-write usage", () => {
  const usage = evaluationUsage({ mode: "full", injectedOverflows: 0, attempts: [], calls: [
    { kind: "action", messages: [], characters: 0, latencyMs: 1,
      outcome: { toolCalls: [], accounting: { usage: { promptTokens: 1000, cachedTokens: 200, cacheWriteTokens: 700, completionTokens: 30, totalTokens: 1030 } } } },
    { kind: "summary", messages: [], characters: 0, latencyMs: 1,
      outcome: { toolCalls: [], accounting: { usage: { promptTokens: 200, cachedTokens: 100, cacheWriteTokens: 50, completionTokens: 20, totalTokens: 220 } } } },
  ] });
  expect(usage).toMatchObject({ promptTokens: 1200, cachedTokens: 300, cacheWriteTokens: 750, completionTokens: 50, totalTokens: 1250, callCount: 2 });
});
