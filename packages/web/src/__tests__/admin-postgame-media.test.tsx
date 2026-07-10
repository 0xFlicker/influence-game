import { afterEach, describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  AdminPostgameMediaDiagnostics,
  AdminPostgameMediaPill,
  postgameMediaActionFor,
  postgameMediaRequiresConfirmation,
} from "../app/admin/admin-postgame-media";
import {
  requestAdminPostgameMedia,
  setApiBase,
  type AdminGameSummary,
  type AdminPostgameMediaArtifactMetadata,
  type AdminPostgameMediaResponse,
} from "../lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiBase("http://127.0.0.1:3000");
});

describe("AdminPostgameMedia", () => {
  it("maps media states to bounded backfill and rerender actions", () => {
    expect(postgameMediaActionFor(notRequested())).toBe("backfill");
    expect(postgameMediaActionFor(mediaDetail({ status: "failed" }))).toBe("backfill");
    expect(postgameMediaActionFor(mediaDetail({ status: "waiting_music" }))).toBe("backfill");
    expect(postgameMediaActionFor(mediaDetail({ status: "rendering" }))).toBeNull();
    expect(postgameMediaActionFor(mediaDetail({ status: "uploading" }))).toBeNull();
    expect(postgameMediaActionFor(mediaDetail({ status: "ready", currentReady: readyVersion() }))).toBe("rerender");
    expect(postgameMediaActionFor(mediaDetail({ status: "failed", currentReady: readyVersion() }))).toBe("rerender");
    expect(postgameMediaRequiresConfirmation(mediaDetail({ status: "ready", currentReady: readyVersion() }))).toBeTrue();
    expect(postgameMediaRequiresConfirmation(mediaDetail({ status: "failed", currentReady: readyVersion() }))).toBeTrue();
    expect(postgameMediaRequiresConfirmation(mediaDetail({ status: "failed" }))).toBeFalse();
  });

  it("renders producer diagnostics without worker secrets or signed upload URLs", () => {
    const html = renderToString(
      <AdminPostgameMediaDiagnostics
        detail={mediaDetail({
          status: "failed",
          attemptNumber: 3,
          failure: { category: "render", message: "ffmpeg exited with code 1" },
          provenance: {
            renderInputSnapshotHash: "safe-hash",
            renderInputSnapshotVersion: 1,
            rendererVersion: "house-highlights-renderer/1",
            timingContractVersion: "house-highlights-trailer-timing/1",
            musicAssetId: "5-cuts_12-player.m4a",
          },
          cueMetadata: {
            cueSheet: {
              totalDurationSeconds: 59,
              segments: [
                { id: "cast", kind: "cast_roster", startSeconds: 0, endSeconds: 5 },
                { id: "winner", kind: "winner", startSeconds: 29, endSeconds: 33 },
              ],
            },
          },
          currentReady: readyVersion(),
        })}
      />,
    );

    expect(html).toContain("Failed");
    expect(html).toContain("Attempt");
    expect(html).toContain("5-cuts_12-player.m4a");
    expect(html).toContain("Cue markers");
    expect(html).toContain("29.0");
    expect(html).toContain("33.0");
    expect(html).toContain("ffmpeg exited with code 1");
    expect(html).toContain("postgame-media/house-highlights-trailers/game-id/v2/trailer.mp4");
    expect(html).not.toContain("leaseToken");
    expect(html).not.toContain("workerToken");
    expect(html).not.toContain("X-Amz-Signature");
  });

  it("only offers the trailer media pill for completed games", () => {
    const completed = renderToString(<AdminPostgameMediaPill game={adminGame()} onClick={() => {}} />);
    const live = renderToString(<AdminPostgameMediaPill game={adminGame({ status: "in_progress" })} onClick={() => {}} />);

    expect(completed).toContain("Trailer");
    expect(completed).toContain("media");
    expect(live).not.toContain("Trailer");
  });

  it("posts a reason and the API-required action confirmation", async () => {
    setApiBase("http://127.0.0.1:3333");
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ outcome: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await requestAdminPostgameMedia("vast plum/bay", "rerender", "New score approved");

    expect(result).toEqual({ outcome: "queued" });
    expect(request?.url).toBe("http://127.0.0.1:3333/api/admin/games/vast%20plum%2Fbay/postgame/media/rerender");
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      reason: "New score approved",
      confirmation: "RERENDER",
    });
  });
});

function notRequested(): AdminPostgameMediaResponse {
  return { schemaVersion: 1, mediaType: "house_highlights_trailer", status: "not_requested" };
}

function mediaDetail(
  overrides: Partial<Exclude<AdminPostgameMediaResponse, { status: "not_requested" }>> = {},
): Exclude<AdminPostgameMediaResponse, { status: "not_requested" }> {
  return {
    schemaVersion: 1,
    mediaType: "house_highlights_trailer",
    status: "queued",
    renderVersion: 2,
    artifactVersion: "opaque-version",
    attemptNumber: 1,
    timestamps: {
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:01:00.000Z",
      claimedAt: null,
      attemptStartedAt: null,
      attemptFinishedAt: null,
    },
    ...overrides,
  };
}

function readyVersion() {
  return {
    renderVersion: 2,
    durationSeconds: 59,
    publishedAt: "2026-07-09T00:02:00.000Z",
    artifactMetadata: artifacts(),
  };
}

function artifacts(): AdminPostgameMediaArtifactMetadata {
  const base = "postgame-media/house-highlights-trailers/game-id/v2";
  return {
    preview: { title: "House Highlights", description: "The game in motion." },
    video: artifact(`${base}/trailer.mp4`, "video/mp4", 4_000_000, { width: 1920, height: 1080 }),
    poster: artifact(`${base}/poster.png`, "image/png", 800_000, { altText: "Contestant roster" }),
    captions: artifact(`${base}/captions.vtt`, "text/vtt", 2_000, { language: "en", label: "English" }),
    manifest: artifact(`${base}/playback.json`, "application/json", 1_000, {}),
    storage: { provider: "linode_object_storage", bucket: "public-assets" },
  };
}

function artifact<T extends object>(objectKey: string, contentType: string, byteLength: number, extra: T) {
  return {
    publicUrl: `https://media.example.test/${objectKey}`,
    objectKey,
    contentType,
    byteLength,
    sha256: "a".repeat(64),
    ...extra,
  };
}

function adminGame(overrides: Partial<AdminGameSummary> = {}): AdminGameSummary {
  return {
    id: "game-id",
    slug: "vast-plum-bay",
    gameNumber: 42,
    status: "completed",
    playerCount: 12,
    currentRound: 8,
    maxRounds: 8,
    currentPhase: "done",
    phaseTimeRemaining: null,
    alivePlayers: 2,
    eliminatedPlayers: 10,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "replay",
    trackType: "custom",
    winner: "Echo",
    winnerPersona: "strategic",
    hidden: false,
    createdAt: "2026-07-09T00:00:00.000Z",
    completedAt: "2026-07-09T01:00:00.000Z",
    ...overrides,
  };
}
