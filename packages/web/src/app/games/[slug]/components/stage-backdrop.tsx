"use client";

import { useState } from "react";
import type { VisualShot, VisualShotPresentation } from "@influence/engine/visual-mode";
import { PANEL_TREATMENTS, type PanelTreatment, type SceneFrame } from "./visual-scene-layout";
import styles from "./stage-backdrop.module.css";

export const SOLO_STUDIO_BACKDROP = "/visual/solo-studio-backdrop.webp";

/** Saved panel order supplies neighboring context; never fetch future scenes. */
export function sceneBackdropSources(imageUrl: string, shots?: VisualShotPresentation<VisualShot>) {
  const index = shots?.groups.findIndex(shot => shot.imageUrl === imageUrl) ?? -1;
  return {
    left: index > 0 ? shots!.groups[index - 1]!.imageUrl : imageUrl,
    right: index >= 0 && index < shots!.groups.length - 1 ? shots!.groups[index + 1]!.imageUrl : imageUrl,
  };
}

/** Decorative edge crops stay behind the complete, sharply framed playspace. */
export function StageBackdrop({ source, left = source, right = source, frame, panelTreatment = "separate" }: {
  source: string;
  left?: string;
  right?: string;
  frame?: SceneFrame;
  panelTreatment?: PanelTreatment;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const usable = (url: string) => failed.has(url) ? failed.has(source) ? SOLO_STUDIO_BACKDROP : source : url;
  return <div aria-hidden="true" data-stage-backdrop data-panel-treatment={panelTreatment} className={`${styles.backdrop} ${panelTreatment === "focal" ? styles.focal : ""}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- a dim defocused base fills beyond the compressed neighbors */}
    {panelTreatment === "focal" && <img src={usable(source)} alt="" draggable={false} className={styles.focalBase} onError={() => setFailed(previous => new Set([...previous, usable(source)]))} />}
    {(["left", "right"] as const).map(side => {
      const url = usable(side === "left" ? left : right);
      const kind = url === SOLO_STUDIO_BACKDROP ? "studio" : url === source ? "repeat" : "neighbor";
      const aligned = kind === "neighbor" && frame && frame.width > 0 && frame.height > 0;
      const overlap = aligned ? frame.width * (1 - PANEL_TREATMENTS[panelTreatment].spacing) : 0;
      return <div key={side} data-backdrop-side={side} data-backdrop-kind={kind}
        className={`${styles.half} ${styles[side]} ${styles[kind]} ${aligned ? styles.aligned : ""}`}
        style={aligned ? { width: side === "left" ? Math.max(0, frame.left + overlap) : `max(0px, calc(100% - ${frame.left + frame.width - overlap}px))` } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative crops of immutable saved media */}
        <img src={url} alt="" draggable={false}
          style={aligned ? { width: panelTreatment === "focal" ? frame.width : `max(100%, ${frame.width}px)`, height: frame.height, top: frame.top } : undefined}
          onError={() => setFailed(previous => new Set([...previous, url]))} />
      </div>;
    })}
  </div>;
}
