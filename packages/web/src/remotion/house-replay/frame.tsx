import { useLayoutEffect, useState, useMemo, useRef } from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  Artifact,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { WerewolfContentFrame } from "../../components/games/werewolf/werewolf-watch-stage";
import { VisualPresentationFrame } from "../../app/games/[slug]/components/visual-presentation";
import { FormatPresentation } from "../../app/games/[slug]/components/format-presentation";
import { FitPresentation } from "../../app/games/[slug]/components/fit-presentation";
import { SceneThinkingProvider } from "../../components/watch/watch-thinking";
import { SampledStageProvider } from "../../components/watch/sampled-stage";
import { sampleTiming } from "../../lib/replay-export/timing";
import {
  cueIndexAt,
  type ReplayManifest,
} from "../../lib/replay-export/manifest";
import { audioGain, placeAudioClip } from "../../lib/replay-export/audio";
import { samplePresentationEntrances } from "../../app/games/[slug]/components/presentation-entrances";
import type { ExportCue } from "../../lib/replay-export/cues";

function sceneFor(cue?: ExportCue) {
  if (!cue) return null;
  const picture = cue.picture;
  if (picture.kind === "werewolf") return picture.scene;
  const beat = picture.beat;
  return beat?.kind === "scene"
    ? (picture.rooms.find((room) => room.id === beat.sceneId) ?? null)
    : null;
}
/** All URL-bearing data is local to the verified bundle before Chromium starts. */
function localize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, item: unknown) =>
    typeof item === "string" && item.startsWith("assets/")
      ? staticFile(item)
      : item,
  ) as T;
}
export function ReplayFrame({
  manifest,
  prepare = false,
}: {
  manifest: ReplayManifest;
  prepare?: boolean;
}) {
  const frame = useCurrentFrame();
  const data = useMemo(() => localize(manifest), [manifest]);
  const measurementCue = prepare ? data.timeline[Math.floor(frame / 2)]! : null;
  const measuredSegment =
    measurementCue?.segments.find(
      (segment) => segment.kind === (frame % 2 === 0 ? "reading" : "thinking"),
    ) ?? measurementCue?.segments.find((segment) => segment.kind === "hold");
  const timeMs = measurementCue
    ? measurementCue.startMs +
      (measuredSegment
        ? (measuredSegment.startMs + measuredSegment.endMs) / 2
        : 0)
    : ((frame + data.range.fromFrame) * 1000) / data.fps;
  const capture = useMemo(
    () => ({
      frame,
      values: {
        layouts: {} as NonNullable<ReplayManifest["layouts"]>,
        pages: {} as NonNullable<ReplayManifest["pages"]>,
      },
      add(key: string, value: NonNullable<ReplayManifest["layouts"]>[string]) {
        this.values.layouts[key] = value;
      },
    }),
    [frame],
  );
  const capturePages = useMemo(
    () => (key: string, pages: string[]) => {
      capture.values.pages[key] = pages;
    },
    [capture],
  );
  const captureLayout = useMemo(() => capture.add.bind(capture), [capture]);
  const index = cueIndexAt(data.timeline, timeMs),
    cue = data.cues[index]!;
  const sample = sampleTiming(data.timeline[index]!, timeMs);
  const previous = data.cues[index - 1];
  const scene = sceneFor(cue),
    previousScene = sceneFor(previous);
  const images = useMemo(
    () =>
      Object.fromEntries(
        Object.values(data.assets)
          .filter((asset) => asset.mediaType === "image")
          .map((asset) => [
            asset.path,
            { width: asset.width!, height: asset.height! },
          ]),
      ),
    [data],
  );
  const picture = cue.picture;
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (stage.current && picture.kind === "influence")
      samplePresentationEntrances(
        stage.current,
        picture.cue,
        sample.elapsedMs,
        data.reducedMotion,
      );
  }, [picture, sample.elapsedMs, data.reducedMotion]);
  return (
    <AbsoluteFill style={{ background: "black", color: "white" }}>
      <SceneThinkingProvider
        enabled={data.thinking}
        thought={
          sample.thought
            ? { ...sample.thought, speaker: cue.speech?.speaker ?? "" }
            : null
        }
      >
        <SampledStageProvider
          value={{
            images,
            previousScene,
            pages: data.pages,
            capturePages: prepare ? capturePages : undefined,
            layouts: data.layouts,
            captureLayout: prepare ? captureLayout : undefined,
            ...(cue.alignment && cue.speech
              ? {
                  speech: {
                    text: cue.speech.text,
                    alignment: cue.alignment,
                    elapsedMs:
                      timeMs - (data.timeline[index]!.recording?.startMs ?? 0),
                  },
                }
              : {}),
            previousSpeaker: previous?.speech?.speakerId ?? null,
            firstInScene:
              !scene ||
              scene.id !== previousScene?.id ||
              scene.version !== previousScene.version,
          }}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black">
            <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60">
              {cue.label}
            </div>
            <div
              ref={stage}
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {picture.kind === "werewolf" ? (
                <WerewolfContentFrame
                  cue={picture.cue}
                  scene={picture.scene}
                  elapsed={sample.elapsedMs}
                  reduced={data.reducedMotion}
                />
              ) : picture.beat ? (
                <VisualPresentationFrame
                  beat={picture.beat}
                  rooms={picture.rooms}
                  elapsedMs={sample.elapsedMs}
                  reducedMotion={data.reducedMotion}
                  fullscreen
                  controlsInset={0}
                  voteLedger={picture.ledger}
                  roster={picture.roster}
                  speechPresentation={picture.cue.speechPresentation}
                />
              ) : picture.cue.source === "format" ? (
                <FitPresentation enabled>
                  <FormatPresentation
                    cue={picture.cue}
                    roster={picture.roster}
                    currentStateEntry={false}
                  />
                </FitPresentation>
              ) : null}
            </div>
          </div>
        </SampledStageProvider>
      </SceneThinkingProvider>
      {!prepare &&
        data.audio.clips.map((clip, index) => {
          const placement = placeAudioClip(clip, data.range, data.fps);
          if (!placement) return null;
          return (
            <Sequence
              key={index}
              from={placement.fromFrame}
              durationInFrames={placement.durationInFrames}
              layout="none"
            >
              <Audio
                src={clip.asset}
                startFrom={placement.sourceOffsetFrames}
                volume={
                  clip.purpose === "speech"
                    ? clip.gain
                    : (f) =>
                        audioGain(
                          clip,
                          ((f + placement.globalStartFrame) * 1000) / data.fps,
                          data.audio.clips,
                        )
                }
              />
            </Sequence>
          );
        })}
      <PreparedFrame
        frame={frame}
        capture={prepare ? capture.values : undefined}
      />
    </AbsoluteFill>
  );
}
/** Wait for real layout/fonts/images, never for game loading timers. */
function PreparedFrame({
  frame,
  capture,
}: {
  frame: number;
  capture?: {
    layouts: NonNullable<ReplayManifest["layouts"]>;
    pages: NonNullable<ReplayManifest["pages"]>;
  };
}) {
  const [initial] = useState(() => delayRender("Preparing replay stage"));
  const [ready, setReady] = useState<{
    frame: number;
    handle: number;
    json: string;
  } | null>(null);
  useLayoutEffect(() => {
    const handle = delayRender(`Replay layout ${frame}`);
    let active = true;
    void (async () => {
      await document.fonts.ready;
      for (let pass = 0; pass < 2; pass++) {
        await Promise.all(
          Array.from(document.images).map((image) => image.decode()),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      if (active)
        setReady({ frame, handle, json: JSON.stringify(capture ?? {}) });
    })().catch((error) => {
      if (active) cancelRender(error);
    });
    return () => {
      active = false;
      continueRender(handle);
    };
  }, [frame, capture]);
  useLayoutEffect(() => {
    if (ready?.frame === frame) {
      continueRender(ready.handle);
      continueRender(initial);
    }
  }, [ready, frame, initial]);
  return capture && ready?.frame === frame ? (
    <Artifact filename={`layout-${frame}.json`} content={ready.json} />
  ) : null;
}
