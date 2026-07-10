import { beforeEach, describe, expect, test } from "bun:test";
import {
  hashHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import {
  getAdminPostgameMedia,
  getPublicPostgameMedia,
  type PostgameMediaArtifactMetadata,
} from "../services/postgame-media.js";
import { insertGame } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

describe("postgame media read models", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  test("returns not_requested when no durable media row exists", async () => {
    const publicRead = await getPublicPostgameMedia(db, "game-without-media");
    const adminRead = await getAdminPostgameMedia(db, "game-without-media");

    expect(publicRead).toEqual({
      schemaVersion: 1,
      mediaType: "house_highlights_trailer",
      status: "not_requested",
    });
    expect(adminRead).toEqual({
      schemaVersion: 1,
      mediaType: "house_highlights_trailer",
      status: "not_requested",
    });
  });

  test("maps queued and claimed attempts to stable public states", async () => {
    const gameId = await insertCompletedGame(db, "media-state-mapping");
    await insertMediaJob(db, gameId, { status: "queued" });

    expect((await getPublicPostgameMedia(db, gameId)).status).toBe("queued");

    await db.update(schema.gamePostgameMedia)
      .set({ status: "claimed", workerIdHash: "sha256:worker", leaseTokenHash: "sha256:lease" })
      .where(eq(schema.gamePostgameMedia.gameId, gameId));

    const publicRead = await getPublicPostgameMedia(db, gameId);
    const adminRead = await getAdminPostgameMedia(db, gameId);
    expect(publicRead.status).toBe("rendering");
    expect(JSON.stringify(publicRead)).not.toContain("sha256:worker");
    expect(adminRead).toMatchObject({
      status: "claimed",
      lease: {
        active: true,
      },
    });
    expect(JSON.stringify(adminRead)).not.toContain("sha256:worker");
    expect(JSON.stringify(adminRead)).not.toContain("sha256:lease");
  });

  test("keeps failure diagnostics admin-only", async () => {
    const gameId = await insertCompletedGame(db, "media-failure");
    await insertMediaJob(db, gameId, {
      status: "failed",
      failureCategory: "render_process",
      failureMessage: "Chromium exited before the winner frame.",
      diagnostics: { stderrSummary: "private renderer detail" },
      cueMetadata: { rawCueIds: ["winner:secret-cue"] },
    });

    const publicRead = await getPublicPostgameMedia(db, gameId);
    const adminRead = await getAdminPostgameMedia(db, gameId);

    expect(publicRead).toEqual({
      schemaVersion: 1,
      mediaType: "house_highlights_trailer",
      status: "failed",
    });
    expect(adminRead).toMatchObject({
      status: "failed",
      failure: {
        category: "render_process",
        message: "Chromium exited before the winner frame.",
      },
      diagnostics: { stderrSummary: "private renderer detail" },
      cueMetadata: { rawCueIds: ["winner:secret-cue"] },
    });
    expect(JSON.stringify(publicRead)).not.toContain("winner:secret-cue");
  });

  test("exposes only safe playback metadata for a ready render", async () => {
    const gameId = await insertCompletedGame(db, "media-ready");
    const artifacts = artifactFixture("v1");
    await insertMediaJob(db, gameId, {
      status: "ready",
      renderDurationMs: 19_800,
      artifactMetadata: artifacts,
      currentReadyRenderVersion: 1,
      currentReadyDurationMs: 19_800,
      currentReadyArtifactMetadata: artifacts,
      currentReadyPublishedAt: "2026-07-09T20:00:00.000Z",
    });

    const publicRead = await getPublicPostgameMedia(db, gameId);
    const adminRead = await getAdminPostgameMedia(db, gameId);

    expect(publicRead).toEqual({
      schemaVersion: 1,
      mediaType: "house_highlights_trailer",
      status: "ready",
      renderVersion: 1,
      durationSeconds: 19.8,
      preview: {
        title: "House Highlights",
        description: "The game, cut by The House.",
      },
      video: {
        url: "https://media.example.test/postgame/v1/trailer.mp4",
        contentType: "video/mp4",
        width: 1920,
        height: 1080,
      },
      poster: {
        url: "https://media.example.test/postgame/v1/poster.png",
        contentType: "image/png",
        altText: "House Highlights trailer preview",
      },
      captions: {
        url: "https://media.example.test/postgame/v1/captions.vtt",
        contentType: "text/vtt",
        language: "en",
        label: "English",
      },
      manifest: {
        url: "https://media.example.test/postgame/v1/metadata.json",
        contentType: "application/json",
      },
    });
    expect(adminRead).toMatchObject({
      status: "ready",
      currentReady: {
        renderVersion: 1,
        durationSeconds: 19.8,
        artifactMetadata: artifacts,
      },
    });
    const serializedPublic = JSON.stringify(publicRead);
    expect(serializedPublic).not.toContain("objectKey");
    expect(serializedPublic).not.toContain("private-bucket");
    expect(serializedPublic).not.toContain("rawCueIds");
  });

  test("fails closed when a ready row lacks a complete published bundle", async () => {
    const gameId = await insertCompletedGame(db, "media-incomplete-ready");
    await insertMediaJob(db, gameId, { status: "ready" });

    expect(await getPublicPostgameMedia(db, gameId)).toEqual({
      schemaVersion: 1,
      mediaType: "house_highlights_trailer",
      status: "failed",
    });
  });

  test("preserves the current ready render while a rerender is queued", async () => {
    const gameId = await insertCompletedGame(db, "media-rerender");
    const currentArtifacts = artifactFixture("v1");
    const nextArtifacts = artifactFixture("v2");
    await insertMediaJob(db, gameId, {
      status: "queued",
      renderVersion: 2,
      attemptNumber: 2,
      artifactMetadata: nextArtifacts,
      currentReadyRenderVersion: 1,
      currentReadyDurationMs: 19_800,
      currentReadyArtifactMetadata: currentArtifacts,
      currentReadyPublishedAt: "2026-07-09T20:00:00.000Z",
    });

    const publicRead = await getPublicPostgameMedia(db, gameId);
    const adminRead = await getAdminPostgameMedia(db, gameId);

    expect(publicRead).toMatchObject({
      status: "ready",
      renderVersion: 1,
      video: { url: "https://media.example.test/postgame/v1/trailer.mp4" },
    });
    expect(JSON.stringify(publicRead)).not.toContain("/v2/");
    expect(adminRead).toMatchObject({
      status: "queued",
      renderVersion: 2,
      attemptNumber: 2,
      artifactMetadata: nextArtifacts,
      currentReady: {
        renderVersion: 1,
        artifactMetadata: currentArtifacts,
      },
    });
  });

  test("preserves the current ready render when a rerender fails", async () => {
    const gameId = await insertCompletedGame(db, "media-rerender-failed");
    const currentArtifacts = artifactFixture("v1");
    await insertMediaJob(db, gameId, {
      status: "failed",
      renderVersion: 2,
      attemptNumber: 2,
      failureCategory: "upload",
      failureMessage: "The replacement trailer could not upload.",
      currentReadyRenderVersion: 1,
      currentReadyDurationMs: 19_800,
      currentReadyArtifactMetadata: currentArtifacts,
      currentReadyPublishedAt: "2026-07-09T20:00:00.000Z",
    });

    expect(await getPublicPostgameMedia(db, gameId)).toMatchObject({
      status: "ready",
      renderVersion: 1,
      video: { url: "https://media.example.test/postgame/v1/trailer.mp4" },
    });
  });

  test("keeps snapshot provenance stable while diagnostics change", async () => {
    const gameId = await insertCompletedGame(db, "media-provenance");
    const manifest = manifestFixture(gameId);
    const snapshotHash = hashHouseHighlightsTrailerManifest(manifest);
    await insertMediaJob(db, gameId, {
      renderInputSnapshot: manifest,
      renderInputSnapshotHash: snapshotHash,
      renderInputSnapshotVersion: manifest.schemaVersion,
    });

    await db.update(schema.gamePostgameMedia)
      .set({
        status: "failed",
        diagnostics: { retryable: true },
        failureCategory: "upload",
        failureMessage: "Temporary upload failure",
      })
      .where(eq(schema.gamePostgameMedia.gameId, gameId));

    const adminRead = await getAdminPostgameMedia(db, gameId);
    expect(adminRead).toMatchObject({
      provenance: {
        renderInputSnapshotHash: snapshotHash,
        renderInputSnapshotVersion: 1,
        rendererVersion: "remotion-v1",
        timingContractVersion: "house-highlights-trailer-timing-v1",
        musicAssetId: "golden-verdict-max",
      },
    });
    expect(adminRead.status).toBe("failed");
  });

  test("redacts bearer-style URLs from admin diagnostics", async () => {
    const gameId = await insertCompletedGame(db, "media-admin-redaction");
    await insertMediaJob(db, gameId, {
      failureCategory: "upload",
      failureMessage: "Upload failed with Bearer private-worker-token",
      diagnostics: {
        uploadUrl: "https://storage.example.test/trailer.mp4?X-Amz-Signature=secret",
        retryable: true,
      },
    });

    const adminRead = await getAdminPostgameMedia(db, gameId);
    expect(adminRead).toMatchObject({
      failure: { message: "[redacted]" },
      diagnostics: { uploadUrl: "[redacted]", retryable: true },
    });
    expect(JSON.stringify(adminRead)).not.toContain("X-Amz-Signature");
  });
});

async function insertCompletedGame(db: DrizzleDB, slug: string): Promise<string> {
  return insertGame(db, {
    id: `game-${slug}`,
    slug,
    status: "completed",
    config: { maxRounds: 8 },
  });
}

async function insertMediaJob(
  db: DrizzleDB,
  gameId: string,
  overrides: Partial<typeof schema.gamePostgameMedia.$inferInsert> = {},
): Promise<void> {
  const manifest = manifestFixture(gameId);
  await db.insert(schema.gamePostgameMedia).values({
    gameId,
    mediaType: "house_highlights_trailer",
    status: "queued",
    renderVersion: 1,
    attemptNumber: 1,
    renderInputSnapshot: manifest,
    renderInputSnapshotHash: hashHouseHighlightsTrailerManifest(manifest),
    renderInputSnapshotVersion: manifest.schemaVersion,
    rendererVersion: "remotion-v1",
    timingContractVersion: manifest.timingContractVersion,
    musicAssetId: "golden-verdict-max",
    ...overrides,
  });
}

function artifactFixture(version: string): PostgameMediaArtifactMetadata {
  const root = `postgame-media/house-highlights-trailers/game/${version}`;
  const publicRoot = `https://media.example.test/postgame/${version}`;
  return {
    preview: {
      title: "House Highlights",
      description: "The game, cut by The House.",
    },
    video: {
      publicUrl: `${publicRoot}/trailer.mp4`,
      objectKey: `${root}/trailer.mp4`,
      contentType: "video/mp4",
      byteLength: 1_024_000,
      sha256: `sha256:${version}-video`,
      width: 1920,
      height: 1080,
    },
    poster: {
      publicUrl: `${publicRoot}/poster.png`,
      objectKey: `${root}/poster.png`,
      contentType: "image/png",
      byteLength: 64_000,
      sha256: `sha256:${version}-poster`,
      altText: "House Highlights trailer preview",
    },
    captions: {
      publicUrl: `${publicRoot}/captions.vtt`,
      objectKey: `${root}/captions.vtt`,
      contentType: "text/vtt",
      byteLength: 2_048,
      sha256: `sha256:${version}-captions`,
      language: "en",
      label: "English",
    },
    manifest: {
      publicUrl: `${publicRoot}/metadata.json`,
      objectKey: `${root}/metadata.json`,
      contentType: "application/json",
      byteLength: 4_096,
      sha256: `sha256:${version}-manifest`,
    },
    storage: {
      provider: "s3",
      bucket: "private-bucket-name-is-admin-only",
    },
  };
}

function manifestFixture(gameId: string): HouseHighlightsTrailerManifest {
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
    schemaVersion: 1,
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
