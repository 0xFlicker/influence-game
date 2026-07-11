import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE,
  type HouseHighlightsTrailerManifest,
} from "@influence/engine";
import { HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID } from "../remotion/house-highlights-trailer/constants";
import {
  HouseHighlightsTrailerMusicUnavailableError,
  musicMuxArgsFor,
  selectHouseHighlightsTrailerMusicVariant,
  type HouseHighlightsTrailerMusicSelection,
} from "./house-highlights-trailer-audio";

const WEB_ROOT = resolve(import.meta.dir, "../..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
export const DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR = resolve(REPO_ROOT, "music/house-highlights-variants");

export type HouseHighlightsTrailerBundleArtifactName = "video" | "poster" | "captions" | "metadata" | "timeline";

export interface HouseHighlightsTrailerBundleArtifact {
  name: HouseHighlightsTrailerBundleArtifactName;
  path: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface HouseHighlightsTrailerMediaBundle {
  manifest: HouseHighlightsTrailerManifest;
  music: HouseHighlightsTrailerMusicSelection;
  durationMs: number;
  dimensions: { width: number; height: number };
  posterFrame: number;
  captions: string;
  timeline: Record<string, unknown>;
  artifacts: Record<Exclude<HouseHighlightsTrailerBundleArtifactName, "metadata">, HouseHighlightsTrailerBundleArtifact>;
}

export interface HouseHighlightsTrailerPlaybackMetadata {
  schema: "influence.house-highlights.playback";
  version: 1;
  durationMs: number;
  dimensions: { width: number; height: number };
  title: string;
  description: string;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
  renderVersion: string;
  contentHashes: { video: string; poster: string; captions: string };
}

export interface HouseHighlightsTrailerRenderer {
  renderVisual(input: { manifest: HouseHighlightsTrailerManifest; outputPath: string }): Promise<void>;
  renderPoster(input: { manifest: HouseHighlightsTrailerManifest; frame: number; outputPath: string }): Promise<void>;
  mux(input: { visualPath: string; outputPath: string; music: HouseHighlightsTrailerMusicSelection }): Promise<void>;
}

export type HouseHighlightsRemotionMediaOptions = ReturnType<typeof remotionMediaOptions>;

export async function renderHouseHighlightsTrailerMediaBundle(input: {
  manifest: HouseHighlightsTrailerManifest;
  outputDir: string;
  musicDir?: string;
  temporaryRoot?: string;
  renderer?: HouseHighlightsTrailerRenderer;
  remotionOptions?: HouseHighlightsRemotionMediaOptions;
  onStage?: (stage: "rendering" | "composing") => Promise<void> | void;
}): Promise<HouseHighlightsTrailerMediaBundle> {
  const musicDir = input.musicDir ?? DEFAULT_HOUSE_HIGHLIGHTS_TRAILER_MUSIC_DIR;
  const filenames = await readdir(musicDir).catch((error) => {
    throw new HouseHighlightsTrailerMusicUnavailableError(
      { houseCuts: input.manifest.scenelets.length, players: input.manifest.cast.length, trailerDurationSeconds: input.manifest.cueSheet.totalDurationSeconds },
      `Prepared House Highlights trailer music is unavailable: ${error instanceof Error ? error.message : "music directory unreadable"}.`,
    );
  });
  const music = selectHouseHighlightsTrailerMusicVariant({
    houseCuts: input.manifest.scenelets.length,
    players: input.manifest.cast.length,
    trailerDurationSeconds: input.manifest.cueSheet.totalDurationSeconds,
  }, filenames, musicDir);
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  const workDir = await mkdtemp(join(input.temporaryRoot ?? tmpdir(), "influence-house-highlights-"));
  const base = safeOutputBasename(input.manifest.game.slug ?? input.manifest.game.id);
  const videoPath = resolve(outputDir, `${base}.mp4`);
  const posterPath = resolve(outputDir, `${base}.poster.png`);
  const captionsPath = resolve(outputDir, `${base}.captions.vtt`);
  const timelinePath = resolve(outputDir, `${base}.cue.json`);
  const visualPath = join(workDir, "visual.mp4");
  const muxPath = join(workDir, "trailer.mp4");
  const posterTempPath = join(workDir, "poster.png");
  const renderer = input.renderer ?? remotionRenderer(input.remotionOptions);
  const posterFrame = posterFrameForManifest(input.manifest);
  try {
    await input.onStage?.("rendering");
    await renderer.renderVisual({ manifest: input.manifest, outputPath: visualPath });
    await renderer.renderPoster({ manifest: input.manifest, frame: posterFrame, outputPath: posterTempPath });
    await input.onStage?.("composing");
    await renderer.mux({ visualPath, outputPath: muxPath, music });
    const captions = captionsForManifest(input.manifest);
    const timeline = timelineForManifest(input.manifest, music, posterFrame);
    await Promise.all([
      rename(muxPath, videoPath),
      rename(posterTempPath, posterPath),
      writeFile(captionsPath, captions, "utf8"),
      writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8"),
    ]);
    return {
      manifest: input.manifest,
      music,
      durationMs: Math.round(input.manifest.cueSheet.totalDurationSeconds * 1_000),
      dimensions: { width: input.manifest.width, height: input.manifest.height },
      posterFrame,
      captions,
      timeline,
      artifacts: {
        video: await artifactFor("video", videoPath, "video/mp4"),
        poster: await artifactFor("poster", posterPath, "image/png"),
        captions: await artifactFor("captions", captionsPath, "text/vtt"),
        timeline: await artifactFor("timeline", timelinePath, "application/json"),
      },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function writeHouseHighlightsTrailerPlaybackMetadata(input: {
  bundle: HouseHighlightsTrailerMediaBundle;
  outputPath: string;
  renderVersion: string;
  urls: { videoUrl: string; posterUrl: string; captionsUrl: string };
}): Promise<HouseHighlightsTrailerBundleArtifact> {
  const metadata = createHouseHighlightsTrailerPlaybackMetadata({
    durationMs: input.bundle.durationMs,
    dimensions: input.bundle.dimensions,
    renderVersion: input.renderVersion,
    urls: input.urls,
    contentHashes: {
      video: input.bundle.artifacts.video.sha256,
      poster: input.bundle.artifacts.poster.sha256,
      captions: input.bundle.artifacts.captions.sha256,
    },
  });
  await writeFile(input.outputPath, `${JSON.stringify(metadata)}\n`, "utf8");
  return artifactFor("metadata", input.outputPath, "application/json");
}

export function createHouseHighlightsTrailerPlaybackMetadata(input: {
  durationMs: number;
  dimensions: { width: number; height: number };
  renderVersion: string;
  urls: { videoUrl: string; posterUrl: string; captionsUrl: string };
  contentHashes: { video: string; poster: string; captions: string };
}): HouseHighlightsTrailerPlaybackMetadata {
  return {
    schema: "influence.house-highlights.playback",
    version: 1,
    durationMs: input.durationMs,
    dimensions: input.dimensions,
    title: "House Highlights",
    description: "A completed Influence game, told through the House.",
    videoUrl: input.urls.videoUrl,
    posterUrl: input.urls.posterUrl,
    captionsUrl: input.urls.captionsUrl,
    renderVersion: input.renderVersion,
    contentHashes: input.contentHashes,
  };
}

export function posterFrameForManifest(manifest: HouseHighlightsTrailerManifest): number {
  const roster = manifest.cueSheet.segments.find((segment) => segment.kind === "cast_roster");
  if (!roster) throw new Error("Trailer manifest is missing the cast roster segment.");
  return roster.endFrame - 1;
}

export function captionsForManifest(manifest: HouseHighlightsTrailerManifest): string {
  const blocks = ["WEBVTT", ""];
  for (const segment of manifest.cueSheet.segments) {
    const lines = captionLinesForSegment(manifest, segment.id, segment.kind);
    if (lines.length === 0) continue;
    blocks.push(`${vttTime(segment.startSeconds)} --> ${vttTime(segment.endSeconds)}`, ...lines.map((line) => line.trim()), "");
  }
  return `${blocks.join("\n")}\n`;
}

export function timelineForManifest(
  manifest: HouseHighlightsTrailerManifest,
  music: HouseHighlightsTrailerMusicSelection,
  posterFrame: number,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mediaType: HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE,
    game: manifest.game,
    cueSheet: manifest.cueSheet,
    posterFrame,
    music: {
      filename: music.filename,
      variantHouseCuts: music.variantHouseCuts,
      variantPlayers: music.variantPlayers,
      variantDurationSeconds: music.variantDurationSeconds,
      behavior: music.behavior,
    },
  };
}

function captionLinesForSegment(manifest: HouseHighlightsTrailerManifest, id: string, kind: string): string[] {
  if (kind === "cast_roster") return ["House Highlights. The room: " + manifest.cast.map((agent) => agent.name).join(", ") + "."];
  if (kind === "scenelet") {
    const scenelet = manifest.scenelets.find((scene) => `scenelet:${scene.id}` === id);
    return scenelet ? [scenelet.title, scenelet.outcome, ...scenelet.facts.map((fact) => fact.text)] : [];
  }
  if (kind === "final_vote") return [`Final vote. ${manifest.finalVote.voteLabel}.`, ...manifest.finalVote.groups.map((group) => `${group.finalist.name}: ${group.votes} votes.`)];
  if (kind === "winner") return [`Winner: ${manifest.finalVote.winner.name}. Final vote ${manifest.finalVote.voteLabel}.`];
  const result = manifest.playerResults.find((entry) => `player_result:${entry.agent.id}` === id);
  return result ? [`${result.agent.name}. ${result.placementLabel}.`, ...result.tags] : [];
}

async function artifactFor(name: HouseHighlightsTrailerBundleArtifactName, path: string, contentType: string): Promise<HouseHighlightsTrailerBundleArtifact> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    byteLength += chunk.byteLength;
  }
  return { name, path, contentType, byteLength, sha256: `sha256:${hash.digest("hex")}` };
}

function remotionRenderer(configuredMediaOptions?: HouseHighlightsRemotionMediaOptions): HouseHighlightsTrailerRenderer {
  let serveUrlPromise: Promise<string> | null = null;
  const mediaOptions = configuredMediaOptions ?? remotionMediaOptions();
  const browserOptions = mediaOptions.browserExecutable
    ? { browserExecutable: mediaOptions.browserExecutable, chromeMode: mediaOptions.chromeMode }
    : {};
  const compositionFor = async (manifest: HouseHighlightsTrailerManifest) => {
    const serveUrl = await (serveUrlPromise ??= bundle({
      entryPoint: resolve(WEB_ROOT, "src/remotion/house-highlights-trailer/index.tsx"),
      publicDir: resolve(WEB_ROOT, "public"),
      rootDir: WEB_ROOT,
    }));
    return { serveUrl, composition: await selectComposition({ serveUrl, id: HOUSE_HIGHLIGHTS_TRAILER_COMPOSITION_ID, inputProps: { manifest }, ...browserOptions }) };
  };
  return {
    async renderVisual({ manifest, outputPath }) {
      const selected = await compositionFor(manifest);
      await renderMedia({ composition: selected.composition, serveUrl: selected.serveUrl, codec: "h264", outputLocation: outputPath, inputProps: { manifest }, overwrite: true, logLevel: "warn", ...mediaOptions });
    },
    async renderPoster({ manifest, frame, outputPath }) {
      const selected = await compositionFor(manifest);
      await renderStill({ composition: selected.composition, serveUrl: selected.serveUrl, frame, imageFormat: "png", output: outputPath, inputProps: { manifest }, overwrite: true, logLevel: "warn", ...browserOptions });
    },
    async mux({ visualPath, outputPath, music }) { await run("ffmpeg", musicMuxArgsFor({ visualPath, outputPath, music })); },
  };
}

export function remotionBrowserOptions(env: Record<string, string | undefined> = process.env): { browserExecutable?: string; chromeMode?: "chrome-for-testing" } {
  const browserExecutable = env.REMOTION_BROWSER_EXECUTABLE?.trim();
  return browserExecutable ? { browserExecutable, chromeMode: "chrome-for-testing" } : {};
}

export function remotionMediaOptions(env: Record<string, string | undefined> = process.env): ReturnType<typeof remotionBrowserOptions> & {
  concurrency: number;
  disallowParallelEncoding: true;
} {
  const configured = env.POSTGAME_MEDIA_REMOTION_CONCURRENCY?.trim();
  const concurrency = configured ? Number(configured) : 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("POSTGAME_MEDIA_REMOTION_CONCURRENCY must be a positive integer.");
  }
  return {
    ...remotionBrowserOptions(env),
    concurrency,
    disallowParallelEncoding: true,
  };
}

function safeOutputBasename(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "house-highlights-trailer"; }
function vttTime(seconds: number): string { const ms = Math.max(0, Math.round(seconds * 1_000)); const hours = Math.floor(ms / 3_600_000); const minutes = Math.floor((ms % 3_600_000) / 60_000); const secs = Math.floor((ms % 60_000) / 1_000); return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms % 1_000).padStart(3, "0")}`; }
function run(command: string, args: string[]): Promise<void> { return new Promise((resolvePromise, reject) => { const child = spawn(command, args, { stdio: "ignore" }); child.on("error", (error) => reject(new Error(`${command} failed to start: ${error.message}`))); child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`))); }); }
