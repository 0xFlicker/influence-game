import { describe, expect, it } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  CompletedGameEntry,
  postgameMediaStateCopy,
} from "../app/games/[slug]/components/completed-game-entry";
import {
  PostgameMediaPlayer,
  sharePostgameTrailer,
} from "../app/games/[slug]/components/postgame-media-player";
import type { PublicPostgameMediaResponse } from "../lib/api";
import { setApiBase } from "../lib/api";
import GameViewerPage, { generateMetadata } from "../app/games/[slug]/page";
import { GameViewer } from "../app/games/[slug]/game-viewer";

const gameId = "edge-smoke-dusk";

function readyMedia(): Extract<PublicPostgameMediaResponse, { status: "ready" }> {
  return {
    schemaVersion: 1,
    mediaType: "house_highlights_trailer",
    status: "ready",
    renderVersion: 3,
    durationSeconds: 19.8,
    preview: {
      title: "House Highlights",
      description: "A completed Influence game, told through the House.",
    },
    video: {
      url: "https://media.example.test/postgame/v3/trailer.mp4",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
    },
    poster: {
      url: "https://media.example.test/postgame/v3/poster.jpg",
      contentType: "image/jpeg",
      altText: "House Highlights cast roster",
    },
    captions: {
      url: "https://media.example.test/postgame/v3/captions.vtt",
      contentType: "text/vtt",
      language: "en",
      label: "English",
    },
    manifest: {
      url: "https://media.example.test/postgame/v3/metadata.json",
      contentType: "application/json",
    },
  };
}

describe("CompletedGameEntry", () => {
  it("renders a ready native player without autoplay and with captions", () => {
    const html = renderToString(
      <CompletedGameEntry gameId={gameId} gameNumber={12} hasReplay initialMedia={readyMedia()} />,
    );

    expect(html).toContain("House Highlights");
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('poster="https://media.example.test/postgame/v3/poster.jpg"');
    expect(html).toContain('src="https://media.example.test/postgame/v3/trailer.mp4"');
    expect(html).toContain('src="https://media.example.test/postgame/v3/captions.vtt"');
    expect(html).toContain('kind="captions"');
    expect(html).not.toContain("autoplay");
    expect(html).not.toContain("Winner");
    expect(html).not.toContain("Final Vote");
    expect(html).toContain("Share trailer");
    expect(html).toContain("focus-visible:outline");
    expect(html).toContain(`/games/${gameId}/highlights`);
    expect(html).toContain(`/games/${gameId}/replay`);
    expect(html).toContain(`/games/${gameId}/results`);
  });

  it("keeps season points and receipts off the spoiler-safe completed-game entry", () => {
    const html = renderToString(
      <CompletedGameEntry
        gameId={gameId}
        hasReplay
        initialMedia={{ schemaVersion: 1, mediaType: "house_highlights_trailer", status: "not_requested" }}
      />,
    );
    expect(html).not.toContain("Championship point receipts");
    expect(html).not.toContain("Place 1 of 8");
    expect(html).not.toContain("points awarded");
    expect(html).not.toContain("112");
    expect(html).not.toContain("sigma");
    expect(html).not.toContain("opponentRatings");
    expect(html).not.toContain("recalibr");
  });

  for (const [status, expected] of [
    ["not_requested", "Trailer not available yet"],
    ["waiting_inputs", "Trailer not available yet"],
    ["waiting_music", "Trailer not available yet"],
    ["queued", "Trailer in preparation"],
    ["rendering", "Trailer in preparation"],
    ["failed", "Trailer unavailable"],
  ] as const) {
    it(`maps ${status} to a public trailer state without diagnostics`, () => {
      const html = renderToString(
        <CompletedGameEntry
          gameId={gameId}
          hasReplay
          initialMedia={{ schemaVersion: 1, mediaType: "house_highlights_trailer", status }}
        />,
      );

      expect(postgameMediaStateCopy(status).title).toBe(expected);
      expect(html).toContain(expected);
      expect(html).toContain("House Highlights");
      expect(html).toContain("Watch Replay");
      expect(html).toContain("See Results");
      expect(html).not.toContain("retry");
      expect(html).not.toContain("diagnostic");
    });
  }

  it("uses the canonical game URL and clipboard fallback feedback", async () => {
    let copiedUrl = "";
    const result = await sharePostgameTrailer({
      gameId,
      origin: "https://thehouse.game",
      title: "House Highlights",
      text: "A completed Influence game, told through the House.",
      copy: async (url) => {
        copiedUrl = url;
      },
    });

    expect(copiedUrl).toBe(`https://thehouse.game/games/${gameId}`);
    expect(result).toEqual({ tone: "success", message: "Share link copied." });
  });

  it("reports share errors through visible live feedback", async () => {
    const result = await sharePostgameTrailer({
      gameId,
      origin: "https://thehouse.game",
      title: "House Highlights",
      text: "A completed Influence game, told through the House.",
      share: async () => {
        throw new Error("Share unavailable");
      },
      copy: async () => {
        throw new Error("Clipboard unavailable");
      },
    });

    expect(result).toEqual({
      tone: "error",
      message: "Unable to share this trailer right now.",
    });

    const html = renderToString(<PostgameMediaPlayer gameId={gameId} media={readyMedia()} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Share trailer"');
  });

  it("uses stored ready media for spoiler-safe social metadata and falls back safely", async () => {
    const originalApiBackendUrl = process.env.API_BACKEND_URL;
    const originalFetch = globalThis.fetch;
    process.env.API_BACKEND_URL = "http://127.0.0.1:3333";
    let mediaResponse: PublicPostgameMediaResponse = readyMedia();
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => new Response(JSON.stringify(
      String(url).endsWith(`/api/games/${gameId}`)
        ? { id: "game-id", slug: gameId, status: "completed" }
        : mediaResponse,
    ), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    try {
      const readyMetadata = await generateMetadata({
        params: Promise.resolve({ slug: gameId }),
      });
      const serializedReadyMetadata = JSON.stringify(readyMetadata);

      expect(readyMetadata.title).toBe("House Highlights — Influence");
      expect(readyMetadata.description).toBe("A completed Influence game, told through the House.");
      expect(readyMetadata.alternates?.canonical).toBe(`/games/${gameId}`);
      expect(readyMetadata.openGraph?.images).toEqual([
        { url: "https://media.example.test/postgame/v3/poster.jpg", alt: "House Highlights cast roster" },
      ]);
      expect(serializedReadyMetadata.toLowerCase()).not.toContain("winner");
      expect(serializedReadyMetadata.toLowerCase()).not.toContain("final vote");

      mediaResponse = {
        schemaVersion: 1,
        mediaType: "house_highlights_trailer",
        status: "queued",
      };

      const fallbackMetadata = await generateMetadata({
        params: Promise.resolve({ slug: gameId }),
      });
      const serializedFallbackMetadata = JSON.stringify(fallbackMetadata);

      expect(fallbackMetadata.title).toBe("Completed Game — Influence");
      expect(fallbackMetadata.alternates?.canonical).toBe(`/games/${gameId}`);
      expect(serializedFallbackMetadata.toLowerCase()).not.toContain("winner");
      expect(serializedFallbackMetadata.toLowerCase()).not.toContain("final vote");
    } finally {
      if (originalApiBackendUrl === undefined) {
        delete process.env.API_BACKEND_URL;
      } else {
        process.env.API_BACKEND_URL = originalApiBackendUrl;
      }
      globalThis.fetch = originalFetch;
    }
  });

  it("server-loads media only for completed games and passes it to the root viewer", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    setApiBase("http://127.0.0.1:3000");
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(url));
      if (String(url).endsWith(`/api/games/${gameId}`)) {
        return new Response(JSON.stringify({
          id: "game-id",
          slug: gameId,
          gameNumber: 12,
          status: "completed",
          currentRound: 4,
          maxRounds: 8,
          currentPhase: "COMPLETE",
          players: [],
          modelTier: "standard",
          visibility: "public",
          viewerMode: "replay",
          createdAt: "2026-07-09T00:00:00.000Z",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(readyMedia()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const page = await GameViewerPage({ params: Promise.resolve({ slug: gameId }) });
      const viewer = findElementByType(page, GameViewer);

      expect(requestedUrls).toEqual([
        `http://127.0.0.1:3000/api/games/${gameId}`,
        `http://127.0.0.1:3000/api/games/${gameId}/postgame/media`,
      ]);
      expect(viewer?.props.initialPostgameMedia).toEqual(readyMedia());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not server-fetch media for games that are still in progress", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    setApiBase("http://127.0.0.1:3000");
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({
        id: "game-id",
        slug: gameId,
        gameNumber: 12,
        status: "in_progress",
        currentRound: 2,
        maxRounds: 8,
        currentPhase: "VOTE",
        players: [],
        modelTier: "standard",
        visibility: "public",
        viewerMode: "live",
        createdAt: "2026-07-09T00:00:00.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    try {
      await GameViewerPage({ params: Promise.resolve({ slug: gameId }) });
      expect(requestedUrls).toEqual([`http://127.0.0.1:3000/api/games/${gameId}`]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function findElementByType(
  node: ReactNode,
  type: ReactElement["type"],
): ReactElement<{
  children?: ReactNode;
  initialPostgameMedia?: PublicPostgameMediaResponse;
}> | null {
  if (!isValidElement<{
    children?: ReactNode;
    initialPostgameMedia?: PublicPostgameMediaResponse;
  }>(node)) return null;
  if (node.type === type) return node;

  const children = node.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const result = findElementByType(child, type);
      if (result) return result;
    }
    return null;
  }
  return findElementByType(children, type);
}
