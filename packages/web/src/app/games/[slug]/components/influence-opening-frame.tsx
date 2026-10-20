"use client";
/* eslint-disable @next/next/no-img-element -- Public packaged artwork and runtime cast URLs. */
import {useState, type ReactNode} from "react";
import {OpeningBrowserVideo, type OpeningVideoProps} from "@/components/watch/opening-browser-video";
import type {InfluenceOpeningCue} from "./types";
import {sampleInfluenceOpening} from "./influence-opening";
import styles from "./influence-opening.module.css";

function CastPortrait({name, fullBodyUrl, headshotUrls}: {name: string; fullBodyUrl?: string; headshotUrls: (string | undefined)[]}) {
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = [
    ...(fullBodyUrl ? [{src:fullBodyUrl, kind:"full-body"}] : []),
    ...headshotUrls.filter((src): src is string => Boolean(src)).map(src => ({src, kind:"headshot"})),
  ];
  const selected = candidates.find(image => !failed.includes(image.src));
  return selected
    ? <img className={selected.kind === "headshot" ? styles.headshot : undefined} data-cast-image={selected.kind}
        src={selected.src} alt={name} onError={() => setFailed(previous => [...previous, selected.src])} />
    : <div className={styles.monogram} aria-label={`${name} portrait unavailable`}>{name.slice(0, 1)}</div>;
}

export function InfluenceOpeningFrame({cue, elapsedMs, reduced = false, fullBodyUrl, portraitUrl, fallbackPortraitUrl, playing = false, speed = 1, video}: {
  cue: InfluenceOpeningCue; elapsedMs: number; reduced?: boolean; fullBodyUrl?: string; portraitUrl?: string; fallbackPortraitUrl?: string; playing?: boolean; speed?: number;
  video?: (props: OpeningVideoProps) => ReactNode;
}) {
  const shot = cue.opening;
  const frame = sampleInfluenceOpening(cue, elapsedMs, reduced);
  const media = {src: shot.entranceVideoUrl, poster: shot.posterUrl, timeMs: frame.videoMs, playing, speed};
  return <div className={styles.frame} data-influence-opening={shot.shot} data-opening-key={cue.key}>
    <div className={styles.picture} style={{opacity: frame.exitOpacity * frame.entranceOpacity}}>
      {frame.entrance && !reduced
        ? video ? video(media) : <OpeningBrowserVideo {...media} className={styles.backdrop} />
        : <img className={styles.backdrop} src={shot.backgroundUrl} alt="" style={{transform: `scale(${frame.scale})`}} />}
      <div className={styles.shade} style={{opacity: frame.entrance ? frame.opacity * 0.65 : 1}} />
      <div className={styles.content} style={{opacity: frame.opacity}}>
        {shot.shot === "house" && <div className={styles.brand}>
          <p>THE HOUSE</p><span>PRESENTS</span>
        </div>}
        {shot.shot === "title" && <div className={styles.title}>
          <p>A GAME OF SOCIAL STRATEGY</p>
          <img src={shot.logoUrl} alt="Influence" />
          <span className={styles.rule} style={{transform: `scaleX(${frame.ruleScale})`}} />
        </div>}
        {shot.shot === "cast" && shot.player && <div className={styles.cast}>
          <div className={styles.name}>
            <p>THE CAST <span>{String((shot.castIndex ?? 0) + 1).padStart(2, "0")} / {String(shot.castCount).padStart(2, "0")}</span></p>
            <h2>{shot.player.name}</h2>
            <span className={styles.rule} style={{transform: `scaleX(${frame.ruleScale})`}} />
          </div>
          <div className={styles.portrait} style={{transform: `translateY(${frame.portraitY}px)`}}>
            <CastPortrait key={shot.player.id} name={shot.player.name} fullBodyUrl={fullBodyUrl}
              headshotUrls={[portraitUrl, shot.player.avatarUrl, fallbackPortraitUrl]} />
          </div>
        </div>}
        {shot.shot === "enter" && <div className={styles.enter}>
          <p>EVERY RELATIONSHIP IS A MOVE.</p>
          <h2>Welcome to the House.</h2>
          <span className={styles.rule} style={{transform: `scaleX(${frame.ruleScale})`}} />
        </div>}
      </div>
    </div>
  </div>;
}
