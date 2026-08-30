"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimate } from "motion/react";
import type { PresentationCue } from "./types";

export interface PresentationClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface PresentationAnimationControlAdapter {
  pause(): void;
  resume(): void;
  complete(): void;
  setSpeed(speed: number): void;
}

interface PresentationDirectorState {
  cues: readonly PresentationCue[];
  cursor: number;
  isPlaying: boolean;
  followTail: boolean;
  waitingAtTail: boolean;
  speed: number;
  hydrationWatermark: number | null;
  reducedMotion: boolean;
}

type PresentationDirectorAction =
  | { type: "load"; cues: readonly PresentationCue[]; cursor?: number }
  | { type: "append"; cues: readonly PresentationCue[]; cursor?: number }
  | { type: "set_playing"; isPlaying: boolean }
  | { type: "set_follow_tail"; followTail: boolean }
  | { type: "set_waiting_at_tail"; waitingAtTail: boolean }
  | { type: "set_cursor"; cursor: number }
  | { type: "set_speed"; speed: number }
  | { type: "set_reduced_motion"; reducedMotion: boolean }
  | { type: "hydrate"; cues: readonly PresentationCue[]; cursor: number; watermark: number | null }
  | { type: "reset_round"; cues: readonly PresentationCue[] };

export interface PresentationDirectorSnapshot {
  cueKeys: readonly string[];
  cursor: number;
  activeKey: string | null;
  canonicalSequence: number | null;
  round: number | null;
  isPlaying: boolean;
  followTail: boolean;
  waitingAtTail: boolean;
  speed: number;
  hydrationWatermark: number | null;
  bufferedCount: number;
  reducedMotion: boolean;
}

export interface CreatePresentationDirectorOptions {
  clock?: PresentationClock;
  animation?: PresentationAnimationControlAdapter;
  reducedMotion?: boolean;
  followTail?: boolean;
}

interface RetainedMotionControl {
  pause(): void;
  play(): void;
  complete(): void;
  speed: number;
}

const NOOP_ANIMATION: PresentationAnimationControlAdapter = {
  pause() {},
  resume() {},
  complete() {},
  setSpeed() {},
};

function reducePresentationDirectorState(
  state: PresentationDirectorState,
  action: PresentationDirectorAction,
): PresentationDirectorState {
  switch (action.type) {
    case "load":
      return {
        ...state,
        cues: action.cues,
        cursor: clampCursor(action.cursor ?? 0, action.cues),
      };
    case "append":
      return {
        ...state,
        cues: action.cues,
        cursor: clampCursor(action.cursor ?? state.cursor, action.cues),
      };
    case "set_playing":
      return { ...state, isPlaying: action.isPlaying };
    case "set_follow_tail":
      return { ...state, followTail: action.followTail };
    case "set_waiting_at_tail":
      return { ...state, waitingAtTail: action.waitingAtTail };
    case "set_cursor":
      return { ...state, cursor: clampCursor(action.cursor, state.cues) };
    case "set_speed":
      return { ...state, speed: action.speed };
    case "set_reduced_motion":
      return { ...state, reducedMotion: action.reducedMotion };
    case "hydrate":
      return {
        ...state,
        cues: action.cues,
        cursor: clampCursor(action.cursor, action.cues),
        hydrationWatermark: action.watermark,
        waitingAtTail: false,
      };
    case "reset_round":
      return {
        ...state,
        cues: action.cues,
        cursor: clampCursor(0, action.cues),
        hydrationWatermark: null,
        waitingAtTail: false,
      };
  }
}

export function createPresentationDirector(
  options: CreatePresentationDirectorOptions = {},
): PresentationDirector {
  return new PresentationDirector(options);
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
    const rootControl = animate(
      scope.current,
      { opacity: reducedMotion ? 1 : [0.985, 1] },
      { duration: reducedMotion ? 0 : 0.18, ease: "easeOut" },
    ) as RetainedMotionControl;
    track(rootControl);

    const activeCue = director.getActiveCue();
    const currentStateEntry = scope.current.querySelector(
      '[data-presentation-current-entry="true"]',
    );
    if (
      !reducedMotion
      && !currentStateEntry
      && activeCue?.source === "format"
      && activeCue.kind === "safety_bounce_pointer"
    ) {
      const candidates = scope.current.querySelectorAll<HTMLElement>(
        '[data-pointer-cycle-candidate="true"]',
      );
      candidates.forEach((candidate, index) => {
        const control = animate(
          candidate,
          {
            opacity: [0.2, 1, 0.28],
            scale: [0.97, 1.04, 1],
          },
          {
            delay: index * 0.2,
            duration: 0.32,
            ease: "easeInOut",
          },
        ) as RetainedMotionControl;
        track(control);
      });
      const acceptedTarget = Array.from(
        scope.current.querySelectorAll<HTMLElement>("[data-accepted-target]"),
      ).find((element) => element.dataset.acceptedTarget === activeCue.targetId);
      const classifiedCard = Array.from(
        scope.current.querySelectorAll<HTMLElement>("[data-board-member]"),
      ).find((element) => element.dataset.boardMember === activeCue.targetId);
      const landingDelay = candidates.length * 0.2;
      if (classifiedCard) {
        const control = animate(
          classifiedCard,
          {
            opacity: [0.35, 1],
            y: [20, 0],
            scale: [0.96, 1],
          },
          {
            delay: landingDelay,
            duration: 0.38,
            ease: "easeOut",
          },
        ) as RetainedMotionControl;
        track(control);
      }
      if (acceptedTarget) {
        const control = animate(
          acceptedTarget,
          { opacity: [0.45, 1], scale: [0.985, 1] },
          {
            delay: landingDelay,
            duration: 0.35,
            ease: "easeOut",
          },
        ) as RetainedMotionControl;
        track(control);
      }
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
    snapshot,
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

export class PresentationDirector {
  private state: PresentationDirectorState;
  private cueKeys: readonly string[] = [];
  private readonly clock: PresentationClock;
  private animation: PresentationAnimationControlAdapter;
  private readonly listeners = new Set<() => void>();
  private timerId: number | null = null;
  private scheduledAt = 0;
  private remainingBaseMs = 0;
  private disposed = false;
  private waitingAtHydrationWatermark = false;
  private hasPlayed = false;

  constructor({
    clock = browserClock(),
    animation = NOOP_ANIMATION,
    reducedMotion = false,
    followTail = false,
  }: CreatePresentationDirectorOptions = {}) {
    this.clock = clock;
    this.animation = animation;
    this.state = {
      cues: [],
      cursor: 0,
      isPlaying: false,
      followTail,
      waitingAtTail: false,
      speed: 1,
      hydrationWatermark: null,
      reducedMotion,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PresentationDirectorSnapshot => {
    const cue = this.state.cues[this.state.cursor] ?? null;
    return {
      cueKeys: this.cueKeys,
      cursor: this.state.cursor,
      activeKey: cue?.key ?? null,
      canonicalSequence: cue?.canonicalSequence ?? null,
      round: cue?.round ?? null,
      isPlaying: this.state.isPlaying,
      followTail: this.state.followTail,
      waitingAtTail: this.state.waitingAtTail,
      speed: this.state.speed,
      hydrationWatermark: this.state.hydrationWatermark,
      bufferedCount: Math.max(0, this.state.cues.length - this.state.cursor - 1),
      reducedMotion: this.state.reducedMotion,
    };
  };

  getActiveCue(): PresentationCue | null {
    return this.state.cues[this.state.cursor] ?? null;
  }

  load(cues: readonly PresentationCue[]): void {
    if (this.disposed) return;
    const canonical = canonicalizeCues(cues);
    if (sameCueKeys(this.state.cues, canonical)) {
      this.ensureTimer();
      return;
    }
    const wasPlaying = this.state.isPlaying;
    this.clearTimer();
    this.waitingAtHydrationWatermark = false;
    this.apply({ type: "load", cues: canonical });
    this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    this.remainingBaseMs = this.activeDurationMs();
    if (wasPlaying) this.ensureTimer();
  }

  append(cues: readonly PresentationCue[]): void {
    if (this.disposed || cues.length === 0) return;
    const existingKeys = new Set(this.state.cues.map((cue) => cue.key));
    const watermark = this.state.hydrationWatermark;
    const additions = canonicalizeCues(cues).filter((cue) => {
      if (existingKeys.has(cue.key)) return false;
      return cue.source === "classic"
        || cue.canonicalSequence === null
        || watermark === null
        || cue.canonicalSequence > watermark;
    });
    if (additions.length === 0) return;

    const nextCues = canonicalizeCues([...this.state.cues, ...additions]);
    let nextCursor = this.state.cursor;
    if (this.waitingAtHydrationWatermark) {
      const firstNewKey = additions[0]!.key;
      nextCursor = nextCues.findIndex((cue) => cue.key === firstNewKey);
      this.waitingAtHydrationWatermark = false;
      this.remainingBaseMs = cueDurationMs(nextCues[nextCursor]);
    } else if (this.state.waitingAtTail && this.state.isPlaying) {
      const firstNewKey = additions[0]!.key;
      nextCursor = nextCues.findIndex((cue) => cue.key === firstNewKey);
      this.remainingBaseMs = cueDurationMs(nextCues[nextCursor]);
    }
    this.apply({ type: "append", cues: nextCues, cursor: nextCursor });
    if (this.state.waitingAtTail && this.state.isPlaying) {
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    }
    this.ensureTimer();
  }

  play(): void {
    if (this.disposed || this.state.cues.length === 0) return;
    if (!this.state.isPlaying) {
      this.apply({ type: "set_playing", isPlaying: true });
      if (this.hasPlayed) {
        this.animation.resume();
      } else {
        this.hasPlayed = true;
      }
    }
    if (
      this.state.waitingAtTail
      && this.state.cursor + 1 < this.state.cues.length
    ) {
      this.apply({ type: "set_cursor", cursor: this.state.cursor + 1 });
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
      this.remainingBaseMs = this.activeDurationMs();
    }
    if (this.remainingBaseMs <= 0) {
      this.remainingBaseMs = this.activeDurationMs();
    }
    this.ensureTimer();
  }

  pause(): void {
    if (this.disposed || !this.state.isPlaying) return;
    this.captureRemainingTime();
    this.clearTimer();
    this.apply({ type: "set_playing", isPlaying: false });
    this.animation.pause();
  }

  manualAdvance(): void {
    if (this.disposed || this.state.cues.length === 0) return;
    this.animation.complete();
    this.advanceOne();
  }

  setSpeed(speed: number): void {
    if (this.disposed || !Number.isFinite(speed) || speed <= 0 || speed === this.state.speed) {
      return;
    }
    this.captureRemainingTime();
    this.clearTimer();
    this.apply({ type: "set_speed", speed });
    this.animation.setSpeed(speed);
    this.ensureTimer();
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.disposed || reducedMotion === this.state.reducedMotion) return;
    this.apply({ type: "set_reduced_motion", reducedMotion });
  }

  setFollowTail(followTail: boolean): void {
    if (this.disposed || followTail === this.state.followTail) return;
    const wasWaitingAtTail = this.state.waitingAtTail;
    this.apply({ type: "set_follow_tail", followTail });
    if (!followTail && wasWaitingAtTail) {
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
      if (this.state.isPlaying) {
        this.apply({ type: "set_playing", isPlaying: false });
      }
    }
  }

  setAnimationAdapter(animation: PresentationAnimationControlAdapter): void {
    if (this.disposed) return;
    this.animation = animation;
    this.animation.setSpeed(this.state.speed);
  }

  seek(cursor: number): void {
    if (this.disposed || this.state.cues.length === 0) return;
    this.clearTimer();
    this.waitingAtHydrationWatermark = false;
    this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    this.apply({ type: "set_cursor", cursor });
    this.remainingBaseMs = this.activeDurationMs();
    this.ensureTimer();
  }

  reconnect(cues: readonly PresentationCue[]): void {
    if (this.disposed) return;
    const canonical = canonicalizeCues(cues);
    const activeKey = this.state.cues[this.state.cursor]?.key;
    const retainedCursor = activeKey
      ? canonical.findIndex((cue) => cue.key === activeKey)
      : -1;
    const cursor = retainedCursor >= 0
      ? retainedCursor
      : Math.max(0, canonical.length - 1);
    const watermark = highestCanonicalSequence(canonical);
    this.clearTimer();
    this.apply({ type: "hydrate", cues: canonical, cursor, watermark });
    this.remainingBaseMs = retainedCursor >= 0 ? this.activeDurationMs() : 0;
    this.waitingAtHydrationWatermark = retainedCursor < 0;
  }

  resetRound(cues: readonly PresentationCue[]): void {
    if (this.disposed) return;
    const canonical = canonicalizeCues(cues);
    this.clearTimer();
    this.apply({ type: "reset_round", cues: canonical });
    this.remainingBaseMs = this.activeDurationMs();
    this.waitingAtHydrationWatermark = false;
    this.ensureTimer();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.listeners.clear();
  }

  activate(): void {
    this.disposed = false;
  }

  private advanceOne(): void {
    this.clearTimer();
    const nextCursor = this.state.cursor + 1;
    if (nextCursor >= this.state.cues.length) {
      this.remainingBaseMs = 0;
      if (this.state.followTail) {
        this.apply({ type: "set_waiting_at_tail", waitingAtTail: true });
      } else {
        this.apply({ type: "set_playing", isPlaying: false });
      }
      return;
    }
    this.apply({ type: "set_cursor", cursor: nextCursor });
    this.remainingBaseMs = this.activeDurationMs();
    this.ensureTimer();
  }

  private activeDurationMs(): number {
    return cueDurationMs(this.state.cues[this.state.cursor]);
  }

  private ensureTimer(): void {
    if (
      this.disposed
      || this.timerId !== null
      || !this.state.isPlaying
      || this.state.waitingAtTail
      || this.waitingAtHydrationWatermark
      || !this.state.cues[this.state.cursor]
    ) {
      return;
    }
    if (this.remainingBaseMs < 0) this.remainingBaseMs = 0;
    this.scheduledAt = this.clock.now();
    this.timerId = this.clock.setTimeout(
      () => {
        this.timerId = null;
        this.remainingBaseMs = 0;
        this.advanceOne();
      },
      this.remainingBaseMs / this.state.speed,
    );
  }

  private captureRemainingTime(): void {
    if (this.timerId === null) return;
    const elapsedRealMs = Math.max(0, this.clock.now() - this.scheduledAt);
    this.remainingBaseMs = Math.max(
      0,
      this.remainingBaseMs - elapsedRealMs * this.state.speed,
    );
  }

  private clearTimer(): void {
    if (this.timerId === null) return;
    this.clock.clearTimeout(this.timerId);
    this.timerId = null;
  }

  private apply(action: PresentationDirectorAction): void {
    const next = reducePresentationDirectorState(this.state, action);
    if (next === this.state) return;
    if (next.cues !== this.state.cues) {
      this.cueKeys = next.cues.map((cue) => cue.key);
    }
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

function cueDurationMs(cue: PresentationCue | undefined): number {
  if (!cue) return 0;
  return Math.max(0, cue.baseDurationMs);
}

function canonicalizeCues(cues: readonly PresentationCue[]): PresentationCue[] {
  const byKey = new Map<string, PresentationCue>();
  for (const cue of cues) {
    if (!byKey.has(cue.key)) byKey.set(cue.key, cue);
  }
  return [...byKey.values()];
}

function highestCanonicalSequence(cues: readonly PresentationCue[]): number | null {
  let highest: number | null = null;
  for (const cue of cues) {
    if (cue.canonicalSequence === null) continue;
    highest = highest === null ? cue.canonicalSequence : Math.max(highest, cue.canonicalSequence);
  }
  return highest;
}

function sameCueKeys(
  left: readonly PresentationCue[],
  right: readonly PresentationCue[],
): boolean {
  return left.length === right.length
    && left.every((cue, index) => cue.key === right[index]?.key);
}

function clampCursor(cursor: number, cues: readonly PresentationCue[]): number {
  if (cues.length === 0) return 0;
  return Math.max(0, Math.min(cursor, cues.length - 1));
}

function browserClock(): PresentationClock {
  return {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
  };
}
