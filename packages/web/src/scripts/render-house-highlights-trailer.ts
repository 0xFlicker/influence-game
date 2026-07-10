import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { CompletedGameResultsResponse, HouseHighlightsResponse } from "../lib/api";
import { gamePathSegment } from "../lib/game-links";
import {
  buildHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "../app/games/[slug]/components/house-highlights-trailer-model";
import { HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID } from "../remotion/house-highlights-trailer/constants";

export interface RenderHouseHighlightsTrailerCliOptions {
  gameIdOrSlug: string;
  apiBaseUrl: string;
  outDir: string;
}

export interface RenderHouseHighlightsTrailerResult {
  mp4Path: string;
  cuePath: string;
  musicPath: string;
  durationSeconds: number;
}

export interface HouseHighlightsTrailerMusicSelection {
  path: string;
  filename: string;
  variantHouseCuts: number;
  variantPlayers: number;
  variantDurationSeconds: number;
  trailerDurationSeconds: number;
}

interface HouseHighlightsTrailerMusicRequest {
  houseCuts: number;
  players: number;
  trailerDurationSeconds: number;
}

interface MusicMuxParams {
  visualPath: string;
  outputPath: string;
  music: HouseHighlightsTrailerMusicSelection;
}

const WEB_ROOT = resolve(import.meta.dir, "../..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_OUTPUT_DIR = resolve(WEB_ROOT, ".renders/house-highlights-trailers");
const HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR = resolve(REPO_ROOT, "music/house-highlights-variants");
const PREPARED_PLAYER_COUNTS = [6, 8, 10, 12] as const;
const MAX_PREPARED_HOUSE_CUTS = 5;
const MUSIC_END_FADE_SECONDS = 3;
const DURATION_EPSILON_SECONDS = 0.05;
const TRAILER_API_TIMEOUT_MS = 30_000;
const MUSIC_VARIANT_PATTERN = /^golden-verdict-(\d+)-cuts-(\d+)-players-(\d+(?:\.\d+)?)s\.m4a$/;

export function parseRenderHouseHighlightsTrailerArgs(
  argv: readonly string[],
): RenderHouseHighlightsTrailerCliOptions {
  const args = [...argv];
  const gameIdOrSlug = args.shift();
  if (!gameIdOrSlug || gameIdOrSlug.startsWith("--")) {
    throw new Error("Usage: bun run trailer:render -- <game-id-or-slug> [--api-base-url <url>] [--out-dir <path>]");
  }

  const options: RenderHouseHighlightsTrailerCliOptions = {
    gameIdOrSlug,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    outDir: DEFAULT_OUTPUT_DIR,
  };

  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!flag || !value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag ?? "option"}.`);
    }
    if (flag === "--api-base-url") {
      options.apiBaseUrl = value;
    } else if (flag === "--out-dir") {
      options.outDir = resolve(value);
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  return {
    ...options,
    apiBaseUrl: normalizeApiBaseUrl(options.apiBaseUrl),
  };
}

export async function renderHouseHighlightsTrailer(
  options: RenderHouseHighlightsTrailerCliOptions,
): Promise<RenderHouseHighlightsTrailerResult> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const gameSegment = gamePathSegment(options.gameIdOrSlug);
  const [highlightsResponse, resultsResponse] = await Promise.all([
    fetchHouseHighlightsTrailerJson<HouseHighlightsResponse>(
      apiBaseUrl,
      `/api/games/${gameSegment}/postgame/highlights`,
    ),
    fetchHouseHighlightsTrailerJson<CompletedGameResultsResponse>(
      apiBaseUrl,
      `/api/games/${gameSegment}/results`,
    ),
  ]);
  const manifest = buildHouseHighlightsTrailerManifest({
    highlightsResponse,
    resultsResponse,
  });
  const outputPaths = outputPathsFor(options.outDir, manifest);
  const music = await musicSelectionForManifest(manifest);
  await mkdir(dirname(outputPaths.mp4Path), { recursive: true });
  const temporaryPaths = temporaryOutputPathsFor(outputPaths.mp4Path);

  const entryPoint = resolve(WEB_ROOT, "src/remotion/house-highlights-trailer/index.tsx");
  console.log(`Bundling ${HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID}...`);
  let lastBundleProgress = -1;
  const serveUrl = await bundle({
    entryPoint,
    publicDir: resolve(WEB_ROOT, "public"),
    rootDir: WEB_ROOT,
    onProgress: (progress) => {
      const percent = progress > 1 ? Math.min(100, progress) : progress * 100;
      const rounded = Math.floor(percent);
      if (rounded === lastBundleProgress || rounded >= 100) return;
      lastBundleProgress = rounded;
      process.stdout.write(`\rBundle ${rounded}%`);
    },
  });
  process.stdout.write("\n");

  const inputProps = { manifest };
  const composition = await selectComposition({
    serveUrl,
    id: HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID,
    inputProps,
  });

  try {
    console.log(`Rendering visual track for ${outputPaths.mp4Path}...`);
    let lastRenderProgress = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: temporaryPaths.visualPath,
      inputProps,
      overwrite: true,
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const rounded = Math.floor(progress * 100);
        if (rounded === lastRenderProgress) return;
        lastRenderProgress = rounded;
        process.stdout.write(`\rRender ${rounded}%`);
      },
    });
    process.stdout.write("\n");

    console.log(`Composing music ${music.filename}...`);
    await run("ffmpeg", musicMuxArgsFor({
      visualPath: temporaryPaths.visualPath,
      outputPath: temporaryPaths.muxPath,
      music,
    }));
    await rename(temporaryPaths.muxPath, outputPaths.mp4Path);
    await writeFile(
      outputPaths.cuePath,
      `${JSON.stringify(cueOutputFor(manifest, music), null, 2)}\n`,
      "utf8",
    );
  } finally {
    await Promise.allSettled([
      unlink(temporaryPaths.visualPath),
      unlink(temporaryPaths.muxPath),
    ]);
  }

  return {
    mp4Path: outputPaths.mp4Path,
    cuePath: outputPaths.cuePath,
    musicPath: music.path,
    durationSeconds: manifest.cueSheet.totalDurationSeconds,
  };
}

export function selectHouseHighlightsTrailerMusicVariant(
  request: HouseHighlightsTrailerMusicRequest,
  filenames: readonly string[],
  musicDir = HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR,
): HouseHighlightsTrailerMusicSelection {
  validateMusicRequest(request);
  const variantHouseCuts = Math.min(
    MAX_PREPARED_HOUSE_CUTS,
    Math.max(0, Math.floor(request.houseCuts)),
  );
  const requestedPlayers = Math.max(0, Math.floor(request.players));
  const variantPlayers = PREPARED_PLAYER_COUNTS.find((count) => count >= requestedPlayers)
    ?? PREPARED_PLAYER_COUNTS[PREPARED_PLAYER_COUNTS.length - 1];
  const matches = filenames
    .map(parseMusicVariantFilename)
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .filter((candidate) => (
      candidate.houseCuts === variantHouseCuts
      && candidate.players === variantPlayers
    ));

  if (matches.length !== 1) {
    throw new Error([
      "Missing House Highlights trailer music variant",
      `${variantHouseCuts} cuts / ${variantPlayers} players`,
      `in ${musicDir}. From ${REPO_ROOT}, run bun run trailer:music:variants to rebuild the score matrix.`,
    ].join(" "));
  }

  const match = matches[0];
  return {
    path: resolve(musicDir, match.filename),
    filename: match.filename,
    variantHouseCuts,
    variantPlayers,
    variantDurationSeconds: match.durationSeconds,
    trailerDurationSeconds: request.trailerDurationSeconds,
  };
}

export function musicMuxArgsFor(params: MusicMuxParams): string[] {
  const { music } = params;
  const trailerDuration = music.trailerDurationSeconds;
  const shouldTrimMusic = music.variantDurationSeconds - trailerDuration > DURATION_EPSILON_SECONDS;
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", params.visualPath,
    "-i", music.path,
  ];

  if (shouldTrimMusic) {
    const fadeDuration = Math.min(MUSIC_END_FADE_SECONDS, trailerDuration);
    const fadeStart = Math.max(0, trailerDuration - fadeDuration);
    args.push(
      "-filter_complex",
      [
        `[1:a]atrim=start=0:end=${formatSeconds(trailerDuration)},`,
        "asetpts=PTS-STARTPTS,",
        `afade=t=out:st=${formatSeconds(fadeStart)}:d=${formatSeconds(fadeDuration)}[outa]`,
      ].join(""),
      "-map", "0:v:0",
      "-map", "[outa]",
    );
  } else {
    args.push(
      "-map", "0:v:0",
      "-map", "1:a:0",
    );
  }

  args.push(
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", formatSeconds(trailerDuration),
    "-movflags", "+faststart",
    params.outputPath,
  );
  return args;
}

export function outputPathsFor(
  outDir: string,
  manifest: Pick<HouseHighlightsTrailerManifest, "game">,
): { mp4Path: string; cuePath: string } {
  const basename = safeOutputBasename(manifest.game.slug ?? manifest.game.id);
  const dir = resolve(outDir);
  return {
    mp4Path: resolve(dir, `${basename}.mp4`),
    cuePath: resolve(dir, `${basename}.cue.json`),
  };
}

function cueOutputFor(
  manifest: HouseHighlightsTrailerManifest,
  music: HouseHighlightsTrailerMusicSelection,
) {
  return {
    schemaVersion: 1,
    game: manifest.game,
    cueSheet: manifest.cueSheet,
    music: {
      filename: music.filename,
      variantHouseCuts: music.variantHouseCuts,
      variantPlayers: music.variantPlayers,
      variantDurationSeconds: music.variantDurationSeconds,
    },
  };
}

async function musicSelectionForManifest(
  manifest: HouseHighlightsTrailerManifest,
): Promise<HouseHighlightsTrailerMusicSelection> {
  const filenames = await readdir(HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR);
  return selectHouseHighlightsTrailerMusicVariant({
    houseCuts: manifest.scenelets.length,
    players: manifest.cast.length,
    trailerDurationSeconds: manifest.cueSheet.totalDurationSeconds,
  }, filenames);
}

function temporaryOutputPathsFor(mp4Path: string): { visualPath: string; muxPath: string } {
  const token = `${process.pid}-${Date.now()}`;
  const dir = dirname(mp4Path);
  const filename = basename(mp4Path);
  return {
    visualPath: resolve(dir, `.${filename}.${token}.visual.tmp.mp4`),
    muxPath: resolve(dir, `.${filename}.${token}.mux.tmp.mp4`),
  };
}

function parseMusicVariantFilename(filename: string): {
  filename: string;
  houseCuts: number;
  players: number;
  durationSeconds: number;
} | null {
  const match = MUSIC_VARIANT_PATTERN.exec(filename);
  if (!match) return null;
  return {
    filename,
    houseCuts: Number(match[1]),
    players: Number(match[2]),
    durationSeconds: Number(match[3]),
  };
}

function validateMusicRequest(request: HouseHighlightsTrailerMusicRequest): void {
  if (
    !Number.isFinite(request.houseCuts)
    || !Number.isFinite(request.players)
    || !Number.isFinite(request.trailerDurationSeconds)
    || request.trailerDurationSeconds <= 0
  ) {
    throw new Error("House Highlights trailer music selection requires finite counts and a positive duration.");
  }
}

export async function fetchHouseHighlightsTrailerJson<T = unknown>(
  apiBaseUrl: string,
  path: string,
  timeoutMs = TRAILER_API_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const url = `${apiBaseUrl}${path}`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed: ${response.status} ${url}${body ? ` - ${body.slice(0, 240)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

function safeOutputBasename(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "house-highlights-trailer";
}

function formatSeconds(value: number): string {
  return value.toFixed(1);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

if (import.meta.main) {
  renderHouseHighlightsTrailer(parseRenderHouseHighlightsTrailerArgs(Bun.argv.slice(2)))
    .then((result) => {
      console.log(`Rendered ${result.mp4Path}`);
      console.log(`Cue sheet ${result.cuePath}`);
      console.log(`Music ${result.musicPath}`);
      console.log(`Duration ${result.durationSeconds}s`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
