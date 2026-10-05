/** One shared clock; game adapters own interpretation, ordering and speech timing. */
export type ThinkingOrder = "thinking-first" | "speech-first";
export interface WatchCue { key: string; baseDurationMs: number }
export interface SpeechBoundaries { showAtMs: number; readAtMs: number; hideAtMs: number; hiddenAtMs: number }
export interface WatchPolicy<C extends WatchCue> {
  position(cue: C): number | null;
  speech(cue: C | null): SpeechBoundaries | null;
  /** Readable landing point shared by direct seeks and arrow-key cue steps. */
  scrubAtMs?(cue: C): number;
  isCatchUp(cue: C): boolean;
  acceptAtWatermark(cue: C, watermark: number): boolean;
  reconcile(cues: C[], active: C | null): C[];
}
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

interface PresentationDirectorState<C extends WatchCue> {
  cues: readonly C[];
  cursor: number;
  isPlaying: boolean;
  followTail: boolean;
  waitingAtTail: boolean;
  speed: number;
  hydrationWatermark: number | null;
  reducedMotion: boolean;
}

type PresentationDirectorAction<C extends WatchCue> =
  | { type: "load"; cues: readonly C[]; cursor?: number }
  | { type: "append"; cues: readonly C[]; cursor?: number }
  | { type: "set_playing"; isPlaying: boolean }
  | { type: "set_follow_tail"; followTail: boolean }
  | { type: "set_waiting_at_tail"; waitingAtTail: boolean }
  | { type: "set_cursor"; cursor: number }
  | { type: "set_speed"; speed: number }
  | { type: "set_reduced_motion"; reducedMotion: boolean }
  | { type: "hydrate"; cues: readonly C[]; cursor: number; watermark: number | null }
  | { type: "reset_round"; cues: readonly C[] };

export interface PresentationDirectorSnapshot {
  cueKeys: readonly string[];
  cursor: number;
  activeKey: string | null;
  position: number | null;
  isPlaying: boolean;
  followTail: boolean;
  waitingAtTail: boolean;
  speed: number;
  hydrationWatermark: number | null;
  bufferedCount: number;
  reducedMotion: boolean;
}

export interface CreatePresentationDirectorOptions<C extends WatchCue> {
  policy: WatchPolicy<C>;
  clock?: PresentationClock;
  animation?: PresentationAnimationControlAdapter;
  reducedMotion?: boolean;
  followTail?: boolean;
}

const NOOP_ANIMATION: PresentationAnimationControlAdapter = {
  pause() {},
  resume() {},
  complete() {},
  setSpeed() {},
};

function reducePresentationDirectorState<C extends WatchCue>(
  state: PresentationDirectorState<C>,
  action: PresentationDirectorAction<C>,
): PresentationDirectorState<C> {
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

export class PresentationDirector<C extends WatchCue> {
  private readonly policy: WatchPolicy<C>;
  private state: PresentationDirectorState<C>;
  private cueKeys: readonly string[] = [];
  private readonly clock: PresentationClock;
  private animation: PresentationAnimationControlAdapter;
  private readonly listeners = new Set<() => void>();
  private timerId: number | null = null;
  private scheduledAt = 0;
  private remainingBaseMs = 0;
  private disposed = false;
  private ready = true;
  private thinkingPending = false;
  private thought: {key: string; text: string; order: ThinkingOrder; duration: number; insertAt: number} | null = null;

  setThinkingPending(key: string, pending: boolean): void {
    if (key !== this.getActiveCue()?.key || this.thinkingPending === pending) return;
    this.captureRemainingTime(); this.clearTimer(); this.thinkingPending = pending; this.ensureTimer();
    for (const listener of this.listeners) listener();
  }

  setThinking(key: string, text: string | null, order: ThinkingOrder): void {
    if (key !== this.getActiveCue()?.key) return;
    this.setThinkingPending(key, false);
    const normalized = text?.trim() || null;
    if ((!normalized && !this.thought) || this.thought?.text === normalized && this.thought.order === order) return;
    this.captureRemainingTime(); this.clearTimer();
    const contentElapsed = this.getElapsedBaseMs();
    const speech = this.policy.speech(this.getActiveCue());
    this.thought = normalized ? {key, text: normalized, order,
      duration: Math.max(2800, normalized.split(/\s+/).length * 320),
      insertAt: order === "thinking-first" ? speech?.showAtMs ?? 0 : speech?.hiddenAtMs ?? this.getActiveCue()!.baseDurationMs,
    } : null;
    this.manualTransition = null; this.exitReadingPositionMs = null;
    this.remainingBaseMs = this.activeDurationMs() - (this.thought ? Math.min(contentElapsed, this.thought.insertAt) : contentElapsed);
    this.ensureTimer();
    for (const listener of this.listeners) listener();
  }

  getThinkingFrame() {
    const thought = this.thought;
    if (!thought || thought.key !== this.getActiveCue()?.key) return null;
    const timeline = this.getTimelineElapsedBaseMs();
    const elapsed = timeline - thought.insertAt;
    const speech = thought.order === "thinking-first" ? this.speechBoundaries() : null;
    const end = speech?.hiddenAtMs ?? thought.insertAt + thought.duration;
    if (elapsed < 0 || timeline >= end || this.state.waitingAtTail) return null;
    const opacity = speech && timeline > speech.hideAtMs
      ? Math.max(0, (speech.hiddenAtMs - timeline) / Math.max(1, speech.hiddenAtMs - speech.hideAtMs)) : 1;
    return {text: thought.text, elapsedMs: Math.min(elapsed, thought.duration), durationMs: thought.duration, opacity};
  }

  private contentTime(elapsed: number): number {
    const thought = this.thought;
    return !thought ? elapsed : elapsed <= thought.insertAt ? elapsed : Math.max(thought.insertAt, elapsed - thought.duration);
  }

  private speechBoundaries() {
    const speech = this.policy.speech(this.getActiveCue());
    if (!speech || !this.thought) return speech;
    const shift = (time: number) => time >= this.thought!.insertAt ? time + this.thought!.duration : time;
    return {showAtMs: shift(speech.showAtMs), readAtMs: shift(speech.readAtMs), hideAtMs: shift(speech.hideAtMs), hiddenAtMs: shift(speech.hiddenAtMs)};
  }


  setReady(key: string, ready: boolean): void {
    if (key !== this.getActiveCue()?.key || this.ready === ready) return;
    this.captureRemainingTime();
    this.clearTimer();
    this.ready = ready;
    this.ensureTimer();
    for (const listener of this.listeners) listener();
  }
  private waitingAtHydrationWatermark = false;
  private hasPlayed = false;
  private navigationRevision = 0;
  private manualTransition: { stopAtMs: number; advance: boolean } | null = null;
  private exitReadingPositionMs: number | null = null;

  /** Explicit seeks cut camera motion; timed and click-driven speech may pan. */
  getNavigationRevision(): number { return this.navigationRevision; }

  /** Click-requested fades run to a boundary even while playback is paused. */
  isAnimating(): boolean { return this.timerId !== null; }

  /** Skipping reading time must fade the visible page, not flash the final page. */
  getSpeechElapsedBaseMs(): number { return this.contentTime(this.exitReadingPositionMs ?? this.getTimelineElapsedBaseMs()); }

  constructor({
    clock = browserClock(),
    animation = NOOP_ANIMATION,
    reducedMotion = false,
    followTail = false,
    policy,
  }: CreatePresentationDirectorOptions<C>) {
    this.policy = policy;
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

  getSnapshot(): PresentationDirectorSnapshot {
    const cue = this.state.cues[this.state.cursor] ?? null;
    return {
      cueKeys: this.cueKeys,
      cursor: this.state.cursor,
      activeKey: cue?.key ?? null,
      position: cue ? this.policy.position(cue) : null,
      isPlaying: this.state.isPlaying,
      followTail: this.state.followTail,
      waitingAtTail: this.state.waitingAtTail,
      speed: this.state.speed,
      hydrationWatermark: this.state.hydrationWatermark,
      bufferedCount: Math.max(0, this.state.cues.length - this.state.cursor - 1),
      reducedMotion: this.state.reducedMotion,
    };
  };

  getActiveCue(): C | null {
    return this.state.cues[this.state.cursor] ?? null;
  }

  /** Base presentation time for timed overlays; freezes on pause and follows playback speed. */
  getElapsedBaseMs(): number { return this.contentTime(this.getTimelineElapsedBaseMs()); }

  private getTimelineElapsedBaseMs(): number {
    const duration = this.activeDurationMs();
    const elapsed = this.timerId === null ? 0 : Math.max(0, this.clock.now() - this.scheduledAt) * this.state.speed;
    return Math.max(0, Math.min(duration, duration - this.remainingBaseMs + elapsed));
  }

  load(cues: readonly C[], cursor = 0): void {
    if (this.disposed) return;
    const canonical = canonicalizeCues(cues);
    if (sameCueKeys(this.state.cues, canonical)) {
      this.ensureTimer();
      return;
    }
    const wasPlaying = this.state.isPlaying;
    this.clearTimer();
    this.manualTransition = null;
    this.exitReadingPositionMs = null;
    this.waitingAtHydrationWatermark = false;
    this.apply({ type: "load", cues: canonical, cursor });
    this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    this.remainingBaseMs = this.activeDurationMs();
    if (wasPlaying) this.ensureTimer();
  }

  append(cues: readonly C[]): void {
    if (this.disposed || cues.length === 0) return;
    const existingKeys = new Set(this.state.cues.map((cue) => cue.key));
    const activeKey = this.getActiveCue()?.key;
    const incoming = this.policy.reconcile(canonicalizeCues(cues), this.getActiveCue());
    // Reconcile the complete chronological timeline, including backfilled history.
    const nextCues = incoming;
    if (activeKey && !nextCues.some((cue) => cue.key === activeKey)) return;
    let nextCursor = Math.max(0, nextCues.findIndex((cue) => cue.key === activeKey));
    const watermark = this.state.hydrationWatermark;
    const firstNewIndex = nextCues.findIndex((cue, index) =>
      index > nextCursor
      && !existingKeys.has(cue.key)
      && !this.policy.isCatchUp(cue)
      && (watermark === null || this.policy.position(cue) === null
        || (this.policy.position(cue) ?? 0) > watermark
        || this.policy.acceptAtWatermark(cue, watermark)),
    );
    if (firstNewIndex >= 0 && this.state.isPlaying
      && (this.waitingAtHydrationWatermark || this.state.waitingAtTail)) {
      nextCursor = firstNewIndex;
      this.exitReadingPositionMs = null;
      this.waitingAtHydrationWatermark = false;
      this.remainingBaseMs = cueDurationMs(nextCues[nextCursor]);
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    }
    this.apply({ type: "append", cues: nextCues, cursor: nextCursor });
    this.ensureTimer();
  }

  play(): void {
    if (this.disposed || this.state.cues.length === 0) return;
    if (this.manualTransition) {
      this.captureRemainingTime();
      this.clearTimer();
      this.manualTransition = null;
    }
    if (!this.state.isPlaying) {
      this.apply({ type: "set_playing", isPlaying: true });
      if (this.hasPlayed) {
        this.animation.resume();
      } else {
        this.hasPlayed = true;
      }
    }
    if (this.waitingAtHydrationWatermark) {
      const next = this.state.cues.findIndex((cue, index) => index > this.state.cursor
        && !this.policy.isCatchUp(cue));
      if (next >= 0) {
        this.waitingAtHydrationWatermark = false;
        this.exitReadingPositionMs = null;
        this.apply({ type: "set_cursor", cursor: next });
        this.remainingBaseMs = this.activeDurationMs();
      }
    }
    if (
      this.state.waitingAtTail
      && this.state.cursor + 1 < this.state.cues.length
    ) {
      this.exitReadingPositionMs = null;
      this.apply({ type: "set_cursor", cursor: this.state.cursor + 1 });
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
      this.remainingBaseMs = this.activeDurationMs();
    }
    if (this.remainingBaseMs <= 0 && !this.state.waitingAtTail) {
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
    // Repeated clicks cannot discard either fade or the clear scene between lines.
    if (this.manualTransition) return;
    if (this.state.waitingAtTail || this.waitingAtHydrationWatermark) {
      if (this.state.cursor + 1 >= this.state.cues.length) return;
      this.waitingAtHydrationWatermark = false;
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
      this.advanceOne();
      const nextSpeech = this.speechBoundaries();
      if (!this.state.isPlaying && nextSpeech) this.transitionWhilePaused(0, nextSpeech.readAtMs);
      return;
    }
    if (this.thought) {
      const elapsed = this.getTimelineElapsedBaseMs();
      if (this.thought.order === "thinking-first" && elapsed < this.thought.insertAt) {
        this.positionWithinCue(this.thought.insertAt);
        return;
      }
      if (elapsed < this.thought.insertAt + this.thought.duration && elapsed >= this.thought.insertAt) {
        this.positionWithinCue(this.thought.insertAt + this.thought.duration);
        return;
      }
    }
    const speech = this.speechBoundaries();
    if (speech) {
      const elapsed = this.getTimelineElapsedBaseMs();
      if (this.thought?.order === "speech-first" && elapsed >= speech.readAtMs && elapsed < this.thought.insertAt) {
        this.positionWithinCue(this.thought.insertAt);
        return;
      }
      if (elapsed < speech.readAtMs) {
        if (this.state.isPlaying) {
          if (elapsed < speech.showAtMs) this.positionWithinCue(speech.showAtMs);
        } else {
          this.transitionWhilePaused(Math.max(elapsed, speech.showAtMs), speech.readAtMs);
        }
        return;
      }
      if (elapsed < speech.hiddenAtMs) {
        this.exitReadingPositionMs ??= elapsed;
        if (this.state.isPlaying) {
          if (elapsed < speech.hideAtMs) this.positionWithinCue(speech.hideAtMs);
        } else {
          this.transitionWhilePaused(Math.max(elapsed, speech.hideAtMs), speech.hiddenAtMs);
        }
        return;
      }
      if (this.state.isPlaying) return;
      // Keep the final image available for a snapshot until more content exists.
      if (this.state.cursor + 1 >= this.state.cues.length) return;
      this.transitionWhilePaused(elapsed, this.activeDurationMs(), true);
      return;
    }
    this.navigationRevision++;
    this.animation.complete();
    this.advanceOne(true);
  }

  private transitionWhilePaused(fromMs: number, stopAtMs: number, advance = false): void {
    this.clearTimer();
    this.manualTransition = { stopAtMs, advance };
    this.positionWithinCue(fromMs);
  }

  private positionWithinCue(elapsedMs: number): void {
    this.clearTimer();
    this.remainingBaseMs = Math.max(0, this.activeDurationMs() - elapsedMs);
    this.ensureTimer();
    for (const listener of this.listeners) listener();
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
    this.navigationRevision++;
    if (this.disposed || this.state.cues.length === 0) return;
    this.clearTimer();
    this.manualTransition = null;
    this.exitReadingPositionMs = null;
    this.waitingAtHydrationWatermark = false;
    // A seek is an immediate cut. Complete retained entrance effects before
    // publishing the next cue so the old scene cannot animate over the new one.
    this.animation.complete();
    this.apply({ type: "set_waiting_at_tail", waitingAtTail: false });
    this.apply({ type: "set_cursor", cursor });
    this.positionWithinCue(this.thought ? 0 : this.policy.scrubAtMs?.(this.state.cues[cursor]!) ?? this.speechBoundaries()?.showAtMs ?? 0);
  }

  reconnect(cues: readonly C[]): void {
    if (this.disposed) return;
    const wasWaitingAtTail = this.state.waitingAtTail;
    const canonical = this.policy.reconcile(canonicalizeCues(cues), this.getActiveCue());
    const activeKey = this.state.cues[this.state.cursor]?.key;
    const retainedCursor = activeKey ? canonical.findIndex((cue) => cue.key === activeKey) : -1;
    const cursor = retainedCursor >= 0 ? retainedCursor : Math.max(0, canonical.length - 1);
    const watermark = highestPosition(canonical, this.policy);
    this.captureRemainingTime();
    this.clearTimer();
    this.apply({ type: "hydrate", cues: canonical, cursor, watermark });
    if (wasWaitingAtTail && retainedCursor >= 0) {
      this.apply({ type: "set_waiting_at_tail", waitingAtTail: true });
    }
    if (retainedCursor < 0) this.remainingBaseMs = 0;
    if (retainedCursor < 0) {
      this.manualTransition = null;
      this.exitReadingPositionMs = null;
    }
    this.waitingAtHydrationWatermark = retainedCursor < 0;
    if (this.manualTransition) this.ensureTimer();
  }

  resetRound(cues: readonly C[]): void {
    if (this.disposed) return;
    const canonical = canonicalizeCues(cues);
    this.clearTimer();
    this.manualTransition = null;
    this.exitReadingPositionMs = null;
    this.apply({ type: "reset_round", cues: canonical });
    this.remainingBaseMs = this.activeDurationMs();
    this.waitingAtHydrationWatermark = false;
    this.ensureTimer();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.manualTransition = null;
    this.listeners.clear();
  }

  activate(): void {
    this.disposed = false;
  }

  private advanceOne(manual = false): void {
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
    this.exitReadingPositionMs = null;
    this.positionWithinCue(manual ? this.policy.scrubAtMs?.(this.state.cues[nextCursor]!) ?? this.speechBoundaries()?.showAtMs ?? 0 : 0);
  }

  private activeDurationMs(): number {
    return cueDurationMs(this.state.cues[this.state.cursor]) + (this.thought?.duration ?? 0);
  }

  private ensureTimer(): void {
    if (
      this.disposed
      || !this.ready
      || this.thinkingPending
      || this.timerId !== null
      || (!this.state.isPlaying && !this.manualTransition)
      || this.state.waitingAtTail
      || this.waitingAtHydrationWatermark
      || !this.state.cues[this.state.cursor]
    ) {
      return;
    }
    if (this.remainingBaseMs < 0) this.remainingBaseMs = 0;
    const transition = this.manualTransition;
    const remainingMs = transition
      ? Math.max(0, transition.stopAtMs - (this.activeDurationMs() - this.remainingBaseMs))
      : this.remainingBaseMs;
    this.scheduledAt = this.clock.now();
    this.timerId = this.clock.setTimeout(
      () => {
        this.timerId = null;
        if (transition) {
          this.manualTransition = null;
          this.remainingBaseMs = Math.max(0, this.activeDurationMs() - transition.stopAtMs);
          if (transition.advance) {
            this.advanceOne();
            const nextSpeech = this.speechBoundaries();
            if (nextSpeech) this.transitionWhilePaused(0, nextSpeech.readAtMs);
          }
          for (const listener of this.listeners) listener();
          return;
        }
        this.remainingBaseMs = 0;
        this.advanceOne();
      },
      remainingMs / this.state.speed,
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

  private apply(action: PresentationDirectorAction<C>): void {
    const next = reducePresentationDirectorState<C>(this.state, action);
    if (next === this.state) return;
    if (next.cues !== this.state.cues) {
      this.cueKeys = next.cues.map((cue) => cue.key);
    }
    if (next.cues[next.cursor]?.key !== this.state.cues[this.state.cursor]?.key) { this.ready = true; this.thought = null; this.thinkingPending = false; }
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

function cueDurationMs<C extends WatchCue>(cue: C | undefined): number {
  if (!cue) return 0;
  return Math.max(0, cue.baseDurationMs);
}

function canonicalizeCues<C extends WatchCue>(cues: readonly C[]): C[] {
  const byKey = new Map<string, C>();
  for (const cue of cues) {
    if (!byKey.has(cue.key)) byKey.set(cue.key, cue);
  }
  return [...byKey.values()];
}

function highestPosition<C extends WatchCue>(cues: readonly C[], policy: WatchPolicy<C>): number | null {
  let highest: number | null = null;
  for (const cue of cues) {
    const position = policy.position(cue);
    if (position === null) continue;
    highest = highest === null ? position : Math.max(highest, position);
  }
  return highest;
}

function sameCueKeys<C extends WatchCue>(
  left: readonly C[],
  right: readonly C[],
): boolean {
  return left.length === right.length
    && left.every((cue, index) => cue.key === right[index]?.key);
}

function clampCursor<C extends WatchCue>(cursor: number, cues: readonly C[]): number {
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

