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
  type ProviderHealthProbeTarget,
} from "./provider-health-probe.js";

describe("provider health probes", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
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
    const evidence = (await db.select().from(schema.providerHealthProbeEvidence))[0]!;
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
    const evidence = (await db.select().from(schema.providerHealthProbeEvidence))[0]!;
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
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = executeProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-a",
      allowBeforeCooldown: true,
    }, {
      runProbe: async () => {
        calls += 1;
        await blocked;
        return { kind: "usable" };
      },
    });
    await waitFor(() => calls === 1);

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

    release?.();
    await expect(first).resolves.toMatchObject({ status: { state: "closed" } });
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
      logicalCallOrdinal: lease.revision,
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition was not reached");
}
