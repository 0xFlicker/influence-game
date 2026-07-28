import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { TranscriptEntry } from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  createCanonicalEventFixture,
  createCheckpointCapsule,
  enrichCapsuleForV1Candidate,
  insertGame,
  insertOwner,
} from "../__tests__/durable-run-test-utils.js";
import { setupTestDB } from "../__tests__/test-utils.js";
import { appendGameEvents, hashCanonicalEvent } from "./game-events.js";
import { writeGameCheckpoint } from "./game-checkpoints.js";
import { getSupportedRecovery } from "./game-recovery.js";
import {
  materializePromptThreadCase,
  type PromptThreadCaseSelection,
} from "./prompt-thread-case-materializer.js";
import type { PrivateTraceStorageAdapter } from "./private-trace-storage.js";
import { createPrivateWorkspace } from "./prompt-thread-workspace.js";

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

class FakeTraceStorage implements PrivateTraceStorageAdapter {
  readonly objects = new Map<string, string>();

  async putObject(): Promise<{ etag?: string }> {
    throw new Error("materialization must not write private storage");
  }

  async headObject(input: { bucket: string; key: string }) {
    const body = this.objects.get(`${input.bucket}/${input.key}`);
    if (body === undefined) throw new Error("object not found");
    return {
      contentLength: Buffer.byteLength(body, "utf8"),
      contentType: "application/json",
    };
  }

  async getObject(input: { bucket: string; key: string; maxBytes?: number }) {
    const body = this.objects.get(`${input.bucket}/${input.key}`);
    if (body === undefined) throw new Error("object not found");
    const returned = input.maxBytes === undefined
      ? body
      : Buffer.from(body, "utf8").subarray(0, input.maxBytes).toString("utf8");
    return {
      body: returned,
      contentLength: Buffer.byteLength(returned, "utf8"),
      contentType: "application/json",
    };
  }
}

interface SeededCase {
  gameId: string;
  selection: PromptThreadCaseSelection;
  storage: FakeTraceStorage;
}

async function seedCase(db: DrizzleDB): Promise<SeededCase> {
  const gameId = await insertGame(db, {
    id: `prompt-thread-case-${randomUUID()}`,
    slug: "materializer-fixture",
    status: "completed",
    config: {
      maxRounds: 5,
      modelTier: "budget",
      visibility: "private",
      viewerMode: "speedrun",
    },
  });
  const ownerEpoch = await insertOwner(db, gameId, { status: "active" });
  const events = createCanonicalEventFixture(gameId);
  await appendGameEvents(db, { gameId, ownerEpoch, events });
  const checkpointEvents = events.slice(0, 2);

  await db.insert(schema.gamePlayers).values([
    {
      id: "atlas",
      gameId,
      persona: JSON.stringify({ name: "Atlas", personality: "steady" }),
      agentConfig: JSON.stringify({ model: "fixture-model" }),
    },
    {
      id: "echo",
      gameId,
      persona: JSON.stringify({ name: "Echo", personality: "sharp" }),
      agentConfig: JSON.stringify({ model: "fixture-model" }),
    },
    {
      id: "mira",
      gameId,
      persona: JSON.stringify({ name: "Mira", personality: "social" }),
      agentConfig: JSON.stringify({ model: "fixture-model" }),
    },
    {
      id: "nyx",
      gameId,
      persona: JSON.stringify({ name: "Nyx", personality: "quiet" }),
      agentConfig: JSON.stringify({ model: "fixture-model" }),
    },
  ]);

  const checkpoint = enrichCapsuleForV1Candidate(createCheckpointCapsule(checkpointEvents), {
    ownerEpoch,
    eventHeadHash: hashCanonicalEvent(checkpointEvents.at(-1)!),
    actorCoordinate: "mingle_i",
  });
  const replay: TranscriptEntry[] = [
    {
      round: 1,
      phase: checkpoint.phase,
      timestamp: 1,
      from: "Atlas",
      scope: "mingle",
      to: ["Echo"],
      text: "Shared Atlas to Echo history",
      speakerPlayerId: "atlas",
      audiencePlayerIds: ["atlas", "echo"],
      entrySequence: 1,
      dialogueKind: "mingle_speech",
      dialogueContext: { version: 1, roomId: 2 },
    },
    {
      round: 1,
      phase: checkpoint.phase,
      timestamp: 2,
      from: "Mira",
      scope: "mingle",
      to: ["Nyx"],
      text: "FOREIGN_PRIVATE_SENTINEL",
      speakerPlayerId: "mira",
      audiencePlayerIds: ["mira", "nyx"],
      entrySequence: 2,
      dialogueKind: "mingle_speech",
      dialogueContext: { version: 1, roomId: 1 },
    },
  ];
  checkpoint.transcriptReplay = { version: 2, entries: replay };
  if (!checkpoint.runtimeSnapshot) throw new Error("expected runtime snapshot");
  checkpoint.runtimeSnapshot.transcriptWatermark.entryCount = replay.length;
  checkpoint.transcriptCursor = {
    entries: replay.length,
    version: 1,
    durableBoundary: true,
    boundaryDigest: checkpoint.runtimeSnapshot.transcriptWatermark.boundaryDigest,
    lastCanonicalSequence: checkpoint.lastEventSequence,
  };
  const checkpointResult = await writeGameCheckpoint(db, { gameId, ownerEpoch, checkpoint });
  expect(checkpointResult.ok).toBeTrue();
  const checkpointRow = (await db
    .select()
    .from(schema.gameCheckpoints)
    .where(eq(schema.gameCheckpoints.gameId, gameId)))[0]!;

  await db.insert(schema.transcripts).values({
    gameId,
    round: 1,
    phase: String(checkpoint.phase),
    fromPlayerId: null,
    scope: "system",
    roomMetadata: JSON.stringify({
      rooms: [
        { roomId: 2, round: 1, beat: 1, playerIds: ["atlas", "echo"] },
        { roomId: 2, round: 1, beat: 2, playerIds: ["atlas", "echo"] },
      ],
      excluded: [],
      diagnostics: {
        actions: ["POST_BOUNDARY_ACTION_SENTINEL"],
        prose: "POST_BOUNDARY_PROSE_SENTINEL",
      },
    }),
    text: "POST_BOUNDARY_PROSE_SENTINEL",
    timestamp: 3,
  });

  const storage = new FakeTraceStorage();
  const targetManifestIds = [
    "target-atlas-1",
    "target-echo-1",
    "target-atlas-2",
    "target-echo-2",
  ] as const;
  const traceInputs = [
    { id: "intent-atlas", actorId: "atlas", actorName: "Atlas", action: "mingle-intent", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "intent-echo", actorId: "echo", actorName: "Echo", action: "mingle-intent", createdAt: "2026-01-01T00:00:00.001Z" },
    { id: targetManifestIds[0], actorId: "atlas", actorName: "Atlas", action: "mingle-turn", createdAt: "2026-01-01T00:00:01.000Z" },
    { id: targetManifestIds[1], actorId: "echo", actorName: "Echo", action: "mingle-turn", createdAt: "2026-01-01T00:00:02.000Z" },
    { id: targetManifestIds[2], actorId: "atlas", actorName: "Atlas", action: "mingle-turn", createdAt: "2026-01-01T00:00:03.000Z" },
    { id: targetManifestIds[3], actorId: "echo", actorName: "Echo", action: "mingle-turn", createdAt: "2026-01-01T00:00:04.000Z" },
  ];
  for (const trace of traceInputs) {
    const body = JSON.stringify({
      actor: { id: trace.actorId, name: trace.actorName, role: "player" },
      action: trace.action,
      phase: String(checkpoint.phase),
      round: 1,
      model: { name: "fixture-model" },
      requestedReasoningEffort: "low",
      reasoningPolicy: "fixture-policy",
      prompt: {
        messages: [
          { role: "system", content: `system-${trace.id}` },
          { role: "user", content: `user-${trace.id}` },
        ],
      },
      request: { model: "fixture-model", transportOnly: trace.id },
      response: { message: `response-${trace.id}` },
      createdAt: trace.createdAt,
    });
    const key = `traces/${trace.id}.json`;
    storage.objects.set(`fixture-bucket/${key}`, body);
    await db.insert(schema.gameEvidenceManifests).values({
      id: trace.id,
      gameId,
      ownerEpoch,
      evidenceType: "private_decision_trace",
      retentionClass: "debug",
      accessScope: "producer_admin",
      storageProvider: "linode_object_storage",
      storageBucket: "fixture-bucket",
      storageKey: key,
      metadata: {
        formatVersion: 2,
        contentType: "application/json",
        byteLength: Buffer.byteLength(body, "utf8"),
        recordCount: 1,
        sha256: sha256Text(body),
        actor: { id: trace.actorId, name: trace.actorName, role: "player" },
        action: trace.action,
        phase: String(checkpoint.phase),
        round: 1,
        model: { name: "fixture-model" },
        modelName: "fixture-model",
      },
      createdAt: trace.createdAt,
    });
  }

  return {
    gameId,
    storage,
    selection: {
      gameId,
      slug: "materializer-fixture",
      checkpointId: checkpointRow.id,
      boundarySequence: checkpoint.lastEventSequence,
      checkpointKind: "phase_boundary",
      actorCoordinate: "mingle_i",
      phase: String(checkpoint.phase),
      round: 1,
      actorIds: ["atlas", "echo"],
      targetManifestIds,
      corroboratingSequences: [],
    },
  };
}

describe("prompt-thread case materializer", () => {
  let db: DrizzleDB;
  let privateRoot = "";

  beforeEach(async () => {
    db = await setupTestDB();
    privateRoot = await mkdtemp(join(tmpdir(), "influence-prompt-thread-case-"));
  });

  afterEach(async () => {
    if (privateRoot) {
      await rm(privateRoot, { recursive: true, force: true });
      privateRoot = "";
    }
  });

  test("materializes a completed historical checkpoint without DB writes or private-history leakage", async () => {
    const fixture = await seedCase(db);
    const before = {
      games: await db.select().from(schema.games),
      events: await db.select().from(schema.gameEvents),
      transcripts: await db.select().from(schema.transcripts),
      checkpoints: await db.select().from(schema.gameCheckpoints),
      manifests: await db.select().from(schema.gameEvidenceManifests),
      reads: await db.select().from(schema.gameEvidenceManifestReads),
      spend: await db.select().from(schema.gameProviderSpendEntries),
    };
    const workspace = await createPrivateWorkspace(privateRoot, {
      gitWorktreeRoots: [process.cwd()],
    });

    const result = await materializePromptThreadCase(db, {
      workspace,
      selection: fixture.selection,
      storageFactory: () => fixture.storage,
      now: () => new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(result.caseArtifact.kind).toBe("frozen_case");
    expect(result.sourceReceiptArtifact.kind).toBe("source_receipt");
    expect(result.traceManifestIds).toEqual([
      "intent-atlas",
      "intent-echo",
      ...fixture.selection.targetManifestIds,
    ]);
    const privateData = JSON.stringify(result.caseArtifact.privateData);
    expect(privateData).toContain("Shared Atlas to Echo history");
    expect(privateData).not.toContain("FOREIGN_PRIVATE_SENTINEL");
    expect(privateData).not.toContain("POST_BOUNDARY_ACTION_SENTINEL");
    expect(privateData).not.toContain("POST_BOUNDARY_PROSE_SENTINEL");
    expect(result.casePath).toEndWith("/case.json");
    expect(result.sourceReceiptPath).toEndWith("/source-receipt.json");
    expect(await getSupportedRecovery(db, fixture.gameId)).toEqual({
      ok: false,
      gameId: fixture.gameId,
      reason: "unsupported_game_status:completed",
    });

    expect(await db.select().from(schema.games)).toEqual(before.games);
    expect(await db.select().from(schema.gameEvents)).toEqual(before.events);
    expect(await db.select().from(schema.transcripts)).toEqual(before.transcripts);
    expect(await db.select().from(schema.gameCheckpoints)).toEqual(before.checkpoints);
    expect(await db.select().from(schema.gameEvidenceManifests)).toEqual(before.manifests);
    expect(await db.select().from(schema.gameEvidenceManifestReads)).toEqual(before.reads);
    expect(await db.select().from(schema.gameProviderSpendEntries)).toEqual(before.spend);
  });

  test("rejects truncated or integrity-mismatched complete trace objects", async () => {
    const fixture = await seedCase(db);
    const targetId = fixture.selection.targetManifestIds[0]!;
    const targetKey = `fixture-bucket/traces/${targetId}.json`;
    fixture.storage.objects.set(targetKey, `${fixture.storage.objects.get(targetKey)!}tampered`);
    const workspace = await createPrivateWorkspace(privateRoot, {
      gitWorktreeRoots: [process.cwd()],
    });

    await expect(materializePromptThreadCase(db, {
      workspace,
      selection: fixture.selection,
      storageFactory: () => fixture.storage,
    })).rejects.toThrow("integrity");
  });

  test("rejects missing exact checkpoint tuples and missing prerequisite intents", async () => {
    const fixture = await seedCase(db);
    const workspace = await createPrivateWorkspace(privateRoot, {
      gitWorktreeRoots: [process.cwd()],
    });

    await expect(materializePromptThreadCase(db, {
      workspace,
      selection: {
        ...fixture.selection,
        checkpointId: "missing-checkpoint",
      },
      storageFactory: () => fixture.storage,
    })).rejects.toThrow("exactly one selected checkpoint tuple");

    await db
      .delete(schema.gameEvidenceManifests)
      .where(eq(schema.gameEvidenceManifests.id, "intent-atlas"));
    await expect(materializePromptThreadCase(db, {
      workspace,
      selection: fixture.selection,
      storageFactory: () => fixture.storage,
    })).rejects.toThrow("exactly one preceding mingle-intent trace");
  });
});
