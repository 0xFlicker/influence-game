import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseHouseHighlightsTrailerManifest, type HouseHighlightsTrailerManifest } from "@influence/engine";
import {
  createHouseHighlightsTrailerPlaybackMetadata,
  renderHouseHighlightsTrailerMediaBundle,
  type HouseHighlightsTrailerRenderer,
} from "../lib/house-highlights-trailer-media-bundle";
import {
  houseHighlightsMediaWorkerConfig,
  parseHouseHighlightsMediaWorkerArgs,
  runHouseHighlightsMediaWorkerOnce,
} from "../scripts/render-house-highlights-media-worker";

describe("House Highlights media worker bundle", () => {
  it("renders a stored snapshot without live game endpoints and cleans temporary output", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-test-"));
    const musicDir = join(root, "music");
    await mkdir(join(root, "tmp"), { recursive: true });
    await mkdir(musicDir, { recursive: true });
    await Bun.write(join(musicDir, "golden-verdict-0-cuts-6-players-28.8s.m4a"), "prepared score");
    const manifest = parseHouseHighlightsTrailerManifest(JSON.stringify(manifestFixture()));
    const bundle = await renderHouseHighlightsTrailerMediaBundle({
      manifest,
      outputDir: join(root, "out"),
      temporaryRoot: join(root, "tmp"),
      musicDir,
      renderer: fakeRenderer(),
    });

    expect(bundle.music.behavior).toBe("trim_and_fade");
    expect(bundle.posterFrame).toBeGreaterThan(manifest.cueSheet.segments[0]!.startFrame);
    expect(bundle.posterFrame).toBeLessThan(manifest.cueSheet.segments[0]!.endFrame);
    expect(bundle.posterFrame).toBeLessThan(manifest.cueSheet.markers.finalVoteRevealSeconds * manifest.frameRate);
    expect(bundle.captions).toContain("The room: Alice, Bob, Cara, Dax.");
    expect(bundle.captions).toContain("Final vote. 2-0.");
    expect(bundle.captions).toContain("Winner: Alice.");
    expect(bundle.captions).toContain("Runner-up");
    expect(bundle.captions.toLowerCase()).not.toContain("receipt");
    expect(bundle.captions.toLowerCase()).not.toContain("proof");
    const metadata = createHouseHighlightsTrailerPlaybackMetadata({
      durationMs: bundle.durationMs,
      dimensions: bundle.dimensions,
      renderVersion: "rv_fixture",
      urls: { videoUrl: "https://media.example.test/trailer.mp4", posterUrl: "https://media.example.test/poster.png", captionsUrl: "https://media.example.test/captions.vtt" },
      contentHashes: { video: bundle.artifacts.video.sha256, poster: bundle.artifacts.poster.sha256, captions: bundle.artifacts.captions.sha256 },
    });
    expect(Object.keys(metadata).sort()).toEqual(["captionsUrl", "contentHashes", "description", "dimensions", "durationMs", "posterUrl", "renderVersion", "schema", "title", "version", "videoUrl"]);
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("winner");
    expect(JSON.stringify(metadata).toLowerCase()).not.toContain("final vote");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("cleans temporary output after a mux failure without creating a final video", async () => {
    const root = await mkdtemp(join(tmpdir(), "house-highlights-worker-failure-"));
    const musicDir = join(root, "music");
    await mkdir(join(root, "tmp"), { recursive: true });
    await mkdir(musicDir, { recursive: true });
    await Bun.write(join(musicDir, "golden-verdict-0-cuts-6-players-28.8s.m4a"), "prepared score");
    const renderer = fakeRenderer({ mux: async () => { throw new Error("simulated mux failure"); } });
    await expect(renderHouseHighlightsTrailerMediaBundle({
      manifest: manifestFixture(), outputDir: join(root, "out"), temporaryRoot: join(root, "tmp"), musicDir, renderer,
    })).rejects.toThrow("simulated mux failure");
    expect(await readdir(join(root, "tmp"))).toEqual([]);
  });

  it("uses env-only worker auth and does not include the token in API failures", async () => {
    const config = houseHighlightsMediaWorkerConfig({
      POSTGAME_MEDIA_API_URL: "http://api.test/",
      POSTGAME_MEDIA_WORKER_TOKEN: "secret-worker-token",
    });
    const requests: Request[] = [];
    const result = await runHouseHighlightsMediaWorkerOnce(config, (async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ claim: null });
    }) as typeof fetch);
    expect(result).toBe("idle");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret-worker-token");
    expect(() => houseHighlightsMediaWorkerConfig({ POSTGAME_MEDIA_API_URL: "http://api.test" }))
      .toThrow("POSTGAME_MEDIA_WORKER_TOKEN");
    expect(parseHouseHighlightsMediaWorkerArgs(["--once"])).toBe("once");
    expect(parseHouseHighlightsMediaWorkerArgs(["--health"])).toBe("health");
  });
});

function fakeRenderer(overrides: Partial<HouseHighlightsTrailerRenderer> = {}): HouseHighlightsTrailerRenderer {
  return {
    renderVisual: async ({ outputPath }) => { await Bun.write(outputPath, "visual"); },
    renderPoster: async ({ outputPath }) => { await Bun.write(outputPath, "poster"); },
    mux: async ({ outputPath }) => { await Bun.write(outputPath, "muxed with audio"); },
    ...overrides,
  };
}

function manifestFixture(): HouseHighlightsTrailerManifest {
  const agent = (id: string, name: string, placement: number, status: "winner" | "finalist" | "eliminated") => ({ id, name, initials: name[0]!, avatarUrl: `/avatars/${id}.png`, placement, status });
  const alice = agent("alice", "Alice", 1, "winner");
  const bob = agent("bob", "Bob", 2, "finalist");
  const cara = agent("cara", "Cara", 3, "eliminated");
  const dax = agent("dax", "Dax", 4, "eliminated");
  return {
    schemaVersion: 1, mediaType: "house_highlights_trailer", timingContractVersion: "house-highlights-trailer-timing-v1",
    game: { id: "fixture", slug: "fixture", status: "completed" }, frameRate: 30, width: 1920, height: 1080,
    cast: [alice, bob, cara, dax], scenelets: [],
    finalVote: { finalists: [alice, bob], groups: [{ finalist: alice, votes: 2, jurors: [cara, dax] }, { finalist: bob, votes: 0, jurors: [] }], voteLabel: "2-0", winner: alice },
    playerResults: [{ agent: dax, placementLabel: "4th", tags: ["Eliminated in round 2"] }, { agent: cara, placementLabel: "3rd", tags: ["Juror"] }, { agent: bob, placementLabel: "2nd", tags: ["Runner-up", "Reached final"] }, { agent: alice, placementLabel: "1st", tags: ["Winner", "Won final vote 2-0"] }],
    cueSheet: {
      schemaVersion: 1, timingContractVersion: "house-highlights-trailer-timing-v1", frameRate: 30, totalFrames: 648, totalDurationSeconds: 21.6,
      segments: [cue("cast_roster", "cast_roster", "Cast roster", 0, 150), cue("final_vote", "final_vote", "Final vote", 150, 300), cue("winner", "winner", "Winner reveal", 300, 420), cue("player_result:dax", "player_result", "Dax", 420, 474), cue("player_result:cara", "player_result", "Cara", 474, 528), cue("player_result:bob", "player_result", "Bob", 528, 582), cue("player_result:alice", "player_result", "Alice", 582, 648)],
      markers: { finalVoteRevealSeconds: 5, winnerRevealSeconds: 10 },
    },
  };
}

function cue(id: string, kind: HouseHighlightsTrailerManifest["cueSheet"]["segments"][number]["kind"], label: string, startFrame: number, endFrame: number) {
  return { id, kind, label, startFrame, endFrame, startSeconds: startFrame / 30, endSeconds: endFrame / 30, durationSeconds: (endFrame - startFrame) / 30 };
}
