import { describe, expect, it } from "bun:test";
import {
  remotionBrowserOptions,
  remotionMediaOptions,
} from "../lib/house-highlights-trailer-media-bundle";
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

  it("only configures Remotion's installed browser when explicitly requested", () => {
    expect(remotionBrowserOptions({})).toEqual({});
    expect(remotionBrowserOptions({ REMOTION_BROWSER_EXECUTABLE: " /usr/bin/chromium " })).toEqual({
      browserExecutable: "/usr/bin/chromium",
      chromeMode: "chrome-for-testing",
    });
  });

  it("uses one low-memory Remotion lane and disables parallel encoding by default", () => {
    expect(remotionMediaOptions({})).toEqual({
      concurrency: 1,
      disallowParallelEncoding: true,
    });
    expect(remotionMediaOptions({
      POSTGAME_MEDIA_REMOTION_CONCURRENCY: "2",
      REMOTION_BROWSER_EXECUTABLE: " /usr/bin/chromium ",
    })).toEqual({
      browserExecutable: "/usr/bin/chromium",
      chromeMode: "chrome-for-testing",
      concurrency: 2,
      disallowParallelEncoding: true,
    });
    expect(() => remotionMediaOptions({
      POSTGAME_MEDIA_REMOTION_CONCURRENCY: "0",
    })).toThrow("POSTGAME_MEDIA_REMOTION_CONCURRENCY");
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
      behavior: "exact",
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

  it("selects every prepared 0-5 cut and 6/8/10/12 player matrix variant exactly", () => {
    const durations = [
      [24.8, 28.4, 32, 35.6], [28.8, 32.4, 36, 39.6], [32.8, 36.4, 40, 43.6],
      [36.8, 40.4, 44, 47.6], [40.8, 44.4, 48, 51.6], [44.8, 48.4, 52, 55.6],
    ];
    const players = [6, 8, 10, 12];
    const filenames = durations.flatMap((row, cuts) => row.map((duration, index) =>
      `golden-verdict-${cuts}-cuts-${players[index]}-players-${duration.toFixed(1)}s.m4a`,
    ));
    for (const [cuts, row] of durations.entries()) {
      for (const [index, duration] of row.entries()) {
        const selection = selectHouseHighlightsTrailerMusicVariant({ houseCuts: cuts, players: players[index]!, trailerDurationSeconds: duration }, filenames, "/music");
        expect(selection.behavior).toBe("exact");
        expect(selection.filename).toBe(`golden-verdict-${cuts}-cuts-${players[index]}-players-${duration.toFixed(1)}s.m4a`);
      }
    }
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
