import { beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { ProductionGameMcpReadModel } from "../game-mcp/read-model.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import {
  PRIVATE_TRACE_CONTENT_TYPE,
  PRIVATE_TRACE_STORAGE_PROVIDER,
  type PrivateTracePutObjectInput,
  type PrivateTraceStorageAdapter,
} from "../services/private-trace-storage.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE } from "../services/private-trace-writer.js";
import { appendGameEvents, hashCanonicalEvent } from "../services/game-events.js";
import { setupTestDB } from "./test-utils.js";
import {
  createCanonicalEventFixture,
  insertCanonicalEventRows,
  insertGame,
  insertOwner,
} from "./durable-run-test-utils.js";

class FakePrivateTraceStorage implements PrivateTraceStorageAdapter {
  private readonly objects = new Map<string, { body: string; contentType: string }>();

  setObject(bucket: string, key: string, body: string, contentType = PRIVATE_TRACE_CONTENT_TYPE): void {
    this.objects.set(`${bucket}/${key}`, { body, contentType });
  }

  async putObject(input: PrivateTracePutObjectInput): Promise<{ etag?: string }> {
    this.setObject(input.bucket, input.key, input.body, input.contentType);
    return { etag: "fake-etag" };
  }

  async getObject(input: { bucket: string; key: string }): Promise<{
    body: string;
    contentLength?: number;
    contentType?: string;
  }> {
    const found = this.objects.get(`${input.bucket}/${input.key}`);
    if (!found) throw new Error("object not found");
    return {
      body: found.body,
      contentLength: Buffer.byteLength(found.body, "utf8"),
      contentType: found.contentType,
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<{
    contentLength?: number;
    contentType?: string;
  }> {
    const found = this.objects.get(`${input.bucket}/${input.key}`);
    if (!found) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(found.body, "utf8"),
      contentType: found.contentType,
    };
  }
}

describe("ProductionGameMcpReadModel", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("reads deployed game summaries, projections, filters, and player timelines from DB state", async () => {
    const gameId = await insertGame(db, {
      slug: "mcp-read-model-game",
      status: "in_progress",
    });
    const ownerEpoch = await insertOwner(db, gameId);
    const events = createCanonicalEventFixture(gameId);
    await appendGameEvents(db, { gameId, ownerEpoch, events });

    const readModel = new ProductionGameMcpReadModel(db);
    const games = await readModel.listGames();
    expect(games.canonicalGameFacts.games).toHaveLength(1);
    expect(games.canonicalGameFacts.games[0]).toMatchObject({
      id: gameId,
      slug: "mcp-read-model-game",
      eventLog: {
        status: "complete",
        rowCount: events.length,
        trustedEventCount: events.length,
        lastTrustedSequence: events.length,
      },
      projection: {
        status: "complete",
        round: 1,
        alivePlayers: expect.arrayContaining(["Atlas", "Echo", "Mira", "Nyx"]),
      },
    });

    const projection = await readModel.readProjection("mcp-read-model-game");
    expect(projection.canonicalGameFacts.projection).toMatchObject({
      status: "complete",
      replayedEventCount: events.length,
      summary: {
        gameId,
        lastSequence: events.length,
      },
    });

    const filtered = await readModel.filterEvents({
      gameIdOrSlug: gameId,
      eventType: events[0]!.type,
      limit: 1,
    });
    expect(filtered.canonicalGameFacts).toMatchObject({
      eventLogStatus: "complete",
      validPrefixLength: events.length,
      events: [{
        gameId,
        sequence: events[0]!.sequence,
        eventType: events[0]!.type,
      }],
    });
    expect(filtered.diagnostics).toEqual([]);

    const timeline = await readModel.playerTimeline({
      gameIdOrSlug: "mcp-read-model-game",
      player: "atlas",
      limit: 5,
    });
    expect(timeline.canonicalGameFacts.eventLogStatus).toBe("complete");
    expect(timeline.canonicalGameFacts.validPrefixLength).toBe(events.length);
    expect(timeline.canonicalGameFacts.events.length).toBeGreaterThan(0);
    expect(timeline.canonicalGameFacts.events[0]?.matchSources?.length).toBeGreaterThan(0);
    expect(timeline.diagnostics).toEqual([]);
  });

  test("returns persisted invalid-log diagnostics through event filters and timelines", async () => {
    const gameId = await insertGame(db, { slug: "mcp-invalid-log" });
    const ownerEpoch = await insertOwner(db, gameId, { lastPersistedEventSequence: 3 });
    const events = createCanonicalEventFixture(gameId).slice(0, 3);
    await insertCanonicalEventRows(db, gameId, ownerEpoch, events, {
      eventHash: (event) => event.sequence === 2
        ? "sha256:not-the-real-event-hash"
        : hashCanonicalEvent(event),
    });

    const readModel = new ProductionGameMcpReadModel(db);
    const filtered = await readModel.filterEvents({ gameIdOrSlug: gameId });
    expect(filtered.canonicalGameFacts).toMatchObject({
      eventLogStatus: "invalid",
      validPrefixLength: 1,
    });
    expect(filtered.canonicalGameFacts.events).toHaveLength(1);
    expect(filtered.diagnostics[0]).toMatchObject({
      code: "hash_mismatch",
      sequence: 2,
    });

    const timeline = await readModel.playerTimeline({
      gameIdOrSlug: "mcp-invalid-log",
      player: "atlas",
    });
    expect(timeline.canonicalGameFacts).toMatchObject({
      player: "atlas",
      eventLogStatus: "invalid",
      validPrefixLength: 1,
    });
    expect(timeline.diagnostics[0]).toMatchObject({
      code: "hash_mismatch",
      sequence: 2,
    });
  });

  test("reads and searches private trace evidence through DB manifests and storage", async () => {
    const gameId = await insertGame(db, { slug: "mcp-private-trace" });
    const ownerEpoch = await insertOwner(db, gameId);
    const storage = new FakePrivateTraceStorage();
    const manifestId = await insertPrivateTraceManifest(db, storage, {
      gameId,
      ownerEpoch,
      body: JSON.stringify({
        reasoningContext: "the secret plan is to shield Mira",
        toolArguments: { expose: "Vera" },
      }),
    });

    const readModel = new ProductionGameMcpReadModel(
      db,
      new PrivateTraceReadModel(db, () => storage),
    );

    const manifests = await readModel.listTraceManifests(gameId);
    expect(asRecord(manifests.developerEvidence)).toMatchObject({
      gameId,
      totalCount: 1,
      manifests: [{
        id: manifestId,
        gameId,
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        phase: "VOTE",
      }],
    });

    const content = await readModel.readTraceContent({
      manifestId,
      gameId,
      maxBytes: 1024,
    });
    expect(asRecord(content.privateReasoning)).toMatchObject({
      ok: true,
      response: {
        manifest: { id: manifestId, gameId },
        content: expect.stringContaining("the secret plan"),
        contentType: PRIVATE_TRACE_CONTENT_TYPE,
      },
    });

    const search = await readModel.searchReasoningTraces({
      gameIdOrSlug: "mcp-private-trace",
      query: "secret plan",
    });
    expect(asRecord(search.privateReasoning)).toMatchObject({
      gameId,
      matches: [{
        manifestId,
        gameId,
        actor: { id: "atlas", name: "Atlas", role: "player" },
        action: "vote",
        preview: expect.stringContaining("secret plan"),
      }],
    });

    const wrongGameRead = await readModel.readTraceContent({
      manifestId,
      gameId: "not-this-game",
    });
    expect(asRecord(wrongGameRead.privateReasoning)).toMatchObject({
      ok: false,
      status: "not_found",
    });
  });
});

async function insertPrivateTraceManifest(
  db: DrizzleDB,
  storage: FakePrivateTraceStorage,
  params: {
    gameId: string;
    ownerEpoch: string;
    body: string;
  },
): Promise<string> {
  const manifestId = randomUUID();
  const bucket = "private-trace-bucket";
  const key = `content/${params.gameId}/private-traces/test-${manifestId}.json`;
  const byteLength = Buffer.byteLength(params.body, "utf8");
  storage.setObject(bucket, key, params.body);

  await db.insert(schema.gameEvidenceManifests).values({
    id: manifestId,
    gameId: params.gameId,
    ownerEpoch: params.ownerEpoch,
    evidenceType: PRIVATE_TRACE_EVIDENCE_TYPE,
    retentionClass: "debug",
    accessScope: "producer_admin",
    redactionStatus: "active",
    storageProvider: PRIVATE_TRACE_STORAGE_PROVIDER,
    storageBucket: bucket,
    storageKey: key,
    metadata: {
      formatVersion: 2,
      contentType: PRIVATE_TRACE_CONTENT_TYPE,
      byteLength,
      recordCount: 1,
      sha256: sha256Text(params.body),
      actor: { id: "atlas", name: "Atlas", role: "player" },
      action: "vote",
      phase: "VOTE",
      round: 1,
      modelName: "gpt-5-nano",
    },
  });

  return manifestId;
}

function sha256Text(body: string): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object");
  }
  return value as Record<string, unknown>;
}
