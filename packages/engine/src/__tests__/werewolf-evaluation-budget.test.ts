import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAttemptIntent, ProviderAttemptRecord } from "../provider-execution";
import { EvaluationBudget, withEvaluationBudget } from "../evaluation-budget";

async function fixture(run: (ledger: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "werewolf-budget-"));
  try { await run(join(dir, "ledger.json")); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
function intent(attemptId: string, inputBytes: number, limit = 100): ProviderAttemptIntent {
  return { attemptId, attemptOrdinal: 1, startedAt: new Date().toISOString(),
    coordinate: { gameId: "g", ownerEpoch: "e", actor: { id: "p", name: "P", role: "player" }, action: "werewolf.discuss", round: 1,
      semantic: { version: 1, kind: "werewolf_action", eventSequence: 1 } },
    preparedRequest: { transport: "openai.responses", providerProfileId: "openai", catalogId: "openai:gpt-6-luna", model: "gpt-6-luna",
      body: { input: "x".repeat(inputBytes), max_output_tokens: limit } } };
}
function terminal(id: string, promptTokens?: number): ProviderAttemptRecord {
  return { ...intent(id, 100), completedAt: new Date().toISOString(), latencyMs: 1,
    outcome: { kind: "usable" }, disposition: "accepted",
    ...(promptTokens === undefined ? {} : { accounting: { usage: { promptTokens, completionTokens: 10, reasoningTokens: 5 } } }) };
}

describe("Shared evaluation spend guard", () => {
  test("reserves Grok schema calls and retains reported router cost", async () => fixture(async path => {
    const hooks = new EvaluationBudget(path, 1).hooks({});
    const request = intent("grok", 100);
    request.preparedRequest.catalogId = "katana:grok-4-3";
    request.preparedRequest.providerProfileId = "katana";
    request.preparedRequest.model = "grok-4-3";
    request.preparedRequest.body = { messages: [{ role: "user", content: "x".repeat(100) }],
      max_tokens: 8192, response_format: { type: "json_schema" } };
    await hooks.onReserve!(request);
    await hooks.onTerminal!({ ...terminal("grok", 100), preparedRequest: request.preparedRequest,
      accounting: { usage: { promptTokens: 100, completionTokens: 20 },
        actualCostMicrousd: 150_000 } });
    const entry = JSON.parse(await readFile(path, "utf8")).entries[0];
    expect(entry.reservedUsd).toBeGreaterThan(0.09);
    expect(entry.providerActualUsd).toBe(0.15);
    expect(entry.status).toBe("settled");
  }));
  test("local API configuration preserves journal hooks and rejects partial or production setup", async () => fixture(async path => {
    const base = { onReadAccepted: async () => undefined };
    expect(withEvaluationBudget(base, {})).toBe(base);
    expect(() => withEvaluationBudget(base, { WEREWOLF_EVALUATION_BUDGET_USD: "15" })).toThrow("Set both");
    expect(() => withEvaluationBudget(base, { NODE_ENV: "production", WEREWOLF_EVALUATION_BUDGET_USD: "15", WEREWOLF_EVALUATION_BUDGET_LEDGER: path })).toThrow("production");
    const hooks = withEvaluationBudget(base, { WEREWOLF_EVALUATION_BUDGET_USD: "15", WEREWOLF_EVALUATION_BUDGET_LEDGER: path });
    expect(hooks.onReadAccepted).toBe(base.onReadAccepted);
    await hooks.onReserve!(intent("api", 100));
    expect(JSON.parse(await readFile(path, "utf8")).entries).toHaveLength(1);
  }));
  test("serializes concurrent player and House reservations under one Influence cap", async () => fixture(async path => {
    const env={INFLUENCE_EVALUATION_BUDGET_LEDGER:path,INFLUENCE_EVALUATION_BUDGET_USD:"0.01"};
    const first=withEvaluationBudget({},env,"INFLUENCE"),second=withEvaluationBudget({},env,"INFLUENCE");
    const outcomes=await Promise.allSettled([first.onReserve!(intent("p1",10)),second.onReserve!(intent("house",10)),first.onReserve!(intent("p2",10))]);
    expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(2);
    expect(JSON.parse(await readFile(path,"utf8")).entries).toHaveLength(2);
  }));
  test("does not settle an attempt when durable evidence persistence fails", async () => fixture(async path => {
    const hooks=new EvaluationBudget(path,1).hooks({onTerminal:async()=>{throw new Error("evidence unavailable");}});
    await hooks.onReserve!(intent("saved",10));
    await expect(hooks.onTerminal!(terminal("saved",100))).rejects.toThrow("evidence unavailable");
    expect(JSON.parse(await readFile(path,"utf8")).entries[0].status).toBe("reserved");
  }));
  test("blocks dispatch before the prepared request would exceed the shared cap", async () => fixture(async path => {
    const budget = new EvaluationBudget(path, 0.0042);
    const hooks = budget.hooks({});
    await hooks.onReserve!(intent("a", 10));
    await expect(hooks.onReserve!(intent("b", 10))).rejects.toThrow("Evaluation budget exhausted");
    const ledger = JSON.parse(await readFile(path, "utf8"));
    expect(ledger.entries).toHaveLength(1);
  }));

  test("persists across invocations and leaves unknown outcomes reserved", async () => fixture(async path => {
    const first = new EvaluationBudget(path, 1).hooks({});
    await first.onReserve!(intent("unknown", 100));
    await first.onTerminal!(terminal("unknown"));
    const second = new EvaluationBudget(path, 1).hooks({});
    await expect(second.onReserve!(intent("next", 10_000_000))).rejects.toThrow("Evaluation budget exhausted");
  }));

  test("settles known usage without releasing more than the conservative reservation", async () => fixture(async path => {
    const baseReserved: string[] = [];
    const hooks = new EvaluationBudget(path, 1).hooks({
      onReserve: value => { baseReserved.push(value.attemptId); },
      onTerminal: () => ({ acceptedAttemptId: "known" }),
    });
    const attempt = intent("known", 100);
    await hooks.onReserve!(attempt);
    const receipt = await hooks.onTerminal!(terminal("known", 100));
    const ledger = JSON.parse(await readFile(path, "utf8"));
    const reservedInputTokens = Buffer.byteLength(JSON.stringify(attempt.preparedRequest.body), "utf8") + 16_384;
    expect(ledger.entries[0]).toMatchObject({ status: "settled", reservedUsd: reservedInputTokens * 0.25 / 1_000_000 + 100 * 0.75 / 1_000_000,
      usageEstimateUsd: expect.any(Number), providerActualUsd: null });
    expect(baseReserved).toEqual(["known"]);
    expect(receipt).toEqual({ acceptedAttemptId: "known" });
  }));

  test("rejects unknown models and requests without a finite output allowance", async () => fixture(async path => {
    const hooks = new EvaluationBudget(path, 1).hooks({});
    await expect(hooks.onReserve!({ ...intent("other", 1), preparedRequest: { ...intent("other", 1).preparedRequest, catalogId: "katana:grok" } })).rejects.toThrow("rejects unpriced");
    const malformed = intent("missing-limit", 1);
    delete (malformed.preparedRequest.body as Record<string, unknown>).max_output_tokens;
    await expect(hooks.onReserve!(malformed)).rejects.toThrow("explicit provider output-token limit");
  }));

  test("raises reservations from an older ledger framing allowance", async () => fixture(async path => {
    const old = intent("old", 100);
    const oldBytes = Buffer.byteLength(JSON.stringify(old.preparedRequest.body), "utf8");
    const oldReserved = (oldBytes + 1_024) * 0.25 / 1_000_000 + 100 * 0.75 / 1_000_000;
    await Bun.write(path, JSON.stringify({ version: 1, capUsd: 1, entries: [{ attemptId: "old", catalogId: "openai:gpt-6-luna",
      reservedUsd: oldReserved, usageEstimateUsd: 0.0001, providerActualUsd: null, status: "settled" }] }));
    const hooks = new EvaluationBudget(path, 1).hooks({});
    await hooks.onReserve!(intent("new", 10));
    const ledger = JSON.parse(await readFile(path, "utf8"));
    expect(ledger.framingReserveTokens).toBe(16_384);
    expect(ledger.entries[0].reservedUsd).toBe(oldReserved + 15_360 * 0.25 / 1_000_000);
    expect(ledger.entries[0].framingAdjustmentUsd).toBe(15_360 * 0.25 / 1_000_000);
  }));
});
