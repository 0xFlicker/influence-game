"use client";

import {voteSceneIdentity} from "./vote-ledger-model";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimate } from "motion/react";
import {presentationEntrances} from "./presentation-entrances";
import type { PresentationCue } from "./types";
import { VISUAL_SPEECH_FADE_MS } from "@influence/engine/visual-speech";
import { SOLO_SPEECH_START_MS, SOLO_READ_START_MS, SOLO_SPEECH_FADE_MS, SOLO_EXIT_MS } from "./solo-presentation-timing";
import { SCENE_SPEECH_START_MS, SCENE_READ_START_MS, SCENE_EXIT_HOLD_MS } from "./scene-speech-timing";

import { PresentationDirector as SharedPresentationDirector, type CreatePresentationDirectorOptions, type PresentationAnimationControlAdapter, type WatchPolicy } from "@/components/watch/watch-director";
import type { PresentationDirectorSnapshot as WatchDirectorSnapshot } from "@/components/watch/watch-director";
export type { PresentationClock, PresentationAnimationControlAdapter } from "@/components/watch/watch-director";
type PresentationDirectorSnapshot = WatchDirectorSnapshot & { canonicalSequence: number | null; round: number | null };
interface RetainedMotionControl { pause(): void; play(): void; complete(): void; speed: number }
export const influencePresentationPolicy: WatchPolicy<PresentationCue> = {
  position: cue => cue.canonicalSequence,
  speech: speechBoundaries,
  scrubAtMs: cue => cue.kind === "format_deciding_vote" ? 2000 : voteSceneIdentity(cue) && !cue.voteSummary ? SOLO_READ_START_MS : cue.voteSummary ? 0 : speechBoundaries(cue)?.showAtMs ?? 0,
  isCatchUp: cue => cue.source !== "format" && Boolean(cue.liveCatchUp),
  acceptAtWatermark: (cue, watermark) => cue.source !== "format" && cue.canonicalSequence === watermark,
  reconcile: retainActiveHouseBridge,
};
/** Influence coordinates stay in its adapter, never in the common scheduler. */
export class PresentationDirector extends SharedPresentationDirector<PresentationCue> {
  override getSnapshot(): PresentationDirectorSnapshot {
    const snapshot = super.getSnapshot();
    return { ...snapshot, canonicalSequence: snapshot.position, round: this.getActiveCue()?.round ?? null };
  }
}
export function createPresentationDirector(options: Omit<CreatePresentationDirectorOptions<PresentationCue>, "policy"> = {}) {
  return new PresentationDirector({ ...options, policy: influencePresentationPolicy });
}
export function usePresentationDirector({
  followTail = false,
}: {
  followTail?: boolean;
} = {}): {
  director: PresentationDirector;
  snapshot: PresentationDirectorSnapshot;
  scope: { current: HTMLDivElement | null };
  reducedMotion: boolean;
} {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();
  const retainedControls = useRef(new Set<RetainedMotionControl>());
  const animation = useMemo<
    PresentationAnimationControlAdapter & {
      track(control: RetainedMotionControl): () => void;
    }
  >(() => ({
    track(control) {
      retainedControls.current.add(control);
      return () => retainedControls.current.delete(control);
    },
    pause() {
      for (const control of retainedControls.current) control.pause();
    },
    resume() {
      for (const control of retainedControls.current) control.play();
    },
    complete() {
      for (const control of retainedControls.current) control.complete();
      retainedControls.current.clear();
    },
    setSpeed(speed) {
      for (const control of retainedControls.current) control.speed = speed;
    },
  }), []);
  const director = useMemo(() => createPresentationDirector(), []);
  const [snapshot, setSnapshot] = useState(() => director.getSnapshot());

  useEffect(() => {
    director.activate();
    const unsubscribe = director.subscribe(() => {
      setSnapshot(director.getSnapshot());
    });
    return () => {
      unsubscribe();
      director.dispose();
    };
  }, [director]);

  useEffect(() => {
    director.setAnimationAdapter(animation);
    director.setReducedMotion(reducedMotion);
    if (reducedMotion) animation.complete();
  }, [animation, director, reducedMotion]);

  useEffect(() => {
    director.setFollowTail(followTail);
  }, [director, followTail]);

  useEffect(() => {
    if (!scope.current || !snapshot.activeKey) return;
    const controls: Array<{
      control: RetainedMotionControl;
      release: () => void;
    }> = [];
    const track = (control: RetainedMotionControl): void => {
      control.speed = director.getSnapshot().speed;
      controls.push({ control, release: animation.track(control) });
    };
    const activeCue = director.getActiveCue();
    const currentStateEntry = scope.current.querySelector(
      '[data-presentation-current-entry="true"]',
    );
    for (const entrance of presentationEntrances(scope.current, activeCue, reducedMotion,
      !currentStateEntry && director.getSnapshot().isPlaying)) {
      track(animate(entrance.element, entrance.keyframes, entrance.options) as RetainedMotionControl);
    }

    return () => {
      for (const { control, release } of controls) {
        control.complete();
        release();
      }
    };
  }, [animate, animation, director, reducedMotion, scope, snapshot.activeKey]);

  return {
    director,
    snapshot: { ...snapshot, canonicalSequence: snapshot.position, round: director.getActiveCue()?.round ?? null },
    scope,
    reducedMotion,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (
      typeof window === "undefined"
      || typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const preference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const syncPreference = (): void => {
      setReducedMotion(preference.matches);
    };
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);
  return reducedMotion;
}

function speechBoundaries(cue: PresentationCue | null) {
  if (!cue?.speechPresentation || voteSceneIdentity(cue)) return null;
  const solo = cue.speechPresentation === "solo";
  const hideAtMs = cue.baseDurationMs - (solo ? SOLO_EXIT_MS : SCENE_EXIT_HOLD_MS + VISUAL_SPEECH_FADE_MS);
  return {
    showAtMs: solo ? SOLO_SPEECH_START_MS : SCENE_SPEECH_START_MS,
    readAtMs: solo ? SOLO_READ_START_MS : SCENE_READ_START_MS,
    hideAtMs,
    hiddenAtMs: hideAtMs + (solo ? SOLO_SPEECH_FADE_MS : VISUAL_SPEECH_FADE_MS),
  };
}

/** Backfilled narration can replace a title in history, but cannot interrupt a title already on air. */
function retainActiveHouseBridge(cues: PresentationCue[], active: PresentationCue | null): PresentationCue[] {
  if (active?.source !== "house" || cues.some((cue) => cue.key === active.key)) return cues;
  const following = cues.findIndex((cue) => cue.key === active.followingCueKey);
  if (following >= 0) cues.splice(following, 0, active);
  return cues;
}
