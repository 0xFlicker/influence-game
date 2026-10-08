"use client";
import {useSampledStage} from "./sampled-stage";
import {useLayoutEffect, useState, type RefObject} from "react";
import {fitBubbleText, type BubbleTypography} from "./bubble-typography";
import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";

/** Measure before speech is shown; time/page changes cannot resize the bubble. */
export function useBubbleTypography(frame: RefObject<HTMLElement | null>, text: string, box: SceneFrame, kind: "speech" | "thought", compact: boolean) {
  const sampled=useSampledStage();
  const {width, height} = box;
  const padding = compact ? 10 : 18;
  const chrome = padding * 2 + 2 + (kind === "thought" ? 20 : 28);
  const maxFont = kind === "thought" ? compact ? 17 : 22 : compact ? 20 : 28;
  const minFont = compact ? 12 : kind === "thought" ? 16 : 18;
  const key = JSON.stringify([text,width,height,kind,compact]);
  const frozen=sampled?.layouts?.[key];
  const capture=sampled?.captureLayout;
  const [measured, setMeasured] = useState<{key:string; value:BubbleTypography} | null>(null);
  useLayoutEffect(() => {
    if(frozen) return;
    const element = frame.current;
    if (!element || width <= padding * 2 || height <= chrome) return;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    Object.assign(probe.style, {position:"fixed", left:"-10000px", top:"0", visibility:"hidden", pointerEvents:"none",
      whiteSpace:"pre-wrap", overflowWrap:"anywhere", fontFamily:getComputedStyle(element).fontFamily, fontWeight:"400", lineHeight:"1.4"});
    document.body.append(probe);
    let active = true;
    const measure = () => {
      if (!active) return;
      const value = fitBubbleText(text, {width,height,chrome,padding,maxFont,minFont}, (copy, contentWidth, fontSize) => {
        probe.style.width = `${contentWidth}px`; probe.style.fontSize = `${fontSize}px`; probe.textContent = copy || " ";
        return probe.getBoundingClientRect().height;
      });
      capture?.(key,value);
      setMeasured({key,value});
    };
    measure(); void document.fonts.ready.then(measure);
    return () => {active = false; probe.remove();};
  }, [frame,key,text,width,height,padding,chrome,maxFont,minFont,frozen,capture]);
  return {typography: frozen ?? (measured?.key === key ? measured.value : null), padding};
}
