"use client";

import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {ThoughtBubble, useSceneThinking} from "@/components/watch/watch-thinking";
import {layoutThought} from "@/components/watch/thought-layout";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { selectVisualShot, type AcceptedVisualScene } from "@influence/engine/visual-mode";
import { frameVisualScene, placeSceneBubble, sceneCameraProgress, type PanelTreatment } from "./visual-scene-layout";
import { TimedSpeech } from "./timed-speech";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { soloPresentationMotion } from "./solo-presentation-timing";
import { StageBackdrop, sceneBackdropSources } from "./stage-backdrop";
import { SceneImage, panelTransition, sceneImageLayers, type SceneCameraView } from "./scene-image";

export interface VisualSpeech { id: string; playerId: string | null; speaker: string; text: string; portrait?: { avatarUrl?: string | null; persona: string; personaKey?: string | null } }

/** Camera, bubble pages and speech share the director's presentation time. */
export function VisualSceneView({ scene: roomScene, speech, elapsedMs, readingElapsedMs = elapsedMs, reducedMotion = false, navigationRevision = 0, controlsInset = 0, speechPresentation = "scene", panelTreatment = "focal", onReadyChange, focusPlayerId }: {
  scene: AcceptedVisualScene; speech: VisualSpeech | null; elapsedMs: number;
  /** Frame a silent performance or elimination without inventing speech. */
  focusPlayerId?: string;
  onReadyChange?: (ready: boolean) => void;
  controlsInset?: number; reducedMotion?: boolean; navigationRevision?: number;
  speechPresentation?: "solo" | "scene";
  readingElapsedMs?: number;
  panelTreatment?: PanelTreatment;
}) {
  const openingKey = `${roomScene.id}:${roomScene.version}:${navigationRevision}`;
  const focusedPlayerId = speech?.playerId ?? focusPlayerId;
  const speechKey = speech?.id ?? `silent:${focusedPlayerId ?? "room"}`;
  const [opening, setOpening] = useState({ key: openingKey, beat: speechKey });
  if (opening.key !== openingKey) setOpening({ key: openingKey, beat: speechKey });
  const openingBeat = opening.key === openingKey ? opening.beat : speechKey;
  const shot = roomScene.shots ? (roomScene.shots.mode === "establishing" && openingBeat === speechKey && elapsedMs < 650 ? roomScene.shots.overview : selectVisualShot(roomScene.shots, focusedPlayerId)) : null;
  const scene = shot ? { ...roomScene, imageUrl: shot.imageUrl, anchors: shot.anchors } : roomScene;
  const treatment = roomScene.shots && roomScene.shots.groups.length > 1 && roomScene.shots.groups.some(group => group.imageUrl === scene.imageUrl) ? panelTreatment : "separate";
  const pointer = shot?.pointers.find(p => p.playerId === focusedPlayerId);
  // Late viewer publications keep the accepted cue's original staging budget.
  const solo = speech && speechPresentation === "solo" ? soloPresentationMotion(speech.text, elapsedMs, false, reducedMotion) : null;
  const opacity = solo?.speechOpacity ?? (speech ? sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion) : 0);
  const anchor = focusedPlayerId ? scene.anchors.find((item) => item.playerId === focusedPlayerId && item.confidence === "clear") : undefined;
  const frameRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState({ url: "", width: 0, height: 0 });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setSize((old) => old.width === frame.clientWidth && old.height === frame.clientHeight ? old : { width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const imageFailed = failedUrl === scene.imageUrl;
  const imageKnown = loaded.url === scene.imageUrl || imageFailed;
  useEffect(() => { onReadyChange?.(imageKnown); }, [imageKnown, onReadyChange]);
  let head = imageFailed ? undefined : pointer ? { x: pointer.x, y: pointer.y, width: 0, height: 0 } : anchor?.head;
  let target = frameVisualScene(size.width, size.height, imageKnown ? loaded.width : 0, imageKnown ? loaded.height : 0, pointer && treatment !== "focal" ? undefined : head, treatment);
  // If an extreme close-up leaves no readable bubble space, show the full image
  // with a named panel instead of covering the face or silently clipping speech.
  if (head && placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), target, head).height < 110) {
    target = frameVisualScene(size.width, size.height, loaded.width, loaded.height);
    head = undefined;
  }
  const viewKey = `${scene.id}:${scene.version}:${scene.imageUrl}:${speechKey}:${imageKnown}:${loaded.width}:${loaded.height}:${target.left}:${target.top}:${target.width}:${target.height}:${head?.x}:${head?.width}:${treatment}:${navigationRevision}:${reducedMotion}`;
  const nextView: SceneCameraView = { url: imageKnown ? scene.imageUrl : "", frame: target, focusX: head ? head.x + head.width / 2 : .5, panelTreatment: treatment, shots: roomScene.shots };
  const [camera, setCamera] = useState({ key: viewKey, speechKey, from: nextView, target: nextView, startedAt: elapsedMs, direction: 0, navigationRevision, size });
  if (imageKnown && camera.key !== viewKey) {
    const previous = camera.speechKey === speechKey
      ? sceneImageLayers(camera.from, camera.target, elapsedMs - camera.startedAt, camera.direction).at(-1)!
      : camera.target;
    const snap = reducedMotion || navigationRevision !== camera.navigationRevision || !previous.url
      || size.width !== camera.size.width || size.height !== camera.size.height;
    const from = snap ? nextView : previous;
    setCamera({ key: viewKey, speechKey, from, target: nextView, startedAt: elapsedMs,
      direction: snap ? 0 : panelTransition(from.url, nextView.url, roomScene.shots), navigationRevision, size });
  }
  const cameraElapsedMs = reducedMotion || !imageKnown && camera.speechKey !== speechKey ? 450 : elapsedMs - camera.startedAt;
  const layers = sceneImageLayers(camera.from, camera.target, cameraElapsedMs, camera.direction);
  const currentLayer = layers[layers.length - 1]!;
  const framing = currentLayer.frame;
  const transitioning = imageKnown && camera.from.url !== camera.target.url && sceneCameraProgress(cameraElapsedMs) < 1;
  const rawBubble = placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), framing, head, 220);
  const thought = useSceneThinking();
  const thoughtLayout = thought ? layoutThought(size.width, Math.max(0, size.height - controlsInset), rawBubble,
    {x: head ? framing.left + framing.width * (head.x + head.width / 2) : size.width / 2,
     y: head ? framing.top + framing.height * (head.y + head.height / 2) : size.height * .4}) : null;
  const compact = size.height - controlsInset < 300;
  const speechBox = {...rawBubble, ...thoughtLayout?.speech};
  const thoughtBox = thoughtLayout?.thought ?? {...speechBox,height:0};
  const speechFit = useBubbleTypography(frameRef, speech?.text ?? "", speechBox, "speech", compact);
  const thoughtFit = useBubbleTypography(frameRef, thought?.text ?? "", thoughtBox, "thought", compact);
  const fittedThought = {...thoughtBox,width:thoughtFit.typography?.width ?? thoughtBox.width,height:thoughtFit.typography?.height ?? thoughtBox.height};
  const bubble = {...speechBox,width:speechFit.typography?.width ?? speechBox.width,height:speechFit.typography?.height ?? speechBox.height};
  return <section ref={frameRef} aria-label="Current room" data-panel-treatment={treatment} data-scene-loading={!imageKnown || undefined} data-panel-transition={transitioning || undefined} className="relative min-h-0 w-full flex-1 overflow-hidden">
    {layers.filter(layer => layer.url).map(layer => <div key={layer.url} data-backdrop-layer className="pointer-events-none absolute inset-0" style={{ opacity: layer.opacity }}>
      <StageBackdrop source={layer.url} frame={layer.frame} panelTreatment={layer.panelTreatment} {...sceneBackdropSources(layer.url, layer.shots)} />
    </div>)}
    {/* eslint-disable-next-line @next/next/no-img-element -- preload the next panel before removing any visible pixels */}
    {!imageKnown && <img data-scene-preload key={scene.imageUrl} src={scene.imageUrl} alt="" aria-hidden="true" className="hidden" onError={() => { setFailedUrl(scene.imageUrl); }} onLoad={(event) => {
      setLoaded({ url: scene.imageUrl, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
    }} />}
    <SceneImage layers={layers} failedUrl={failedUrl} />
    {speech && imageKnown && !transitioning && opacity > 0 && <div data-speech-bubble className="absolute z-10 flex flex-col rounded-2xl border border-white/20 bg-black/90 px-4 py-3 text-white shadow-xl"
      style={{ opacity, width: bubble.width, height: bubble.height, left: bubble.left, top: bubble.top, padding:speechFit.padding }}>
      <div className={`mb-2 flex h-5 shrink-0 items-center gap-3 ${speechFit.typography && speechFit.typography.pages.length > 1 && !speechFit.typography.footerHeight ? "pr-12" : ""}`}>
        {(imageFailed || !anchor && !pointer) && speech.playerId && <div data-headshot-fallback><AgentAvatar {...speech.portrait} persona={speech.portrait?.persona ?? ""} name={speech.speaker} size="12" /></div>}
        <p className="truncate text-xs font-semibold text-white/65">{speech.playerId === null ? "Anonymous" : speech.speaker}</p>
      </div>
      <TimedSpeech typography={speechFit.typography} text={speech.text} elapsedMs={speechPresentation === "solo" ? soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs : readingElapsedMs - SCENE_SPEECH_START_MS} className={thoughtLayout && size.height - controlsInset < 300 ? "text-xs leading-4" : "text-sm leading-relaxed"} />
      {head && <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/20 bg-black/90 ${bubble.below ? "border-t border-l" : "border-b border-r"}`} style={{ left: bubble.arrowLeft, top: bubble.below ? -8 : undefined, bottom: bubble.below ? undefined : -8 }} />}
    </div>}
    {imageKnown && thoughtLayout && <ThoughtBubble box={fittedThought} head={thoughtLayout.head} typography={thoughtFit.typography} padding={thoughtFit.padding} />}
  </section>;
}
