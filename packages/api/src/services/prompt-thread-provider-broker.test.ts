import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROMPT_THREAD_PANEL_MODEL,
  PromptThreadBrokerError,
  PromptThreadProviderBroker,
} from "./prompt-thread-provider-broker.js";
import { createPrivateWorkspace, withRunMutationLock } from "./prompt-thread-workspace.js";

const cells = [
  { cellId: "one", ordinal: 1, actorId: "finn", lineage: "branch-a" },
  { cellId: "two", ordinal: 2, actorId: "lyra", lineage: "branch-a", controlReturnTurn: true },
];

describe("PromptThreadProviderBroker", () => {
  it("admits each planned cell once and in manifest order", () => {
    const broker = new PromptThreadProviderBroker(cells);
    expect(() => broker.prepare({ cellId: "two", model: PROMPT_THREAD_PANEL_MODEL, request: {} }))
      .toThrow(PromptThreadBrokerError);
    const prepared = broker.prepare({ cellId: "one", model: PROMPT_THREAD_PANEL_MODEL, request: { input: "normal" } });
    const receipt = broker.recordComplete(prepared, {
      id: "response-1",
      status: "completed",
      usage: { input_tokens_details: { cached_tokens: 0 } },
    }, 12);
    expect(receipt.cachedInputTokens).toBe(0);
    expect(() => broker.prepare({ cellId: "one", model: PROMPT_THREAD_PANEL_MODEL, request: {} }))
      .toThrow(PromptThreadBrokerError);
  });

  it("pins the model and transforms only a control return prefix", () => {
    const broker = new PromptThreadProviderBroker([
      { ...cells[0]!, firstCall: true, requestedServiceTier: "flex", maxCostUsd: 0.25 },
      { ...cells[1]!, requestedServiceTier: "flex", maxCostUsd: 0.25 },
    ], 0.5);
    expect(() => broker.prepare({ cellId: "one", model: "gpt-5.4-nano", request: {} }))
      .toThrow(PromptThreadBrokerError);
    const first = broker.prepare({ cellId: "one", model: PROMPT_THREAD_PANEL_MODEL, request: { input: "normal" } });
    broker.recordComplete(first, {
      status: "completed",
      service_tier: "flex",
      usage: { input_tokens_details: { cached_tokens: 0 } },
    }, 1);
    const control = broker.prepare({
      cellId: "two",
      model: PROMPT_THREAD_PANEL_MODEL,
      request: { input: "same remainder" },
    });
    expect(control.request.instructions).toBe("[influence-cache-prefix:x1]\n");
    expect(control.controlPrefixBeforeDigest).not.toBe(control.controlPrefixAfterDigest);
  });

  it("rejects contaminated first calls, tier drift, and over-reservation", () => {
    expect(() => new PromptThreadProviderBroker([
      { ...cells[0]!, maxCostUsd: 2 },
    ], 1)).toThrow(new PromptThreadBrokerError("spend_cap"));

    const broker = new PromptThreadProviderBroker([
      { ...cells[0]!, firstCall: true, requestedServiceTier: "flex" },
    ]);
    const prepared = broker.prepare({
      cellId: "one",
      model: PROMPT_THREAD_PANEL_MODEL,
      request: { input: "normal" },
    });
    expect(() => broker.recordComplete(prepared, {
      status: "completed",
      service_tier: "flex",
      usage: { input_tokens_details: { cached_tokens: 1 } },
    }, 1)).toThrow(new PromptThreadBrokerError("cache_contaminated"));
  });

  it("journals a complete injected provider response under the workspace lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "prompt-thread-broker-"));
    const workspace = await createPrivateWorkspace(root, { gitWorktreeRoots: [] });
    const broker = new PromptThreadProviderBroker([{ ...cells[0]!, lineage: "opaque-lineage" }]);
    await withRunMutationLock(workspace, "run-1", async (lock) => {
      const result = await broker.dispatch(lock, {
        cellId: "one",
        model: PROMPT_THREAD_PANEL_MODEL,
        request: {
          model: PROMPT_THREAD_PANEL_MODEL,
          prompt_cache_key: "opaque-lineage",
          input: "x".repeat(1_024),
        },
      }, async () => ({ id: "response-1", status: "completed", usage: { input_tokens_details: { cached_tokens: 0 } } }));
      expect(result.receipt.responseId).toBe("response-1");
    });
  });
});
