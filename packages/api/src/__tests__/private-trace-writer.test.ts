import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Phase, type PrivateDecisionTrace } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { PrivateTracePutObjectInput, PrivateTraceStorageAdapter } from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_CONTENT_TYPE, PRIVATE_TRACE_STORAGE_PROVIDER } from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE, writePrivateDecisionTrace } from "../services/private-trace-writer.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
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
    maxBytes?: number;
  }): Promise<{ body: string; contentLength?: number; contentType?: string }> {
    const found = this.puts.find((put) => put.bucket === input.bucket && put.key === input.key);
    if (!found) throw new Error("object not found");
    const body = input.maxBytes === undefined
      ? found.body
      : Buffer.from(found.body, "utf8").subarray(0, Math.max(1, Math.floor(input.maxBytes))).toString("utf8");
    return {
      body,
      contentLength: Buffer.byteLength(body, "utf8"),
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
    model: { name: "gpt-5-nano" },
    prompt: {
      messages: [
        { role: "system", content: "system prompt secret" },
        { role: "user", content: "full prompt secret" },
      ],
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
    strategyPacketRevision: "r1-vote-1",
    decisionLog: "The vote followed the packet by rewarding Mira and pressuring Vera.",
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
      modelName: "gpt-5-nano",
      promptMessageCount: 2,
      toolName: "cast_votes",
      providerReasoningSummaryByteLength: expect.any(Number),
      strategicDecision: {
        decisionLogBytes: expect.any(Number),
      },
      strategyPacket: {
        revision: "r1-vote-1",
      },
    });
    expect(metadata.byteLength).toBeGreaterThan(0);
    expect(metadata.promptByteLength).toBeGreaterThan(0);
    expect(metadata.responseByteLength).toBeGreaterThan(0);
    expect(String(metadata.sha256)).toStartWith("sha256:");
    expect(JSON.stringify(metadata)).not.toContain("full prompt secret");
    expect(JSON.stringify(metadata)).not.toContain("native reasoning secret");
    expect(JSON.stringify(metadata)).not.toContain("private thought secret");
    expect(JSON.stringify(metadata)).not.toContain("provider summary secret");

    const readModel = new PrivateTraceReadModel(db, () => storage);
    const index = await readModel.listManifests(gameId);
    expect(index.manifests[0]).toMatchObject({
      id: result.manifestId,
      strategicDecision: {
        decisionLogBytes: expect.any(Number),
      },
      strategyPacket: {
        revision: "r1-vote-1",
      },
    });
    expect(JSON.stringify(index.manifests[0])).not.toContain("The vote followed the packet");
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
});
