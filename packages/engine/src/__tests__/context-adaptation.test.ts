import { describe, expect, test } from "bun:test";
import { hashCanonicalJson } from "@influence/prompt-lab-protocol";
import { compactInvocation, contextSummaryArtifact } from "../context-adaptation";
import { executeModelInvocation } from "../provider-adapters";
import { classifyProviderError, ProviderExecutionCoordinator, providerLogicalCallId, type ProviderAttemptRecord, type ProviderExecutionHooks } from "../provider-execution";
import type { ModelInvocation, LlmProviderAdapter } from "../model-invocation";
import type { LlmProviderRuntime } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";
import { exactStructuredOutputRegistry } from "../structured-output";
import { Phase } from "../types";

const coordinate = { gameId: "game", actor: { id: "a", name: "Ada", role: "player" as const }, action: "vote",
  semantic: { version: 1 as const, kind: "phase_call" as const, phase: Phase.VOTE, round: 4, canonicalEventSequence: 20, callSlot: 1 } };
const history = 'Ada promised Bea protection; Bea disputed it. 界😀 "quoted"\n'.repeat(6000);
const invocation: ModelInvocation = { messages: [{ role: "system", content: "Keep the decision contract exact." },
  { role: "user", content: `LEGAL: Bea only\n${history}\nACTION: vote for one legal target.` }],
  contextSpans: [{ text: history, format: "text" }], result: { kind: "text" }, outputTokenLimit: 100 };
function fixture(options: { alwaysOverflow?: boolean; crashAfterSummary?: boolean; summaryOverflow?: boolean; fallback?: boolean } = {}) {
  const records: ProviderAttemptRecord[] = [];
  const requests: Array<{ summary: boolean; text: string }> = [];
  const key = (value: typeof coordinate | ProviderAttemptRecord["coordinate"]) => providerLogicalCallId("game", value);
  let crash = options.crashAfterSummary;
  const hooks: ProviderExecutionHooks = {
    onReadAccepted: c => {
      const row = records.find(r => key(r.coordinate) === key(c) && r.outcome.kind === "usable");
      return row ? { value: row.acceptedValue, catalogId: row.preparedRequest.catalogId, attemptOrdinal: row.attemptOrdinal } : undefined;
    },
    onReadContextAttempts: async c => records.filter(r => key(r.coordinate) === key(c))
      .flatMap(r => { const identity = r.context ?? (r.coordinate.semantic.kind === "context_compaction" ? r.coordinate.semantic : undefined);
        return identity ? [{ catalogId: r.preparedRequest.catalogId!, sourceHash: identity.sourceHash, revision: identity.revision, outcome: r.outcome.kind }] : []; }),
    onAllocateAttemptOrdinal: c => records.filter(r => key(r.coordinate) === key(c)).length + 1,
    onTerminal: r => { records.push(r); if (crash && r.coordinate.semantic.kind === "context_compaction" && r.outcome.kind === "usable") { crash = false; throw new Error("crash after summary acceptance"); } },
  };
  const model = modelCatalogEntryById("openai:gpt-5.6-luna")!;
  const adapter: LlmProviderAdapter = { id: "test", validate: () => ({ compatible: true }),
    compile: (i, runtime) => ({ transport: "test.responses", body: { position: runtime.catalogId === "fallback:test" ? 1 : 0, messages: i.messages, summary: i.result.kind === "structured" } }),
    classifyError: classifyProviderError,
    dispatch: async r => {
      const body = r.body as { messages: ModelInvocation["messages"]; summary: boolean; position: number };
      const text = body.messages.map(m => m.content).join("\n"); requests.push({ summary: body.summary, text });
      if (!body.summary && (text.includes(history) || (options.alwaysOverflow && (!options.fallback || body.position === 0)))) throw Object.assign(new Error("maximum context length exceeded"), { status: 400, code: "context_length_exceeded" });
      if (body.summary && options.summaryOverflow && JSON.parse(body.messages[1]!.content!).source.length > 9000) throw Object.assign(new Error("prompt is too long"), { status: 400 });
      return { transport: "test.responses", nativeResponse: {}, toolCalls: [], text: body.summary
        ? JSON.stringify({ summary: "Ada promised Bea protection; Bea disputed it." }) : "Bea" };
    },
  };
  const runtime: LlmProviderRuntime = { adapter, catalogId: model.id, providerProfileId: model.providerProfileId, modelId: model.modelId,
    modelCapabilities: model.capabilities, reasoningPolicy: "low", toolChoiceMode: "named", position: 0, role: "primary" };
  const run = (request = invocation) => executeModelInvocation({ call: new ProviderExecutionCoordinator({ hooks, wait: async () => {} }).startCall(coordinate),
    runtimes: options.fallback ? [runtime, { ...runtime, catalogId: "fallback:test", position: 1, role: "fallback" }] : [runtime], invocation: request, maxAttempts: 1,
    validate: outcome => ({ status: "usable", value: outcome.text! }) });
  return { records, requests, run };
}

describe("context adaptation", () => {
  test("large Unicode history compacts and continues with exact mechanics and one action acceptance", async () => {
    const f = fixture(); const result = await f.run(); expect(result.value).toBe("Bea");
    expect(f.requests[0]!.text.length).toBeGreaterThan(256 * 1024);
    const final = f.requests.at(-1)!;
    expect(final.text).toContain("LEGAL: Bea only"); expect(final.text).toContain("ACTION: vote for one legal target.");
    expect(final.text).toContain("Ada promised Bea protection; Bea disputed it.");
    expect(final.text.length).toBeLessThan(f.requests[0]!.text.length / 2);
    expect(f.records.filter(r => r.coordinate.semantic.kind !== "context_compaction" && r.outcome.kind === "usable")).toHaveLength(1);
    expect(result.liveOutcome?.invocationMessages?.[1]?.content).toContain("Derived context memory");
    const calls = f.requests.length; await f.run(); expect(f.requests).toHaveLength(calls);
  });
  test("restart after accepted summary resumes without resending original overflow or accepted chunks", async () => {
    const f = fixture({ crashAfterSummary: true }); await expect(f.run()).rejects.toThrow("crash after summary acceptance");
    expect((await f.run()).value).toBe("Bea");
    expect(f.requests.filter(r => !r.summary && r.text.includes(history))).toHaveLength(1);
    const firstSummary = f.requests.find(r => r.summary)!;
    expect(f.requests.filter(r => r.summary && r.text === firstSummary.text)).toHaveLength(1);
  });
  test("changed frozen source cannot reuse a logical call after overflow", async () => {
    const f = fixture({ crashAfterSummary: true }); await expect(f.run()).rejects.toThrow();
    await expect(f.run({ ...invocation, messages: [{ role: "user", content: "different" }] })).rejects.toThrow("Context source changed");
  });
  test("changed character context cannot reuse summaries under the same logical call", async () => {
    const f = fixture({ crashAfterSummary: true });
    const request = { ...invocation, compactionCharacter: { personality: "Careful", backstory: "A teacher", strategy: "Protect Bea" } };
    await expect(f.run(request)).rejects.toThrow("crash after summary acceptance");
    await expect(f.run({ ...request, compactionCharacter: { ...request.compactionCharacter, strategy: "Eliminate Bea" } }))
      .rejects.toThrow("Context source changed");
  });
  test("persistent overflow reaches existing typed exhaustion after three revisions", async () => {
    const f = fixture({ alwaysOverflow: true }); await expect(f.run()).rejects.toMatchObject({ outcome: { kind: "context_overflow" } });
    expect(f.requests.filter(r => !r.summary)).toHaveLength(4);
    const count = f.requests.length; await expect(f.run()).rejects.toMatchObject({ outcome: { kind: "context_overflow" } });
    expect(f.requests).toHaveLength(count);
  });
  test("a summary overflow splits chunks and restart skips rejected and accepted chunks", async () => {
    const f = fixture({ summaryOverflow: true, crashAfterSummary: true });
    await expect(f.run()).rejects.toThrow("crash after summary acceptance");
    const rejected = f.requests.find(r => r.summary)!;
    expect((await f.run()).value).toBe("Bea");
    expect(f.requests.filter(r => r.text === rejected.text)).toHaveLength(1);
  });
  test("the next sealed model can accept the latest compacted revision", async () => {
    const f = fixture({ alwaysOverflow: true, fallback: true });
    expect((await f.run()).value).toBe("Bea");
    const actions = f.records.filter(r => r.coordinate.semantic.kind !== "context_compaction");
    expect(actions.map(r => r.context?.revision)).toEqual([0, 1, 2, 3, 3]);
    expect(actions.at(-1)!.preparedRequest.catalogId).toBe("fallback:test");
  });
  test("JSON context remains parseable; exact board, private knowledge and output contract remain unchanged", async () => {
    const historical = [{ speaker: "Ada", text: "private promise ".repeat(100) }];
    const source: ModelInvocation = { ...invocation, messages: [{ role: "user", content: JSON.stringify({ board: { targets: ["b"], role: "seer" }, history: historical }) }],
      contextSpans: [{ text: JSON.stringify(historical), format: "json" }] };
    const compacted = await compactInvocation({ invocation: source, sourceHash: hashCanonicalJson(source.messages), revision: 1,
      call: new ProviderExecutionCoordinator().startCall(coordinate), summarize: async () => "Ada made a private promise." });
    expect(JSON.parse(compacted.messages[0]!.content!).board).toEqual({ targets: ["b"], role: "seer" });
    expect(compacted.result).toBe(source.result);
  });
  test.each(["plain", 'prefix {"summary":"x"}', '```json\n{"summary":"x"}\n```', '{}', '{"summary":""}', '{"summary":"x","extra":true}', '{"summary":4}'])("rejects malformed summary %s", text => {
    expect(exactStructuredOutputRegistry.decodeJsonDocument(contextSummaryArtifact(100), text).status).toBe("invalid");
  });
  test("overflow classification stays separate from configuration, output length and generic 400", () => {
    for (const code of ["context_length_exceeded", "context_window_exceeded", "prompt_too_long", "input_too_long"]) expect(classifyProviderError({ code, message: "too big", status: 400 }).kind).toBe("context_overflow");
    expect(classifyProviderError({ status: 400, message: "bad input" }).kind).toBe("request_error");
    expect(classifyProviderError({ code: "invalid_schema", status: 400, message: "wrong" }).kind).toBe("configuration");
    expect(classifyProviderError({ status: 429, message: "rate limited" }).kind).toBe("rate_limit");
  });
});
