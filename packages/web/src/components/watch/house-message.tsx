import {cleanSpeechPage} from "../../app/games/[slug]/components/speech-pages";

/** In-flow House copy: native wrapping determines height, including during audio. */
export function HouseMessage({text, logoUrl = "/logo.png"}: {text:string; logoUrl?:string}) {
  return <section aria-label="House summary" data-house-message className="relative mt-6 min-h-24 shrink-0 rounded-xl border border-white/20 bg-black/90 px-4 pb-4 pt-9 text-white">
    {/* eslint-disable-next-line @next/next/no-img-element -- bundled House identity, also used by rendered exports */}
    <img src={logoUrl} alt="The House" data-house-message-logo className="absolute left-1/2 top-0 h-14 w-14 -translate-x-1/2 -translate-y-1/2 object-contain" />
    <p data-house-message-text className="whitespace-pre-wrap break-words text-base leading-relaxed sm:text-lg">{cleanSpeechPage([text],0)}</p>
  </section>;
}
