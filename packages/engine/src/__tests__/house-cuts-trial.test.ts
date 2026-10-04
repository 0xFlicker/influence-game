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
    modelCapabilities: model.capabilities, reasoningPolicy: "low", toolChoiceMode: "named", position: 0, role: "primary",
    adapter: { id: "test", validate: () => ({ compatible: true }),
      compile: (invocation, descriptor) => { tiers.push(descriptor.openAIServiceTier); return { transport: "openai.responses", body: invocation.messages }; },
      async dispatch(request) {
        calls++;
        if (calls <= capacityFailures) throw new Error("capacity");
        const messages = request.body as Array<{ content: string }>;
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
for (const text of ["not JSON", "```json\n{}\n```", "{}", '{"candidates":[]}', '{"sourceHash":"wrong","windowId":"wrong","candidates":[]}']) {
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
  const provider = runtime(undefined, 2), journal = newCutTrialJournal(source, 1);
  await runCutTrial({ source, journal, runtimes: [provider.value], save: async () => {} });
  expect(provider.calls()).toBe(3);
  expect(provider.tiers.at(-1)).toBe("auto");
  expect(journal.attempts.filter(a => a.terminal?.outcome.kind === "rate_limit")).toHaveLength(2);
  expect(journal.attempts[2]!.terminal?.acceptedValue).toBeDefined();
  const failing = runtime(undefined, 9), exhausted = newCutTrialJournal(source, 1);
  await expect(runCutTrial({ source, journal: exhausted, runtimes: [failing.value], save: async () => {} })).rejects.toThrow();
  expect(failing.calls()).toBe(3);
});

for (const output of ['not JSON', '{}', 'prefix {"selectedKeys":[]}', '```json\n{"selectedKeys":[]}\n```', '{"selectedKeys":[],"extra":true}', '{"selectedKeys":["made-up"]}']) {
  test(`final selector retries malformed output and never accepts it: ${output}`, async () => {
    const { CUT_SELECTION_SCHEMA, validateCutSelection } = await import("../house-cuts/selection");
    const { cutFixtureReports } = await import("../house-cuts/fixtures");
    const report = (await cutFixtureReports())[0]!;
    const provider = runtime(output), journal = newCutTrialJournal(source, 1);
    await expect(executeCutTrialInvocation({ source, journal, runtimes: [provider.value], save: async () => {} }, {
      prompt: "Select", schema: CUT_SELECTION_SCHEMA, window: { id: "selection" }, maxOutputTokens: 1000,
      accept: value => ({ selectedKeys: validateCutSelection(value, report) }),
    })).rejects.toThrow();
    expect(provider.calls()).toBe(2);
    expect(journal.attempts.every(a => a.terminal?.acceptedValue === undefined)).toBe(true);
  });
}
test("final selection is journaled and replays without a second paid dispatch", async () => {
  const { CUT_SELECTION_SCHEMA, validateCutSelection } = await import("../house-cuts/selection");
  const { cutFixtureReports } = await import("../house-cuts/fixtures");
  const report = (await cutFixtureReports())[0]!;
  const provider = runtime('{"selectedKeys":[]}'), journal = newCutTrialJournal(source, 1);
  const options = { source, journal, runtimes: [provider.value], save: async () => {} };
  const request = { prompt: "Select", schema: CUT_SELECTION_SCHEMA, window: { id: "selection" }, maxOutputTokens: 1000,
    accept: (value: unknown) => ({ selectedKeys: validateCutSelection(value, report) }) };
  expect((await executeCutTrialInvocation(options, request)).decoded).toEqual({ selectedKeys: [] });
  expect((await executeCutTrialInvocation(options, request)).decoded).toEqual({ selectedKeys: [] });
  expect(provider.calls()).toBe(1);
});
