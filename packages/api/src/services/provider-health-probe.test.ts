import { loadPayloads } from "./payload-storage.js";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  Phase,
  PROVIDER_ATTEMPT_HEADER,
  type LlmClientConfig,
  type ProviderAttemptRecord,
} from "@influence/engine";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import {
  listProviderHealth,
  recordProviderHealthOutcomeInTransaction,
  type ProviderHealthProbeLease,
} from "./provider-health.js";
import {
  executeProviderHealthProbe,
  probeDueTransientProviderHealth,
  startProviderHealthProbeRuntime,
  type ProviderHealthProbeTarget,
} from "./provider-health-probe.js";

describe("provider health probes", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("local thinking probes use the configured deadline and a lease that outlives it", async () => {
    const scopeKey = "entry:lm-studio:test-local";
    await db.transaction(tx => recordProviderHealthOutcomeInTransaction(tx, {
      providerProfileId: "lm-studio", catalogId: "lm-studio:test-local",
      outcome: { kind: "configuration", message: "fixture", retryable: false },
    }));
    const result = await executeProviderHealthProbe(db, { scopeKey, owner: "test", allowBeforeCooldown: true }, {
      env: { INFLUENCE_LM_STUDIO_TIMEOUT_MS: "7200000" },
      createClientFromEnv: (_env, options) => {
        expect(options?.timeout).toBe(7_200_000);
        return {
          client: { chat: { completions: { create: async (body: { max_tokens: number }) => {
            expect(body.max_tokens).toBe(2048);
            const [row] = await db.select().from(schema.providerHealthStates).where(eq(schema.providerHealthStates.scopeKey, scopeKey));
            expect(Date.parse(row!.probeLeaseExpiresAt!) - Date.now()).toBeGreaterThan(7_200_000);
            return { id: "local-probe", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "OK" } }] };
          } } } } as unknown as LlmClientConfig["client"], apiKeySource: "test", providerLabel: "local", providerProfileId: "lm-studio",
          toolChoiceMode: "required", flexProcessingEnabled: false,
        };
      },
    });
    expect(result.status.state).toBe("closed");
  });

  test("a long probe does not block runtime startup and stop cancels its transport", async () => {
    await openAuthCircuit(db);
    await db.update(schema.providerHealthStates).set({ reason: "transport_timeout", cooldownUntil: new Date(0).toISOString() });
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const runtime = await startProviderHealthProbeRuntime(db, {
      createClientFromEnv: () => ({
        client: { responses: { create: async (_body: unknown, options: { signal: AbortSignal }) => {
          ready();
          return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
        } } } as unknown as LlmClientConfig["client"], apiKeySource: "test", providerLabel: "OpenAI", providerProfileId: "openai",
        toolChoiceMode: "required", flexProcessingEnabled: false,
      }),
    });
    try {
      await started;
      const sweep = runtime.runOnce();
      runtime.stop();
      expect(await sweep).toMatchObject({ attempted: 1, remainedOpen: 1 });
    } finally { runtime.stop(); }
  });

  test("a requested usable probe closes the current auth breaker", async () => {
    await openAuthCircuit(db);

    const result = await executeProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-user",
      allowBeforeCooldown: true,
    }, {
      runProbe: async (target) => {
        expect(target).toMatchObject({
          providerProfileId: "openai",
        });
        expect(target.catalogId).toStartWith("openai:");
        expect(target.modelId.length).toBeGreaterThan(0);
        return { kind: "usable" };
      },
    });

    expect(result.status).toMatchObject({ state: "closed", reason: null });
    expect(result.outcome).toEqual({ kind: "usable" });
  });

  test("a failed requested probe leaves the circuit open with current evidence", async () => {
    await openAuthCircuit(db);

    const result = await executeProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-user",
      allowBeforeCooldown: true,
    }, {
      runProbe: async (target, lease) => {
        const outcome = {
          kind: "authentication" as const,
          message: "credential still rejected",
          retryable: false,
        };
        return {
          outcome,
          evidence: probeEvidence(target, lease, outcome),
        };
      },
    });

    expect(result.status).toMatchObject({
      state: "open",
      reason: "authentication",
      probeLeaseOwner: null,
      lastProbeEvidenceId: expect.stringMatching(/^sha256:/),
    });
    const evidence = (await loadPayloads(db.select().from(schema.providerHealthProbeEvidence)))[0]!;
    expect(evidence).toMatchObject({
      id: result.status.lastProbeEvidenceId,
      scopeKey: "provider:openai",
      record: {
        outcome: { kind: "authentication", message: "credential still rejected" },
        rawRequest: { body: { messages: [{ content: "Reply with OK." }] } },
        rawResponse: { status: 401, body: { error: "invalid api key" } },
      },
    });
  });

  test("an unavailable probe catalog is rejected before acquiring the probe lease", async () => {
    await db.transaction((tx) => recordProviderHealthOutcomeInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
      outcome: { kind: "configuration", message: "missing model", retryable: false },
    }));
    const entryScope = (await listProviderHealth(db)).find(
      (status) => status.scopeKind === "entry",
    )!;
    await db.update(schema.providerHealthStates).set({
      catalogId: "katana:glm-5-2",
      lastAttemptId: null,
    }).where(eq(schema.providerHealthStates.scopeKey, entryScope.scopeKey));

    await expect(executeProviderHealthProbe(db, {
      scopeKey: entryScope.scopeKey,
      owner: "admin-user",
      allowBeforeCooldown: true,
    })).rejects.toThrow("Provider health probe model katana:glm-5-2 is unavailable");

    expect((await listProviderHealth(db)).find(
      (status) => status.scopeKey === entryScope.scopeKey,
    )).toMatchObject({
      state: "open",
      probeLeaseOwner: null,
      probeLeaseExpiresAt: null,
      lastProbeAt: null,
    });
  });

  test("live probes pass coordinator request options into the SDK and persist evidence", async () => {
    await openAuthCircuit(db);
    let receivedRequestOptions: Record<string, unknown> | undefined;
    const createClientFromEnv = (): LlmClientConfig => ({
      client: {
        responses: {
          create: async (_body: unknown, requestOptions?: Record<string, unknown>) => {
            receivedRequestOptions = requestOptions;
            return {
              id: "probe-response-id",
              _request_id: "probe-request-id",
              status: "completed",
              output: [{
                type: "message",
                content: [{ type: "output_text", text: "OK" }],
              }],
            };
          },
        },
      } as unknown as LlmClientConfig["client"],
      apiKeySource: "test",
      providerLabel: "OpenAI",
      providerProfileId: "openai",
      toolChoiceMode: "required",
      flexProcessingEnabled: false,
      openAIServiceTier: "auto",
    });

    const result = await executeProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-user",
      allowBeforeCooldown: true,
    }, {
      env: { OPENAI_API_KEY: "test-key" },
      createClientFromEnv,
    });

    expect(receivedRequestOptions).toMatchObject({
      maxRetries: 0,
      headers: {
        [PROVIDER_ATTEMPT_HEADER]: expect.any(String),
        "x-influence-no-flex-transport-retry": "1",
      },
    });
    expect(result.status).toMatchObject({
      state: "closed",
      probeLeaseOwner: null,
      lastProbeEvidenceId: expect.stringMatching(/^sha256:/),
    });
    const evidence = (await loadPayloads(db.select().from(schema.providerHealthProbeEvidence)))[0]!;
    expect(evidence.record).toMatchObject({
      requestId: "probe-request-id",
      preparedRequest: { transport: "openai.responses" },
      outcome: { kind: "usable" },
      disposition: "accepted",
    });
  });

  test("concurrent requested probes execute only one provider call", async () => {
    await openAuthCircuit(db);
    let calls = 0;
    const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
    const { promise: started, resolve: signalStarted } = Promise.withResolvers<void>();
    const first = executeProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-a",
      allowBeforeCooldown: true,
    }, {
      runProbe: async () => {
        calls += 1;
        signalStarted();
        await blocked;
        return { kind: "usable" };
      },
    });
    try {
      await Promise.race([
        started,
        first.then(() => { throw new Error("Probe completed before entering runProbe"); }),
      ]);

      await expect(executeProviderHealthProbe(db, {
        scopeKey: "provider:openai",
        owner: "admin-b",
        allowBeforeCooldown: true,
      }, {
        runProbe: async () => {
          calls += 1;
          return { kind: "usable" };
        },
      })).rejects.toMatchObject({ code: "probe_active" });
    } finally {
      release();
      await expect(first).resolves.toMatchObject({ status: { state: "closed" } });
    }
    expect(calls).toBe(1);
  });

  test("automatic probing waits for cooldown and closes one due transient circuit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await db.transaction((tx) => recordProviderHealthOutcomeInTransaction(tx, {
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
        outcome: { kind: "service_error", message: "temporary outage", retryable: true },
      }));
    }
    expect(await probeDueTransientProviderHealth(db, {
      runProbe: async () => ({ kind: "usable" }),
    })).toEqual({ attempted: 0, closed: 0, remainedOpen: 0, skipped: 0 });

    await db.update(schema.providerHealthStates).set({
      cooldownUntil: new Date(Date.now() - 1_000).toISOString(),
    }).where(eq(schema.providerHealthStates.scopeKey, "provider:openai"));
    let calls = 0;
    expect(await probeDueTransientProviderHealth(db, {
      runProbe: async () => {
        calls += 1;
        return { kind: "usable" };
      },
    })).toEqual({ attempted: 1, closed: 1, remainedOpen: 0, skipped: 0 });
    expect(calls).toBe(1);
    expect((await listProviderHealth(db))[0]).toMatchObject({ state: "closed" });
  });
});

async function openAuthCircuit(db: DrizzleDB): Promise<void> {
  await db.transaction((tx) => recordProviderHealthOutcomeInTransaction(tx, {
    providerProfileId: "openai",
    catalogId: "openai:gpt-5.6-luna",
    outcome: { kind: "authentication", message: "expired credential", retryable: false },
  }));
}

function probeEvidence(
  target: ProviderHealthProbeTarget,
  lease: Pick<ProviderHealthProbeLease, "owner" | "revision">,
  outcome: Exclude<ProviderAttemptRecord["outcome"], { kind: "usable" }>,
): ProviderAttemptRecord {
  return {
    coordinate: {
      gameId: `provider-health:${target.scopeKey}`,
      actor: { id: lease.owner, name: lease.owner, role: "system" },
      action: "provider_health_probe",
      phase: Phase.LOBBY,
      semantic: {
        version: 1,
        kind: "provider_health",
        providerProfileId: target.providerProfileId,
        revision: lease.revision,
      },
    },
    attemptOrdinal: 1,
    attemptId: "probe-attempt",
    preparedRequest: {
      transport: "katana.chat_completions",
      providerProfileId: target.providerProfileId,
      catalogId: target.catalogId,
      model: target.modelId,
      body: { messages: [{ content: "Reply with OK." }] },
    },
    rawRequest: {
      transport: "katana.chat_completions",
      providerProfileId: target.providerProfileId,
      catalogId: target.catalogId,
      model: target.modelId,
      body: { messages: [{ content: "Reply with OK." }] },
    },
    startedAt: "2026-08-23T00:00:00.000Z",
    completedAt: "2026-08-23T00:00:01.000Z",
    latencyMs: 1_000,
    outcome,
    disposition: "exhausted",
    rawResponse: { status: 401, body: { error: "invalid api key" } },
  };
}
