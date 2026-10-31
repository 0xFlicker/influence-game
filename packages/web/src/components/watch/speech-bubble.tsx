"use client";
import type {CSSProperties} from "react";
import type {BubbleTypography} from "./bubble-typography";
import {TimedSpeech} from "@/app/games/[slug]/components/timed-speech";
import type {SceneFrame} from "@/app/games/[slug]/components/visual-scene-layout";

/** Shared solo/decision speech chrome, typography, pagination, and pointer. */
export function SpeechBubble({speaker, caption, roleLabel, text, box, opacity, typography, padding, elapsedMs, staticSpeech = false, tail}: {
  speaker:string; caption?:string; roleLabel?:string; text:string; box:SceneFrame; opacity:number;
  typography?:BubbleTypography | null; padding:number; elapsedMs:number; staticSpeech?:boolean;
  tail:{side:"left" | "top" | "bottom"; style:CSSProperties};
}) {
  return <div data-speech-bubble style={{...box,opacity,padding}} className="absolute z-[200] flex flex-col rounded-2xl border border-white/25 bg-black/85 shadow-xl">
    <div className={`mb-2 shrink-0 text-base leading-5 ${typography && typography.pages.length > 1 && !typography.footerHeight ? "pr-12" : ""}`}>
      <p className="flex h-5 items-baseline gap-x-2 overflow-hidden font-semibold">
        <span className="min-w-0 truncate">{speaker}</span>
        {roleLabel ? <span data-speaker-role className="shrink-0 text-amber-200">{roleLabel}</span> : <span className="shrink-0 font-normal text-white/50">{caption}</span>}
      </p>
      {roleLabel && <p className="h-5 text-white/50">{caption}</p>}
    </div>
    <blockquote className="flex min-h-0 flex-1 flex-col">
      {staticSpeech ? <p className="break-words" style={{fontSize:typography?.fontSize,lineHeight:1.4}}>{text}</p>
        : <TimedSpeech text={text} elapsedMs={elapsedMs} typography={typography}/>}
    </blockquote>
    <span aria-hidden="true" data-speech-tail className={`absolute h-4 w-4 rotate-45 border-white/25 bg-black ${tail.side === "left" ? "-left-2 border-l border-b" : tail.side === "bottom" ? "-bottom-2 border-r border-b" : "-top-2 border-l border-t"}`} style={tail.style}/>
  </div>;
}
