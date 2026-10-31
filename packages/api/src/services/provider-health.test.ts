import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ProviderCircuitOpenError,
  resolveProviderManifestFromGameConfig,
  type ProviderAttemptOutcome,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import {
  acquireProviderHealthProbe,
  assertProviderDispatchHealthInTransaction,
  checkDailyProviderAdmission,
  completeProviderHealthProbe,
  listProviderHealth,
  projectDailyProviderAdmissionImpact,
  providerHealthEntryScope,
  providerHealthFlexScope,
  resolveOpenAIServiceTier,
  providerHealthProviderScope,
  recordProviderHealthOutcomeInTransaction,
  type ProviderHealthPolicy,
} from "./provider-health.js";

const TEST_POLICY: ProviderHealthPolicy = {
  transientFailureThreshold: 3,
  transientWindowMs: 60_000,
  transientCooldownMs: 60_000,
  probeLeaseMs: 30_000,
};

const dailyManifest = resolveProviderManifestFromGameConfig({
  modelSelection: {
    catalogId: "openai:gpt-5.6-luna",
    reasoningPolicy: "action-policy",
  },
  providerManifest: [
    {
      catalogId: "openai:gpt-5.6-luna",
      reasoningPolicy: "action-policy",
    },
    {
      catalogId: "katana:grok-4-5",
      reasoningPolicy: "action-policy",
      maxCallsPerGame: 4,
    },
  ],
});

function failure(kind: Exclude<ProviderAttemptOutcome["kind"], "usable">): ProviderAttemptOutcome {
  return { kind, message: kind, retryable: false };
}

async function record(
  db: DrizzleDB,
  kind: ProviderAttemptOutcome["kind"],
  overrides: { providerProfileId?: string; catalogId?: string | null } = {},
): Promise<void> {
  const outcome: ProviderAttemptOutcome = kind === "usable"
    ? { kind: "usable" }
    : failure(kind);
  await db.transaction((tx) => recordProviderHealthOutcomeInTransaction(tx, {
    providerProfileId: overrides.providerProfileId ?? "openai",
    catalogId: overrides.catalogId === undefined
      ? "openai:gpt-5.6-luna"
      : overrides.catalogId,
    outcome,
  }, TEST_POLICY));
}

describe("provider health circuit authority", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });


  test("Flex capacity cooldown survives new callers, admits standard, and expires within the bounded policy", async () => {
    const route = { providerProfileId: "openai", catalogId: "openai:gpt-6-luna" };
    await db.transaction(tx => recordProviderHealthOutcomeInTransaction(tx, { ...route, flexCapacity: true,
      outcome: { kind: "rate_limit", retryable: true, message: "capacity", httpStatus: 429, errorCode: "flex_unavailable", retryAfterMs: 86_400_000 } }));
    expect(await resolveOpenAIServiceTier(db, route.catalogId)).toBe("default");
    await expect(db.transaction(tx => assertProviderDispatchHealthInTransaction(tx, { ...route, serviceTier: "default" }))).resolves.toBeUndefined();
    await expect(db.transaction(tx => assertProviderDispatchHealthInTransaction(tx, { ...route, serviceTier: "flex" }))).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    const key = providerHealthFlexScope(route.catalogId).scopeKey;
    const row = (await listProviderHealth(db)).find(row => row.scopeKey === key)!;
    expect(Date.parse(row.cooldownUntil!) - Date.parse(row.openedAt!)).toBe(900_000);
    await db.update(schema.providerHealthStates).set({ cooldownUntil: new Date(0).toISOString() }).where(eq(schema.providerHealthStates.scopeKey, key));
    expect(await resolveOpenAIServiceTier(db, route.catalogId)).toBe("flex");
    expect(await checkDailyProviderAdmission(db, resolveProviderManifestFromGameConfig({ providerManifest: [{ catalogId: route.catalogId }] }))).toEqual({ ok: true });
  });

  test.each(["service_error", "rate_limit"] as const)("%s Retry-After cools only GLM across actors and reopens after the deadline", async kind => {
    const glm = { providerProfileId: "katana", catalogId: "katana:glm-5-3-flash-private" };
    const result = await db.transaction(tx => recordProviderHealthOutcomeInTransaction(tx, { ...glm,
      outcome: { kind, message: "origin_bad_gateway", retryable: true, retryAfterMs: 60_000 } }));
    expect(result.circuit).toMatchObject({ scopeKey: `entry:${glm.catalogId}`, haltManifest: false });
    const [row] = await listProviderHealth(db);
    expect(Date.parse(row!.cooldownUntil!) - Date.parse(row!.openedAt!)).toBe(60_000);
    for (let actor = 0; actor < 2; actor++) {
      await expect(db.transaction(tx => assertProviderDispatchHealthInTransaction(tx, glm))).rejects.toMatchObject({ haltManifest: false });
    }
    await expect(db.transaction(tx => assertProviderDispatchHealthInTransaction(tx, { providerProfileId: "katana", catalogId: "katana:grok-4-6" }))).resolves.toBeUndefined();
    const manifest = resolveProviderManifestFromGameConfig({ providerManifest: [{ catalogId: glm.catalogId }] });
    expect(await checkDailyProviderAdmission(db, manifest)).toMatchObject({ ok: false, code: "provider_admission_closed" });
    await db.update(schema.providerHealthStates).set({ cooldownUntil: new Date(0).toISOString() }).where(eq(schema.providerHealthStates.scopeKey, `entry:${glm.catalogId}`));
    expect(await checkDailyProviderAdmission(db, manifest)).toEqual({ ok: true });
    await expect(db.transaction(tx => assertProviderDispatchHealthInTransaction(tx, glm))).resolves.toBeUndefined();
    expect((await listProviderHealth(db)).find(row => row.catalogId === glm.catalogId)).toMatchObject({ state: "closed", cooldownUntil: null });
  });

  test("request refusals, ambiguous client errors, and rate limits without Retry-After stay call-scoped", async () => {
    await record(db, "refusal");
    await record(db, "request_error");
    await record(db, "context_overflow");
    await record(db, "rate_limit");

    expect(await listProviderHealth(db)).toEqual([]);
  });

  test("authentication opens the provider immediately and survives later reads", async () => {
    await record(db, "authentication");

    expect(await listProviderHealth(db)).toEqual([
      expect.objectContaining({
        scopeKey: "provider:openai",
        state: "open",
        reason: "authentication",
        consecutiveFailureCount: 1,
      }),
    ]);
    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }))).rejects.toBeInstanceOf(ProviderCircuitOpenError);
  });

  test("configuration opens only the affected catalog entry", async () => {
    await record(db, "configuration", {
      providerProfileId: "katana",
      catalogId: "katana:grok-4-5",
    });

    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "katana",
      catalogId: "katana:grok-4-5",
    }))).rejects.toMatchObject({
      scopeKey: "entry:katana:grok-4-5",
      haltManifest: false,
    });
    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "katana",
      catalogId: "katana:glm-5-2",
    }))).resolves.toBeUndefined();
  });

  test("transient failures open only at the configured rolling-window threshold", async () => {
    await record(db, "service_error");
    await record(db, "transport_timeout");
    expect(await listProviderHealth(db)).toEqual([
      expect.objectContaining({ state: "closed", consecutiveFailureCount: 2 }),
    ]);

    await record(db, "transport_error");
    expect(await listProviderHealth(db)).toEqual([
      expect.objectContaining({
        state: "open",
        reason: "transport_error",
        consecutiveFailureCount: 3,
        cooldownUntil: expect.any(String),
      }),
    ]);
  });

  test("concurrent probe acquisition grants one fenced lease", async () => {
    await record(db, "authentication");
    const results = await Promise.allSettled([
      acquireProviderHealthProbe(db, {
        scopeKey: "provider:openai",
        owner: "admin-a",
        allowBeforeCooldown: true,
      }, TEST_POLICY),
      acquireProviderHealthProbe(db, {
        scopeKey: "provider:openai",
        owner: "admin-b",
        allowBeforeCooldown: true,
      }, TEST_POLICY),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await listProviderHealth(db))[0]).toMatchObject({ state: "probing" });
  });

  test("an expired probe lease is recovered and stale completion cannot close the newer revision", async () => {
    await record(db, "authentication");
    const oldLease = await acquireProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-a",
      allowBeforeCooldown: true,
    }, TEST_POLICY);
    await db.update(schema.providerHealthStates).set({
      probeLeaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    }).where(eq(schema.providerHealthStates.scopeKey, oldLease.scopeKey));

    const newLease = await acquireProviderHealthProbe(db, {
      scopeKey: "provider:openai",
      owner: "admin-b",
      allowBeforeCooldown: true,
    }, TEST_POLICY);
    expect(newLease.revision).toBeGreaterThan(oldLease.revision);
    await expect(completeProviderHealthProbe(db, {
      ...oldLease,
      outcome: { kind: "usable" },
    }, TEST_POLICY)).rejects.toMatchObject({ code: "stale_probe" });
    await expect(completeProviderHealthProbe(db, {
      ...newLease,
      outcome: { kind: "usable" },
    }, TEST_POLICY)).resolves.toMatchObject({ state: "closed", reason: null });
  });

  test("transient cooldown blocks early probing and grants one probe afterward", async () => {
    await record(db, "service_error");
    await record(db, "service_error");
    await record(db, "service_error");
    await expect(acquireProviderHealthProbe(db, {
      scopeKey: "entry:openai:gpt-5.6-luna",
      owner: "automatic-probe",
      allowBeforeCooldown: false,
    }, TEST_POLICY)).rejects.toMatchObject({ code: "cooldown_active" });

    await db.update(schema.providerHealthStates).set({
      cooldownUntil: new Date(Date.now() - 1_000).toISOString(),
    }).where(eq(schema.providerHealthStates.scopeKey, "entry:openai:gpt-5.6-luna"));
    await expect(acquireProviderHealthProbe(db, {
      scopeKey: "entry:openai:gpt-5.6-luna",
      owner: "automatic-probe",
      allowBeforeCooldown: false,
    }, TEST_POLICY)).resolves.toMatchObject({ scopeKey: "entry:openai:gpt-5.6-luna" });
  });

  test("opening between an observation and reservation blocks the ordinary call", async () => {
    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }))).resolves.toBeUndefined();
    await record(db, "authentication");
    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }))).rejects.toMatchObject({ scopeKey: "provider:openai" });
  });

  test("healthy reservations for separate games do not serialize on global health", async () => {
    await db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }));
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      firstReady = resolve;
    });
    const first = db.transaction(async (tx) => {
      await assertProviderDispatchHealthInTransaction(tx, {
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
      });
      firstReady();
      await holdFirst;
    });
    await ready;
    await expect(Promise.race([
      db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
      })),
      Bun.sleep(250).then(() => "timed-out" as const),
    ])).resolves.toBeUndefined();
    releaseFirst();
    await first;
  });

  test("a breaker open waits behind prior reservations and blocks later ones", async () => {
    await db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }));
    let releaseReservation!: () => void;
    const holdReservation = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });
    let reservationReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      reservationReady = resolve;
    });
    const reservation = db.transaction(async (tx) => {
      await assertProviderDispatchHealthInTransaction(tx, {
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
      });
      reservationReady();
      await holdReservation;
    });
    await ready;
    let openingSettled = false;
    const opening = record(db, "authentication").then(() => {
      openingSettled = true;
    });
    await Bun.sleep(20);
    expect(openingSettled).toBeFalse();
    releaseReservation();
    await reservation;
    await opening;
    await expect(db.transaction((tx) => assertProviderDispatchHealthInTransaction(tx, {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    }))).rejects.toBeInstanceOf(ProviderCircuitOpenError);
  });

  test("Daily admission is fail-closed while its primary scope is open", async () => {
    expect(await checkDailyProviderAdmission(db, dailyManifest)).toEqual({ ok: true });
    await record(db, "authentication");
    expect(await checkDailyProviderAdmission(db, dailyManifest)).toMatchObject({
      ok: false,
      code: "provider_admission_closed",
      scopeKey: "provider:openai",
    });
  });

  test("Daily impact follows the sealed primary rather than fallback health", async () => {
    await record(db, "configuration", {
      providerProfileId: "katana",
      catalogId: "katana:grok-4-5",
    });
    expect(projectDailyProviderAdmissionImpact(
      await listProviderHealth(db),
      dailyManifest,
    )).toEqual({
      dailyAdmissionPaused: false,
      affectedDailyPrimaryScopeKeys: [
        "provider:openai",
        "entry:openai:gpt-5.6-luna",
      ],
    });

    await record(db, "configuration", {
      providerProfileId: "openai",
      catalogId: "openai:gpt-5.6-luna",
    });
    expect(projectDailyProviderAdmissionImpact(
      await listProviderHealth(db),
      dailyManifest,
    ).dailyAdmissionPaused).toBeTrue();
  });

  test("scope constructors keep provider and entry authority distinct", () => {
    expect(providerHealthProviderScope("katana")).toEqual({
      scopeKey: "provider:katana",
      scopeKind: "provider",
      providerProfileId: "katana",
      catalogId: null,
    });
    expect(providerHealthEntryScope("katana", "katana:glm-5-2")).toEqual({
      scopeKey: "entry:katana:glm-5-2",
      scopeKind: "entry",
      providerProfileId: "katana",
      catalogId: "katana:glm-5-2",
    });
  });
});
