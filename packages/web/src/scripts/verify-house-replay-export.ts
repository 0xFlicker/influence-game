/** Opt-in local browser proof using an already prepared bundle; no providers or API reads. */
import { resolve, join } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  openBrowser,
  renderStill,
  renderFrames,
  selectComposition,
} from "@remotion/renderer";
import { withPreparedReplay } from "../lib/replay-export/render";
import {
  validateManifest,
  type ReplayManifest,
} from "../lib/replay-export/manifest";
import { bundlePath, sha256 } from "../lib/replay-export/assets";

const bundleDir = resolve(process.argv[2] ?? ""),
  output = resolve(process.argv[3] ?? ".renders/replay-frame-proof");
if (!process.argv[2])
  throw new Error(
    "Usage: bun run src/scripts/verify-house-replay-export.ts BUNDLE OUTPUT",
  );
const manifest: ReplayManifest = JSON.parse(
  await readFile(join(bundleDir, "manifest.json"), "utf8"),
);
validateManifest(manifest);
for (const [path, hash] of [
  ...Object.entries(manifest.staticFiles),
  ...Object.values(manifest.assets).map(
    (asset) => [asset.path, asset.sha256] as const,
  ),
]) {
  if (sha256(await readFile(bundlePath(bundleDir, path))) !== hash)
    throw new Error(`Checksum mismatch: ${path}`);
}
await mkdir(output, { recursive: true });
await withPreparedReplay(
  manifest,
  bundleDir,
  new AbortController().signal,
  async (serveUrl, manifest) => {
    const inputProps = { manifest },
      composition = await selectComposition({
        serveUrl,
        id: "HouseReplay",
        inputProps,
      });
    const selected = new Map<string, number>();
    const thinkingFrames = new Map<string, number>();
    for (const [index, cue] of manifest.cues.entries()) {
      const picture = cue.picture;
      const kind =
        picture.kind === "werewolf"
          ? picture.cue.transformation
            ? `transformation-${picture.cue.transformation.wolfIds.length}`
            : (picture.cue.nightAction?.kind ??
              (picture.cue.ballot
                ? picture.cue.ballot.complete
                  ? "tally"
                  : "ballot"
                : picture.cue.moment.entry.kind))
          : picture.kind === "werewolf-opening" ? `opening-${picture.cue.opening.shot}` : (picture.beat?.kind ?? picture.cue.kind);
      const interval = manifest.timeline[index]!;
      if (interval.thought) {
        const thought = interval.thought;
        const treatment = picture.kind === "werewolf" && picture.scene
          ? "scene" : picture.kind === "influence" && picture.beat?.kind === "scene"
            ? "scene" : "portrait";
        for (const [phase, offset] of [
          ["enter", thought.enterMs / 2],
          ["reading", thought.readAtMs + 500],
          ["return", (thought.returnAtMs + thought.duration) / 2],
        ] as const) {
          const key = `thinking-${treatment}-${phase}`;
          const frame = Math.ceil((interval.startMs + thought.insertAt + offset) * manifest.fps / 1000) - manifest.range.fromFrame;
          if (frame >= 0 && frame + 1 < composition.durationInFrames && !thinkingFrames.has(key))
            thinkingFrames.set(key, frame);
        }
      }
      const reading = interval.segments.find(
        (segment) => segment.kind === "reading",
      );
      const transformation =
        picture.kind === "werewolf" ? picture.cue.transformation : undefined;
      const cameraFrame = interval.startFrame + Math.ceil(0.2 * manifest.fps) - manifest.range.fromFrame;
      const frame =
        Math.ceil(
          ((interval.startMs +
            (transformation
              ? transformation.durationMs / 2
              : reading
                ? reading.startMs +
                  Math.min(1000, (reading.endMs - reading.startMs) / 2)
                : (interval.endMs - interval.startMs) / 2)) *
            manifest.fps) /
            1000,
        ) - manifest.range.fromFrame;
      if (
        frame > 0 &&
        frame + 1 < composition.durationInFrames &&
        !selected.has(kind)
      )
        selected.set(kind, frame);
      if (
        picture.kind === "werewolf" &&
        picture.scene &&
        cue.speech &&
        index > 0
      ) {
        const prior = manifest.cues[index - 1]!;
        if (
          prior.picture.kind === "werewolf" &&
          prior.picture.scene?.id === picture.scene.id &&
          prior.speech?.speakerId !== cue.speech.speakerId &&
          cameraFrame >= 0 && cameraFrame < composition.durationInFrames &&
          !selected.has("camera-pan")
        )
          selected.set(
            "camera-pan",
            cameraFrame,
          );
      }
    }
    const samples = [...selected].slice(0, 14).concat([...thinkingFrames]),
      hashes = new Map<number, string>();
    const browser = await openBrowser("chrome");
    try {
      for (const [kind, frame] of samples) {
        const path = join(output, `${kind}-${frame}.png`);
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          frame,
          output: path,
          imageFormat: "png",
          puppeteerInstance: browser,
        });
        hashes.set(frame, sha256(await readFile(path)));
        console.log(`Sampled ${kind} at ${frame}`);
      }
      for (const [, frame] of samples.toReversed()) {
        const path = join(output, "reverse.png");
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          frame,
          output: path,
          imageFormat: "png",
          puppeteerInstance: browser,
        });
        if (sha256(await readFile(path)) !== hashes.get(frame))
          throw new Error(`Reverse frame mismatch at ${frame}`);
      }
      for (const [kind, frame] of samples.slice(0, 3)) {
        const directory = join(output, `sequential-${kind}`);
        await renderFrames({
          composition,
          serveUrl,
          inputProps,
          frameRange: [frame - 1, frame + 1],
          outputDir: directory,
          imageFormat: "png",
          concurrency: 1,
          puppeteerInstance: browser,
          onStart: () => undefined,
          onFrameUpdate: () => undefined,
        });
        const files = (await readdir(directory))
          .filter((file) => file.endsWith(".png"))
          .sort();
        if (
          files.length !== 3 ||
          sha256(await readFile(join(directory, files[1]!))) !==
            hashes.get(frame)
        )
          throw new Error(`Sequential frame mismatch at ${frame}`);
      }
    } finally {
      await browser.close({ silent: true });
    }
    const frame = samples[0]![1],
      path = join(output, "independent.png");
    await renderStill({
      composition,
      serveUrl,
      inputProps,
      frame,
      output: path,
      imageFormat: "png",
    });
    if (sha256(await readFile(path)) !== hashes.get(frame))
      throw new Error(`Independent frame mismatch at ${frame}`);
    await writeFile(
      join(output, "proof.json"),
      JSON.stringify(
        {
          game: manifest.game,
          samples,
          reverse: true,
          sequential: samples.slice(0, 3),
          independent: true,
        },
        null,
        2,
      ),
    );
    console.log(
      `Verified ${samples.length} frame samples, reverse order, three contiguous ranges and a fresh browser.`,
    );
  },
);
