import { visualSpeechDurationMs } from "@influence/engine/visual-speech";

/** All motion is sampled from the presentation director's clock. */
export function houseSegmentMotion(elapsedMs: number, durationMs: number, readable: boolean, reducedMotion: boolean) {
  if (readable || reducedMotion || elapsedMs >= durationMs) return { opacity: 1, transform: "none" };
  const entrance = Math.min(1, Math.max(0, elapsedMs / 300));
  const exit = Math.min(1, Math.max(0, (durationMs - elapsedMs) / 300));
  return { opacity: Math.min(entrance, exit), transform: `translateY(${(1 - entrance) * 12}px)` };
}

export function HouseSegment({ text, title, elapsedMs, paused, reducedMotion }: {
  text: string | null;
  title?: string;
  elapsedMs: number;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const duration = text === null ? 2000 : visualSpeechDurationMs(text);
  const motion = houseSegmentMotion(elapsedMs, duration, paused, reducedMotion);
  return <section aria-label={text === null ? `House transition: ${title}` : "House summary"}
    data-house-segment={text === null ? "transition" : "summary"}
    className="relative isolate mx-auto flex w-full max-w-3xl flex-col items-center px-2 py-8 text-center sm:px-8 sm:py-12" style={motion}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_25%,rgba(190,149,63,0.10),transparent_65%)]" />
    {/* eslint-disable-next-line @next/next/no-img-element -- the existing House brand asset */}
    <img src="/logo.png" alt="The House" className="mix-blend-screen mb-5 h-28 w-28 object-contain sm:h-40 sm:w-40" />
    <div aria-hidden="true" className="mb-7 h-px w-20 bg-gradient-to-r from-transparent via-[#c5a05a] to-transparent" />
    {text === null
      ? <h2 className="text-2xl font-medium tracking-wide text-[#e6ce9a] sm:text-4xl">{title}</h2>
      : <p className="whitespace-pre-wrap break-words text-left text-lg leading-relaxed text-[#f0eade] sm:text-2xl sm:leading-relaxed">{text}</p>}
  </section>;
}
