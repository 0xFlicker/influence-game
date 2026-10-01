"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { selectVisualShot } from "@influence/engine/visual-mode";
import { VisualSceneView } from "../games/[slug]/components/visual-scene-view";
import { TimedSpeech } from "../games/[slug]/components/timed-speech";
import { SCENE_READ_START_MS, SCENE_SPEECH_START_MS } from "../games/[slug]/components/scene-speech-timing";
import { replayMoment } from "./replay-moment";
import styles from "./werewolf-player.module.css";

/** One clock per accepted moment. Pauses on buffering and backgrounding. */
export function WerewolfPlayer({ data, playing, speed, onAdvance }: { data: WerewolfPresentation; playing: boolean; speed: number; onAdvance: () => void }) {
  const moment = replayMoment(data.view);
  const scene = data.scene;
  const shot = scene?.shots ? selectVisualShot(scene.shots, moment.actor?.id) : null;
  const covered = Boolean(scene && moment.actor && (shot ? shot.visibleParticipantIds.includes(moment.actor.id) : scene.anchors.some(a => a.playerId === moment.actor?.id && a.confidence === "clear")));
  const imageUrl = covered ? null : moment.actor?.avatarUrl;
  const [ready, setReady] = useState(!covered && !imageUrl), [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [elapsed, setElapsed] = useState(playing ? 0 : SCENE_READ_START_MS + 1);
  const elapsedRef = useRef(elapsed), advanced = useRef(false), advance = useRef(onAdvance);
  useEffect(() => { advance.current = onAdvance; }, [onAdvance]);
  const imageReady = useCallback((value: boolean) => setReady(value), []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches); update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!playing || !ready) return;
    if (elapsedRef.current >= moment.duration) { elapsedRef.current = 0; advanced.current = false; }
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      if (!document.hidden) {
        elapsedRef.current = Math.min(moment.duration, elapsedRef.current + Math.min(now - previous, 100) * speed);
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= moment.duration && !advanced.current) { advanced.current = true; advance.current(); }
      }
      previous = now; frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, ready, speed, moment.duration]);
  // A hung image must never strand a game. The renderer reports ordinary errors;
  // this bound lets the user continue with a readable fallback on stalled delivery.
  const [imageTimeout, setImageTimeout] = useState(false);
  useEffect(() => { if (ready) return; const timer = setTimeout(() => { setImageTimeout(true); setReady(true); }, 8000); return () => clearTimeout(timer); }, [ready]);
  const visual = covered && scene && !imageTimeout;
  return <>
    <div className={`${styles.stage} ${moment.pack ? styles.pack : ""}`} data-werewolf-stage data-cursor={data.view.cursor} data-ready={ready} data-elapsed={Math.floor(elapsed)}>
      <div className={styles.context}>{moment.title}</div>
      {visual ? <VisualSceneView scene={scene} focusPlayerId={moment.actor?.id} speech={moment.spoken && moment.actor ? { id: `${data.view.cursor}`, playerId: moment.actor.id, speaker: moment.speaker, text: moment.text, portrait: { avatarUrl: moment.actor.avatarUrl, persona: "", personaKey: moment.actor.personaKey } } : null} elapsedMs={elapsed} reducedMotion={reduced} onReadyChange={imageReady} /> : <div className={styles.fallback}>
        {moment.actor && <div className={styles.portrait}>
          {imageUrl && !failed && !imageTimeout ? <>
            {/* eslint-disable-next-line @next/next/no-img-element -- audience-checked frozen game reference, never a mutable profile */}
            <img src={imageUrl} alt={moment.actor.name} onLoad={() => setReady(true)} onError={() => { setFailed(true); setReady(true); }} />
          </> : <span aria-label={moment.actor.name}>{moment.actor.name.slice(0, 1)}</span>}
        </div>}
        {moment.spoken ? <div className={styles.bubble} data-speech-bubble><p className={styles.speaker}>{moment.speaker}</p><TimedSpeech text={moment.text} elapsedMs={elapsed - SCENE_SPEECH_START_MS} className={styles.words} /></div> : null}
      </div>}
      {!moment.spoken && <div className={styles.outcome}><p className={styles.speaker}>{moment.actor ? moment.speaker : "The House"}</p><h2>{moment.text}</h2>{moment.cue && <p className={styles.cue}>{moment.cue}</p>}</div>}
      {!ready && <p className={styles.loading} role="status">Loading the scene…</p>}
    </div>
  </>;
}
