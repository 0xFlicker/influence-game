"use client";
import type {CSSProperties, RefObject} from "react";
import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";
import {ThoughtBubble, useSceneThinking} from "./watch-thinking";
import {useBubbleTypography} from "./use-bubble-typography";

/** Screen-space camera: normal framing is unchanged outside a thought shot. */
export function thinkingFocus(width: number, height: number, face: SceneFrame, progress: number, portrait = false, reducedMotion = false, faceSide?: "left" | "right") {
  const margin = 20, gap = 24;
  const beside = width >= 640 && width >= height;
  const faceOnRight = beside && (faceSide ? faceSide === "right" : face.left + face.width / 2 > width / 2);
  const square = Math.max(0, Math.min(beside ? width * .48 : width - margin * 2, beside ? height - margin * 2 : height * .48));
  const textWidth = Math.max(0, Math.min(560, beside ? width - square - gap - margin * 2 : width - margin * 2));
  const left = beside ? (width - square - gap - textWidth) / 2 : (width - square) / 2;
  const top = beside ? (height - square) / 2 : margin;
  const target = {x:left + (faceOnRight ? textWidth + gap : 0) + square / 2, y:top + square * .46};
  const source = {x:face.left + face.width / 2, y:face.top + face.height / 2};
  const zoom = Math.max(1.12, Math.min(portrait ? 1.65 : 7, square * .58 / Math.max(1, face.width, face.height)));
  const amount = reducedMotion ? (progress > 0 ? 1 : 0) : progress;
  const scale = 1 + (zoom - 1) * amount;
  const x = (target.x - source.x * zoom) * amount;
  const y = (target.y - source.y * zoom) * amount;
  const head = {x:source.x * scale + x, y:source.y * scale + y};
  const box: SceneFrame = {left:beside ? faceOnRight ? left : left + square + gap : margin, top:beside ? Math.max(margin,(height - Math.min(380,height - margin * 2)) / 2) : top + square + gap,
    width:textWidth, height:Math.max(0,beside ? Math.min(380,height - margin * 2) : height - (top + square + gap) - margin)};
  // Reduced motion cuts to a still close-up instead of animating the camera.
  const radius = Math.max(24, Math.max(face.width,face.height) * scale * .7);
  const mediaStyle: CSSProperties = {transformOrigin:"0 0", transform:`translate(${x}px, ${y}px) scale(${scale})`};
  return {box, head, radius, mediaStyle, progress, faceOnRight};
}
export type ThinkingFocusLayout = ReturnType<typeof thinkingFocus>;

export function ThinkingFocusOverlay({frame, layout}: {frame: RefObject<HTMLElement | null>; layout: ThinkingFocusLayout}) {
  const thought = useSceneThinking();
  const fit = useBubbleTypography(frame, thought?.text ?? "", layout.box, "thought", layout.box.height < 180);
  if (!thought) return null;
  const {head, radius} = layout;
  const fittedWidth = fit.typography?.width ?? layout.box.width;
  const box = {...layout.box,width:fittedWidth,height:fit.typography?.height ?? layout.box.height,
    left:layout.box.left + (layout.faceOnRight ? layout.box.width - fittedWidth : 0)};
  return <>
    <div aria-hidden="true" data-thinking-vignette className="pointer-events-none absolute inset-0 z-[175]"
      style={{opacity:thought.focus,background:`radial-gradient(circle at ${head.x}px ${head.y}px, transparent 0, transparent ${radius * .65}px, rgba(4,6,14,.55) ${radius * 1.1}px, rgba(4,6,14,.94) ${radius * 1.9}px)`}} />
    <div aria-hidden="true" className="pointer-events-none absolute z-[176] rounded-full"
      style={{left:head.x-radius,top:head.y-radius,width:radius*2,height:radius*2,opacity:thought.focus*.3,
        boxShadow:`0 0 ${radius*.4}px rgba(213,226,255,.28), inset 0 0 ${radius*.3}px rgba(213,226,255,.12)`}} />
    {thought.opacity > 0 && <ThoughtBubble box={box} head={{x:head.x + (layout.faceOnRight ? -1 : 1)*radius*.75,y:head.y}} typography={fit.typography} padding={fit.padding} />}
  </>;
}
