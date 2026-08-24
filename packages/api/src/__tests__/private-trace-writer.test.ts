import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { PrivateTracePutObjectInput, PrivateTraceStorageAdapter } from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_CONTENT_TYPE, PRIVATE_TRACE_STORAGE_PROVIDER } from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE, writePrivateDecisionTrace } from "../services/private-trace-writer.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import { createEvidenceManifest } from "../services/game-evidence.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

const ENV_KEYS = [
  "LINODE_OBJ_BUCKET",
  "LINODE_PRIVATE_CONTENT_ENDPOINT",
  "LINODE_PRIVATE_CONTENT_ACCESS_KEY",
  "LINODE_PRIVATE_CONTENT_SECRET_KEY",
  "LINODE_PRIVATE_CONTENT_BUCKET",
] as const;

class FakePrivateTraceStorage implements PrivateTraceStorageAdapter {
  readonly puts: PrivateTracePutObjectInput[] = [];

  constructor(private readonly failure?: Error) {}

  async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    if (this.failure) throw this.failure;
    this.puts.push(input);
    return { etag: "fake-etag" };
  }

  async getObject(input: {
    bucket: string;
    key: string;
    offsetBytes?: number;
    maxBytes?: number;
  }): Promise<{ bodyBytes: Uint8Array; contentLength?: number; contentType?: string }> {
    const found = this.puts.find((put) => put.bucket === input.bucket && put.key === input.key);
    if (!found) throw new Error("object not found");
    const bytes = Buffer.from(found.body, "utf8");
    const offsetBytes = Math.max(0, Math.floor(input.offsetBytes ?? 0));
    const bodyBytes = bytes.subarray(
      offsetBytes,
      input.maxBytes === undefined ? undefined : offsetBytes + Math.max(1, Math.floor(input.maxBytes)),
    );
    return {
      bodyBytes,
      contentLength: bodyBytes.byteLength,
      contentType: found.contentType,
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<{ contentLength?: number; contentType?: string }> {
    const found = this.puts.find((put) => put.bucket === input.bucket && put.key === input.key);
    if (!found) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(found.body, "utf8"),
      contentType: found.contentType,
    };
  }
}

function makeTrace(overrides: Partial<PrivateDecisionTrace> = {}): PrivateDecisionTrace {
  return {
    version: 2,
    gameId: "game-1",
    ownerEpoch: "owner-1",
    action: "vote",
    actor: { id: "atlas", name: "Atlas", role: "player" },
    phase: Phase.VOTE,
    round: 1,
    createdAt: "2026-06-15T00:00:00.000Z",
    model: {
      provider: "katana",
      providerProfileId: "katana",
      catalogId: "katana:grok-4-3",
      name: "grok-4-3",
    },
    requestedReasoningEffort: "high",
    reasoningPolicy: "high",
    prompt: {
      messages: [
        { role: "system", content: "system prompt secret" },
        { role: "user", content: "full prompt secret" },
      ],
    },
    request: {
      providerProfileId: "katana",
      catalogId: "katana:grok-4-3",
      model: "grok-4-3",
      messages: [
        { role: "system", content: "system prompt secret" },
        { role: "user", content: "full prompt secret" },
      ],
      reasoning_effort: "high",
    },
    response: {
      raw: {
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "native reasoning secret",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "cast_votes",
                arguments: "{\"thinking\":\"private thought secret\",\"empower\":\"Mira\",\"expose\":\"Vera\"}",
              },
            }],
          },
        }],
      },
      finishReason: "tool_calls",
      content: null,
      toolCalls: [{
        id: "call-1",
        type: "function",
        name: "cast_votes",
        arguments: "{\"thinking\":\"private thought secret\",\"empower\":\"Mira\",\"expose\":\"Vera\"}",
      }],
    },
    output: {
      thinking: "private thought secret",
      empower: "Mira",
      expose: "Vera",
      reasoningContext: "native reasoning secret",
    },
    usage: {
      promptTokens: 100,
      completionTokens: 25,
      cachedTokens: 12,
      reasoningTokens: 8,
      totalTokens: 125,
      routerBilling: {
        credits: 17,
        providerCostUsd: 0.0042,
      },
    },
    emittedThinking: "private thought secret",
    reasoningContext: "native reasoning secret",
    providerReasoningSummary: {
      provider: "openai_responses",
      mode: "auto",
      text: "provider summary secret",
      parts: ["provider summary secret"],
    },
    toolName: "cast_votes",
    toolArguments: {
      thinking: "private thought secret",
      empower: "Mira",
      expose: "Vera",
      reasoningContext: "native reasoning secret",
    },
    strategyCandidate: {
      operation: "delta",
      submittedValue: "Reward Mira and pressure Vera.",
    },
    boundary: {
      currentEventSequence: 7,
      currentEventHash: "sha256:event-head",
      sourcePointer: {
        kind: "agent_turn",
        actorId: "atlas",
        action: "vote",
        round: 1,
        phase: Phase.VOTE,
      },
    },
    ...overrides,
  };
}

describe("private trace writer", () => {
  let db: DrizzleDB;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.LINODE_OBJ_BUCKET = "public-profile-bucket";
    delete process.env.LINODE_PRIVATE_CONTENT_ENDPOINT;
    delete process.env.LINODE_PRIVATE_CONTENT_ACCESS_KEY;
    delete process.env.LINODE_PRIVATE_CONTENT_SECRET_KEY;
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "private-content-bucket";
    db = await setupTestDB();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("writes raw trace content and creates a sanitized private trace manifest", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const decisionId = "decision-forward-path";

    const result = await writePrivateDecisionTrace(
      db,
      {
        gameId,
        ownerEpoch,
        trace: makeTrace({ gameId, ownerEpoch, decisionId }),
      },
      {
        storage,
        now: () => new Date("2026-06-15T12:00:00.000Z"),
      },
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]).toMatchObject({
      bucket: "private-content-bucket",
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
    });
    expect(storage.puts[0]!.key).toStartWith(`content/${gameId}/private-traces/round-1/`);
    expect(storage.puts[0]!.body).toContain("full prompt secret");
    expect(storage.puts[0]!.body).toContain("native reasoning secret");

    const manifest = (await db
      .select()
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.id, result.manifestId)))[0];
    expect(manifest).toBeDefined();
    expect(manifest).toMatchObject({
      gameId,
      ownerEpoch,
      decisionId,
      evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
      retentionClass: "debug",
      accessScope: "producer_admin",
      storageProvider: PRIVATE_TRACE_STORAGE_PROVIDER,
      storageBucket: "private-content-bucket",
      storageKey: storage.puts[0]!.key,
    });

    const metadata = manifest!.metadata as Record<string, unknown>;
    expect(metadata).toMatchObject({
      formatVersion: 2,
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
      recordCount: 1,
      action: "vote",
      phase: "VOTE",
      round: 1,
      model: {
        name: "grok-4-3",
        provider: "katana",
        providerProfileId: "katana",
        catalogId: "katana:grok-4-3",
      },
      modelName: "grok-4-3",
      requestedReasoningEffort: "high",
      reasoningPolicy: "high",
      promptMessageCount: 2,
      usage: {
        promptTokens: 100,
        completionTokens: 25,
        cachedTokens: 12,
        reasoningTokens: 8,
        totalTokens: 125,
        routerBilling: {
          credits: 17,
          providerCostUsd: 0.0042,
        },
      },
      toolName: "cast_votes",
      providerReasoningSummaryByteLength: expect.any(Number),
      strategyCandidate: {
        operation: "delta",
        submittedValueByteLength: expect.any(Number),
      },
    });
    expect(metadata.byteLength).toBeGreaterThan(0);
    expect(metadata.promptByteLength).toBeGreaterThan(0);
    expect(metadata.requestByteLength).toBeGreaterThan(0);
    expect(metadata.responseByteLength).toBeGreaterThan(0);
    expect(String(metadata.sha256)).toStartWith("sha256:");
    expect(JSON.stringify(metadata)).not.toContain("full prompt secret");
    expect(JSON.stringify(metadata)).not.toContain("native reasoning secret");
    expect(JSON.stringify(metadata)).not.toContain("private thought secret");
    expect(JSON.stringify(metadata)).not.toContain("provider summary secret");

    const readModel = new PrivateTraceReadModel(db, () => storage);
    const index = await readModel.listManifests(gameId);
    expect(index.ok).toBe(true);
    if (!index.ok) throw new Error(index.error);
    expect(index.manifests[0]).toMatchObject({
      id: result.manifestId,
      decisionId,
      model: {
        name: "grok-4-3",
        providerProfileId: "katana",
        catalogId: "katana:grok-4-3",
      },
      requestedReasoningEffort: "high",
      reasoningPolicy: "high",
      usage: {
        totalTokens: 125,
        routerBilling: {
          credits: 17,
        },
      },
      strategyCandidate: {
        operation: "delta",
        submittedValueByteLength: expect.any(Number),
      },
    });
    expect(JSON.stringify(index.manifests[0])).not.toContain("Reward Mira and pressure Vera");
  });

  test("persists effective OpenAI tier and cache-write usage for cost backfill", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const trace = makeTrace({
      gameId,
      ownerEpoch,
      model: {
        provider: "openai",
        providerProfileId: "openai",
        catalogId: "openai:gpt-5.6-luna",
        name: "gpt-5.6-luna",
      },
      response: {
        raw: { id: "resp-flex", object: "response", service_tier: "flex" },
        finishReason: "completed",
        content: "{}",
      },
      usage: {
        promptTokens: 100,
        cachedTokens: 12,
        cacheWriteTokens: 8,
        completionTokens: 25,
        reasoningTokens: 8,
        totalTokens: 125,
      },
    });

    const result = await writePrivateDecisionTrace(
      db,
      { gameId, ownerEpoch, trace },
      { storage, now: () => new Date("2026-07-30T12:00:00.000Z") },
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(result.metadata).toMatchObject({
      effectiveServiceTier: "flex",
      usage: {
        promptTokens: 100,
        cachedTokens: 12,
        cacheWriteTokens: 8,
        completionTokens: 25,
      },
    });
  });

  test("uses ranged reads for capped private trace content", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();

    const result = await writePrivateDecisionTrace(
      db,
      {
        gameId,
        ownerEpoch,
        trace: makeTrace({ gameId, ownerEpoch }),
      },
      {
        storage,
        now: () => new Date("2026-06-15T12:00:00.000Z"),
      },
    );
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);

    const manifest = (await db
      .select()
      .from(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.id, result.manifestId)))[0];
    expect(manifest?.decisionId).toBeNull();

    const readModel = new PrivateTraceReadModel(db, () => storage);
    const cappedRead = await readModel.readContent(result.manifestId, {
      gameId,
      maxBytes: 64,
    });

    expect(cappedRead.ok).toBeTrue();
    if (!cappedRead.ok) throw new Error(cappedRead.error);
    expect(cappedRead.response.truncated).toBeTrue();
    expect(cappedRead.response.returnedByteLength).toBe(64);
    expect(cappedRead.response.totalByteLength).toBe(result.metadata.byteLength);
    expect(cappedRead.response.byteLength).toBe(result.metadata.byteLength);
    expect(cappedRead.response.content.length).toBeGreaterThan(0);
    expect(cappedRead.response.manifest.decisionId).toBeUndefined();
    expect(cappedRead.response.offsetBytes).toBe(0);
    expect(cappedRead.response.nextOffsetBytes).toBe(64);
    expect(cappedRead.response.hashScope).toBe("chunk");

    const finalRead = await readModel.readContent(result.manifestId, {
      gameId,
      offsetBytes: cappedRead.response.nextOffsetBytes,
      maxBytes: result.metadata.byteLength,
    });
    expect(finalRead.ok).toBeTrue();
    if (!finalRead.ok) throw new Error(finalRead.error);
    expect(finalRead.response.offsetBytes).toBe(64);
    expect(finalRead.response.truncated).toBeFalse();
    expect(finalRead.response.nextOffsetBytes).toBeUndefined();
    expect(finalRead.response.hashScope).toBe("chunk");
    expect(`${cappedRead.response.content}${finalRead.response.content}`).toBe(storage.puts[0]!.body);
  });

  test("pages multibyte evidence only on lossless UTF-8 boundaries", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const result = await writePrivateDecisionTrace(
      db,
      {
        gameId,
        ownerEpoch,
        trace: makeTrace({
          gameId,
          ownerEpoch,
          prompt: { messages: [{ role: "user", content: "Vote for Maya 🌌 — 开始" }] },
        }),
      },
      { storage },
    );
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);

    const readModel = new PrivateTraceReadModel(db, () => storage);
    let offsetBytes = 0;
    let reconstructed = "";
    for (let page = 0; page < result.metadata.byteLength + 10; page += 1) {
      const read = await readModel.readContent(result.manifestId, {
        gameId,
        offsetBytes,
        maxBytes: 1,
      });
      expect(read.ok).toBeTrue();
      if (!read.ok) throw new Error(read.error);
      reconstructed += read.response.content;
      offsetBytes += read.response.returnedByteLength;
      expect(read.response.offsetBytes).toBe(offsetBytes - read.response.returnedByteLength);
      if (!read.response.truncated) break;
      expect(read.response.nextOffsetBytes).toBe(offsetBytes);
    }

    const stored = storage.puts[0]!.body;
    expect(reconstructed).toBe(stored);
    expect(offsetBytes).toBe(Buffer.byteLength(stored, "utf8"));
    expect(`sha256:${createHash("sha256").update(reconstructed).digest("hex")}`)
      .toBe(result.metadata.sha256);
  });

  test("searches within capped trace prefixes without treating larger objects as errors", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();

    const result = await writePrivateDecisionTrace(
      db,
      {
        gameId,
        ownerEpoch,
        trace: makeTrace({ gameId, ownerEpoch }),
      },
      {
        storage,
        now: () => new Date("2026-06-15T12:00:00.000Z"),
      },
    );
    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);

    const readModel = new PrivateTraceReadModel(db, () => storage);
    const unbounded = await readModel.searchReasoningTraces({
      gameIdOrSlug: gameId,
      query: "native reasoning secret",
    });
    expect(unbounded.matches).toHaveLength(1);
    expect(unbounded.diagnostics).toBeUndefined();

    const capped = await readModel.searchReasoningTraces({
      gameIdOrSlug: gameId,
      query: "native reasoning secret",
      maxBytes: 1,
    });

    expect(capped.matches).toHaveLength(0);
    expect(capped.diagnostics).toBeUndefined();
  });

  test("does not create a manifest when private storage fails and marks trace diagnostics degraded", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage(new Error("object store unavailable"));

    const result = await writePrivateDecisionTrace(db, {
      gameId,
      ownerEpoch,
      trace: makeTrace({ gameId, ownerEpoch }),
    }, { storage });

    expect(result).toEqual({ ok: false, error: "object store unavailable" });
    expect(storage.puts).toHaveLength(0);
    const manifests = await db.select().from(schema.gameEvidenceManifests);
    expect(manifests).toHaveLength(0);
    const owner = (await db
      .select()
      .from(schema.gameRunOwners)
      .where(eq(schema.gameRunOwners.ownerEpoch, ownerEpoch)))[0]!;
    expect(owner.kernelHealth).toBe("degraded");
    expect(owner.failureReason).toContain("private_trace_storage_failed");
  });

  test("rejects public profile bucket configuration before writing content", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    process.env.LINODE_PRIVATE_CONTENT_BUCKET = "public-profile-bucket";

    const result = await writePrivateDecisionTrace(db, {
      gameId,
      ownerEpoch,
      trace: makeTrace({ gameId, ownerEpoch }),
    }, { storage });

    expect(result.ok).toBeFalse();
    if (result.ok) throw new Error("expected private trace write to fail");
    expect(result.error).toContain("public profile-picture bucket");
    expect(storage.puts).toHaveLength(0);
  });

  test("writes large traces without a write-time byte limit", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();

    const result = await writePrivateDecisionTrace(db, {
      gameId,
      ownerEpoch,
      trace: makeTrace({
        gameId,
        ownerEpoch,
        prompt: {
          messages: [
            { role: "system", content: "x".repeat(100_000) },
            { role: "user", content: "large prompt survives" },
          ],
        },
      }),
    }, { storage });

    expect(result.ok).toBeTrue();
    if (!result.ok) throw new Error(result.error);
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.body).toContain("large prompt survives");
    expect(result.metadata.byteLength).toBeGreaterThan(100_000);
  });

  test("reuses an explicitly deterministic evidence manifest id only for identical immutable content", async () => {
    const gameId = await insertGame(db);
    const ownerEpoch = await insertOwner(db, gameId);
    const manifestId = "provider-attempt-manifest-deterministic";
    const input = {
      manifestId,
      gameId,
      ownerEpoch,
      evidenceType: "provider_attempt_failure",
      storage: {
        provider: PRIVATE_TRACE_STORAGE_PROVIDER,
        bucket: "private-content-bucket",
        key: `content/${gameId}/provider-attempts/call/attempt-1.json`,
      },
      sourcePointers: [{ kind: "provider_attempt", attemptOrdinal: 1 }],
      metadata: {
        formatVersion: 1,
        byteLength: 42,
        sha256: `sha256:${"a".repeat(64)}`,
      },
    } as const;

    expect(await createEvidenceManifest(db, input)).toEqual({
      ok: true,
      manifestId,
    });
    expect(await createEvidenceManifest(db, input)).toEqual({
      ok: true,
      manifestId,
    });
    expect(await db.select().from(schema.gameEvidenceManifests)).toHaveLength(1);
    const providerIndex = await new PrivateTraceReadModel(db).listManifests(gameId, {
      evidenceType: "provider_attempt_failure",
    });
    expect(providerIndex.ok).toBeTrue();
    if (!providerIndex.ok) throw new Error(providerIndex.error);
    expect(providerIndex.manifests.map((manifest) => manifest.id)).toEqual([manifestId]);
    const ordinaryIndex = await new PrivateTraceReadModel(db).listManifests(gameId);
    expect(ordinaryIndex.ok).toBeTrue();
    if (!ordinaryIndex.ok) throw new Error(ordinaryIndex.error);
    expect(ordinaryIndex.manifests).toEqual([]);

    const conflict = await createEvidenceManifest(db, {
      ...input,
      metadata: {
        ...input.metadata,
        sha256: `sha256:${"b".repeat(64)}`,
      },
    });
    expect(conflict.ok).toBeFalse();
    if (conflict.ok) throw new Error("expected deterministic manifest conflict");
    expect(conflict.error).toContain("conflicting immutable identity");
  });
});
