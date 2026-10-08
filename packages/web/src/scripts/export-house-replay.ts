import { renderReplay } from "../lib/replay-export/render";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadReplaySource } from "../lib/replay-export/source";
import { buildExportCues } from "../lib/replay-export/cues";
import { compileTiming, parseTimingProfile } from "../lib/replay-export/timing";
import {
  ReplayAssets,
  bundlePath,
  fetchReplay,
  runProcess,
  sha256,
  snapshotStageArt,
} from "../lib/replay-export/assets";
import { compileAudio } from "../lib/replay-export/audio";
import { attachSpeech } from "../lib/replay-export/speech";
import {
  validateManifest,
  type ReplayManifest,
} from "../lib/replay-export/manifest";
const webRoot = resolve(import.meta.dir, "../.."),
  repoRoot = resolve(webRoot, "../..");
const resolveInput = (path: string) =>
  resolve(process.env.REPLAY_EXPORT_CWD ?? process.cwd(), path);
const options = {
  "api-base-url": { type: "string" },
  audience: { type: "string" },
  thinking: { type: "string" },
  output: { type: "string" },
  bundle: { type: "string" },
  inspect: { type: "boolean" },
  overwrite: { type: "boolean" },
  help: { type: "boolean" },
  timing: { type: "string" },
  "speech-manifest": { type: "string" },
  music: { type: "string" },
  volume: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  fps: { type: "string" },
  "reduced-motion": { type: "boolean" },
  "from-cue": { type: "string" },
  "until-cue": { type: "string" },
} as const;
async function main() {
  const { values: args, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options,
    allowPositionals: true,
    strict: true,
  });
  if (args.help) {
    console.log(`Export a completed House replay locally. No provider calls or publication.
Usage: bun run replay:export -- <slug> --output <file.mp4> [options]
       bun run replay:export -- --bundle <directory> --output <file.mp4>
--api-base-url URL       API origin (default http://127.0.0.1:3000)
--audience mystery|omniscient  Werewolf only; default mystery
--thinking on|off        Default off
--timing FILE            JSON presentation adjustments
--speech-manifest FILE   Existing recorded messages, never generated
--music on|off           Default on; --volume 0..1 (default 0.3)
--width N --height N --fps N   Default 1920x1080 at 30fps
--reduced-motion        Explicit output motion preference
--from-cue KEY --until-cue KEY  Inclusive/exclusive range
--inspect               Prepare the sibling .bundle and print cue IDs
--overwrite             Replace an existing output file
Private reads: set HOUSE_REPLAY_TOKEN in the environment. Never saved.
Paths are relative to the invoking directory. --bundle uses frozen settings.`);
    return;
  }
  if (!args.output || !args.output.endsWith(".mp4"))
    throw new Error("--output requires an .mp4 path");
  if (
    args.bundle
      ? positionals.length ||
        Object.keys(args).some(
          (key) =>
            ![
              "bundle",
              "output",
              "overwrite",
              "inspect",
              "from-cue",
              "until-cue",
            ].includes(key),
        )
      : positionals.length !== 1
  )
    throw new Error("Supply one game OR --bundle; bundle settings are frozen");
  const output = resolveInput(args.output),
    bundleDir = args.bundle
      ? resolveInput(args.bundle)
      : output.replace(/\.mp4$/, ".bundle");
  if (!args.overwrite && (await Bun.file(output).exists()))
    throw new Error("Output exists; choose another path or --overwrite");
  const abort = new AbortController();
  const cancel = () => abort.abort(new Error("Replay export cancelled"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    let manifest: ReplayManifest;
    if (args.bundle) {
      manifest = JSON.parse(
        await readFile(join(bundleDir, "manifest.json"), "utf8"),
      );
      if (
        manifest.schema !== "house.replay-export" ||
        manifest.version !== 1 ||
        !manifest.cues.length ||
        manifest.timeline.length !== manifest.cues.length
      )
        throw new Error("Invalid replay bundle");
      validateManifest(manifest);
      for (const [path, hash] of Object.entries(manifest.staticFiles))
        if (sha256(await readFile(bundlePath(bundleDir, path))) !== hash)
          throw new Error(`Stage art checksum mismatch: ${path}`);
      for (const asset of Object.values(manifest.assets))
        if (
          sha256(await readFile(bundlePath(bundleDir, asset.path))) !==
          asset.sha256
        )
          throw new Error(`Asset checksum mismatch: ${asset.path}`);
    } else {
      if (await Bun.file(join(bundleDir, "manifest.json")).exists())
        throw new Error(
          "Prepared bundle already exists; use --bundle or another output path",
        );
      const number = (name: "width" | "height" | "fps", fallback: number) =>
        args[name] === undefined ? fallback : Number(args[name]);
      const width = number("width", 1920),
        height = number("height", 1080),
        fps = number("fps", 30);
      if (
        ![width, height].every(
          (value) =>
            Number.isSafeInteger(value) &&
            value >= 128 &&
            value <= 7680 &&
            value % 2 === 0,
        ) ||
        !Number.isSafeInteger(fps) ||
        fps < 1 ||
        fps > 120
      )
        throw new Error("Use even dimensions 128–7680 and integer FPS 1–120");
      if (args.audience && !["mystery", "omniscient"].includes(args.audience))
        throw new Error("Invalid audience");
      if (
        (args.thinking && !["on", "off"].includes(args.thinking)) ||
        (args.music && !["on", "off"].includes(args.music))
      )
        throw new Error("thinking/music must be on or off");

      const api = new URL(args["api-base-url"] ?? "http://127.0.0.1:3000"),
        token = process.env.HOUSE_REPLAY_TOKEN;
      if (api.username || api.password || api.search || api.pathname !== "/")
        throw new Error("API base must be an origin without credentials");
      console.log("Loading completed replay…");
      const read = async <T>(path: string): Promise<T> => {
        const response = await fetchReplay(
          new URL(path, api),
          api,
          token,
          AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
        );
        return (await response.json()) as T;
      };
      const source = await loadReplaySource(read, {
        game: positionals[0]!,
        audience: args.audience as "mystery" | "omniscient" | undefined,
        thinking: args.thinking === "on",
      });
      let cues = await buildExportCues(
        source,
        args.thinking === "on",
        read,
      );
      const assets = new ReplayAssets(
        bundleDir,
        join(webRoot, "public"),
        api,
        abort.signal,
        token,
      );
      if (args.music === "off")
        cues = cues.map((cue) => ({ ...cue, music: null }));
      if (args["speech-manifest"])
        await attachSpeech(resolveInput(args["speech-manifest"]), cues, assets);
      console.log(`Preparing media for ${cues.length} cues…`);
      for (let index = 0; index < cues.length; index++) {
        try {
          cues[index] = await assets.freeze(cues[index]!);
        } catch (error) {
          throw new Error(
            `Media preparation failed for cue ${cues[index]!.timing.key}: ${error instanceof Error ? error.message : "unknown asset failure"}`,
          );
        }
      }
      const profile = parseTimingProfile(
        args.timing
          ? JSON.parse(await readFile(resolveInput(args.timing), "utf8"))
          : {},
      );
      const timeline = compileTiming(
        cues.map((cue) => cue.timing),
        profile,
        fps,
      );
      const audio = compileAudio(
        cues,
        timeline,
        assets.table,
        profile,
        args.music !== "off",
        args.volume === undefined ? 0.3 : Number(args.volume),
      );
      const game =
        source.kind === "werewolf"
          ? {
              id: source.windows[0]!.gameId,
              slug: source.windows[0]!.slug,
              kind: source.kind,
              audience: source.windows[0]!.audience,
            }
          : { id: source.game.id, slug: source.game.slug, kind: source.kind };
      const staticFiles = await snapshotStageArt(
        join(webRoot, "public"),
        bundleDir,
      );
      const boundary =
        source.kind === "werewolf"
          ? {
              cursor: source.windows[0]!.latestCursor,
              publicationCutoff: source.windows[0]!.publicationCutoff,
            }
          : {
              eventSequence: source.frames.at(-1)?.sequence,
              transcriptCount: source.messages.length,
              publications: source.visual.publicationSnapshot,
            };
      manifest = {
        schema: "house.replay-export",
        version: 1,
        game,
        width,
        height,
        fps,
        reducedMotion: Boolean(args["reduced-motion"]),
        thinking: args.thinking === "on",
        profile,
        cues,
        timeline,
        assets: assets.table,
        staticFiles,
        boundary,
        audio,
        range: {
          fromFrame: 0,
          untilFrame: Math.ceil((audio.durationMs * fps) / 1000),
        },
        revision: (
          await runProcess("git", ["-C", repoRoot, "rev-parse", "HEAD"])
        ).trim(),
        dirty: Boolean(
          (
            await runProcess("git", ["-C", repoRoot, "status", "--porcelain"])
          ).trim(),
        ),
      };
      validateManifest(manifest);
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
    }
    const find = (key: string) => {
      const cue = manifest.timeline.find((cue) => cue.key === key);
      if (!cue) throw new Error(`Unknown cue: ${key}`);
      return cue.startFrame;
    };
    manifest = {
      ...manifest,
      range: {
        fromFrame: args["from-cue"] ? find(args["from-cue"]) : 0,
        untilFrame: args["until-cue"]
          ? find(args["until-cue"])
          : Math.ceil((manifest.audio.durationMs * manifest.fps) / 1000),
      },
    };
    if (manifest.range.fromFrame >= manifest.range.untilFrame)
      throw new Error("Range must contain at least one frame");
    console.log(
      `${manifest.game.kind}: ${manifest.cues.length} cues, ${Object.keys(manifest.assets).length} assets, ${((manifest.range.untilFrame - manifest.range.fromFrame) / manifest.fps).toFixed(2)}s at ${manifest.width}×${manifest.height}/${manifest.fps}fps`,
    );
    if (args.inspect) {
      for (const [index, cue] of manifest.cues.entries())
        console.log(
          JSON.stringify({
            key: cue.timing.key,
            seconds:
              (manifest.timeline[index]!.endMs -
                manifest.timeline[index]!.startMs) /
              1000,
            source: cue.source,
            voice: !!cue.timing.recording,
            ...(cue.speech
              ? {
                  messageId: cue.speech.messageId,
                  speakerId: cue.speech.speakerId,
                  textHash: sha256(cue.speech.text),
                }
              : {}),
          }),
        );
      console.log(`Bundle: ${bundleDir}`);
      return;
    }
    await renderReplay(
      manifest,
      bundleDir,
      output,
      !!args.overwrite,
      abort.signal,
    );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
