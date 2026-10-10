import {
  thoughtTiming,
  sampleThought,
  type SpeechBoundaries,
  type ThoughtTiming,
} from "../../components/watch/thinking-timing";

export interface TimingAdjustments {
  readingRate?: number;
  thinkingRate?: number;
  conversationGapMs?: number;
  ballotHoldMs?: number;
  tallyHoldMs?: number;
  establishingHoldMs?: number;
  motionScale?: number;
  postSpeechHoldMs?: number;
}
export interface TimingProfile extends TimingAdjustments {
  ending: "finish-score" | { holdMs: number };
  overrides: Record<string, TimingAdjustments>;
}
export interface SpeechRecording {
  assetId: string;
  durationMs: number;
}
export interface TimingInput {
  key: string;
  baseDurationMs: number;
  kind: "opening" | "speech" | "ballot" | "tally" | "scene" | "result";
  speech: SpeechBoundaries | null;
  thinking: string | null;
  recording?: SpeechRecording;
}
export interface TimeSegment {
  kind:
    | "establish"
    | "entrance"
    | "reading"
    | "exit"
    | "hold"
    | "thinking"
    | "gap";
  startMs: number;
  endMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
}
export interface CompiledTiming {
  key: string;
  startMs: number;
  endMs: number;
  startFrame: number;
  endFrame: number;
  segments: TimeSegment[];
  thought: ThoughtTiming | null;
  speech: SpeechBoundaries | null;
  recording?: SpeechRecording & { startMs: number };
}

const keys = [
  "readingRate",
  "thinkingRate",
  "conversationGapMs",
  "ballotHoldMs",
  "tallyHoldMs",
  "establishingHoldMs",
  "motionScale",
  "postSpeechHoldMs",
] as const;
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function adjustments(value: unknown): TimingAdjustments {
  const input = record(value, "Timing adjustments");
  for (const [key, amount] of Object.entries(input)) {
    if (!keys.some((allowed) => allowed === key))
      throw new Error(`Unknown timing field: ${key}`);
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      ((key.endsWith("Rate") || key === "motionScale") && amount === 0)
    )
      throw new Error(`Invalid timing value: ${key}`);
  }
  return input as TimingAdjustments;
}
/** Undefined means preserve the game's existing timing, not a new global preset. */
export function parseTimingProfile(value: unknown = {}): TimingProfile {
  const input = { ...record(value, "Timing profile") };
  const ending = input.ending ?? "finish-score";
  const overrides = record(input.overrides ?? {}, "Cue overrides");
  delete input.ending;
  delete input.overrides;
  if (ending !== "finish-score") {
    const fixed = record(ending, "Ending");
    if (
      Object.keys(fixed).length !== 1 ||
      typeof fixed.holdMs !== "number" ||
      !Number.isFinite(fixed.holdMs) ||
      fixed.holdMs < 0
    )
      throw new Error("Ending requires a nonnegative holdMs");
  }
  return {
    ...adjustments(input),
    ending: ending as TimingProfile["ending"],
    overrides: Object.fromEntries(
      Object.entries(overrides).map(([key, settings]) => [
        key,
        adjustments(settings),
      ]),
    ),
  };
}

/** Compile absolute boundaries before rounding. No drift from per-cue frame rounding. */
export function compileTiming(
  inputs: readonly TimingInput[],
  profile: TimingProfile,
  fps: number,
): CompiledTiming[] {
  if (!Number.isSafeInteger(fps) || fps < 1 || fps > 120)
    throw new Error("FPS must be an integer from 1 to 120");
  const cueKeys = new Set(inputs.map((cue) => cue.key));
  if (cueKeys.size !== inputs.length) throw new Error("Duplicate cue keys");
  for (const key of Object.keys(profile.overrides))
    if (!cueKeys.has(key)) throw new Error(`Unknown override cue: ${key}`);
  let cursor = 0;
  return inputs.map((input) => {
    if (!Number.isFinite(input.baseDurationMs) || input.baseDurationMs <= 0)
      throw new Error(`Invalid duration: ${input.key}`);
    const settings = { ...profile, ...profile.overrides[input.key] };
    const speech = input.speech;
    if (
      speech &&
      !(
        0 <= speech.showAtMs &&
        speech.showAtMs <= speech.readAtMs &&
        speech.readAtMs <= speech.hideAtMs &&
        speech.hideAtMs <= speech.hiddenAtMs &&
        speech.hiddenAtMs <= input.baseDurationMs
      )
    )
      throw new Error(`Invalid speech boundaries: ${input.key}`);
    if (
      input.recording &&
      (!speech ||
        !Number.isFinite(input.recording.durationMs) ||
        input.recording.durationMs <= 0)
    )
      throw new Error(
        `Recording requires a spoken cue and positive duration: ${input.key}`,
      );
    const segments: TimeSegment[] = [];
    let time = 0;
    const add = (
      kind: TimeSegment["kind"],
      from: number,
      to: number,
      duration: number,
    ) => {
      if (!Number.isFinite(duration) || duration < 0)
        throw new Error(`Invalid ${kind} duration: ${input.key}`);
      segments.push({
        kind,
        startMs: time,
        endMs: time + duration,
        sourceStartMs: from,
        sourceEndMs: to,
      });
      time += duration;
    };
    const motion = settings.motionScale ?? 1;
    const thought = thoughtTiming(input.thinking, speech, {readingRate: settings.thinkingRate, motionScale: motion});
    const thoughtDuration = thought?.duration ?? 0;
    const addThought = () => {
      if (thought)
        add("thinking", thought.insertAt, thought.insertAt, thoughtDuration);
    };
    if (speech) {
      add(
        "establish",
        0,
        speech.showAtMs,
        settings.establishingHoldMs ?? speech.showAtMs * motion,
      );
      addThought();
      add(
        "entrance",
        speech.showAtMs,
        speech.readAtMs,
        (speech.readAtMs - speech.showAtMs) * motion,
      );
      const reading = speech.hideAtMs - speech.readAtMs;
      add(
        "reading",
        speech.readAtMs,
        speech.hideAtMs,
        input.recording
          ? Math.max(reading, input.recording.durationMs)
          : Math.max(
              Math.min(3000, reading),
              reading / (settings.readingRate ?? 1),
            ),
      );
      add(
        "exit",
        speech.hideAtMs,
        speech.hiddenAtMs,
        (speech.hiddenAtMs - speech.hideAtMs) * motion,
      );
      add(
        "hold",
        speech.hiddenAtMs,
        input.baseDurationMs,
        settings.postSpeechHoldMs ?? input.baseDurationMs - speech.hiddenAtMs,
      );
      add(
        "gap",
        input.baseDurationMs,
        input.baseDurationMs,
        settings.conversationGapMs ?? 0,
      );
    } else {
      addThought();
      const duration =
        input.kind === "opening" ? input.baseDurationMs : input.kind === "ballot"
          ? (settings.ballotHoldMs ?? input.baseDurationMs)
          : input.kind === "tally"
            ? (settings.tallyHoldMs ?? input.baseDurationMs)
            : input.baseDurationMs * motion;
      add("hold", 0, input.baseDurationMs, duration);
    }
    if (time <= 0 || !Number.isFinite(cursor + time))
      throw new Error(`Cue has no finite playable duration: ${input.key}`);
    const thoughtSegment = segments.find(
      (segment) => segment.kind === "thinking",
    );
    const actualThought =
      thought && thoughtSegment
        ? {
            ...thought,
            insertAt: thoughtSegment.startMs,
            duration: thoughtDuration,
          }
        : null;
    const boundary = (kind: TimeSegment["kind"], edge: "startMs" | "endMs") =>
      segments.find((s) => s.kind === kind)![edge];
    const compiledSpeech = speech
      ? {
          showAtMs: boundary("entrance", "startMs"),
          readAtMs: boundary("reading", "startMs"),
          hideAtMs: boundary("reading", "endMs"),
          hiddenAtMs: boundary("exit", "endMs"),
        }
      : null;
    const startMs = cursor;
    cursor += time;
    return {
      key: input.key,
      startMs,
      endMs: cursor,
      startFrame: Math.ceil((startMs * fps) / 1000),
      endFrame: Math.ceil((cursor * fps) / 1000),
      segments,
      thought: actualThought,
      speech: compiledSpeech,
      ...(input.recording && compiledSpeech
        ? {
            recording: {
              ...input.recording,
              startMs: startMs + compiledSpeech.readAtMs,
            },
          }
        : {}),
    };
  });
}

/** Convert edited timing to the source stage's clock without stretching a speech recording. */
export function sampleTiming(cue: CompiledTiming, absoluteMs: number) {
  const local = Math.max(
    0,
    Math.min(cue.endMs - cue.startMs, absoluteMs - cue.startMs),
  );
  const segment =
    cue.segments.find((s) => local >= s.startMs && local < s.endMs) ??
    cue.segments.at(-1)!;
  const fraction =
    segment.endMs === segment.startMs
      ? 1
      : Math.max(
          0,
          Math.min(
            1,
            (local - segment.startMs) / (segment.endMs - segment.startMs),
          ),
        );
  const elapsedMs =
    segment.sourceStartMs +
    fraction * (segment.sourceEndMs - segment.sourceStartMs);
  return { elapsedMs, thought: sampleThought(local, cue.thought) };
}
