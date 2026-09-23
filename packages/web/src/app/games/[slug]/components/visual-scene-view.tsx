"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import { frameVisualScene, panScene, placeSceneBubble } from "./visual-scene-layout";
import { TimedSpeech } from "./timed-speech";
import { SCENE_SPEECH_START_MS, sceneSpeechOpacity } from "./scene-speech-timing";
import { soloPresentationMotion } from "./solo-presentation-timing";

export interface VisualSpeech { id: string; playerId: string | null; speaker: string; text: string }

/** Camera, bubble pages and speech share the director's presentation time. */
export function VisualSceneView({ scene, speech, elapsedMs, readingElapsedMs = elapsedMs, reducedMotion = false, navigationRevision = 0, controlsInset = 0, speechPresentation = "scene" }: {
  scene: AcceptedVisualScene; speech: VisualSpeech | null; elapsedMs: number;
  controlsInset?: number; reducedMotion?: boolean; navigationRevision?: number;
  speechPresentation?: "solo" | "scene";
  readingElapsedMs?: number;
}) {
  // Late viewer publications keep the accepted cue's original staging budget.
  const solo = speech && speechPresentation === "solo" ? soloPresentationMotion(speech.text, elapsedMs, false, reducedMotion) : null;
  const opacity = solo?.speechOpacity ?? (speech ? sceneSpeechOpacity(speech.text, elapsedMs, reducedMotion) : 0);
  const anchor = speech?.playerId ? scene.anchors.find((item) => item.playerId === speech.playerId && item.confidence === "clear") : undefined;
  const speechMeasure = useRef<HTMLDivElement>(null);
  const [speechHeight, setSpeechHeight] = useState(220);
  const frameRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState({ url: "", width: 0, height: 0 });
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setSize((old) => old.width === frame.clientWidth && old.height === frame.clientHeight ? old : { width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (speechMeasure.current) {
      speechMeasure.current.textContent = speech?.text ?? "";
      setSpeechHeight(speechMeasure.current.offsetHeight + 70);
      speechMeasure.current.textContent = "";
    }
  }, [speech?.text, size.width]);
  const imageKnown = loaded.url === scene.imageUrl;
  let target = frameVisualScene(size.width, size.height, imageKnown ? loaded.width : 0, imageKnown ? loaded.height : 0, anchor?.head);
  let head = anchor?.head;
  // If an extreme close-up leaves no readable bubble space, show the full image
  // with a named panel instead of covering the face or silently clipping speech.
  if (head && placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), target, head).height < 110) {
    target = frameVisualScene(size.width, size.height, loaded.width, loaded.height);
    head = undefined;
  }
  const geometryKey = `${scene.id}:${scene.version}:${scene.roomId}:${scene.imageUrl}:${size.width}:${size.height}:${loaded.width}:${loaded.height}:${navigationRevision}:${reducedMotion}`;
  const beatKey = speech?.id ?? "silent";
  const [camera, setCamera] = useState({ geometryKey, beatKey, from: target, target });
  if (camera.geometryKey !== geometryKey || camera.beatKey !== beatKey) {
    setCamera({ geometryKey, beatKey, from: camera.geometryKey === geometryKey && head && camera.target.width === target.width && !reducedMotion ? camera.target : target, target });
  }
  const framing = reducedMotion ? target : panScene(camera.from, target, elapsedMs);
  const bubble = placeSceneBubble(size.width, Math.max(0, size.height - controlsInset), framing, head, speechHeight);
  return <section ref={frameRef} aria-label="Current room" className="relative min-h-0 w-full flex-1 overflow-hidden">
    <div ref={speechMeasure} aria-hidden="true" className="pointer-events-none invisible absolute whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed" style={{ width: Math.max(0, Math.min(480, size.width - 24) - 32) }} />
    {/* eslint-disable-next-line @next/next/no-img-element -- immutable generated scene served by game media storage */}
    <img src={scene.imageUrl} alt="Current conversation scene" onLoad={(event) => setLoaded({ url: scene.imageUrl, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      className="absolute max-w-none object-contain" style={imageKnown ? { left: framing.left, top: framing.top, width: framing.width, height: framing.height } : { width: '100%', height: '100%' }} />
    {speech && opacity > 0 && <div data-speech-bubble className="absolute z-10 flex flex-col rounded-2xl border border-white/20 bg-black/90 px-4 py-3 text-white shadow-xl"
      style={{ opacity, width: bubble.width, height: bubble.height, left: bubble.left, top: bubble.top }}>
      <p className="mb-1 shrink-0 text-xs font-semibold text-white/65">{speech.playerId === null ? "Anonymous" : speech.speaker}</p>
      <TimedSpeech text={speech.text} elapsedMs={speechPresentation === "solo" ? soloPresentationMotion(speech.text, readingElapsedMs).speechElapsedMs : readingElapsedMs - SCENE_SPEECH_START_MS} className="text-sm leading-relaxed" />
      {head && <span aria-hidden="true" className={`absolute h-4 w-4 rotate-45 border-white/20 bg-black/90 ${bubble.below ? "border-t border-l" : "border-b border-r"}`} style={{ left: bubble.arrowLeft, top: bubble.below ? -8 : undefined, bottom: bubble.below ? undefined : -8 }} />}
    </div>}
  </section>;
}
