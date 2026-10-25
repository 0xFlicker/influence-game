import {HouseNarration, narrationWindow} from "../../components/watch/house-narration";
import {WerewolfOpeningFrame} from "../../components/games/werewolf/werewolf-opening-frame";
import {InfluenceOpeningFrame} from "../../app/games/[slug]/components/influence-opening-frame";
import type {OpeningVideoProps} from "../../components/watch/opening-browser-video";
import { useLayoutEffect, useState, useMemo, useRef, type RefObject } from "react";
import {
  AbsoluteFill,
  Freeze, OffthreadVideo, useVideoConfig,
  Audio,
  Sequence,
  Artifact,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useBufferState,
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
import { VisualSceneView } from "../../app/games/[slug]/components/visual-scene-view";
import { SoloPresentation } from "../../app/games/[slug]/components/solo-presentation";
import { PortraitRoom } from "../../app/games/[slug]/components/portrait-room";

function sceneFor(cue?: ExportCue) {
  if (!cue) return null;
  const picture = cue.picture;
  if (picture.kind === "thinking") return picture.scene;
  if (picture.kind === "werewolf") return picture.scene;
  const beat = picture.kind === "influence" ? picture.beat : null;
  return beat?.kind === "scene"
    ? ((picture.kind === "influence" ? picture.rooms : []).find((room) => room.id === beat.sceneId) ?? null)
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
  preview = false,
}: {
  manifest: ReplayManifest;
  prepare?: boolean;
  preview?: boolean;
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
  const nextPicture = data.cues[index + 1]?.picture;
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
  const recording = data.timeline[index]!.recording;
  const houseAudio = cue.speech?.speakerId === null && recording;
  const houseWindow = houseAudio ? narrationWindow(timeMs - recording.startMs, recording.durationMs) : null;
  const stage = useRef<HTMLDivElement>(null);
  const thinkingActor = picture.kind === "werewolf" ? picture.cue.moment.snapshot.players.find(player => player.id === cue.speech?.speakerId) : null;
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
        thought={
          sample.thought
            ? { ...sample.thought, speaker: picture.kind === "thinking" ? picture.actor.name : thinkingActor?.name ?? cue.speech?.speaker ?? "",
                roleLabel: picture.kind === "thinking" ? picture.roleLabel : picture.kind === "werewolf" && picture.cue.moment.snapshot.audience === "omniscient" ? thinkingActor?.role ?? undefined : undefined }
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-black" data-composition-frame={preview ? frame : undefined} data-composition-moment={preview ? cue.momentId : undefined}>
            {picture.kind !== "werewolf-opening" && picture.kind !== "influence-opening" && <div className="z-20 shrink-0 truncate border-b border-white/10 bg-black/80 px-4 py-2 text-xs text-white/60">
              {cue.label}
            </div>}
            <div
              ref={stage}
              className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {picture.kind === "influence-opening" ? <InfluenceOpeningFrame {...picture} elapsedMs={sample.elapsedMs} reduced={data.reducedMotion} video={renderOpeningVideo} /> : picture.kind === "thinking" ? <ThinkingFrame picture={picture} elapsedMs={sample.elapsedMs} reduced={data.reducedMotion} /> : picture.kind === "werewolf-opening" ? <WerewolfOpeningFrame cue={picture.cue} elapsedMs={sample.elapsedMs} reduced={data.reducedMotion} video={renderOpeningVideo} /> : picture.kind === "werewolf" ? (
                <WerewolfContentFrame
                  hideHouseCaption={Boolean(houseAudio)}
                  cue={picture.cue}
                  previousCue={previous?.picture.kind === "werewolf" && !previous.picture.scene ? previous.picture.cue : undefined}
                  nextCue={nextPicture?.kind === "werewolf" && !nextPicture.scene ? nextPicture.cue : undefined}
                  scene={picture.scene}
                  elapsed={sample.elapsedMs}
                  reduced={data.reducedMotion}
                />
              ) : picture.beat ? (
                <VisualPresentationFrame
                  hideHouseNarration={Boolean(houseAudio)}
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
              <HouseNarration text={cue.speech?.text ?? ""} window={houseWindow} logoUrl={staticFile("logo.png")} />
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
      {preview && <PreviewFrameReady frame={frame} stage={stage} content={data} />}
      {!preview && <PreparedFrame
        frame={frame}
        capture={prepare ? capture.values : undefined}
      />}
    </AbsoluteFill>
  );
}

/** Actor and scene context contain no omitted response payload. */
function ThinkingFrame({picture, elapsedMs, reduced}: {
  picture: Extract<ExportCue["picture"], {kind: "thinking"}>;
  elapsedMs: number;
  reduced: boolean;
}) {
  const actor = picture.actor;
  if (picture.room) return <PortraitRoom beat={{kind:"portrait-room",roomNumber:picture.room.number,roomLabel:picture.room.label,
    participants:picture.room.players,speech:{id:actor.id,playerId:actor.id,speaker:actor.name,text:""}}}
    hideSpeech elapsedMs={elapsedMs} readingElapsedMs={elapsedMs} reducedMotion={reduced} controlsInset={0} />;
  if (picture.scene) return <VisualSceneView scene={picture.scene} speech={null}
    focusPlayerId={actor.id} focusActor={actor} elapsedMs={elapsedMs} reducedMotion={reduced} controlsInset={0} />;
  return <SoloPresentation beat={{kind:"portrait", purpose:"Conversation", player:actor,
    roleLabel:picture.roleLabel, speech:{id:actor.id, playerId:actor.id, speaker:actor.name, text:""}}}
    hideSpeech elapsedMs={elapsedMs} imageOpacity={1} reducedMotion={reduced} controlsInset={0} />;
}

/** Player buffers at the requested frame. Stale media completion cannot resume a newer seek. */
function PreviewFrameReady({frame, stage, content}: {frame: number; stage: RefObject<HTMLDivElement | null>; content: ReplayManifest}) {
  const {delayPlayback} = useBufferState();
  const [failure, setFailure] = useState<{frame: number; content: ReplayManifest; error: Error} | null>(null);
  useLayoutEffect(() => {
    const currentPictures = Array.from(stage.current?.querySelectorAll("img") ?? []);
    // Ready frames are sampled immediately. A readiness wait must not throttle normal playback.
    if (document.fonts.status === "loaded" && currentPictures.every(image => image.complete && image.naturalWidth > 0)) return;
    const waiting = delayPlayback();
    let active = true;
    void (async () => {
      await document.fonts.ready;
      // Pagination/portrait layout can settle after the first image decode.
      for (let pass = 0; pass < 2; pass++) {
        const pictures = Array.from(stage.current?.querySelectorAll("img") ?? []);
        await Promise.all(pictures.map(async image => {
          try {await image.decode();}
          catch (cause) {throw new Error(`Preview image could not load: ${image.currentSrc || image.src}`, {cause});}
        }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (!active) return;
      }
      if (active) waiting.unblock();
    })().catch(cause => {
      if (!active) return;
      setFailure({frame, content, error: cause instanceof Error ? cause : new Error(String(cause))});
      waiting.unblock();
    });
    return () => {active = false; waiting.unblock();};
  }, [frame, stage, content, delayPlayback]);
  if (failure?.frame === frame && failure.content === content) throw failure.error;
  return null;
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

function renderOpeningVideo(props: OpeningVideoProps) {return <OpeningExportVideo {...props} />;}
function OpeningExportVideo({src,timeMs}: OpeningVideoProps) {
  const {fps} = useVideoConfig();
  return <Freeze frame={Math.floor(timeMs * fps / 1000)}><OffthreadVideo src={src} muted style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}} /></Freeze>;
}
