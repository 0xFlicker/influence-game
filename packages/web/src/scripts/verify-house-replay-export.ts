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
import { bundlePath, sha256,probe,runProcess } from "../lib/replay-export/assets";
import {placeAudioClip} from "../lib/replay-export/audio";
import {compareRecordingPcm} from "./recording-alignment";

const bundleDir = resolve(process.argv[2] ?? ""),
  output = resolve(process.argv[3] ?? ".renders/replay-frame-proof");
const encoded = process.argv[4] ? resolve(process.argv[4]) : null;
if (!process.argv[2])
  throw new Error(
    "Usage: bun run src/scripts/verify-house-replay-export.ts BUNDLE OUTPUT [ENCODED.mp4]",
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
          : picture.kind === "werewolf-opening" || picture.kind === "influence-opening" ? `opening-${picture.cue.opening.shot}` : picture.kind === "thinking" ? "thinking" : (picture.beat?.kind ?? picture.cue.kind);
      const interval = manifest.timeline[index]!;
      if (interval.thought) {
        const thought = interval.thought;
        const treatment = (picture.kind === "werewolf" || picture.kind === "thinking") && picture.scene
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
      const random = [...samples].sort((a,b) => sha256(String(a[1])).localeCompare(sha256(String(b[1]))));
      for (const [,frame] of random) {
        const path = join(output,"random.png");
        await renderStill({composition,serveUrl,inputProps,frame,output:path,imageFormat:"png",puppeteerInstance:browser});
        if (sha256(await readFile(path)) !== hashes.get(frame)) throw new Error(`Random frame mismatch at ${frame}`);
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
    for (const [,frame] of samples) {
      const path = join(output,"independent.png");
      await renderStill({composition,serveUrl,inputProps,frame,output:path,imageFormat:"png"});
      if (sha256(await readFile(path)) !== hashes.get(frame)) throw new Error(`Independent frame mismatch at ${frame}`);
    }
    let encodedEvidence:unknown = null;
    if (encoded) {
      const metadata = await probe(encoded);
      const duration = (manifest.range.untilFrame-manifest.range.fromFrame)/manifest.fps;
      const video = metadata.streams.find(stream => stream.codec_type === "video");
      if (!video || !Number.isFinite(Number(video.duration)) || Math.abs(Number(video.duration)-duration) > 1/manifest.fps+0.01
        || video.nb_frames !== undefined && Number(video.nb_frames) !== manifest.range.untilFrame-manifest.range.fromFrame)
        throw new Error("Encoded video duration/frame count disagrees with compiled selection");
      const expectedAudio = manifest.audio.clips.some(clip => clip.endMs > manifest.range.fromFrame*1000/manifest.fps && clip.startMs < manifest.range.untilFrame*1000/manifest.fps);
      const hasAudio = metadata.streams.some(stream => stream.codec_type === "audio");
      if (expectedAudio && !hasAudio) throw new Error("Encoded movie lost its scheduled audio");
      const differences = [];
      for (const [kind,frame] of samples) {
        const path = join(output,`encoded-${frame}.png`);
        await runProcess("ffmpeg",["-y","-v","error","-i",encoded,"-vf",`select=eq(n\\,${frame})`,"-frames:v","1",path]);
        const expectedPath = join(output,"expected.rgb"),actualPath = join(output,"actual.rgb");
        await runProcess("ffmpeg",["-y","-v","error","-i",join(output,`${kind}-${frame}.png`),"-pix_fmt","rgb24","-f","rawvideo",expectedPath]);
        await runProcess("ffmpeg",["-y","-v","error","-i",path,"-pix_fmt","rgb24","-f","rawvideo",actualPath]);
        const expected = await readFile(expectedPath),actual = await readFile(actualPath);
        if (expected.length !== actual.length) throw new Error("Encoded geometry disagrees with sampled frame");
        const meanDifference = expected.reduce((sum,value,index) => sum+Math.abs(value-actual[index]!),0)/expected.length;
        if (meanDifference > 12) throw new Error(`Encoded frame disagrees at ${frame}: mean pixel difference ${meanDifference}`);
        differences.push({frame,meanDifference});
      }
      let audioPeak:number|null = null;
      if (hasAudio) {
        const levels = await runProcess("ffmpeg",["-v","error","-i",encoded,"-map","0:a:0","-af","astats=metadata=1:reset=0,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-","-f","null","/dev/null"]);
        const peaks = [...levels.matchAll(/lavfi\.astats\.Overall\.Peak_level=(-?[\d.]+)/g)].map(match => Number(match[1])).filter(Number.isFinite);
        audioPeak = peaks.length ? Math.max(...peaks) : null;
        if (expectedAudio && (audioPeak === null || audioPeak < -90)) throw new Error("Encoded scheduled audio is silent");
      }
      let recordingAlignment:unknown = {verified:false,reason:"Requires a recording-only schedule without overlapping clips"};
      const speech = manifest.audio.clips.filter(clip => clip.purpose === "speech");
      if (hasAudio && speech.length && manifest.audio.clips.every(clip => clip.purpose === "speech")
        && speech.every((clip,index) => speech.every((other,otherIndex) => index === otherIndex || clip.endMs <= other.startMs || clip.startMs >= other.endMs))) {
        const rate = 16000,actualPath = join(output,"encoded-audio.f32");
        await runProcess("ffmpeg",["-y","-v","error","-i",encoded,"-map","0:a:0","-ac","1","-ar",String(rate),"-f","f32le",actualPath]);
        const decode = (bytes:Buffer) => Array.from({length:Math.floor(bytes.length/4)},(_,index) => bytes.readFloatLE(index*4));
        const actual = decode(await readFile(actualPath)),expected = new Float32Array(Math.ceil(duration*rate));
        for (const [index,clip] of speech.entries()) {
          const placement = placeAudioClip(clip,manifest.range,manifest.fps);if (!placement) continue;
          const sourcePath = join(output,`recording-${index}.f32`);
          await runProcess("ffmpeg",["-y","-v","error","-i",bundlePath(bundleDir,manifest.assets[clip.asset]!.path),"-ac","1","-ar",String(rate),"-f","f32le",sourcePath]);
          const source = decode(await readFile(sourcePath)),offset = Math.round(placement.sourceOffsetFrames/manifest.fps*rate);
          const start = Math.round(placement.fromFrame/manifest.fps*rate),length = Math.min(source.length-offset,Math.round(placement.durationInFrames/manifest.fps*rate));
          for (let sample = 0;sample < length && start+sample < expected.length;sample++) expected[start+sample] = source[offset+sample]! * clip.gain;
        }
        const stream = metadata.streams.find(stream => stream.codec_type === "audio")!;
        const codecSampleRate = Number(stream.sample_rate);
        if (!Number.isFinite(codecSampleRate) || codecSampleRate <= 0) throw new Error("Encoded recording needs a finite audio sample rate");
        // The installed AAC path uses raw ADTS before MP4 muxing, without a priming edit.
        // Bound the measurement to one output frame plus two 1024-sample AAC frames.
        const codecBudgetMs = stream.codec_name === "aac" ? 2048 * 1000 / codecSampleRate : 0;
        const alignment = compareRecordingPcm(expected,actual,rate,1000 / manifest.fps + codecBudgetMs);
        if (!Number.isFinite(alignment.correlation) || alignment.correlation < .95 || alignment.relativeError > .2)
          throw new Error(`Encoded recording alignment differs: ${JSON.stringify(alignment)}`);
        recordingAlignment = {verified:true,...alignment,codec:stream.codec_name,codecSampleRate,codecBudgetMs,clips:speech.length};
      }
      encodedEvidence = {duration,expectedAudio,hasAudio,audioPeak,recordingAlignment,frames:differences,schedule:manifest.audio.clips};
    }
    await writeFile(
      join(output, "proof.json"),
      JSON.stringify(
        {
          game: manifest.game,
          samples,
          reverse: true,
          random:true,
          sequential: samples.slice(0, 3),
          independent: true,
          encoded:encodedEvidence,
        },
        null,
        2,
      ),
    );
    console.log(
      `Verified ${samples.length} frame samples in reverse/random order, three contiguous ranges and fresh browsers${encoded ? ", plus encoded frame/audio presence" : ""}.`,
    );
  },
);
