"use client";
/* eslint-disable @next/next/no-img-element -- The shared frame also renders from frozen files outside Next. */
import {useState, type ReactNode} from "react";
import {OpeningBrowserVideo, type OpeningVideoProps} from "../../watch/opening-browser-video";
import {OPENING_ASSETS, sampleOpening, type WerewolfOpeningCue} from "./werewolf-opening";
import styles from "./werewolf-opening.module.css";

/** Shared by the live webpage and the full replay renderer. No controls or independent timers. */
export function WerewolfOpeningFrame({cue, elapsedMs, reduced = false, playing = false, speed = 1, navigationRevision = 0, video, browserLoading = false}: {
  cue: WerewolfOpeningCue; elapsedMs: number; reduced?: boolean; playing?: boolean; speed?: number; navigationRevision?: number;
  video?: (props: OpeningVideoProps) => ReactNode; browserLoading?: boolean;
}) {
  const shot = cue.opening;
  const frame = sampleOpening(cue, elapsedMs, reduced);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const media = {src: shot.videoUrl ?? "", poster: shot.backgroundUrl, timeMs: frame.videoMs, playing, speed, navigationRevision};
  const backgroundTransform = `translate(${frame.panX}%, ${frame.panY}%) scale(${frame.scale})`;
  const warmDoor = browserLoading && !video && !reduced;
  return <div className={styles.frame} data-werewolf-opening={shot.shot} data-opening-key={cue.key}>
    <div className={styles.picture} style={{opacity: frame.opacity}}>
      {warmDoor && shot.shot === "door" ? null : shot.videoUrl && !reduced ? video ? video(media) : <OpeningBrowserVideo key={shot.videoUrl} {...media} className={styles.backdrop} /> :
        <img className={styles.backdrop} src={shot.backgroundUrl} alt="" style={{transform:backgroundTransform}} />}
      {warmDoor && <OpeningBrowserVideo src={OPENING_ASSETS.door} poster={OPENING_ASSETS.doorPoster} timeMs={shot.shot === "door" ? frame.videoMs : 0}
        playing={shot.shot === "door" && playing} speed={speed} navigationRevision={navigationRevision} className={styles.backdrop} hidden={shot.shot !== "door"} />}
      {shot.transitionUrl && <img className={styles.backdrop} src={shot.transitionUrl} alt="" style={{opacity:frame.transitionOpacity, transform:backgroundTransform}} />}
      {shot.shot !== "door" && <div className={styles.shade} />}
      {shot.shot === "house" && <div className={styles.brand} style={{opacity:frame.textOpacity}}>
        <img src={shot.logoUrl} alt="" className={styles.logo} />
        <div className={styles.wordmark} aria-label="The House presents"><span className={styles.the}>THE</span><strong>HOUSE</strong><span className={styles.presents}>PRESENTS</span></div>
      </div>}
      {shot.shot === "title" && <div className={styles.title} style={{opacity:frame.textOpacity}}>
        <img src={shot.logoUrl} alt="Werewolf" className={styles.titleLogo} />
        <h1>{shot.title === "Werewolf" ? <span className="sr-only">Werewolf</span> : shot.title}</h1><span className={styles.rule} />
      </div>}
      {shot.shot === "cast" && shot.player && <div className={styles.cast} style={{opacity:frame.textOpacity}}>
        <div className={styles.portrait}>{shot.player.imageUrl && failedImage !== shot.player.imageUrl ? <CastImage key={shot.player.imageUrl} src={shot.player.imageUrl} name={shot.player.name} fullBody={shot.player.fullBody} browserLoading={browserLoading} reduced={reduced} onError={() => setFailedImage(shot.player?.imageUrl ?? null)} /> : <span>{shot.player.name}</span>}</div>
        <div className={styles.name}><p>THE CAST</p><h2>{shot.player.name}</h2><span className={styles.role}>{shot.player.role ?? ""}</span></div>
      </div>}
    </div>
  </div>;
}

function CastImage({src, name, fullBody, browserLoading, reduced, onError}: {src: string; name: string; fullBody?: boolean; browserLoading: boolean; reduced: boolean; onError: () => void}) {
  const [loaded, setLoaded] = useState(false);
  return <img className={fullBody ? styles.fullBody : undefined} src={src} alt={name} onLoad={() => setLoaded(true)} onError={onError}
    style={browserLoading ? {opacity: loaded ? 1 : 0, transition: reduced ? undefined : "opacity 400ms ease"} : undefined} />;
}
