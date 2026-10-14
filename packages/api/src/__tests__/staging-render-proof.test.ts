import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashHouseHighlightsTrailerManifest, type InfluenceTrailerManifest } from "@influence/engine";
import { closeDB, createDB } from "../db/index.js";
import { assertProofDatabase, fixtureDigest, prepareProofDatabase, proofDatabaseReceipt, queueProofFixture, validateFixture, type RenderProofFixture, type RenderProofIdentity } from "../services/staging-render-proof.js";
import { createStagingRenderProofAPI } from "../services/staging-render-proof-api.js";
import { mutateRenderRelease, dispatchRenderWakes, claimRemotePostgameMedia } from "../services/postgame-media-execution.js";
import { heartbeatPostgameMedia } from "../services/postgame-media-worker.js";
import { renderExecutionConfig } from "@influence/engine/render-execution-config";

function manifestFixture(gameId: string): InfluenceTrailerManifest {
  const winner = {
    id: "winner",
    name: "Mira Solari",
    initials: "MS",
    avatarUrl: "https://media.example.test/mira.png",
    placement: 1,
    status: "winner" as const,
  };
  const runnerUp = {
    id: "runner-up",
    name: "Orion Vale",
    initials: "OV",
    avatarUrl: "https://media.example.test/orion.png",
    placement: 2,
    status: "finalist" as const,
  };
  return {
    schemaVersion: 2, kind: "influence",
    mediaType: "house_highlights_trailer",
    timingContractVersion: "house-highlights-trailer-timing-v1",
    game: { id: gameId, slug: "fixture-game", status: "completed" },
    frameRate: 30,
    width: 1920,
    height: 1080,
    cast: [winner, runnerUp],
    scenelets: [],
    finalVote: {
      finalists: [winner, runnerUp],
      groups: [
        { finalist: winner, votes: 4, jurors: [runnerUp] },
        { finalist: runnerUp, votes: 3, jurors: [winner] },
      ],
      voteLabel: "4-3",
      winner,
    },
    playerResults: [{ agent: winner, placementLabel: "Winner", tags: [] }],
    cueSheet: {
      schemaVersion: 1,
      timingContractVersion: "house-highlights-trailer-timing-v1",
      frameRate: 30,
      totalFrames: 474,
      totalDurationSeconds: 15.8,
      segments: [],
      markers: { finalVoteRevealSeconds: 5, winnerRevealSeconds: 10 },
    },
  };
}
const runId = "test_" + randomUUID().replaceAll("-", "").slice(0, 20);
const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test");
adminUrl.pathname = "/postgres";
const sha = "a".repeat(40), image = "sha256:" + "b".repeat(64);
const manifest = manifestFixture(randomUUID());
const fixture: RenderProofFixture = { schemaVersion: 1, game: { id: manifest.game.id, slug: "fixture-game", gameKind: "influence", config: '{"visibility":"public"}' },
  media: { snapshot: manifest, snapshotHash: hashHouseHighlightsTrailerManifest(manifest), snapshotVersion: 2, rendererVersion: "house-v1", timingContractVersion: manifest.timingContractVersion, musicAssetId: "fixture-music", renderVersion: 1 } };
const approval = { runId, candidateSha: sha, sourceRepository: "0xFlicker/linode-iac" as const, workflowRunId: 1, workflowRunAttempt: 1,
  wakeUrl: "https://fixture.lambda-url.us-west-1.on.aws/", wakeQueueArn: "arn:aws:sqs:us-west-1:978355607658:house-render-staging-wakes", deadLetterQueueArn: "arn:aws:sqs:us-west-1:978355607658:house-render-staging-dead-letters" };

describe("isolated staging render proof", () => {
  let identity: RenderProofIdentity, sql: ReturnType<typeof postgres>, owner: ReturnType<typeof postgres>, url: string;
  beforeAll(async () => {
    identity = await prepareProofDatabase(adminUrl.toString(), fixture, approval);
    const admin = postgres(adminUrl.toString(), { max: 1 });
    // Local disposable-test credential only: live preparation always leaves NOLOGIN.
    try { await admin.unsafe(`ALTER ROLE "${identity.principal}" LOGIN PASSWORD 'disposable-proof-test-only'`); }
    finally { await admin.end(); }
    const ownerUrl = new URL(adminUrl); ownerUrl.pathname = "/" + identity.database;
    owner = postgres(ownerUrl.toString(), { max: 1 });
    ownerUrl.username = identity.principal; ownerUrl.password = "disposable-proof-test-only"; url = ownerUrl.toString();
    sql = postgres(url, { max: 1 });
  }, 30000);
  afterAll(async () => {
    if (!identity) {
      const admin = postgres(adminUrl.toString(), { max: 1 });
      try { await admin.unsafe('DROP DATABASE IF EXISTS "influence_render_proof_' + runId + '"'); await admin.unsafe('DROP ROLE IF EXISTS "influence_render_proof_' + runId + '_api"'); }
      finally { await admin.end(); } return;
    }
    await closeDB(url); await sql?.end(); await owner?.end();
    const admin = postgres(adminUrl.toString(), { max: 1 });
    try { await admin.unsafe('DROP DATABASE "' + identity.database + '"'); await admin.unsafe('DROP ROLE "' + identity.principal + '"'); }
    finally { await admin.end(); }
  });
  test("canonical fixture digest survives jsonb key order and rejects signed assets", () => {
    const reordered = { media: fixture.media, game: fixture.game, schemaVersion: 1 } as RenderProofFixture;
    expect(fixtureDigest(reordered)).toBe(fixtureDigest(fixture));
    const bad = structuredClone(fixture); (bad.media.snapshot as InfluenceTrailerManifest).cast[0]!.avatarUrl += "?token=secret";
    bad.media.snapshotHash = hashHouseHighlightsTrailerManifest(bad.media.snapshot as InfluenceTrailerManifest);
    expect(() => validateFixture(bad)).toThrow("credential-free");
  });
  test("approval rejects unknown fields before opening a connection or creating objects", async () => {
    await expect(prepareProofDatabase("invalid-url", fixture, { ...approval, token: "never-in-a-safe-receipt" } as typeof approval)).rejects.toThrow("nonsecret identity fields");
  });
  test("fresh DB has only the frozen fixture, durable hold and bounded table permissions", async () => {
    expect(await assertProofDatabase(sql, runId)).toEqual(identity);
    await expect(Promise.resolve(sql`INSERT INTO users(id) VALUES(${randomUUID()})`)).rejects.toThrow();
    await expect(Promise.resolve(sql`UPDATE games SET status='waiting'`)).rejects.toThrow();
    await expect(Promise.resolve(sql`UPDATE deployment_admission_leases SET status='released'`)).rejects.toThrow();
    await expect(Promise.resolve(sql`CREATE TABLE unsafe(id text)`)).rejects.toThrow();
    await expect(prepareProofDatabase(adminUrl.toString(), fixture, approval)).rejects.toThrow("never reuse");
  });
  test("whole DB rejects unrelated upstream data, restored after test", async () => {
    const id = randomUUID(); await owner`INSERT INTO users(id) VALUES(${id})`;
    try { await expect(assertProofDatabase(sql, runId)).rejects.toThrow("upstream proof data"); }
    finally { await owner`DELETE FROM users WHERE id=${id}`; }
    expect((await assertProofDatabase(sql, runId)).gameId).toBe(fixture.game.id);
  });
  test("enqueue requires remote admission and commits one wake exactly once", async () => {
    await expect(queueProofFixture(sql, runId)).rejects.toThrow("not admitted");
    expect(await mutateRenderRelease(createDB(url), { operation: "accept", generation: "proof-generation", workerDigest: image, previousGeneration: null })).toBe(true);
    expect((await proofDatabaseReceipt(sql, runId)).pendingWakes).toBe(1);
    expect(await queueProofFixture(sql, runId)).toEqual({ gameId: fixture.game.id, renderVersion: 2 });
    await expect(queueProofFixture(sql, runId)).rejects.toThrow("already queued");
    const receipt = await proofDatabaseReceipt(sql, runId);
    expect(receipt.pendingWakes).toBe(1); expect(receipt.status).toBe("queued");
    expect(JSON.stringify(receipt)).not.toContain("leaseToken");
  });
  test("bounded dispatcher delivers only the single durable enqueue and does not repair new wake IDs", async () => {
    let sends = 0;
    const execution = { ...renderExecutionConfig({ INFLUENCE_DEPLOYMENT_ENVIRONMENT: "staging" }), mode: "remote" as const };
    const options = { execution, repair: false, env: { POSTGAME_MEDIA_WAKE_URL: approval.wakeUrl, POSTGAME_MEDIA_WAKE_SECRET: "disposable-proof-test-only-wake-secret" },
      fetch: (async () => { sends++; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch };
    expect(await dispatchRenderWakes(createDB(url), options)).toBe(1);
    expect(await dispatchRenderWakes(createDB(url), options)).toBe(0);
    expect(sends).toBe(1);
  });
  test("minimal API denies scheduler/provider routes and fails closed on isolation drift", async () => {
    let healthy = true;
    const execution = renderExecutionConfig({ INFLUENCE_DEPLOYMENT_ENVIRONMENT: "staging" });
    const app = createStagingRenderProofAPI({ sql, runId, identity, execution, apiDigest: image, candidateSha: sha, db: createDB(url), healthy: () => healthy });
    const health = await (await app.request("/api/health")).json() as { renderProof: { upstreamWorkers: boolean } };
    expect(health.renderProof.upstreamWorkers).toBe(false);
    for (const route of ["/api/games", "/api/internal/scheduler/daily-free", "/api/internal/admission", "/api/internal/editorial"]) {
      expect((await app.request(route, { method: "POST" })).status).toBe(404);
    }
    expect((await app.request("/api/internal/render-proof/receipt")).status).toBe(401);
    healthy = false; expect((await app.request("/api/health")).status).toBe(503);
    expect((await app.request("/api/internal/postgame-media/claim", { method: "POST" })).status).toBe(503);
  });
  test("existing remote generation, lease and heartbeat contract works with the restricted principal", async () => {
    const db = createDB(url), worker = { generation: "proof-generation", workerDigest: image, workerInstanceId: "proof-task" };
    expect((await claimRemotePostgameMedia(db, "disposable-worker-token", { ...worker, generation: "foreign" })).admitted).toBe(false);
    const result = await claimRemotePostgameMedia(db, "disposable-worker-token", worker);
    expect(result.admitted).toBe(true); expect(result.claim?.gameId).toBe(fixture.game.id);
    if (!result.claim) throw new Error("Expected restricted proof claim");
    const request = { gameId: result.claim.gameId, attemptNumber: result.claim.attemptNumber, leaseToken: result.claim.leaseToken };
    const future = new Date(Date.now() + 1000);
    expect(await heartbeatPostgameMedia(db, request, future)).toBe(true);
    expect(await heartbeatPostgameMedia(db, { ...request, leaseToken: "foreign" }, future)).toBe(false);
    const receipt = await proofDatabaseReceipt(sql, runId);
    expect(receipt.status).toBe("claimed"); expect(receipt.leaseExpiresAt).not.toBe(result.claim.leaseExpiresAt);
    expect(JSON.stringify(receipt)).not.toContain(request.leaseToken);
  });
});
