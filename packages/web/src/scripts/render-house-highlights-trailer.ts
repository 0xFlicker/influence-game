import { resolve } from "node:path";
import {
  buildHouseHighlightsTrailerManifest,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import type { CompletedGameResultsResponse, HouseHighlightsResponse } from "../lib/api";
import { gamePathSegment } from "../lib/game-links";
import {
  renderHouseHighlightsTrailerMediaBundle,
} from "../lib/house-highlights-trailer-media-bundle";

export {
  HouseHighlightsTrailerMusicUnavailableError,
  musicMuxArgsFor,
  selectHouseHighlightsTrailerMusicVariant,
} from "../lib/house-highlights-trailer-audio";
export type {
  HouseHighlightsTrailerMusicRequest,
  HouseHighlightsTrailerMusicSelection,
} from "../lib/house-highlights-trailer-audio";

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

const WEB_ROOT = resolve(import.meta.dir, "../..");
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_OUTPUT_DIR = resolve(WEB_ROOT, ".renders/house-highlights-trailers");
const TRAILER_API_TIMEOUT_MS = 30_000;

export function parseRenderHouseHighlightsTrailerArgs(argv: readonly string[]): RenderHouseHighlightsTrailerCliOptions {
  const args = [...argv];
  const gameIdOrSlug = args.shift();
  if (!gameIdOrSlug || gameIdOrSlug.startsWith("--")) {
    throw new Error("Usage: bun run trailer:render -- <game-id-or-slug> [--api-base-url <url>] [--out-dir <path>]");
  }
  const options: RenderHouseHighlightsTrailerCliOptions = { gameIdOrSlug, apiBaseUrl: DEFAULT_API_BASE_URL, outDir: DEFAULT_OUTPUT_DIR };
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!flag || !value || value.startsWith("--")) throw new Error(`Missing value for ${flag ?? "option"}.`);
    if (flag === "--api-base-url") options.apiBaseUrl = value;
    else if (flag === "--out-dir") options.outDir = resolve(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  return { ...options, apiBaseUrl: normalizeApiBaseUrl(options.apiBaseUrl) };
}

/** Local developer adapter only: production workers receive a stored manifest. */
export async function renderHouseHighlightsTrailer(options: RenderHouseHighlightsTrailerCliOptions): Promise<RenderHouseHighlightsTrailerResult> {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const gameSegment = gamePathSegment(options.gameIdOrSlug);
  const [highlightsResponse, resultsResponse] = await Promise.all([
    fetchHouseHighlightsTrailerJson<HouseHighlightsResponse>(apiBaseUrl, `/api/games/${gameSegment}/postgame/highlights`),
    fetchHouseHighlightsTrailerJson<CompletedGameResultsResponse>(apiBaseUrl, `/api/games/${gameSegment}/results`),
  ]);
  const manifest = buildHouseHighlightsTrailerManifest({ highlightsResponse, resultsResponse });
  const bundle = await renderHouseHighlightsTrailerMediaBundle({ manifest, outputDir: options.outDir });
  return {
    mp4Path: bundle.artifacts.video.path,
    cuePath: bundle.artifacts.timeline.path,
    musicPath: bundle.music.path,
    durationSeconds: manifest.cueSheet.totalDurationSeconds,
  };
}

export function outputPathsFor(outDir: string, manifest: Pick<HouseHighlightsTrailerManifest, "game">): { mp4Path: string; cuePath: string } {
  const base = safeOutputBasename(manifest.game.slug ?? manifest.game.id);
  return { mp4Path: resolve(outDir, `${base}.mp4`), cuePath: resolve(outDir, `${base}.cue.json`) };
}

export async function fetchHouseHighlightsTrailerJson<T = unknown>(apiBaseUrl: string, path: string, timeoutMs = TRAILER_API_TIMEOUT_MS, fetchImpl: typeof fetch = fetch): Promise<T> {
  const url = `${apiBaseUrl}${path}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  return response.json() as Promise<T>;
}

function normalizeApiBaseUrl(value: string): string { return new URL(value).toString().replace(/\/$/, ""); }
function safeOutputBasename(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "house-highlights-trailer"; }

if (import.meta.main) {
  renderHouseHighlightsTrailer(parseRenderHouseHighlightsTrailerArgs(Bun.argv.slice(2)))
    .then((result) => console.log(`Rendered ${result.mp4Path}\nCue sheet ${result.cuePath}\nMusic ${result.musicPath}\nDuration ${result.durationSeconds}s`))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
