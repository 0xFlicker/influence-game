"use client";

import type { VisualShot, VisualShotPresentation } from "@influence/engine/visual-mode";
import { PANEL_TREATMENTS, panScene, sceneCameraProgress, type PanelTreatment, type SceneFrame } from "./visual-scene-layout";
import styles from "./scene-image.module.css";

export function panelTransition(from: string, to: string, shots?: VisualShotPresentation<VisualShot>) {
  const previous = shots?.groups.findIndex(shot => shot.imageUrl === from) ?? -1;
  const next = shots?.groups.findIndex(shot => shot.imageUrl === to) ?? -1;
  return previous >= 0 && next >= 0 ? Math.sign(next - previous) : 0;
}

export interface SceneCameraView {
  url: string;
  frame: SceneFrame;
  focusX: number;
  panelTreatment: PanelTreatment;
  shots?: VisualShotPresentation<VisualShot>;
}
export interface SceneImageLayer extends SceneCameraView { opacity: number; blur: number; exiting: boolean }

/** One director-clock interpolation moves the camera, masks, backdrop and dissolving pixels. */
export function sceneImageLayers(from: SceneCameraView, to: SceneCameraView, elapsedMs: number, direction: number): SceneImageLayer[] {
  const progress = sceneCameraProgress(elapsedMs, PANEL_TREATMENTS[to.panelTreatment].durationMs);
  if (!from.url || progress >= 1) return [{ ...to, opacity: 1, blur: 0, exiting: false }];
  if (from.url === to.url) return [{ ...to, frame: panScene(from.frame, to.frame, elapsedMs),
    focusX: from.focusX + (to.focusX - from.focusX) * progress, opacity: 1, blur: 0, exiting: false }];
  const step = Math.max(from.frame.width, to.frame.width) * PANEL_TREATMENTS[to.panelTreatment].spacing;
  const incomingStart = direction ? { ...to.frame, left: from.frame.left + direction * step, top: from.frame.top } : to.frame;
  const outgoingEnd = direction ? { ...from.frame, left: to.frame.left - direction * step, top: to.frame.top } : from.frame;
  return [
    { ...from, frame: panScene(from.frame, outgoingEnd, elapsedMs), opacity: 1 - progress, blur: 14 * progress, exiting: true },
    { ...to, frame: panScene(incomingStart, to.frame, elapsedMs), opacity: progress, blur: 8 * (1 - progress), exiting: false },
  ];
}

export function SceneImage({ layers, failedUrl }: { layers: readonly SceneImageLayer[]; failedUrl?: string | null }) {
  return layers.filter(layer => layer.url && layer.url !== failedUrl).map(layer => {
    const { url, frame, focusX, panelTreatment, opacity, blur, exiting } = layer;
    const imageStyle = { ...frame, "--focus-x": `${focusX * 100}%`, "--feather-left": `${Math.min(18, focusX * 50)}%`, "--feather-right": `${Math.max(82, 100 - (1 - focusX) * 50)}%` };
    const feather = `${styles.feather} ${panelTreatment === "focal" ? styles.focal : ""}`;
    return <div key={url} data-scene-layer data-scene-exiting={exiting || undefined} aria-hidden={exiting}
      className="pointer-events-none absolute inset-0" style={{ opacity, filter: `blur(${blur}px)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- saved pixels retain their own framing until the director completes their fade */}
      <img src={url} alt="Current conversation scene" className={`absolute max-w-none object-contain ${feather}`} style={imageStyle} />
      <div aria-hidden="true" className={`${styles.vignette} ${feather}`} style={{ ...imageStyle, opacity: .22 + .68 * blur / 14 }} />
    </div>;
  });
}
