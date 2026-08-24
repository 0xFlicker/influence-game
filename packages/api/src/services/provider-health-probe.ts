import {
  Phase,
  ProviderAttemptError,
  ProviderExecutionCoordinator,
  createLlmClientFromEnv,
  gameReadyCatalogEntries,
  modelCatalogEntryById,
  type LlmClientConfig,
  type ProviderAttemptOutcome,
  type ProviderAttemptRecord,
  type ProviderProfileId,
} from "@influence/engine";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  acquireProviderHealthProbe,
  completeProviderHealthProbe,
  listProviderHealth,
  type ProviderHealthProbeLease,
  type ProviderHealthStatus,
} from "./provider-health.js";

const PROVIDER_PROBE_TIMEOUT_MS = 20_000;
const PROVIDER_PROBE_INTERVAL_MS = 15_000;

export interface ProviderHealthProbeTarget {
  scopeKey: string;
  providerProfileId: ProviderProfileId;
  catalogId: string;
  modelId: string;
}

export interface ProviderHealthProbeResult {
  target: ProviderHealthProbeTarget;
  outcome: ProviderAttemptOutcome;
  status: ProviderHealthStatus;
}

export interface ProviderHealthProbeObservation {
  outcome: ProviderAttemptOutcome;
  evidence?: ProviderAttemptRecord;
}

export interface ProviderHealthProbeDependencies {
  runProbe?: (
    target: ProviderHealthProbeTarget,
    lease: ProviderHealthProbeLease,
  ) => Promise<ProviderAttemptOutcome | ProviderHealthProbeObservation>;
  env?: NodeJS.ProcessEnv;
  createClientFromEnv?: (
    env: NodeJS.ProcessEnv,
    options: Parameters<typeof createLlmClientFromEnv>[1],
  ) => LlmClientConfig | null;
}

export async function executeProviderHealthProbe(
  db: DrizzleDB,
  input: {
    scopeKey: string;
    owner: string;
    allowBeforeCooldown: boolean;
  },
  dependencies: ProviderHealthProbeDependencies = {},
): Promise<ProviderHealthProbeResult> {
  const target = await resolveProviderHealthProbeTarget(db, input.scopeKey);
  const lease = await acquireProviderHealthProbe(db, input);
  const runProbe = dependencies.runProbe
    ?? ((candidate, currentLease) => runLiveProviderHealthProbe(
      candidate,
      currentLease,
      dependencies.env ?? process.env,
      dependencies.createClientFromEnv ?? createLlmClientFromEnv,
    ));
  let observation: ProviderHealthProbeObservation;
  try {
    observation = normalizeProbeObservation(await runProbe(target, lease));
  } catch (error) {
    observation = {
      outcome: {
        kind: "service_error",
        message: error instanceof Error ? error.message : "Provider health probe failed",
        retryable: true,
      },
    };
  }
  const status = await completeProviderHealthProbe(db, { ...lease, ...observation });
  return { target, outcome: observation.outcome, status };
}

export async function probeDueTransientProviderHealth(
  db: DrizzleDB,
  dependencies: ProviderHealthProbeDependencies = {},
): Promise<{ attempted: number; closed: number; remainedOpen: number; skipped: number }> {
  const now = Date.now();
  const due = (await listProviderHealth(db)).filter((status) => (
    status.state === "open"
    && isTransientReason(status.reason)
    && status.cooldownUntil !== null
    && Date.parse(status.cooldownUntil) <= now
  ));
  let closed = 0;
  let remainedOpen = 0;
  let skipped = 0;
  for (const status of due) {
    try {
      const result = await executeProviderHealthProbe(db, {
        scopeKey: status.scopeKey,
        owner: "provider-health-runtime",
        allowBeforeCooldown: false,
      }, dependencies);
      if (result.status.state === "closed") closed += 1;
      else remainedOpen += 1;
    } catch {
      // Lease contention, a newer revision, or a concurrent operator probe is
      // expected; the durable scope remains authoritative and retryable.
      skipped += 1;
    }
  }
  return { attempted: due.length, closed, remainedOpen, skipped };
}

export async function startProviderHealthProbeRuntime(
  db: DrizzleDB,
  options: ProviderHealthProbeDependencies & { intervalMs?: number } = {},
): Promise<{ runOnce: () => ReturnType<typeof probeDueTransientProviderHealth>; stop: () => void }> {
  let inFlight: ReturnType<typeof probeDueTransientProviderHealth> | null = null;
  const runOnce = () => {
    if (inFlight) return inFlight;
    const current = probeDueTransientProviderHealth(db, options);
    inFlight = current;
    void current.then(
      () => { if (inFlight === current) inFlight = null; },
      () => { if (inFlight === current) inFlight = null; },
    );
    return current;
  };
  await runOnce();
  const timer = setInterval(() => {
    void runOnce().catch(() => undefined);
  }, options.intervalMs ?? PROVIDER_PROBE_INTERVAL_MS);
  timer.unref();
  return { runOnce, stop: () => clearInterval(timer) };
}

async function resolveProviderHealthProbeTarget(
  db: DrizzleDB,
  scopeKey: string,
): Promise<ProviderHealthProbeTarget> {
  const health = (await db.select().from(schema.providerHealthStates)
    .where(eq(schema.providerHealthStates.scopeKey, scopeKey)))[0];
  if (!health) throw new Error("Provider health scope was not found");
  const lastAttempt = health.lastAttemptId
    ? (await db.select({
        catalogId: schema.providerCallAttempts.catalogId,
        modelId: schema.providerCallAttempts.modelName,
      }).from(schema.providerCallAttempts)
        .where(eq(schema.providerCallAttempts.id, health.lastAttemptId)))[0]
    : undefined;
  const catalogId = health.catalogId
    ?? lastAttempt?.catalogId
    ?? gameReadyCatalogEntries().find(
      (entry) => entry.providerProfileId === health.providerProfileId,
    )?.id;
  if (!catalogId) throw new Error(`No probe model is available for ${health.providerProfileId}`);
  const catalog = modelCatalogEntryById(catalogId);
  if (!catalog || catalog.providerProfileId !== health.providerProfileId) {
    throw new Error(`Provider health probe model ${catalogId} is unavailable`);
  }
  return {
    scopeKey,
    providerProfileId: catalog.providerProfileId,
    catalogId,
    modelId: lastAttempt?.modelId ?? catalog.modelId,
  };
}

async function runLiveProviderHealthProbe(
  target: ProviderHealthProbeTarget,
  lease: ProviderHealthProbeLease,
  env: NodeJS.ProcessEnv,
  createClient: NonNullable<ProviderHealthProbeDependencies["createClientFromEnv"]>,
): Promise<ProviderHealthProbeObservation> {
  const body = {
    model: target.modelId,
    messages: [{ role: "user" as const, content: "Reply with OK." }],
    ...(target.providerProfileId === "openai"
      ? { max_completion_tokens: 16 }
      : { max_tokens: 16 }),
  };
  const config = createClient(env, {
    providerProfileId: target.providerProfileId,
    maxRetries: 0,
    timeout: PROVIDER_PROBE_TIMEOUT_MS,
    flexProcessing: false,
  });
  if (!config) {
    const outcome = {
      kind: "configuration",
      message: `Provider credentials are unavailable for ${target.providerProfileId}`,
      retryable: false,
    } as const;
    return {
      outcome,
      evidence: syntheticProbeEvidence(target, lease, body, outcome),
    };
  }
  let evidence: ProviderAttemptRecord | undefined;
  const call = new ProviderExecutionCoordinator({
    hooks: {
      onTerminal: (record) => { evidence = record; },
    },
  }).startCall({
    gameId: `provider-health:${target.scopeKey}`,
    actor: { id: lease.owner, name: lease.owner, role: "system" },
    action: "provider_health_probe",
    phase: Phase.LOBBY,
    logicalCallOrdinal: lease.revision,
  });
  try {
    await call.execute({
      preparedRequest: {
        requestShape: "chat_completions",
        providerProfileId: target.providerProfileId,
        catalogId: target.catalogId,
        model: target.modelId,
        body,
      },
      maxAttempts: 1,
      dispatch: async ({ requestOptions }) =>
        config.client.chat.completions.create(body, requestOptions),
      validate: (response) => response.choices[0]?.message?.content
        ? { status: "usable" as const, value: response }
        : {
            status: "unusable" as const,
            kind: "empty_output" as const,
            message: "Provider health probe returned no text",
            retryable: false,
          },
    });
    return { outcome: { kind: "usable" }, ...(evidence && { evidence }) };
  } catch (error) {
    if (error instanceof ProviderAttemptError) {
      return { outcome: error.outcome, evidence: evidence ?? error.record };
    }
    throw error;
  }
}

function normalizeProbeObservation(
  value: ProviderAttemptOutcome | ProviderHealthProbeObservation,
): ProviderHealthProbeObservation {
  return "outcome" in value ? value : { outcome: value };
}

function syntheticProbeEvidence(
  target: ProviderHealthProbeTarget,
  lease: ProviderHealthProbeLease,
  body: Record<string, unknown>,
  outcome: Exclude<ProviderAttemptOutcome, { kind: "usable" }>,
): ProviderAttemptRecord {
  const timestamp = new Date().toISOString();
  const preparedRequest = {
    requestShape: "chat_completions" as const,
    providerProfileId: target.providerProfileId,
    catalogId: target.catalogId,
    model: target.modelId,
    body,
  };
  return {
    coordinate: {
      gameId: `provider-health:${target.scopeKey}`,
      actor: { id: lease.owner, name: lease.owner, role: "system" },
      action: "provider_health_probe",
      phase: Phase.LOBBY,
      logicalCallOrdinal: lease.revision,
    },
    attemptOrdinal: 1,
    attemptId: randomUUID(),
    preparedRequest,
    rawRequest: preparedRequest,
    startedAt: timestamp,
    completedAt: timestamp,
    latencyMs: 0,
    outcome,
    disposition: "exhausted",
    rawResponse: { body: { error: outcome.message } },
  };
}

function isTransientReason(reason: ProviderHealthStatus["reason"]): boolean {
  return reason === "service_error"
    || reason === "transport_timeout"
    || reason === "transport_error";
}
