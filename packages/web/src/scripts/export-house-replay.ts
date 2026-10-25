import { attachGeneratedAudio } from "../lib/replay-export/generated-audio";
import type { PublishedAudioTrack } from "@influence/engine/audio-track";
import { prepareReplayBundle } from "../lib/replay-export/prepare";
import { renderReplay } from "../lib/replay-export/render";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {loadProductionReplaySource,type ProductionSnapshot} from "../lib/replay-export/production-source";
import {bindInfluenceProductionPresentation,bindWerewolfProductionPresentation} from "../lib/replay-export/production-presentation";
import {compilePresentation,type PresentationMoment} from "../lib/replay-export/presentation";
import type {ExportCue} from "../lib/replay-export/cues";
import {parseTimingProfile} from "../lib/replay-export/timing";
import {selectProductionMoments,resolveProductionMomentIds} from "@influence/engine/production-moments";
import {decodeProductionExport,stableProductionJson} from "@influence/engine/production-moments/export";
import { resolveCliApiSession } from "@influence/engine/cli-api-session";
import {
  ReplayAssets,
  bundlePath,
  fetchReplay,
  runProcess,
  sha256,
  snapshotStageArt,
} from "../lib/replay-export/assets";
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
  "web-base-url": { type: "string" },
  selection:{type:"string"},
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
       bun run replay:export -- --selection "$HOME/Downloads/<slug>-selection.json" --output .renders/<slug>.mp4
       bun run replay:export -- --bundle <directory> --output <file.mp4>
--api-base-url URL       API origin (default http://127.0.0.1:3000)
--web-base-url URL       House sign-in origin (default http://localhost:3001)
--audience mystery|omniscient  Werewolf only; default mystery
--thinking on|off        Default off
--selection FILE         Frozen Studio selection; uses its exact IDs and presentation settings
--timing FILE            JSON presentation adjustments
--speech-manifest FILE   Existing recorded messages, never generated
--music on|off           Default on; --volume 0..1 (default 0.3)
--width N --height N --fps N   Default 1920x1080 at 30fps
--reduced-motion        Explicit output motion preference
--from-cue KEY --until-cue KEY  Inclusive/exclusive range
--inspect               Prepare the sibling .bundle and print cue IDs
--overwrite             Replace output; with a slug, freshly prepare its bundle too
Production reads reuse a cached Producer/Sysop session; browser sign-in opens when needed.
INFLUENCE_API_SESSION_TOKEN supplies an explicit session for unattended local tooling.
Run these commands from the influence-game repository root.
Paths are relative to the invoking directory. --bundle uses frozen settings.
Use the actual downloaded filename for --selection if your browser renamed or moved it.`);
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
      : args.selection ? positionals.length > 1 || Object.keys(args).some(key => !["selection","output","overwrite","inspect","api-base-url","web-base-url","speech-manifest"].includes(key)) : positionals.length !== 1
  )
    throw new Error("Supply one game OR --bundle; bundle settings are frozen");
  const descriptor = args.selection ? decodeProductionExport(JSON.parse(await readFile(resolveInput(args.selection),"utf8"))) : null;
  if (descriptor) {
    const {hash,...frozen} = descriptor;
    if (hash !== `sha256:${sha256(stableProductionJson(frozen))}`) throw new Error("Frozen selection checksum mismatch");
    if (!descriptor.momentIds.length) throw new Error("Selected cut is empty; tag moments before exporting");
    if (descriptor.recordings.some(recording => !recording.versionId) && !args["speech-manifest"]) throw new Error("This frozen cut requires its local --speech-manifest and audio files");
    if (!descriptor.recordings.length && args["speech-manifest"]) throw new Error("Import recordings into the studio before freezing this cut");
  }
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
        manifest.version !== 2 ||
        !manifest.cues.length ||
        manifest.timeline.length !== manifest.cues.length
      )
        throw new Error("Invalid or obsolete replay bundle; re-prepare it from the game");
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
      manifest = await prepareReplayBundle(bundleDir, !!args.overwrite, async (preparationDir) => {
        const number = (name: "width" | "height" | "fps", fallback: number) =>
          args[name] === undefined ? fallback : Number(args[name]);
        const width = descriptor?.settings.width ?? number("width", 1920),
          height = descriptor?.settings.height ?? number("height", 1080),
          fps = descriptor?.settings.fps ?? number("fps", 30);
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

        const api = new URL(args["api-base-url"] ?? "http://127.0.0.1:3000");
        if (api.username || api.password || api.search || api.pathname !== "/")
          throw new Error("API base must be an origin without credentials");
        const token = await resolveCliApiSession({
          apiOrigin: api.origin,
          webOrigin: args["web-base-url"] ?? process.env.INFLUENCE_WEB_BASE_URL ?? "http://localhost:3001",
          requiredRoles: ["producer", "sysop"],
          signal: abort.signal,
        });
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
        const entry = await read<{id:string;slug:string;gameKind:"influence"|"werewolf"}>(descriptor
          ? `/api/admin/production/games/${encodeURIComponent(descriptor.gameId)}`
          : `/api/game-entries/${encodeURIComponent(positionals[0]!)}`);
        if (descriptor && (entry.id !== descriptor.gameId || entry.gameKind !== descriptor.gameKind)) throw new Error("Frozen selection belongs to another game");
        if (descriptor && positionals[0] && positionals[0] !== entry.id && positionals[0] !== entry.slug) throw new Error("Frozen selection belongs to another game");
        const audience = descriptor?.audience ?? (entry.gameKind === "werewolf" ? args.audience as "mystery"|"omniscient"|undefined ?? "mystery" : "public");
        if (entry.gameKind === "influence" && args.audience) throw new Error("--audience applies only to Werewolf");
        const thinking = descriptor ? typeof descriptor.sourceSnapshot.thinking === "boolean" ? descriptor.sourceSnapshot.thinking : descriptor.selection.thinking : args.thinking === "on";
        if (descriptor) {
          const response = await fetch(new URL(`/api/admin/production/games/${encodeURIComponent(entry.id)}/selection/validate`,api),{
            method:"POST",redirect:"error",signal:AbortSignal.any([abort.signal,AbortSignal.timeout(60000)]),
            headers:{"Content-Type":"application/json",...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(descriptor)});
          if (!response.ok) throw new Error(`Selection authorization failed: ${response.status} ${await response.text()}`);
        }
        const loaded = await loadProductionReplaySource(read,{gameId:entry.id,gameKind:entry.gameKind,audience,thinking,
          snapshot:descriptor?.sourceSnapshot as ProductionSnapshot|undefined});
        if (loaded.status !== "completed") throw new Error("Export requires a completed game; paused snapshots are preview-only");
        const source = loaded.source;
        if (source.kind === "werewolf" && descriptor?.copy.title !== undefined) source.title = descriptor.copy.title;
        const moments = source.kind === "werewolf"
          ? await bindWerewolfProductionPresentation({source,catalog:loaded.catalog,provenance:loaded.provenance,thoughts:loaded.thoughts})
          : await bindInfluenceProductionPresentation({source,catalog:loaded.catalog,thoughts:loaded.acceptedThoughts});
        const selectedIds = descriptor ? resolveProductionMomentIds(loaded.catalog,descriptor.momentIds).map(moment => moment.id)
          : selectProductionMoments(loaded.catalog,{mode:"full",thinking:args.thinking === "on"}).map(moment => moment.id);
        if (descriptor && selectedIds.some((id,index) => id !== descriptor.momentIds[index])) throw new Error("Frozen IDs must preserve source order");
        const selected = new Set(selectedIds),permittedSpeech = moments.flatMap(moment => moment.segments);
        let selectedMoments = moments.filter(moment => selected.has(moment.id));
        const assets = new ReplayAssets(
          preparationDir,
          join(webRoot, "public"),
          api,
          abort.signal,
          token,
        );
        if (args["speech-manifest"])
          await attachSpeech(resolveInput(args["speech-manifest"]),selectedMoments.flatMap(moment => moment.segments),assets,permittedSpeech,descriptor?.recordings);
        if (!args["speech-manifest"]) {
          const publication = await read<PublishedAudioTrack | null>(`/api/admin/production/games/${encodeURIComponent(entry.id)}/audio/manifest?audience=${audience}&thinking=${thinking ? "on" : "off"}`);
          const attached = await attachGeneratedAudio({source:selectedMoments, selectedIds, publication, hash:sha256, frozen:descriptor?.recordings, signal:abort.signal,
            asset:async clip => {const key = await assets.cache(clip.url);return {...assets.table[key]!,path:key};}});
          selectedMoments = attached.source;
        }
        const profile = descriptor?.settings.profile ?? parseTimingProfile(args.timing ? JSON.parse(await readFile(resolveInput(args.timing),"utf8")) : {});
        const music = descriptor?.settings.music ?? args.music !== "off",volume = descriptor?.settings.volume ?? (args.volume === undefined ? .3 : Number(args.volume));
        const frozenMoments:PresentationMoment[] = [];
        for (const moment of selectedMoments) {
          const segments:ExportCue[] = [];
          for (const cue of moment.segments) segments.push(await assets.freeze({...cue,music:music ? cue.music : null}));
          frozenMoments.push({...moment,segments});
        }
        // Preserve the complete source ID namespace for legal overrides, without carrying omitted payload into preparation.
        const frozenById = new Map(frozenMoments.map(moment => [moment.id,moment]));
        const preparationSource = moments.map(moment => frozenById.get(moment.id) ?? {id:moment.id,segments:[]});
        const compiled = compilePresentation({source:preparationSource,selectedIds,profile,fps,assets:assets.table,music,volume});
        const {cues,timeline,audio} = compiled;
        console.log(`Preparing media for ${cues.length} cues…`);
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
          preparationDir,
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
        const prepared: ReplayManifest = {
          schema: "house.replay-export",
          version: 2,
          game,
          width,
          height,
          fps,
          reducedMotion: descriptor?.settings.reducedMotion ?? Boolean(args["reduced-motion"]),
          thinking: cues.some(cue => cue.picture.kind === "thinking"),
          profile,
          cues,
          timeline,
          assets: assets.table,
          staticFiles,
          boundary:{...boundary,sourceHash:loaded.snapshot.sourceHash,...(descriptor && {selectionHash:descriptor.hash})},
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
        validateManifest(prepared);
        abort.signal.throwIfAborted();
        await writeFile(
          join(preparationDir, "manifest.json"),
          JSON.stringify(prepared, null, 2),
        );
        return prepared;
      });
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
    if (manifest.boundary.selectionHash) console.log(`Frozen selection: ${manifest.boundary.selectionHash}`);
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
