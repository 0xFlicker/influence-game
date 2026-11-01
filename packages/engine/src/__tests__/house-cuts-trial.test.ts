import { expect, test } from "bun:test";
import { cutInfluenceFixture } from "../house-cuts/fixtures";
import { influenceCutSource } from "../house-cuts/influence-source";
import { cutSource } from "../house-cuts/source";
import { newCutTrialJournal, runCutTrial, cutTrialSpend, executeCutTrialInvocation } from "../house-cuts/trial";
import { CUT_EDITORIAL_MODEL, type CutWindow } from "../house-cuts/editorial";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";

const fixture = cutInfluenceFixture();
const full = influenceCutSource(fixture.events, fixture.dialogue, "trial");
const { hash: _hash, version: _version, ...sourceInput } = full;
const source = cutSource({ ...sourceInput, evidence: full.evidence.filter(e => e.content.kind === "dialogue") });
function runtime(output?: string, capacityFailures = 0) {
  const tiers: Array<string | undefined> = [];
  let calls = 0;
  const model = modelCatalogEntryById(CUT_EDITORIAL_MODEL)!;
  const value: LlmProviderRuntime = { catalogId: CUT_EDITORIAL_MODEL, modelId: model.modelId, providerProfileId: "openai",
    modelCapabilities: model.capabilities, reasoningPolicy: "low", openAIServiceTier: "flex",  position: 0, role: "primary",
    adapter: { id: "test", validate: () => ({ compatible: true }),
      compile: (invocation, descriptor) => ({ transport: "openai.responses", body: { input: invocation.messages, service_tier: descriptor.openAIServiceTier } }),
      async dispatch(request) {
        calls++;
        const body = request.body as { service_tier: string; input: Array<{ content: string }> };
        tiers.push(body.service_tier);
        if (calls <= capacityFailures) throw Object.assign(new Error("capacity"), { status: 429, error: { code: body.service_tier === "flex" ? "flex_unavailable" : "rate_limit_exceeded" } });
        const messages = body.input;
        const window = JSON.parse(messages[1]!.content) as CutWindow;
        const text = output ?? JSON.stringify({ sourceHash: window.sourceHash, windowId: window.id, candidates: [] });
        return { transport: "openai.responses", nativeResponse: { text }, text, toolCalls: [], status: "completed",
          accounting: { usage: { promptTokens: 100, completionTokens: 20 }, effectiveServiceTier: "flex" } };
      }, classifyError: error => error instanceof Error && error.message === "capacity"
        ? { kind: "rate_limit", retryable: true, message: "capacity" }
        : { kind: "configuration", retryable: false, message: "test failure" } },
  };
  return { value, calls: () => calls, tiers };
}
test("real execution journals before dispatch, accepts strict empty output, and resumes without spending", async () => {
  const provider = runtime(), journal = newCutTrialJournal(source, 1);
  const saved: number[] = [];
  const options = { source, journal, runtimes: [provider.value], save: async () => { saved.push(provider.calls()); } };
  const first = await runCutTrial(options);
  expect(saved[0]).toBe(0);
  expect(first.candidates).toHaveLength(0);
  expect(journal.attempts).toHaveLength(1);
  expect(journal.attempts[0]!.terminal?.acceptedValue).toBeDefined();
  expect(cutTrialSpend(journal)).toBeGreaterThan(0);
  expect(await runCutTrial(options)).toEqual(first);
  expect(provider.calls()).toBe(1);
});
test("full budget and binding failures dispatch nothing", async () => {
  const provider = runtime();
  await expect(runCutTrial({ source, journal: newCutTrialJournal(source, 0.000001), runtimes: [provider.value], save: async () => {} })).rejects.toThrow("budget");
  const journal = newCutTrialJournal(source, 1); journal.binding = "changed";
  await expect(runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} })).rejects.toThrow("mismatch");
  expect(provider.calls()).toBe(0);
});
for (const text of ["", "not JSON", "```json\n{}\n```", "{}", '{"candidates":[]}', '{"sourceHash":"wrong","windowId":"wrong","candidates":[]}']) {
  test(`malformed provider output is never accepted: ${text}`, async () => {
    const provider = runtime(text), journal = newCutTrialJournal(source, 1);
    await expect(runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} })).rejects.toThrow();
    expect(provider.calls()).toBe(2);
    expect(journal.attempts.every(a => a.terminal && a.terminal.acceptedValue === undefined)).toBe(true);
    expect(cutTrialSpend(journal)).toBeGreaterThan(0);
  });
}
test("unknown dispatched outcome fails closed on resume", async () => {
  const provider = runtime(), journal = newCutTrialJournal(source, 1);
  await runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} });
  delete journal.attempts[0]!.terminal;
  await expect(runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} })).rejects.toThrow("unknown outcome");
  expect(provider.calls()).toBe(1);
});

test("Flex capacity failures receive only one standard-tier retry, preserving prior attempts", async () => {
  const provider = runtime(undefined, 1), journal = newCutTrialJournal(source, 1);
  await runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} });
  expect(provider.calls()).toBe(2);
  expect(provider.tiers).toEqual(["flex", "default"]);
  expect(journal.attempts.filter(a => a.terminal?.outcome.kind === "rate_limit")).toHaveLength(1);
  expect(journal.attempts[1]!.terminal?.acceptedValue).toBeDefined();
  const failing = runtime(undefined, 9), exhausted = newCutTrialJournal(source, 1);
  await expect(runCutTrial({ source, journal: exhausted, runtimes: [failing.value], save: async () => {} })).rejects.toThrow();
  expect(failing.calls()).toBe(3);
});

test("final editor accepts rewritten cards, journals explicit zero and replays without spending", async () => {
  const { CUT_SELECTION_SCHEMA, validateCutSelection } = await import("../house-cuts/selection");
  const { cutFixtureReports } = await import("../house-cuts/fixtures");
  const report = (await cutFixtureReports())[0]!;
  const empty = { sourceHash: report.source.hash, windowId: "selection", candidates: [] };
  const provider = runtime(JSON.stringify(empty)), journal = newCutTrialJournal(source, 1);
  const options = { source, journal, runtimes: [provider.value], save: async () => {} };
  const request = { prompt: "Edit", schema: CUT_SELECTION_SCHEMA, window: { id: "selection" }, maxOutputTokens: 1000,
    accept: (value: unknown) => validateCutSelection(value, report) };
  expect((await executeCutTrialInvocation(options, request)).decoded).toEqual(empty);
  expect((await executeCutTrialInvocation(options, request)).decoded).toEqual(empty);
  expect(provider.calls()).toBe(1);
});

test("semantic retries contain corrective feedback and exhaustion replays without spending", async () => {
  const provider = runtime('{"sourceHash":"wrong","windowId":"wrong","candidates":[]}');
  const journal = newCutTrialJournal(source, 1);
  const options = { source, journal, runtimes: [provider.value], save: async () => {} };
  await expect(runCutTrial(options)).rejects.toThrow("not an editorial zero");
  expect(JSON.stringify(journal.attempts[1]!.intent.preparedRequest.body)).toContain("previous response was rejected");
  await expect(runCutTrial(options)).rejects.toThrow("not an editorial zero");
  expect(provider.calls()).toBe(2);
});

test("explicit recovery retains previous spending", async () => {
  const previous = newCutTrialJournal(source, 1);
  const provider = runtime();
  await runCutTrial({ source, journal: previous, runtimes: [provider.value], save: async () => {} });
  const next = newCutTrialJournal(source, 1);
  next.recovery = { key: "recovery", previous, failure: "fixture", requestedBy: "operator", requestedAt: new Date().toISOString() };
  expect(cutTrialSpend(previous)).toBeGreaterThan(0);
  expect(cutTrialSpend(next)).toBe(cutTrialSpend(previous));
});

for (const rejection of ["malformed", "refusal"] as const) test(`a ${rejection} window does not stop later cards or redispatch on restart`, async () => {
  const expanded = cutSource({ ...sourceInput, evidence: [
    ...source.evidence,
    ...source.evidence.map(e => ({ ...e, id: `${e.id}-later`, group: "later" })),
  ] });
  const provider = runtime();
  let calls = 0;
  provider.value.adapter!.dispatch = async request => {
    calls++;
    const body = request.body as { input: Array<{ content: string }> };
    const w = JSON.parse(body.input[1]!.content) as CutWindow;
    const text = w.id === "window-1" ? "{}" : JSON.stringify({ sourceHash: w.sourceHash, windowId: w.id,
      candidates: [{ id: "later", title: "Trust with receipts", context: "An exchange.", angle: "A warm audit.", payoff: null,
        sourceRefs: [w.evidence[0]!.id], quotes: [], rationale: "Worth sharing." }] });
    return { transport: "openai.responses", nativeResponse: { text }, text, toolCalls: [], status: "completed",
      refusal: rejection === "refusal" && w.id === "window-1" ? "fixture refusal" : undefined,
      accounting: { usage: { promptTokens: 100, completionTokens: 20 }, effectiveServiceTier: "flex" } };
  };
  const journal = newCutTrialJournal(expanded, 1);
  const options = { source: expanded, journal, runtimes: [provider.value], save: async () => {} };
  const report = await runCutTrial(options);
  expect(report.failures).toHaveLength(1);
  expect(report.candidates).toHaveLength(1);
  expect(calls).toBe(rejection === "refusal" ? 2 : 3);
  expect(await runCutTrial(options)).toEqual(report);
  expect(calls).toBe(rejection === "refusal" ? 2 : 3);
});

test("native exact card schema isolates malformed cards without manufacturing zero", async () => {
  const { CUT_PROPOSAL_SCHEMA, planCutDiscovery, validateCutProposals } = await import("../house-cuts/editorial");
  const w = planCutDiscovery(source).windows[0]!;
  const card = { id: "good", title: "Warm audit", context: "Trust with a count.", angle: "A friendship with receipts.", payoff: null,
    sourceRefs: [w.evidence[0]!.id], quotes: [], rationale: "A sharp exchange." };
  const provider = runtime(JSON.stringify({ sourceHash: source.hash, windowId: w.id, candidates: [card, { id: "missing-fields" }] }));
  const journal = newCutTrialJournal(source, 1);
  const result = await executeCutTrialInvocation({ source, journal, runtimes: [provider.value], save: async () => {} }, {
    prompt: "Edit", schema: CUT_PROPOSAL_SCHEMA, window: w, maxOutputTokens: 1000, accept: value => validateCutProposals(value, w),
  });
  expect(result.decoded.candidates).toEqual([card]);
  expect(provider.calls()).toBe(1);
  const allBad = runtime(JSON.stringify({ sourceHash: source.hash, windowId: w.id, candidates: [{ id: "missing-fields" }] }));
  await expect(runCutTrial({ source, journal: newCutTrialJournal(source, 1), runtimes: [allBad.value], save: async () => {} })).rejects.toThrow("not an editorial zero");
  expect(allBad.calls()).toBe(2);
});

test("accepted replay never silently drops a corrupted card", async () => {
  const { CUT_PROPOSAL_SCHEMA, planCutDiscovery, validateCutProposals } = await import("../house-cuts/editorial");
  const w = planCutDiscovery(source).windows[0]!;
  const card = { id: "good", title: "Warm audit", context: "Trust with a count.", angle: "A friendship with receipts.", payoff: null,
    sourceRefs: [w.evidence[0]!.id], quotes: [], rationale: "A sharp exchange." };
  const provider = runtime(JSON.stringify({ sourceHash: source.hash, windowId: w.id, candidates: [card] }));
  const journal = newCutTrialJournal(source, 1);
  const options = { source, journal, runtimes: [provider.value], save: async () => {} };
  const request = { prompt: "Edit", schema: CUT_PROPOSAL_SCHEMA, window: w, maxOutputTokens: 1000, accept: (value: unknown) => validateCutProposals(value, w) };
  await executeCutTrialInvocation(options, request);
  journal.attempts[0]!.terminal!.acceptedValue = { sourceHash: source.hash, windowId: w.id, candidates: [card, { ...card, id: "corrupted", sourceRefs: ["foreign"] }] };
  await expect(executeCutTrialInvocation(options, request)).rejects.toThrow("Accepted House Cuts changed");
  expect(provider.calls()).toBe(1);
});
