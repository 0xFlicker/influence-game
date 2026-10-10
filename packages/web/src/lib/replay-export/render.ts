import { rmSync } from "node:fs";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "../../../tailwind.config";
import { resolve, dirname, join } from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  mkdtemp,
  rm,
  link,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderFrames,
  selectComposition,
  makeCancelSignal,
} from "@remotion/renderer";
import { probe, runProcess, sha256 } from "./assets";
import type { ReplayManifest } from "./manifest";
const webRoot = resolve(import.meta.dir, "../../.."),
  repoRoot = resolve(webRoot, "../..");

/** Own the temporary browser bundle and layout prepass for encoding or frame verification. */
export async function withPreparedReplay<T>(
  manifest: ReplayManifest,
  bundleDir: string,
  signal: AbortSignal,
  run: (
    serveUrl: string,
    manifest: ReplayManifest,
    cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"],
  ) => Promise<T>,
): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), "house-replay-"));
  // Remotion's Chromium runner exits synchronously on SIGINT. Own files still need cleanup.
  const cleanupOnExit = () => rmSync(scratch, { recursive: true, force: true });
  process.once("exit", cleanupOnExit);
  const { cancel, cancelSignal } = makeCancelSignal();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    console.log("Bundling shared replay stages…");
    const publicDir = join(scratch, "public");
    await cp(join(bundleDir, "static"), publicDir, { recursive: true });
    await mkdir(join(bundleDir, "assets"), { recursive: true });
    await cp(join(bundleDir, "assets"), join(publicDir, "assets"), {
      recursive: true,
    });
    const css = await postcss([
      tailwind({
        ...tailwindConfig,
        content: [join(webRoot, "src/**/*.{ts,tsx}")],
      }),
      autoprefixer,
    ]).process(await readFile(join(webRoot, "src/app/globals.css"), "utf8"), {
      from: join(webRoot, "src/app/globals.css"),
    });
    await writeFile(join(scratch, "replay.css"), css.css);
    const entry = join(scratch, "entry.tsx");
    await writeFile(
      entry,
      `import "./replay.css";\nimport ${JSON.stringify(join(webRoot, "src/remotion/house-replay/index.tsx"))};\n`,
    );
    const serveUrl = await bundle({
      entryPoint: entry,
      ignoreRegisterRootWarning: true,
      rootDir: webRoot,
      publicDir,
      outDir: join(scratch, "bundle"),
      webpackOverride: (config) => {
        for (const rule of config.module?.rules ?? [])
          if (rule && typeof rule === "object" && Array.isArray(rule.use))
            for (const loader of rule.use)
              if (
                loader &&
                typeof loader === "object" &&
                loader.loader?.includes("css-loader")
              )
                loader.options = {
                  ...(typeof loader.options === "object" ? loader.options : {}),
                  url: false,
                };
        return {
          ...config,
          resolve: {
            ...config.resolve,
            alias: { ...config.resolve?.alias, "@": join(webRoot, "src") },
          },
        };
      },
    });
    await cp(publicDir, serveUrl, { recursive: true });
    signal.throwIfAborted();
    if (!manifest.layouts || !manifest.pages) {
      console.log("Measuring and freezing speech/thinking layout…");
      const layouts = { ...manifest.layouts },
        pages = { ...manifest.pages };
      const preparation = { manifest, prepare: true };
      const measured = await selectComposition({
        serveUrl,
        id: "HouseReplay",
        inputProps: preparation,
        timeoutInMilliseconds: 60000,
      });
      await renderFrames({
        composition: measured,
        serveUrl,
        inputProps: preparation,
        outputDir: join(scratch, "layout"),
        onStart: () => console.log("Layout prepass started"),
        onFrameUpdate: () => undefined,
        imageFormat: "png",
        concurrency: 1,
        cancelSignal,
        timeoutInMilliseconds: 60000,
        onArtifact: (artifact) => {
          const measured = JSON.parse(
            typeof artifact.content === "string"
              ? artifact.content
              : new TextDecoder().decode(artifact.content),
          );
          Object.assign(layouts, measured.layouts);
          Object.assign(pages, measured.pages);
        },
      });
      manifest = { ...manifest, layouts, pages };
      await writeFile(
        join(bundleDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );
    }
    signal.throwIfAborted();
    return await run(serveUrl, manifest, cancelSignal);
  } finally {
    signal.removeEventListener("abort", cancel);
    await rm(scratch, { recursive: true, force: true });
    process.removeListener("exit", cleanupOnExit);
  }
}

export async function renderReplay(
  manifest: ReplayManifest,
  bundleDir: string,
  output: string,
  overwrite: boolean,
  signal: AbortSignal,
) {
  await mkdir(dirname(output), { recursive: true });
  const partial = join(dirname(output), `.${crypto.randomUUID()}.mp4`);
  const cleanupOnExit = () => rmSync(partial, { force: true });
  process.once("exit", cleanupOnExit);
  const started = Date.now();
  try {
    await withPreparedReplay(
      manifest,
      bundleDir,
      signal,
      async (serveUrl, manifest, cancelSignal) => {
        const inputProps = { manifest };
        const composition = await selectComposition({
          serveUrl,
          id: "HouseReplay",
          inputProps,
          timeoutInMilliseconds: 60000,
        });
        let percent = -1;
        await renderMedia({
          composition,
          serveUrl,
          inputProps,
          codec: "h264",
          audioCodec: "aac",
          outputLocation: partial,
          concurrency: 1,
          cancelSignal,
          timeoutInMilliseconds: 60000,
          onProgress: (progress) => {
            const next = Math.floor(progress.progress * 100);
            if (next !== percent) {
              percent = next;
              console.log(`Rendering ${next}%`);
            }
          },
        });
        const metadata = await probe(partial, signal),
          video = metadata.streams.find(
            (stream) => stream.codec_type === "video",
          );
        const expected =
          (manifest.range.untilFrame - manifest.range.fromFrame) / manifest.fps;
        if (
          video?.codec_name !== "h264" ||
          video.width !== manifest.width ||
          video.height !== manifest.height ||
          Math.abs(Number(metadata.format.duration) - expected) >
            Math.max(0.1, 2 / manifest.fps)
        )
          throw new Error("Encoded video failed output validation");
        if (
          manifest.audio.clips.some(
            (clip) =>
              clip.endMs > (manifest.range.fromFrame * 1000) / manifest.fps &&
              clip.startMs < (manifest.range.untilFrame * 1000) / manifest.fps,
          ) &&
          !metadata.streams.some(
            (stream) =>
              stream.codec_type === "audio" && stream.codec_name === "aac",
          )
        )
          throw new Error("Encoded replay is missing audio");
        const bytes = await readFile(partial),
          receipt = {
            schema: "house.replay-export-receipt",
            manifestHash: sha256(JSON.stringify(manifest)),
            preparedRevision: manifest.revision,
            preparedDirty: manifest.dirty,
            revision: (
              await runProcess("git", ["-C", repoRoot, "rev-parse", "HEAD"])
            ).trim(),
            dirty: Boolean(
              (
                await runProcess("git", [
                  "-C",
                  repoRoot,
                  "status",
                  "--porcelain",
                ])
              ).trim(),
            ),
            range: manifest.range,
            outputHash: sha256(bytes),
            bytes: bytes.length,
            durationSeconds: expected,
            width: manifest.width,
            height: manifest.height,
            fps: manifest.fps,
            elapsedSeconds: (Date.now() - started) / 1000,
            bun: Bun.version,
            ffmpeg: (await runProcess("ffmpeg", ["-version"], signal)).split(
              "\n",
            )[0],
          };
        if (overwrite) await rename(partial, output);
        else {
          await link(partial, output);
          await rm(partial);
        }
        await writeFile(
          `${output}.receipt.json`,
          JSON.stringify(receipt, null, 2),
        );
        console.log(
          `Saved ${output} (${receipt.elapsedSeconds.toFixed(1)}s rendering, ${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`,
        );
      },
    );
  } finally {
    await rm(partial, { force: true });
    process.removeListener("exit", cleanupOnExit);
  }
}
