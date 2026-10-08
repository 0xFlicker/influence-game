import { test, expect } from "bun:test";
import {
  audioGain,
  placeAudioClip,
  compileAudio,
  type AudioClip,
} from "./audio";
import { validateAlignment } from "./speech";
import { alignedPage } from "../../components/watch/speech-alignment";
const music: AudioClip = {
  asset: "music",
  purpose: "music",
  startMs: 0,
  endMs: 10000,
  offsetMs: 0,
  gain: 0.3,
  fadeInMs: 700,
  fadeOutMs: 700,
};
const voice: AudioClip = {
  asset: "speech",
  purpose: "speech",
  startMs: 2000,
  endMs: 5000,
  offsetMs: 0,
  gain: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
};
test("audio fades and voice ducking are pure random-access envelopes", () => {
  const clips = [music, voice];
  expect(audioGain(music, 0, clips)).toBe(0);
  expect(audioGain(music, 350, clips)).toBeCloseTo(0.15);
  expect(audioGain(music, 2500, clips)).toBeCloseTo(0.105);
  expect(audioGain(music, 5350, clips)).toBeCloseTo(0.3);
  expect(audioGain(music, 10000, clips)).toBe(0);
  expect(audioGain(voice, 2500, clips)).toBe(1);
  expect(audioGain(voice, 5000, clips)).toBe(0);
});
test("aligned pages follow recorded spans and reject incomplete coverage", () => {
  const spans = validateAlignment(
    [
      { textStart: 0, textEnd: 6, startMs: 0, endMs: 1000 },
      { textStart: 6, textEnd: 11, startMs: 1300, endMs: 2000 },
    ],
    "Hello world",
    2000,
  );
  expect(alignedPage(["Hello", "world"], "Hello world", spans, 1250)).toBe(0);
  expect(alignedPage(["Hello", "world"], "Hello world", spans, 1300)).toBe(1);
  expect(() => validateAlignment(spans, "Hello world!", 2000)).toThrow("whole");
  expect(() => validateAlignment(spans, "Hello world", 1900)).toThrow(
    "recording",
  );
  expect(() =>
    alignedPage(
      ["Hello", "world"],
      "Hello world",
      [{ textStart: 0, textEnd: 11, startMs: 0, endMs: 2000 }],
      500,
    ),
  ).toThrow("page boundary");
});

import { compileTiming, parseTimingProfile, type TimingInput } from "./timing";
const timing: TimingInput = {
  key: "one",
  kind: "scene",
  baseDurationMs: 12000,
  speech: null,
  thinking: null,
  order: "thinking-first",
};
const score = {
  key: "day",
  title: "Day",
  src: "music",
  repeat: true,
  continueAtEnd: false,
};
const assets = {
  music: {
    path: "music",
    sha256: "test",
    mediaType: "audio" as const,
    durationMs: 5000,
  },
};
test("score loops overlap and continue across speaker cues", () => {
  const cues = [
    { timing, music: score },
    { timing: { ...timing, key: "two" }, music: score },
  ];
  const timeline = compileTiming(
    cues.map((c) => c.timing),
    parseTimingProfile(),
    30,
  );
  const result = compileAudio(
    cues,
    timeline,
    assets,
    parseTimingProfile(),
    true,
  );
  expect(result.durationMs).toBe(24000);
  expect(result.clips.map((clip) => clip.startMs)).toEqual([
    0, 4300, 8600, 12900, 17200, 21500,
  ]);
  expect(result.clips.at(-1)!.endMs).toBe(24000);
});
test("result holds finish the score or an explicit finite hold", () => {
  const cues = [
    {
      timing: { ...timing, kind: "result" as const, baseDurationMs: 2000 },
      music: { ...score, repeat: false, continueAtEnd: true },
    },
  ];
  const timeline = compileTiming(
    cues.map((c) => c.timing),
    parseTimingProfile(),
    30,
  );
  expect(
    compileAudio(cues, timeline, assets, parseTimingProfile(), true).durationMs,
  ).toBe(5000);
  expect(
    compileAudio(cues, timeline, assets, parseTimingProfile(), false)
      .durationMs,
  ).toBe(2000);
  expect(
    compileAudio(
      cues,
      timeline,
      assets,
      parseTimingProfile({ ending: { holdMs: 1000 } }),
      true,
    ).clips[0]!.endMs,
  ).toBe(3000);
});

test("range audio retains the full traversal source offset and envelope clock", () => {
  const full = placeAudioClip(music, { fromFrame: 0, untilFrame: 300 }, 30)!;
  const excerpt = placeAudioClip(
    music,
    { fromFrame: 180, untilFrame: 240 },
    30,
  )!;
  expect(excerpt).toEqual({
    fromFrame: 0,
    durationInFrames: 60,
    sourceOffsetFrames: 180,
    globalStartFrame: 180,
  });
  for (const frame of [0, 10, 40])
    expect(
      audioGain(music, ((frame + excerpt.globalStartFrame) * 1000) / 30, [
        music,
        voice,
      ]),
    ).toBe(
      audioGain(music, ((frame + 180 + full.globalStartFrame) * 1000) / 30, [
        music,
        voice,
      ]),
    );
  expect(
    placeAudioClip(voice, { fromFrame: 180, untilFrame: 240 }, 30),
  ).toBeNull();
});
