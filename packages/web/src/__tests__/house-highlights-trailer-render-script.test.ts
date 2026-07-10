import { describe, expect, it } from "bun:test";
import {
  fetchHouseHighlightsTrailerJson,
  musicMuxArgsFor,
  outputPathsFor,
  parseRenderHouseHighlightsTrailerArgs,
  selectHouseHighlightsTrailerMusicVariant,
} from "../scripts/render-house-highlights-trailer";

describe("house highlights trailer render script", () => {
  it("parses required game id with local defaults", () => {
    const options = parseRenderHouseHighlightsTrailerArgs(["vast-plum-bay"]);

    expect(options.gameIdOrSlug).toBe("vast-plum-bay");
    expect(options.apiBaseUrl).toBe("http://127.0.0.1:3000");
    expect(options.outDir).toContain(".renders/house-highlights-trailers");
  });

  it("parses explicit API base URL and output directory", () => {
    const options = parseRenderHouseHighlightsTrailerArgs([
      "vast-plum-bay",
      "--api-base-url",
      "http://localhost:3000/",
      "--out-dir",
      "/tmp/trailers",
    ]);

    expect(options.apiBaseUrl).toBe("http://localhost:3000");
    expect(options.outDir).toBe("/tmp/trailers");
  });

  it("rejects missing game id and unknown options", () => {
    expect(() => parseRenderHouseHighlightsTrailerArgs([])).toThrow("Usage:");
    expect(() => parseRenderHouseHighlightsTrailerArgs(["vast-plum-bay", "--wat", "nope"]))
      .toThrow("Unknown option");
  });

  it("uses stable filesystem-safe output names", () => {
    const paths = outputPathsFor("/tmp/trailers", {
      game: {
        id: "game-id",
        slug: "Vast Plum/Bay!",
        status: "completed",
      },
    });

    expect(paths.mp4Path).toBe("/tmp/trailers/vast-plum-bay.mp4");
    expect(paths.cuePath).toBe("/tmp/trailers/vast-plum-bay.cue.json");
  });

  it("selects the exact prepared score for a supported trailer shape", () => {
    const selection = selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 5,
      players: 12,
      trailerDurationSeconds: 55.6,
    }, [
      "golden-verdict-5-cuts-12-players-55.6s.m4a",
    ], "/music");

    expect(selection).toEqual({
      path: "/music/golden-verdict-5-cuts-12-players-55.6s.m4a",
      filename: "golden-verdict-5-cuts-12-players-55.6s.m4a",
      variantHouseCuts: 5,
      variantPlayers: 12,
      variantDurationSeconds: 55.6,
      trailerDurationSeconds: 55.6,
    });
  });

  it("uses the next prepared player count and caps out-of-matrix content", () => {
    const filenames = [
      "golden-verdict-2-cuts-8-players-36.4s.m4a",
      "golden-verdict-5-cuts-12-players-55.6s.m4a",
    ];

    expect(selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 2,
      players: 7,
      trailerDurationSeconds: 34.6,
    }, filenames, "/music").filename).toBe(
      "golden-verdict-2-cuts-8-players-36.4s.m4a",
    );
    expect(selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 7,
      players: 14,
      trailerDurationSeconds: 67.2,
    }, filenames, "/music").filename).toBe(
      "golden-verdict-5-cuts-12-players-55.6s.m4a",
    );
  });

  it("trims and fades an oversized score while preserving the visual duration", () => {
    const music = selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 2,
      players: 7,
      trailerDurationSeconds: 34.6,
    }, [
      "golden-verdict-2-cuts-8-players-36.4s.m4a",
    ], "/music");
    const args = musicMuxArgsFor({
      visualPath: "/tmp/trailer.visual.mp4",
      outputPath: "/tmp/trailer.mux.mp4",
      music,
    });

    expect(args.join(" ")).toContain("atrim=start=0:end=34.6");
    expect(args.join(" ")).toContain("afade=t=out:st=31.6:d=3.0");
    expect(args).not.toContain("-shortest");
    expect(args[args.indexOf("-t") + 1]).toBe("34.6");
  });

  it("keeps the prepared score fade intact when its duration already matches", () => {
    const music = selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 5,
      players: 12,
      trailerDurationSeconds: 55.6,
    }, [
      "golden-verdict-5-cuts-12-players-55.6s.m4a",
    ], "/music");
    const args = musicMuxArgsFor({
      visualPath: "/tmp/trailer.visual.mp4",
      outputPath: "/tmp/trailer.mux.mp4",
      music,
    });

    expect(args).not.toContain("-filter_complex");
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
    expect(args[args.lastIndexOf("-map") + 1]).toBe("1:a:0");
  });

  it("allows an out-of-matrix trailer to continue after the prepared score ends", () => {
    const music = selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 7,
      players: 14,
      trailerDurationSeconds: 67.2,
    }, [
      "golden-verdict-5-cuts-12-players-55.6s.m4a",
    ], "/music");
    const args = musicMuxArgsFor({
      visualPath: "/tmp/trailer.visual.mp4",
      outputPath: "/tmp/trailer.mux.mp4",
      music,
    });

    expect(args).not.toContain("-filter_complex");
    expect(args).not.toContain("-shortest");
    expect(args[args.indexOf("-t") + 1]).toBe("67.2");
  });

  it("fails clearly when the required prepared score is missing", () => {
    expect(() => selectHouseHighlightsTrailerMusicVariant({
      houseCuts: 3,
      players: 10,
      trailerDurationSeconds: 44,
    }, [], "/music")).toThrow("bun run trailer:music:variants");
  });

  it("aborts a stalled trailer API request", async () => {
    const stalledFetch = ((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Expected a request signal."));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;

    await expect(fetchHouseHighlightsTrailerJson(
      "http://127.0.0.1:3000",
      "/api/games/stalled/results",
      1,
      stalledFetch,
    )).rejects.toThrow();
  });
});
