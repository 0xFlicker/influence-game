"use client";
import {useEffect, useState} from "react";
import type {werewolfTransformationCast} from "./werewolf-watch-model";
import {wolfTransformationFrame} from "./werewolf-night-motion";
import styles from "./werewolf-transformation-stage.module.css";

const ignoreReadiness = () => {};

/** One establishing passage with the original and transformed character art. */
export function WerewolfTransformationStage({wolves, elapsed, reduced, onReady = ignoreReadiness}: {
  wolves: ReturnType<typeof werewolfTransformationCast>; elapsed: number; reduced: boolean; onReady?: (ready: boolean) => void;
}) {
  const sources = JSON.stringify(wolves.flatMap(wolf => [wolf.originalUrl, wolf.wolfUrl]).filter((url): url is string => Boolean(url)));
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let active = true;
    const urls: string[] = JSON.parse(sources);
    const failures = new Set<string>();
    let pending = urls.length;
    onReady(pending === 0);
    const images = urls.map(url => {
      const image = new Image();
      const done = (error: boolean) => {
        if (!active) return;
        if (error) failures.add(url);
        if (--pending === 0) { setFailed(new Set(failures)); onReady(true); }
      };
      image.onload = () => done(false); image.onerror = () => done(true); image.src = url;
      return image;
    });
    return () => {active = false; for (const image of images) {image.onload = null; image.onerror = null;} };
  }, [sources, onReady]);
  return <section data-wolf-transformation className={`${styles.stage} flex min-h-0 flex-1 flex-col overflow-hidden bg-[#111821] text-center text-white`}>
    <div className={`${styles.content} flex min-h-0 flex-1 flex-col items-center`}>
      <p className="shrink-0 text-xs uppercase tracking-[.25em] text-slate-300">The pack awakens</p>
      <div className={`${styles.cast} flex min-h-0 w-full max-w-3xl flex-1 items-stretch justify-center`}>
        {wolves.map(({id, name, originalUrl: original, wolfUrl: wolf}, index) => {
          const frame = wolfTransformationFrame(elapsed, index, reduced);
          const canTransform = Boolean(original && wolf && !failed.has(original) && !failed.has(wolf));
          return <figure key={id} data-wolf-id={id} data-wolf-form={canTransform && frame.wolf ? "wolf" : "original"} className={`${styles.wolf} flex min-h-0 min-w-0 flex-1 flex-col`}>
            <div className="relative min-h-0 flex-1" style={{transform: canTransform ? `translateY(${frame.y}px) rotate(${frame.rotate}deg) scale(${frame.scale})` : undefined}}>
              {/* eslint-disable-next-line @next/next/no-img-element -- frozen original and published derivative remain opaque rectangles */}
              {original && !failed.has(original) && <img src={original} alt={name} className="absolute inset-0 h-full w-full object-contain" style={{opacity: canTransform ? 1 - frame.wolfOpacity : 1}} />}
              {/* eslint-disable-next-line @next/next/no-img-element -- only an audience-permitted published form */}
              {wolf && !failed.has(wolf) && <img src={wolf} alt={`${name}, werewolf form`} className="absolute inset-0 h-full w-full object-contain" style={{opacity: canTransform ? frame.wolfOpacity : original && !failed.has(original) ? 0 : 1}} />}
            </div>
            <figcaption className="shrink-0 break-words text-sm"><span className="font-semibold">{name}</span><span className="mt-1 block text-xs text-slate-400">Werewolf</span></figcaption>
          </figure>;
        })}
      </div>
    </div>
  </section>;
}
