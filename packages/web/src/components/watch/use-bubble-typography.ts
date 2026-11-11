"use client";
import {useSampledStage} from "./sampled-stage";
import {useLayoutEffect, useState, type RefObject} from "react";
import {bubbleFontRange, fitBubbleText, type BubbleTypography} from "./bubble-typography";
import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";

/** Measure before speech is shown; time/page changes cannot resize the bubble. */
export function useBubbleTypography(frame: RefObject<HTMLElement | null>, text: string, box: SceneFrame, kind: "speech" | "thought", compact: boolean, headerHeight = kind === "thought" ? 20 : 28, headerText?: string) {
  const sampled=useSampledStage();
  const {width, height} = box;
  const padding = compact ? 10 : 18;
  const chrome = padding * 2 + 2 + headerHeight;
  const {minFont, maxFont} = bubbleFontRange(width, compact);
  const key = JSON.stringify([text,width,height,kind,compact,headerHeight,minFont,maxFont,...(headerText === undefined ? [] : [headerText])]);
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
      let measuredChrome = chrome, minWidth: number | undefined;
      if (headerText !== undefined) {
        // Reserve the label's natural width before tightening short dialogue.
        // Measuring at this independent width avoids a label/body resize loop.
        Object.assign(probe.style,{width:"max-content",fontSize:"16px",fontWeight:"600",lineHeight:"20px",whiteSpace:"pre"});
        probe.textContent = headerText;
        minWidth = Math.min(width,Math.max(240,Math.ceil(probe.getBoundingClientRect().width) + padding * 2 + 2));
        Object.assign(probe.style,{width:`${Math.max(1,minWidth-padding*2-2)}px`,whiteSpace:"pre-wrap"});
        measuredChrome = padding * 2 + 2 + Math.ceil(probe.getBoundingClientRect().height) + 8;
        Object.assign(probe.style,{fontWeight:"400",lineHeight:"1.4"});
      }
      const value = fitBubbleText(text, {width,height,chrome:measuredChrome,padding,maxFont,minFont,minWidth}, (copy, contentWidth, fontSize) => {
        probe.style.width = `${contentWidth}px`; probe.style.fontSize = `${fontSize}px`; probe.textContent = copy || " ";
        return probe.getBoundingClientRect().height;
      });
      capture?.(key,value);
      setMeasured({key,value});
    };
    measure(); void document.fonts.ready.then(measure);
    return () => {active = false; probe.remove();};
  }, [frame,key,text,width,height,padding,chrome,maxFont,minFont,frozen,capture,headerText]);
  return {typography: frozen ?? (measured?.key === key ? measured.value : null), padding};
}
