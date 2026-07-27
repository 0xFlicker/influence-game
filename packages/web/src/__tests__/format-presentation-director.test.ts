import { describe, expect, it } from "bun:test";
import {
  createPresentationDirector,
  type PresentationAnimationControlAdapter,
  type PresentationClock,
} from "../app/games/[slug]/components/format-presentation-director";
import type { PresentationCue } from "../app/games/[slug]/components/types";

class FakeClock implements PresentationClock {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { dueAt: number; callback: () => void }>();

  now = () => this.nowMs;
  setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.nowMs + delayMs, callback });
    return id;
  };
  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  tick(ms: number) {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) break;
      this.nowMs = due[1].dueAt;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.nowMs = target;
  }
}

class FakeAnimationAdapter implements PresentationAnimationControlAdapter {
  pauses = 0;
  resumes = 0;
  completes = 0;
  speeds: number[] = [];

  pause() {
    this.pauses += 1;
  }
  resume() {
    this.resumes += 1;
  }
  complete() {
    this.completes += 1;
  }
  setSpeed(speed: number) {
    this.speeds.push(speed);
  }
}

function cue(
  key: string,
  sequence: number | null,
  round = 1,
  source: "classic" | "format" = "format",
): PresentationCue {
  if (source === "classic") {
    return {
      source,
      key,
      canonicalSequence: sequence,
      round,
      phase: "LOBBY",
      kind: "classic_transcript",
      stage: "done",
      baseDurationMs: 1_000,
      sceneIndex: sequence ?? 0,
      messageIndex: 0,
    };
  }
  return {
    source,
    key,
    canonicalSequence: sequence ?? 0,
    round,
    phase: "FORMAT_MENU",
    kind: "format_menu",
    baseDurationMs: 1_000,
    before: {
      round,
      phase: "FORMAT_MENU",
      canonicalSequence: Math.max(0, (sequence ?? 0) - 1),
      empoweredId: null,
      empoweredTally: null,
      offeredFormatIds: null,
      activeFormatId: null,
      safetyBounce: null,
      resolution: null,
      revealedBallots: [],
      eliminatedId: null,
    },
    after: {
      round,
      phase: "FORMAT_MENU",
      canonicalSequence: sequence ?? 0,
      empoweredId: "atlas",
      empoweredTally: null,
      offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
      activeFormatId: null,
      safetyBounce: null,
      resolution: null,
      revealedBallots: [],
      eliminatedId: null,
    },
    empoweredId: "atlas",
    offeredFormatIds: ["save_or_eliminate", "vote_bomb"],
  };
}

describe("presentation director", () => {
  it("uses one fake-clock timer for classic and format cues", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock });
    director.load([
      cue("classic:1", null, 1, "classic"),
      cue("game:10:menu", 10),
    ]);
    director.play();

    expect(clock.timers.size).toBe(1);
    clock.tick(1_000);
    expect(director.getSnapshot()).toMatchObject({
      cursor: 1,
      activeKey: "game:10:menu",
      canonicalSequence: 10,
    });
    expect(clock.timers.size).toBe(1);
  });

  it("pauses with remaining time and resumes buffered cues in order", () => {
    const clock = new FakeClock();
    const animation = new FakeAnimationAdapter();
    const director = createPresentationDirector({ clock, animation });
    director.load([cue("game:10", 10), cue("game:12", 12), cue("game:14", 14)]);
    director.play();
    clock.tick(400);
    director.pause();
    director.append([cue("game:16", 16)]);
    clock.tick(10_000);

    expect(director.getSnapshot()).toMatchObject({
      isPlaying: false,
      cursor: 0,
      bufferedCount: 3,
    });
    expect(animation.pauses).toBe(1);

    director.play();
    expect(animation.resumes).toBe(1);
    clock.tick(599);
    expect(director.getSnapshot().cursor).toBe(0);
    clock.tick(1);
    expect(director.getSnapshot().cursor).toBe(1);
  });

  it("manual-completes the active animation and advances exactly one cue", () => {
    const clock = new FakeClock();
    const animation = new FakeAnimationAdapter();
    const director = createPresentationDirector({ clock, animation });
    director.load([cue("game:10", 10), cue("game:12", 12), cue("game:14", 14)]);
    director.play();

    director.manualAdvance();

    expect(animation.completes).toBe(1);
    expect(director.getSnapshot()).toMatchObject({
      cursor: 1,
      canonicalSequence: 12,
    });
    expect(clock.timers.size).toBe(1);
  });

  it("changes duration without changing cue membership or order", () => {
    const clock = new FakeClock();
    const animation = new FakeAnimationAdapter();
    const cues = [cue("game:10", 10), cue("game:12", 12), cue("game:14", 14)];
    const director = createPresentationDirector({ clock, animation });
    director.load(cues);
    director.play();
    clock.tick(250);
    director.setSpeed(2);

    expect(director.getSnapshot().cueKeys).toEqual(cues.map((item) => item.key));
    expect(animation.speeds).toEqual([2]);
    clock.tick(374);
    expect(director.getSnapshot().cursor).toBe(0);
    clock.tick(1);
    expect(director.getSnapshot().cursor).toBe(1);
  });

  it("snaps reconnect hydration to the latest complete cue and animates only higher sequences", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock });
    director.load([cue("game:10", 10), cue("game:12", 12)]);
    director.play();
    director.reconnect([cue("game:10", 10), cue("game:12", 12), cue("game:20", 20)]);

    expect(director.getSnapshot()).toMatchObject({
      cursor: 2,
      activeKey: "game:20",
      canonicalSequence: 20,
      hydrationWatermark: 20,
      isPlaying: true,
    });
    expect(clock.timers.size).toBe(0);

    director.append([cue("game:18", 18), cue("game:20", 20), cue("game:22", 22)]);
    expect(director.getSnapshot().cueKeys).toEqual([
      "game:10",
      "game:12",
      "game:20",
      "game:22",
    ]);
    expect(clock.timers.size).toBe(1);
    clock.tick(1_000);
    expect(director.getSnapshot().canonicalSequence).toBe(22);
  });

  it("retains unseen social cues anchored at the hydration watermark", () => {
    const director = createPresentationDirector();
    director.reconnect([cue("game:20", 20)]);

    director.append([cue("social:20", 20, 1, "classic")]);

    expect(director.getSnapshot().cueKeys).toEqual([
      "game:20",
      "social:20",
    ]);
  });

  it("follows separate live batches while remaining logically playing at the natural tail", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock, followTail: true });
    director.reconnect([cue("game:10", 10)]);
    director.play();

    director.append([cue("game:12", 12)]);
    expect(director.getSnapshot()).toMatchObject({
      activeKey: "game:12",
      isPlaying: true,
      waitingAtTail: false,
    });
    expect(clock.timers.size).toBe(1);

    clock.tick(1_000);
    expect(director.getSnapshot()).toMatchObject({
      activeKey: "game:12",
      isPlaying: true,
      waitingAtTail: true,
    });
    expect(clock.timers.size).toBe(0);

    director.append([cue("game:14", 14)]);
    expect(director.getSnapshot()).toMatchObject({
      activeKey: "game:14",
      isPlaying: true,
      waitingAtTail: false,
    });
    expect(clock.timers.size).toBe(1);
  });

  it("buffers a live append while manually paused at the tail until resume", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock, followTail: true });
    director.reconnect([cue("game:10", 10)]);
    director.play();
    director.append([cue("game:12", 12)]);
    clock.tick(1_000);

    director.pause();
    director.append([cue("game:14", 14)]);
    expect(director.getSnapshot()).toMatchObject({
      activeKey: "game:12",
      cursor: 1,
      bufferedCount: 1,
      isPlaying: false,
      waitingAtTail: true,
    });
    expect(clock.timers.size).toBe(0);

    director.play();
    expect(director.getSnapshot()).toMatchObject({
      activeKey: "game:14",
      cursor: 2,
      bufferedCount: 0,
      isPlaying: true,
      waitingAtTail: false,
    });
    expect(clock.timers.size).toBe(1);
  });

  it("resets round-local state before any new-round timer starts", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock });
    director.load([cue("game:10", 10), cue("game:12", 12)]);
    director.play();
    director.resetRound([cue("game:30", 30, 2)]);

    expect(director.getSnapshot()).toMatchObject({
      cursor: 0,
      round: 2,
      activeKey: "game:30",
      canonicalSequence: 30,
    });
    expect(director.getSnapshot().cueKeys).toEqual(["game:30"]);
    expect(clock.timers.size).toBe(1);
  });

  it("preserves readable semantic dwell and cue order under reduced motion", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({
      clock,
      reducedMotion: true,
    });
    director.load([cue("game:10", 10), cue("game:12", 12)]);
    director.play();

    expect(director.getSnapshot().cueKeys).toEqual(["game:10", "game:12"]);
    expect(clock.timers.size).toBe(1);
    clock.tick(0);
    expect(director.getSnapshot().cursor).toBe(0);
    clock.tick(999);
    expect(director.getSnapshot().cursor).toBe(0);
    clock.tick(1);
    expect(director.getSnapshot().cursor).toBe(1);
  });

  it("is idempotent across Strict Mode-style repeated loads and disposals", () => {
    const clock = new FakeClock();
    const director = createPresentationDirector({ clock });
    const cues = [cue("game:10", 10), cue("game:12", 12)];
    director.load(cues);
    director.play();
    director.load(cues);
    director.play();

    expect(clock.timers.size).toBe(1);
    expect(director.getSnapshot().cueKeys).toEqual(["game:10", "game:12"]);
    director.dispose();
    director.dispose();
    expect(clock.timers.size).toBe(0);
  });
});
