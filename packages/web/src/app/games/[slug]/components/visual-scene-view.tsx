"use client";

import {useSampledStage} from "@/components/watch/sampled-stage";
import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import {thinkingFocus, ThinkingFocusOverlay} from "@/components/watch/thinking-focus";
import {resolveAgentAvatarUrl} from "@/components/agent-avatar";
import { useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import {ItemBadges} from "@/components/watch/item-badges";
import { selectVisualShot, type AcceptedVisualScene } from "@influence/engine/visual-mode";
import { frameVisualScene, placeSceneBubble, sceneCameraProgress, type PanelTreatment, type SceneFrame, type HeadRect } from "./visual-scene-layout";
import { TimedSpeech } from "./timed-speech";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity, sceneSpeechDurationMs } from "./scene-speech-timing";
import { soloPresentationMotion } from "./solo-presentation-timing";
import { StageBackdrop, sceneBackdropSources } from "./stage-backdrop";
import { SceneImage, panelTransition, sceneImageLayers, type SceneCameraView } from "./scene-image";

// Finish the 450ms room-to-speaker move before speech/thinking starts at 650ms.
const OVERVIEW_HOLD_MS = 200;

export interface SceneComposition {
  width:number; height:number; ready:boolean;
  /** Crowded social rooms retain their entire cast through ordinary speech. */
  fitCast?:boolean;
  cast: Array<{id:string;name:string;items?:readonly string[];source:string;frame:SceneFrame;head:HeadRect;labelTop:number}>;
}

export interface VisualSpeech { id: string; playerId: string | null; speaker: string; text: string; portrait?: { avatarUrl?: string | null; persona: string; personaKey?: string | null } }

/** Camera, bubble pages and speech share the director's presentation time. */
export function VisualSceneView({ scene: roomScene, composition, previousFocusPlayerId, speech, elapsedMs, readingElapsedMs = elapsedMs, reducedMotion = false, navigationRevision = 0, paused = false, controlsInset = 0, speechPresentation = "scene", speechDurationMs, panelTreatment = "separate", onReadyChange, focusPlayerId, focusActor }: {
  composition?: SceneComposition;
  previousFocusPlayerId?: string | null;
  scene: AcceptedVisualScene; speech: VisualSpeech | null; elapsedMs: number;
  /** Frame a silent performance or elimination without inventing speech. */
  focusPlayerId?: string;
  focusActor?: {id: string; name: string; avatarUrl?: string | null; persona: string; personaKey?: string | null};
  onReadyChange?: (ready: boolean) => void;
  paused?: boolean;
  controlsInset?: number; reducedMotion?: boolean; navigationRevision?: number;
  speechPresentation?: "solo" | "scene";
  speechDurationMs?: number;
  readingElapsedMs?: number;
  panelTreatment?: PanelTreatment;
}) {
  const sampled = useSampledStage();
  const portraitActor = speech ? {name:speech.speaker, avatarUrl:speech.portrait?.avatarUrl,
    persona:speech.portrait?.persona ?? "", personaKey:speech.portrait?.personaKey} : focusActor;
  const openingKey = `${roomScene.id}:${roomScene.version}:${navigationRevision}`;
  const focusedPlayerId = speech?.playerId ?? focusPlayerId;
  const speechKey = speech?.id ?? `silent:${focusedPlayerId ?? "room"}`;
  const [opening, setOpening] = useState({ key: openingKey, beat: speechKey });
  if (opening.key !== openingKey) setOpening({ key: openingKey, beat: speechKey });
  const openingBeat = opening.key === openingKey ? opening.beat : speechKey;
  const shot = roomScene.shots ? (roomScene.shots.mode === "establishing" && (sampled ? sampled.firstInScene : openingBeat === speechKey) && elapsedMs < OVERVIEW_HOLD_MS ? roomScene.shots.overview : selectVisualShot(roomScene.shots, focusedPlayerId)) : null;
  const scene = shot ? { ...roomScene, imageUrl: shot.imageUrl, anchors: shot.anchors } : roomScene;
  const treatment = roomScene.shots && roomScene.shots.groups.length > 1 && roomScene.shots.groups.some(group => group.imageUrl === scene.imageUrl) ? panelTreatment : "separate";
  const pointer = shot?.pointers.find(p => p.playerId === focusedPlayerId);
  // Late viewer publications keep the accepted cue's original staging budget.
  const solo = speech && speechPresentation === "solo" ? soloPresentationMotion(speech.text, elapsedMs, false, reducedMotion) : null;
  const opacity = solo?.speechOpacity ?? (speech ? speechDurationMs === undefined ? sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion)
    : elapsedMs <= SCENE_SPEECH_START_MS ? 0 : reducedMotion ? 1 : Math.max(0,Math.min(1,(elapsedMs - SCENE_SPEECH_START_MS)/200,(speechDurationMs - 400 - elapsedMs)/200)) : 0);
  const anchor = focusedPlayerId ? scene.anchors.find((item) => item.playerId === focusedPlayerId && item.confidence === "clear") : undefined;
  const frameRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [browserLoaded, setLoaded] = useState({ url: "", width: 0, height: 0 });
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
  const known = sampled?.images[scene.imageUrl];
  const backgroundLoaded = known ? {url: scene.imageUrl, ...known} : browserLoaded;
  const loaded = composition ? {...backgroundLoaded,width:composition.width,height:composition.height} : backgroundLoaded;
  const imageFailed = failedUrl === scene.imageUrl;
  const imageKnown = (backgroundLoaded.url === scene.imageUrl || imageFailed) && (!composition || composition.ready);
  // Hold the shared clock before paint so cold image loads cannot consume the
  // room's settling interval or the following thought/speech shot.
  useLayoutEffect(() => { onReadyChange?.(imageKnown); }, [imageKnown, onReadyChange]);
  let head = imageFailed ? undefined : pointer ? { x: pointer.x, y: pointer.y, width: 0, height: 0 } : anchor?.head;
  let target = frameVisualScene(size.width, size.height, imageKnown ? loaded.width : 0, imageKnown ? loaded.height : 0, composition?.fitCast || pointer && treatment !== "focal" ? undefined : head, treatment);
  // If an extreme close-up leaves no readable bubble space, show the full image
  // with a named panel instead of covering the face or silently clipping speech.
  if (head && !composition?.fitCast && placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), target, head).height < 110) {
    target = frameVisualScene(size.width, size.height, loaded.width, loaded.height);
    head = undefined;
  }
  const viewKey = `${scene.id}:${scene.version}:${scene.imageUrl}:${speechKey}:${imageKnown}:${loaded.width}:${loaded.height}:${target.left}:${target.top}:${target.width}:${target.height}:${head?.x}:${head?.width}:${treatment}:${navigationRevision}:${reducedMotion}`;
  const nextView: SceneCameraView = { url: imageKnown ? scene.imageUrl : "", frame: target, focusX: head ? head.x + head.width / 2 : .5, panelTreatment: treatment, shots: roomScene.shots };
  const [camera, setCamera] = useState({ key: viewKey, speechKey, from: nextView, target: nextView, startedAt: elapsedMs, direction: 0, navigationRevision, size });
  if (!sampled && imageKnown && camera.key !== viewKey) {
    const previous = camera.speechKey === speechKey
      ? sceneImageLayers(camera.from, camera.target, elapsedMs - camera.startedAt, camera.direction).at(-1)!
      : camera.target;
    const snap = paused || reducedMotion || navigationRevision !== camera.navigationRevision || !previous.url
      || size.width !== camera.size.width || size.height !== camera.size.height;
    const from = snap ? nextView : previous;
    const leavingOverview = camera.speechKey === speechKey && roomScene.shots?.mode === "establishing"
      && from.url === roomScene.shots.overview?.imageUrl && nextView.url !== from.url;
    setCamera({ key: viewKey, speechKey, from, target: nextView, startedAt: leavingOverview ? OVERVIEW_HOLD_MS : elapsedMs,
      direction: snap ? 0 : panelTransition(from.url, nextView.url, roomScene.shots), navigationRevision, size });
  }
  let from = camera.from, to = camera.target, startedAt = camera.startedAt, direction = camera.direction;
  if (sampled) {
    to = nextView; from = nextView; startedAt = 0; direction = 0;
    // Match the live establishing shot before the thinking or speech interval.
    const overview = sampled.firstInScene && roomScene.shots?.mode === "establishing" && elapsedMs >= OVERVIEW_HOLD_MS ? roomScene.shots.overview : null;
    const previousScene = sampled.previousScene;
    const previousShot = overview ?? (previousScene?.id === roomScene.id && previousScene.version === roomScene.version
      ? previousScene.shots ? selectVisualShot(previousScene.shots, sampled.previousSpeaker) : previousScene : null);
    if (previousShot) {
      const dimensions = sampled.images[previousShot.imageUrl];
      const previousAnchor = previousShot.anchors.find(a => a.playerId === sampled.previousSpeaker && a.confidence === "clear")?.head;
      const previousTreatment = roomScene.shots && roomScene.shots.groups.length > 1 && roomScene.shots.groups.some(g => g.imageUrl === previousShot.imageUrl) ? panelTreatment : "separate";
      if (dimensions) from = {url: previousShot.imageUrl, frame: frameVisualScene(size.width, size.height, dimensions.width, dimensions.height, overview ? undefined : previousAnchor, previousTreatment), focusX: previousAnchor ? previousAnchor.x + previousAnchor.width/2 : .5, panelTreatment: previousTreatment, shots: roomScene.shots};
      startedAt = overview ? OVERVIEW_HOLD_MS : 0;
      direction = panelTransition(from.url, to.url, roomScene.shots);
    }
  }
  // A composed room has no persisted scene predecessor. Its canonical room
  // predecessor still drives the same camera path on fresh/isolated samples.
  if (composition && imageKnown && (sampled || previousFocusPlayerId !== undefined)) {
    const previousId = sampled ? sampled.previousSpeaker : previousFocusPlayerId;
    const previousHead = scene.anchors.find(anchor => anchor.playerId === previousId)?.head;
    to = nextView; from = nextView; startedAt = 0; direction = 0;
    if (previousHead && !composition.fitCast) {
      let previousFrame = frameVisualScene(size.width,size.height,composition.width,composition.height,previousHead);
      const canFrameHead = placeSceneBubble(size.width,Math.max(0,size.height-controlsInset),previousFrame,previousHead).height >= 110;
      if (!canFrameHead) previousFrame = frameVisualScene(size.width,size.height,composition.width,composition.height);
      from = {...nextView,frame:previousFrame,focusX:canFrameHead ? previousHead.x + previousHead.width / 2 : .5};
    }
  }
  const cameraElapsedMs = reducedMotion || !imageKnown && camera.speechKey !== speechKey ? 450 : elapsedMs - startedAt;
  const layers = sceneImageLayers(from, to, cameraElapsedMs, direction);
  const currentLayer = layers[layers.length - 1]!;
  const framing = currentLayer.frame;
  const transitioning = imageKnown && from.url !== to.url && sceneCameraProgress(cameraElapsedMs) < 1;
  const thinkingReady = imageKnown && !transitioning && currentLayer.url === scene.imageUrl;
  const castHeads = composition?.fitCast ? composition.cast.map(player=>player.head) : [];
  const castHead = castHeads.length ? {x:Math.min(...castHeads.map(head=>head.x)),y:Math.min(...castHeads.map(head=>head.y)),
    width:Math.max(...castHeads.map(head=>head.x+head.width))-Math.min(...castHeads.map(head=>head.x)),
    height:Math.max(...castHeads.map(head=>head.y+head.height))-Math.min(...castHeads.map(head=>head.y))} : undefined;
  if(castHead && composition) {
    const top=Math.min(castHead.y,...composition.cast.map(player=>player.labelTop/composition.height-36/Math.max(1,framing.height)));
    castHead.height+=castHead.y-top;castHead.y=top;
  }
  const rawBubble = placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), framing, castHead ?? head);
  const thought = useSceneThinking();
  const available = Math.max(0,size.height - controlsInset);
  // Use the verified head box even when the speech pointer has zero dimensions.
  const face = anchor?.head ?? head;
  const fallback = !face || imageFailed;
  const fallbackSize = Math.min(200, size.width * .35, available * .35);
  const fallbackFrame = {left:(size.width-fallbackSize)/2,top:available*.3-fallbackSize/2,width:fallbackSize,height:fallbackSize};
  const faceFrame = fallback ? fallbackFrame : {left:framing.left + framing.width * face.x, top:framing.top + framing.height * face.y,
    width:framing.width * (face.width || .1),height:framing.height * (face.height || .12)};
  const focus = thinkingFocus(size.width, available, faceFrame, thinkingReady ? thought?.focus ?? 0 : 0, fallback, reducedMotion,
    !fallback && face.x + face.width / 2 > .5 ? "right" : "left", Boolean(composition));
  const speechBox = rawBubble;
  const speechFit = useBubbleTypography(frameRef, speech?.text ?? "", speechBox, "speech", available < 300, 28, composition ? speech?.speaker : undefined);
  const bubble = {...speechBox,width:speechFit.typography?.width ?? speechBox.width,height:speechFit.typography?.height ?? speechBox.height};
  if(castHead && head) {
    const x=framing.left+(head.x+head.width/2)*framing.width;
    bubble.left=Math.max(12,Math.min(size.width-bubble.width-12,x-bubble.width/2));
    if(!bubble.below)bubble.top=speechBox.top+speechBox.height-bubble.height;
    bubble.arrowLeft=Math.max(12,Math.min(bubble.width-20,x-bubble.left-4));
  }
  return <section ref={frameRef} aria-label="Current room" data-fit-cast={composition?.fitCast || undefined} data-thinking-shot={Boolean(thought) || undefined} data-panel-treatment={treatment} data-scene-loading={!imageKnown || undefined} data-panel-transition={transitioning || undefined} className="relative min-h-0 w-full flex-1 overflow-hidden">
    <div data-thinking-camera className="absolute inset-0" style={focus.mediaStyle}>
    {layers.filter(layer => layer.url).map(layer => <div key={layer.url} data-backdrop-layer className="pointer-events-none absolute inset-0" style={{ opacity: layer.opacity }}>
      <StageBackdrop source={layer.url} frame={layer.frame} panelTreatment={layer.panelTreatment} {...sceneBackdropSources(layer.url, layer.shots)} />
    </div>)}
    {/* eslint-disable-next-line @next/next/no-img-element -- preload the next panel before removing any visible pixels */}
    {!imageKnown && <img data-scene-preload key={scene.imageUrl} src={scene.imageUrl} alt="" aria-hidden="true" className="hidden" onError={() => { setFailedUrl(scene.imageUrl); }} onLoad={(event) => {
      setLoaded({ url: scene.imageUrl, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
    }} />}
    <SceneImage layers={layers} failedUrl={failedUrl} />
    {composition && imageKnown && layers.map(layer => <div key={layer.url} data-composed-cast className="pointer-events-none absolute inset-0" style={{opacity:layer.opacity}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- frozen transparent characters share the scene camera */}
      {composition.cast.map(player => <img key={player.id} data-room-player={player.id} src={player.source} alt={player.name}
        className="absolute max-w-none" style={{left:layer.frame.left + player.frame.left / composition.width * layer.frame.width,
          top:layer.frame.top + player.frame.top / composition.height * layer.frame.height,
          width:player.frame.width / composition.width * layer.frame.width,height:player.frame.height / composition.height * layer.frame.height,
          filter:"drop-shadow(0 12px 12px #0007)"}} />)}
      {composition.cast.map(player => {
        const x=layer.frame.left+(player.frame.left+player.frame.width/2)/composition.width*layer.frame.width;
        const y=layer.frame.top+player.labelTop/composition.height*layer.frame.height-36;
        if(x<0 || x>size.width || y<0 || y>available) return null;
        const progress=thought ? thought.elapsedMs/Math.max(1,thought.durationMs) : Math.max(0,(readingElapsedMs-650)/Math.max(1,(speechDurationMs ?? sceneSpeechDurationMs(speech?.text ?? ""))-1050));
        return <div key={player.id} data-room-player-name={player.id} data-composed-item-player={player.items?.length ? player.id : undefined} aria-label={player.name} className="absolute flex h-8 items-center gap-0.5 rounded bg-black/80 px-1 text-center text-sm leading-4 text-white"
          style={{left:Math.max(8,Math.min(size.width-120,x-56)),top:Math.max(8,Math.min(available-40,y)),width:112}}>
          <TimedSpeech text={player.name} elapsedMs={readingElapsedMs} progress={progress} pageCounter={false} className="h-full min-w-0 text-sm leading-4"/><ItemBadges items={player.items} compact/>
        </div>;
      })}
    </div>)}
    {/* eslint-disable-next-line @next/next/no-img-element -- frozen speaker portrait when scene head geometry is unavailable */}
    {thinkingReady && thought && fallback && portraitActor && <img alt={portraitActor.name} src={resolveAgentAvatarUrl(portraitActor.avatarUrl,portraitActor.persona,portraitActor.name,portraitActor.personaKey)}
      className="absolute rounded-full object-cover" style={{...fallbackFrame,opacity:thought.focus}} />}
    </div>
    {!thought && speech && imageKnown && !transitioning && opacity > 0 && <div data-speech-bubble className="absolute z-10 flex flex-col rounded-2xl border-2 border-white/60 bg-black/90 px-4 py-3 text-white shadow-xl"
      style={{ opacity, width: bubble.width, height: bubble.height, left: bubble.left, top: bubble.top, padding:speechFit.padding }}>
      <div className={`mb-2 flex shrink-0 items-center gap-3 ${speechFit.typography && speechFit.typography.pages.length > 1 && !speechFit.typography.footerHeight ? "pr-12" : ""}`}>
        {(imageFailed || !anchor && !pointer) && speech.playerId && <div data-headshot-fallback><AgentAvatar {...speech.portrait} persona={speech.portrait?.persona ?? ""} name={speech.speaker} size="12" /></div>}
        <p className={`${composition ? "whitespace-normal break-words [overflow-wrap:anywhere]" : "truncate"} text-base font-semibold leading-5 text-white/80`}>{speech.playerId === null ? "Anonymous" : speech.speaker}</p>
      </div>
      <TimedSpeech advancePart="speech" typography={speechFit.typography} text={speech.text} elapsedMs={speechPresentation === "solo" ? soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs : readingElapsedMs - SCENE_SPEECH_START_MS} progressDurationMs={speechDurationMs !== undefined ? Math.max(1,speechDurationMs - 1450) : undefined}
        progress={speechDurationMs !== undefined && sampled?.speech?.text !== speech.text ? Math.max(0,(readingElapsedMs - 850)/Math.max(1,speechDurationMs - 1450)) : undefined} className="text-sm leading-relaxed" />
      {head && <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/60 bg-black/90 ${bubble.below ? "border-t-2 border-l-2" : "border-b-2 border-r-2"}`} style={{ left: bubble.arrowLeft, top: bubble.below ? -8 : undefined, bottom: bubble.below ? undefined : -8 }} />}
    </div>}
    {thinkingReady && <ThinkingFocusOverlay wrapSpeaker={Boolean(composition)} frame={frameRef} layout={focus} />}
  </section>;
}
