import sharp from "sharp";
import { beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createAgentProfileRoutes } from "../routes/agent-profiles.js";
import { createSessionToken } from "../middleware/auth.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { setupTestDB } from "./test-utils.js";
import {
  reserveInference,
  dispatchInference,
  settleInference,
  recoverExpiredImageExecutions,
  heartbeatImageExecution,
} from "../services/inference-allowances.js";
import {
  requestCharacterReference,
  decideCharacterReference,
  processCharacterReference,
  retryCharacterReference,
} from "../services/character-reference-jobs.js";
import {
  listAgentGenerations,
  cancelAgentGeneration,
} from "../services/agent-generations.js";
import {
  characterGenerationInput,
  processMockCharacterReference,
} from "./character-generation-fixture.js";
let db: DrizzleDB;
const owner = "image-recovery-owner",
  other = "image-recovery-other";
beforeEach(async () => {
  db = await setupTestDB();
  await db.insert(schema.users).values([{ id: owner }, { id: other }]);
});
async function reserve(id = randomUUID()) {
  return db.transaction((tx) =>
    reserveInference(tx, {
      id,
      userId: owner,
      category: "image",
      inputHash: id,
    }),
  );
}
test("activity exposes queued work before an agent exists, prevents duplicates, and isolates owners", async () => {
  const input = characterGenerationInput(randomUUID(), "Pending Agent");
  const queued = await requestCharacterReference(db, owner, input, "");
  expect(queued!.status).toBe("queued");
  expect(await listAgentGenerations(db, other)).toEqual([]);
  expect(await listAgentGenerations(db, owner)).toMatchObject([
    {
      id: input.requestId,
      status: "queued",
      blocksGeneration: true,
      agentId: null,
    },
  ]);
  expect((await requestCharacterReference(db, owner, input, ""))!.id).toBe(
    input.requestId,
  );
  await expect(
    requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "Duplicate"),
      "",
    ),
  ).rejects.toMatchObject({ code: "generation_pending" });
  expect(await db.select().from(schema.characterReferenceJobs)).toHaveLength(1);
  await expect(
    cancelAgentGeneration(db, other, input.requestId, "reference"),
  ).rejects.toMatchObject({ status: 404 });
  await cancelAgentGeneration(db, owner, input.requestId, "reference");
  await cancelAgentGeneration(db, owner, input.requestId, "reference");
  expect(await listAgentGenerations(db, owner)).toEqual([]);
  expect(await db.select().from(schema.inferenceReservations)).toHaveLength(0);
});
test("concurrent starts admit one job rather than two hidden queued requests", async () => {
  const results = await Promise.allSettled([
    requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "One"),
      "",
    ),
    requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "Two"),
      "",
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.select().from(schema.characterReferenceJobs)).toHaveLength(1);
});
test("activity routes enforce authentication, owner isolation and a scalar source", async () => {
  process.env.JWT_SECRET = "image-activity-test";
  const app = new Hono();
  app.route("/", createAgentProfileRoutes(db));
  const id = randomUUID();
  await requestCharacterReference(
    db,
    owner,
    characterGenerationInput(id, "Private pending image"),
    "",
  );
  const url = "/api/agent-profiles/generations";
  const headers = {
    Authorization: `Bearer ${await createSessionToken(owner)}`,
    "Content-Type": "application/json",
  };
  expect((await app.request(url)).status).toBe(401);
  expect(await (await app.request(url, { headers })).json()).toMatchObject([
    { id, status: "queued" },
  ]);
  const otherHeaders = {
    ...headers,
    Authorization: `Bearer ${await createSessionToken(other)}`,
  };
  expect(
    await (await app.request(url, { headers: otherHeaders })).json(),
  ).toEqual([]);
  expect(
    (
      await app.request(`${url}/${id}/cancel`, {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify({ source: "reference" }),
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request(`${url}/${id}/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source: ["reference"] }),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(`${url}/${id}/cancel`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source: "reference" }),
      })
    ).status,
  ).toBe(200);
});
test("cancellation before image reservation prevents paid dispatch and refunds its temporary hold", async () => {
  const id = randomUUID();
  await requestCharacterReference(
    db,
    owner,
    characterGenerationInput(id, "Cancelled before dispatch"),
    "",
  );
  const locked = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const blocker = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const waitForQueue = async (count: number) => {
    for (let i = 0; i < 100; i++) {
      const result =
        await db.execute(sql`SELECT count(*)::int AS count FROM pg_locks
        WHERE locktype='advisory' AND NOT granted AND objid=(hashtext(${owner})::bigint & 4294967295)::oid
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`);
      if (Number(result[0]?.count) >= count) return;
      await Bun.sleep(10);
    }
    throw new Error("Worker did not reach the dispatch boundary");
  };
  const cancellation = cancelAgentGeneration(db, owner, id, "reference");
  let work: Promise<number> | undefined;
  try {
    await waitForQueue(1);
    work = processMockCharacterReference(db, new Uint8Array());
    await waitForQueue(2);
  } finally {
    release.resolve();
    await blocker;
    await cancellation;
  }
  expect(await work).toBe(0);
  expect(
    (await db.select().from(schema.characterReferenceJobs))[0]!.status,
  ).toBe("discarded");
  expect(await db.select().from(schema.visualRenderAttempts)).toHaveLength(0);
  expect(
    (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
  ).toBe(25);
});
test("undispatched cancellation refunds once; dispatched cancellation preserves charges and frees capacity", async () => {
  const first = await reserve();
  await cancelAgentGeneration(db, owner, first.id, "reservation");
  await cancelAgentGeneration(db, owner, first.id, "reservation");
  expect(
    (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
  ).toBe(25);
  const second = await reserve();
  await db.transaction((tx) => dispatchInference(tx, second.id, owner));
  await cancelAgentGeneration(db, owner, second.id, "reservation");
  const [retained] = await db
    .select()
    .from(schema.inferenceReservations)
    .where(eq(schema.inferenceReservations.id, second.id));
  expect(retained).toMatchObject({
    state: "uncertain",
    finishedAt: null,
    executionReleaseReason: "cancelled",
  });
  expect(retained!.executionReleasedAt).toBeTruthy();
  expect(
    (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
  ).toBe(24);
  expect(await heartbeatImageExecution(db, owner, second.id)).toBe(false);
  await expect(
    db.transaction((tx) => dispatchInference(tx, second.id, owner)),
  ).rejects.toMatchObject({ code: "generation_recovery_required" });
  await reserve();
  await db.transaction((tx) =>
    settleInference(tx, second.id, owner, "succeeded"),
  );
  expect(
    (
      await db
        .select()
        .from(schema.inferenceReservations)
        .where(eq(schema.inferenceReservations.id, second.id))
    )[0],
  ).toMatchObject({ state: "succeeded", executionReleaseReason: "cancelled" });
});
test("stale recovery retains charge uncertainty and audit; live heartbeats prevent expiry", async () => {
  const first = await reserve();
  await db.transaction((tx) => dispatchInference(tx, first.id, owner));
  expect(await heartbeatImageExecution(db, owner, first.id)).toBe(true);
  expect(
    await db.transaction((tx) => recoverExpiredImageExecutions(tx, owner)),
  ).toBe(0);
  await db
    .update(schema.inferenceReservations)
    .set({ executionLeaseUntil: "2020-01-01T00:00:00Z" })
    .where(eq(schema.inferenceReservations.id, first.id));
  expect(await heartbeatImageExecution(db, owner, first.id)).toBe(false);
  expect(
    await db.transaction((tx) => recoverExpiredImageExecutions(tx, owner)),
  ).toBe(1);
  expect(
    await db.transaction((tx) => recoverExpiredImageExecutions(tx, owner)),
  ).toBe(0);
  expect(
    (await db.select().from(schema.inferenceReservations))[0],
  ).toMatchObject({
    state: "uncertain",
    finishedAt: null,
    executionReleaseReason: "interrupted",
  });
  expect(
    (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
  ).toBe(24);
  expect(
    await db
      .select()
      .from(schema.inferenceActions)
      .where(eq(schema.inferenceActions.id, `execution-expired:${first.id}`)),
  ).toHaveLength(1);
  expect(await listAgentGenerations(db, owner)).toMatchObject([
    { status: "stopped", blocksGeneration: false },
  ]);
  await reserve();
});
test("an older unresolved charge cannot mislabel a newer image that is finishing", async () => {
  const id = randomUUID(),
    operationId = randomUUID();
  await requestCharacterReference(
    db,
    owner,
    characterGenerationInput(id, "Finishing image"),
    "",
  );
  await db
    .insert(schema.visualRenderOperations)
    .values({
      id: operationId,
      userId: owner,
      operationKey: `full-body:${id}`,
      inputHash: "fixture",
      generation: 2,
    });
  const reserveGeneration = (generation: number) =>
    db.transaction((tx) =>
      reserveInference(tx, {
        id: `visual:${operationId}:${generation}`,
        userId: owner,
        category: "image",
        inputHash: "fixture",
        visualOperationId: operationId,
      }),
    );
  const old = await reserveGeneration(1);
  await db.transaction(async (tx) => {
    await dispatchInference(tx, old.id, owner);
    await settleInference(tx, old.id, owner, "uncertain");
  });
  const current = await reserveGeneration(2);
  await db.transaction((tx) =>
    settleInference(tx, current.id, owner, "succeeded"),
  );
  await db
    .update(schema.characterReferenceJobs)
    .set({
      status: "processing",
      stage: "background",
      leaseUntil: new Date(Date.now() + 120000).toISOString(),
    })
    .where(eq(schema.characterReferenceJobs.id, id));
  expect(await listAgentGenerations(db, owner)).toMatchObject([
    { id, status: "running", stage: "background", blocksGeneration: false },
  ]);
  expect(
    (await db.select().from(schema.inferenceReservations)).find(
      (row) => row.id === old.id,
    )!.state,
  ).toBe("uncertain");
});
test("expired undispatched reservation refunds before admitting replacement without losing that refund", async () => {
  const first = await reserve();
  await db
    .update(schema.inferenceAccounts)
    .set({ imageBalance: 0 })
    .where(eq(schema.inferenceAccounts.userId, owner));
  await db
    .update(schema.inferenceReservations)
    .set({ executionLeaseUntil: "2020-01-01T00:00:00Z" })
    .where(eq(schema.inferenceReservations.id, first.id));
  await reserve();
  expect(
    (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
  ).toBe(0);
  expect(
    (
      await db
        .select()
        .from(schema.inferenceReservations)
        .where(eq(schema.inferenceReservations.id, first.id))
    )[0]!.state,
  ).toBe("failed");
});
test("discard releases execution while keeping the durable request", async () => {
  const id = randomUUID();
  await requestCharacterReference(
    db,
    owner,
    characterGenerationInput(id, "Discarded"),
    "",
  );
  await decideCharacterReference(db, owner, id, "discarded");
  expect(
    (await db.select().from(schema.characterReferenceJobs))[0]!.status,
  ).toBe("discarded");
  expect(await listAgentGenerations(db, owner)).toEqual([]);
});

test("late provider success after cancellation retains charge evidence and never publishes a candidate", async () => {
  const originalFetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  const image = await sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 20, height: 70, channels: 4, background: "#884422" },
        })
          .png()
          .toBuffer(),
        top: 10,
        left: 20,
      },
    ])
    .png()
    .toBuffer();
  const started = Promise.withResolvers<void>(),
    response = Promise.withResolvers<Response>();
  process.env.OPENAI_API_KEY = "provider-free";
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      if (String(input).includes("/images/")) {
        started.resolve();
        return response.promise;
      }
      throw new Error("Unexpected provider request");
    },
    { preconnect: originalFetch.preconnect },
  );
  const id = randomUUID();
  try {
    await requestCharacterReference(
      db,
      owner,
      characterGenerationInput(id, "Late Image"),
      "",
    );
    const work = processCharacterReference(db);
    await started.promise;
    await cancelAgentGeneration(db, owner, id, "reference");
    expect(
      (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
    ).toBe(24);
    await requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "Next Image"),
      "",
    );
    response.resolve(
      Response.json({
        data: [{ b64_json: image.toString("base64") }],
        usage: { images: 1 },
      }),
    );
    await work;
    const [job] = await db
      .select()
      .from(schema.characterReferenceJobs)
      .where(eq(schema.characterReferenceJobs.id, id));
    expect(job).toMatchObject({ status: "discarded", result: null });
    const [attempt] = await db.select().from(schema.visualRenderAttempts);
    expect(attempt!.receipt?.status).toBe(200);
    expect(attempt!.imageHash).toBeTruthy();
    expect(
      (await db.select().from(schema.inferenceReservations))[0],
    ).toMatchObject({
      state: "succeeded",
      executionReleaseReason: "cancelled",
    });
    expect(
      (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
    ).toBe(24);
  } finally {
    response.resolve(Response.json({ error: "cancelled" }, { status: 503 }));
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});

test("retry obeys the same queue gate and an undispatched failure gets a fresh execution without another debit", async () => {
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const input = characterGenerationInput(randomUUID(), "Retry Agent");
  try {
    await requestCharacterReference(db, owner, input, "");
    await processCharacterReference(db);
    const [original] = await db.select().from(schema.inferenceReservations);
    expect(original).toMatchObject({ state: "failed" });
    const blocker = characterGenerationInput(randomUUID(), "Other Image");
    await requestCharacterReference(db, owner, blocker, "");
    await expect(
      retryCharacterReference(db, owner, input.requestId),
    ).rejects.toMatchObject({ code: "generation_pending" });
    await cancelAgentGeneration(db, owner, blocker.requestId, "reference");
    expect(
      (await retryCharacterReference(db, owner, input.requestId))!.status,
    ).toBe("queued");
    expect(
      (await db.select().from(schema.visualRenderOperations))[0]!.generation,
    ).toBe(2);
    const image = await sharp({
      create: {
        width: 64,
        height: 96,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 20,
              height: 70,
              channels: 4,
              background: "#884422",
            },
          })
            .png()
            .toBuffer(),
          top: 10,
          left: 20,
        },
      ])
      .png()
      .toBuffer();
    expect(await processMockCharacterReference(db, image)).toBe(1);
    expect(
      (
        await db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, input.requestId))
      )[0]!.status,
    ).toBe("ready");
    expect(
      (await db.select().from(schema.inferenceAccounts))[0]!.imageBalance,
    ).toBe(24);
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});

test("pause and allowance exhaustion reject new queues but never prevent cancellation", async () => {
  const input = characterGenerationInput(randomUUID(), "Paused Image");
  await requestCharacterReference(db, owner, input, "");
  await db
    .update(schema.inferenceAccounts)
    .set({ paused: true })
    .where(eq(schema.inferenceAccounts.userId, owner));
  await expect(
    requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "Rejected"),
      "",
    ),
  ).rejects.toMatchObject({ code: "generation_paused" });
  await cancelAgentGeneration(db, owner, input.requestId, "reference");
  await db
    .update(schema.inferenceAccounts)
    .set({ paused: false, imageBalance: 0 })
    .where(eq(schema.inferenceAccounts.userId, owner));
  await expect(
    requestCharacterReference(
      db,
      owner,
      characterGenerationInput(randomUUID(), "Exhausted"),
      "",
    ),
  ).rejects.toMatchObject({ code: "generation_exhausted" });
  expect(await listAgentGenerations(db, owner)).toEqual([]);
});
