"use client";
import {TimedSpeech} from "../../app/games/[slug]/components/timed-speech";

/** A bounded caption always reserves one text line; pages follow the playback clock. */
export function HouseMessage({text, elapsedMs = 0, logoUrl = "/logo.png"}: {text:string; elapsedMs?:number; logoUrl?:string}) {
  return <section aria-label="House summary" data-house-message className="relative mt-3 flex h-full max-h-40 min-h-[74px] min-w-0 self-end flex-col rounded-xl border border-white/20 bg-black/90 px-3 pb-1 pt-5 text-white">
    {/* eslint-disable-next-line @next/next/no-img-element -- bundled House identity, also used by rendered exports */}
    <img src={logoUrl} alt="The House" data-house-message-logo className="absolute left-1/2 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2 object-contain" />
    <TimedSpeech text={text} elapsedMs={elapsedMs} className="text-sm leading-5 sm:text-base sm:leading-6" />
  </section>;
}
