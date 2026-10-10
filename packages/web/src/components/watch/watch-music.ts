/** A game supplies visible sections; the House owns all audio transport. */
export interface MusicSection {
  key: string; src: string; title: string; repeat: boolean;
  /** Keep playing over the final replay frame until the track ends naturally. */
  continueAtEnd?: boolean;
}
export type MusicStatus = "idle" | "loading" | "playing" | "blocked" | "unavailable";
export interface MusicDeck {
  time: number; readonly duration: number; readonly ready: boolean; readonly ended: boolean; readonly failed: boolean;
  load(src: string): void; play(): Promise<void>; pause(): void; gain(value: number): void; dispose(): void;
}
export interface MusicOutput {
  decks: [MusicDeck, MusicDeck]; readonly time: number;
  resume(): Promise<void>; master(value: number): void; dispose(): void;
}
export interface MusicInput {
  section: MusicSection | null; playing: boolean; muted: boolean; volume: number;
  /** Transport fade, used while waiting for new live moments. */
  fadeGain?: number;
}

const FADE_SECONDS = 0.7;
const ownership: {current: WatchMusic | null} = {current: null};

/** Two streaming decks, one audio clock. No game clock, DOM inspection or persisted offsets. */
export class WatchMusic {
  private output: MusicOutput | null = null;
  private input: MusicInput = {section: null, playing: false, muted: true, volume: 0.3};
  private selected: MusicSection | null = null;
  private active: 0 | 1 = 0;
  private loaded: [boolean, boolean] = [false, false];
  private fade: {from: 0 | 1 | null; to: 0 | 1 | null; elapsed: number; duration: number} | null = null;
  private version = 0;
  private pending = false;
  private running = false;
  private disposed = false;
  private superseded = false;
  private lastTime = 0;
  private status: MusicStatus = "idle";
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly create: () => MusicOutput, private readonly changed: (status: MusicStatus) => void,
    private readonly automaticTick = true) {}

  private report(status: MusicStatus) { if (this.status !== status) { this.status = status; this.changed(status); } }
  private silence() {
    this.version++; this.pending = false; this.running = false;
    if (this.output) { this.output.master(0); for (const deck of this.output.decks) deck.pause(); }
  }
  /** Pause immediately in a pointer/seek handler, before React commits its state. */
  suspend() { this.input = {...this.input, playing: false}; this.silence(); }
  restart() {
    this.silence(); this.selected = null; this.loaded = [false, false]; this.fade = null;
    if (this.output) for (const deck of this.output.decks) {deck.gain(0); deck.time = 0;}
  }
  update(input: MusicInput) {
    if (this.disposed) return;
    const wasPlaying = this.input.playing;
    this.input = input;
    if (!input.playing && wasPlaying) this.silence();
    // Don't allocate/download on first-visit mute. Once unlocked, mute preserves media time.
    if (!this.output && this.status === "unavailable") return;
    if (!this.output && !input.muted && input.playing && input.section) {
      try {
        this.output = this.create();
        if (this.automaticTick) this.interval = setInterval(() => this.tick(), 40);
      } catch { this.report("unavailable"); return; }
    }
    if (!this.output) return;
    if (this.selected?.key !== input.section?.key) this.select(input.section);
    if (input.playing && !input.muted && !this.superseded) this.claim();
    this.applyMaster();
    if (input.playing && (this.loaded.some(Boolean))) this.start();
  }
  /** Called directly from Music/Play gestures; browser denial is not a mute preference. */
  unlock() {
    if (this.disposed) return;
    if (this.status === "unavailable") { this.restart(); }
    if (!this.output) {
      try {this.output = this.create(); if (this.automaticTick) this.interval = setInterval(() => this.tick(), 40);}
      catch {this.report("unavailable"); return;}
    }
    this.superseded = false;
    this.report("idle");
    this.update(this.input);
    // Resume inside the gesture even if the visual transport is paused.
    if (this.output && !this.input.playing) {
      const version = this.version;
      void this.output.resume().catch(() => {if (!this.disposed && version === this.version) this.report("blocked");});
    }
  }
  private select(section: MusicSection | null) {
    if (!this.output) return;
    this.version++; this.pending = false; this.running = false;
    // A rapid new transition retires the oldest deck; never creates a third one.
    if (this.fade?.from !== null && this.fade?.from !== undefined) this.retire(this.fade.from);
    const from = this.loaded[this.active] ? this.active : null;
    const to = section ? (this.active === 0 ? 1 : 0) : null;
    this.selected = section;
    if (to !== null && section) {
      this.retire(to);
      this.output.decks[to].load(section.src);
      this.loaded[to] = true;
      this.active = to;
      if (this.status !== "blocked") this.report("loading");
    }
    this.fade = {from, to, elapsed: 0, duration: from === null ? 0.1 : FADE_SECONDS};
    this.lastTime = this.output.time;
    // A seek while paused changes the selection without playing its opening.
    if (!this.input.playing) { if (from !== null) this.retire(from); this.fade.from = null; }
  }
  private retire(index: 0 | 1) {
    this.output?.decks[index].pause(); this.output?.decks[index].gain(0); this.loaded[index] = false;
  }
  private claim() {
    if (ownership.current && ownership.current !== this) {ownership.current.superseded = true; ownership.current.suspend();}
    ownership.current = this;
  }
  private applyMaster() {
    this.output?.master(this.input.playing && !this.input.muted && !this.superseded ? this.input.volume * (this.input.fadeGain ?? 1) : 0);
  }
  private start() {
    if (!this.output || this.pending || this.status === "blocked" || this.status === "unavailable") return;
    if (this.running || this.superseded || this.selected && !this.selected.repeat && this.output.decks[this.active].ended) return;
    const output = this.output, version = this.version;
    this.pending = true;
    // Audible ownership is local to this document, never a cross-tab election.
    if (!this.input.muted) this.claim();
    const starts = output.decks.flatMap((deck, index) => this.loaded[index] && !deck.ended ? [deck.play()] : []);
    void Promise.all([output.resume(), ...starts]).then(() => {
      if (this.disposed || !this.input.playing) {for (const deck of output.decks) deck.pause(); return;}
      if (version !== this.version) return;
      this.running = true; this.pending = false; this.lastTime = output.time;
      this.report(this.selected ? "playing" : "idle");
    }).catch((error: unknown) => {
      if (this.disposed || version !== this.version) return;
      this.silence();
      this.report(error instanceof Error && error.name === "NotAllowedError" ? "blocked" : "unavailable");
    });
  }
  /** Uses the audio clock, not React renders; exposed for deterministic clock tests. */
  tick() {
    if (!this.output || !this.input.playing || !this.running || this.disposed) return;
    const output = this.output;
    if (output.decks.some((deck, index) => this.loaded[index] && deck.failed)) {this.silence(); this.report("unavailable"); return;}
    const dt = Math.max(0, output.time - this.lastTime); this.lastTime = output.time;
    const fade = this.fade;
    if (fade) {
      if (fade.to !== null && !output.decks[fade.to].ready) return;
      fade.elapsed = Math.min(fade.duration, fade.elapsed + dt);
      const amount = fade.elapsed / fade.duration;
      if (fade.from !== null) output.decks[fade.from].gain(1 - amount);
      if (fade.to !== null) output.decks[fade.to].gain(amount);
      if (amount === 1) { if (fade.from !== null) this.retire(fade.from); this.fade = null; }
    } else {
      const deck = output.decks[this.active];
      if (this.selected?.repeat && Number.isFinite(deck.duration) && deck.duration > 0 && deck.duration - deck.time <= FADE_SECONDS) {
        // Reuse the idle deck. If late, the outgoing track may finish before the new one loads.
        const section = this.selected;
        this.select(section); this.start();
      } else if (deck.ended && !this.selected?.repeat) { this.silence(); this.report("idle"); }
    }
  }
  dispose() {
    this.disposed = true; this.silence();
    if (this.interval !== null) clearInterval(this.interval);
    this.output?.dispose(); this.output = null;
    if (ownership.current === this) ownership.current = null;
  }
}

/** Streams packaged same-origin files; one context serves exactly two media elements. */
export function createBrowserMusicOutput(): MusicOutput {
  const context = new AudioContext();
  const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
  const decks = [0, 1].map((): MusicDeck => {
    const audio = new Audio(); audio.preload = "auto";
    const source = context.createMediaElementSource(audio), gain = context.createGain();
    gain.gain.value = 0; source.connect(gain); gain.connect(master);
    return {
      get time() { return audio.currentTime; }, set time(value) { audio.currentTime = value; },
      get duration() { return audio.duration; }, get ready() { return audio.readyState >= 3; }, get ended() {return audio.ended;}, get failed() {return audio.error !== null;},
      load(src) { audio.src = src; audio.load(); },
      play: () => audio.play(), pause: () => audio.pause(),
      gain(value) { gain.gain.setTargetAtTime(value, context.currentTime, 0.008); },
      dispose() { audio.pause(); audio.removeAttribute("src"); audio.load(); source.disconnect(); gain.disconnect(); },
    };
  }) as [MusicDeck, MusicDeck];
  return {decks, get time() {return context.currentTime;},
    resume: async () => {
      // A blocked resume can remain pending indefinitely. Surface it instead of claiming sound is on.
      const resume = context.resume();
      if (context.state !== "running") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([resume, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new DOMException("Enable music to play sound", "NotAllowedError")), 1200);})]); }
        finally { if (timer !== undefined) clearTimeout(timer); }
      } else await resume;
    },
    master(value) { master.gain.setTargetAtTime(value, context.currentTime, value === 0 ? 0.003 : 0.025); },
    dispose() { for (const deck of decks) deck.dispose(); master.disconnect(); void context.close().catch(error => console.warn("Music context could not close", error)); },
  };
}
