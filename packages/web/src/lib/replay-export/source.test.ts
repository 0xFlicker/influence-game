import { test, expect } from "bun:test";
import { projectWerewolfWatch } from "@influence/engine/werewolf/watch";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { loadReplaySource, type ReadReplayJson } from "./source";
import { buildExportCues } from "./cues";
import { compileTiming, parseTimingProfile, sampleTiming } from "./timing";

function reader(values: unknown[]): ReadReplayJson {
  return async <T>() => {
    if (!values.length) throw new Error("Unexpected read");
    return values.shift() as T;
  };
}
test("Mystery exports reject thinking before reading private evidence", async () => {
  const read = reader([{ id: "game", slug: "game", gameKind: "werewolf" }]);
  await expect(
    loadReplaySource(read, {
      game: "game",
      thinking: true,
    }),
  ).rejects.toThrow("Mystery");
});
test("completed canonical Werewolf windows load with audience-safe evidence", async () => {
  const events = await werewolfResultsFixture("village", "export-test");
  const windows = [];
  for (let from = 1; ; ) {
    const window = {
      ...projectWerewolfWatch(events, "mystery", from, 64),
      status: "completed",
      audience: "mystery",
      publicationCutoff: "2026-10-01T00:00:00.000Z",
      media: {},
    };
    window.moments = window.moments.map(({ staging: _staging, ...moment }) => {
      void _staging;
      return moment as (typeof window.moments)[number];
    });
    windows.push(window);
    from = window.throughCursor + 1;
    if (from > window.latestCursor) break;
  }
  const read = reader([
    { id: "export-test", slug: "export-test", gameKind: "werewolf" },
    ...windows,
    {episode:{title:"Silence Beneath the Lanterns"}},
  ]);
  const source = await loadReplaySource(read, {
    game: "export-test",
    thinking: false,
  });
  expect(source.kind).toBe("werewolf");
  if (source.kind === "werewolf") expect(source.title).toBe("Silence Beneath the Lanterns");
  expect(JSON.stringify(source)).not.toContain('"thinking":');
  expect(JSON.stringify(source)).not.toContain('"wolfForms":');
  expect(JSON.stringify(source)).not.toContain('"staging":');
  const cues = await buildExportCues(source, false);
  const opening = cues.filter(cue => cue.picture.kind === "werewolf-opening");
  expect(opening.length).toBeGreaterThan(3);
  expect(cues[0]?.picture.kind).toBe("werewolf-opening");
  expect(JSON.stringify(opening)).toContain("Silence Beneath the Lanterns");
  const timeline = compileTiming(cues.map(cue => cue.timing), parseTimingProfile(), 30);
  expect(timeline[0]?.startFrame).toBe(0);
  expect(timeline[opening.length]?.startMs).toBe(opening.reduce((ms, cue) => ms + cue.timing.baseDurationMs, 0));
  const poisoned = structuredClone(windows[0]!);
  poisoned.moments[0]!.wolfForms = { wolf: "/private-wolf.png" };
  await expect(
    loadReplaySource(
      reader([
        { id: "export-test", slug: "export-test", gameKind: "werewolf" },
        poisoned,
      ]),
      { game: "export-test", thinking: false },
    ),
  ).rejects.toThrow("private");
});

test("fresh Omniscient cues compile the shared thinking zoom before speech", async () => {
  const events = await werewolfResultsFixture("village", "thinking-export");
  const window = {
    ...projectWerewolfWatch(events, "omniscient", 1, 64),
    slug: "thinking-export",
    status: "completed" as const,
    audience: "omniscient" as const,
    publicationCutoff: "2026-10-01T00:00:00.000Z",
    media: {},
  };
  const source = {kind: "werewolf" as const, windows: [window], thoughts: []};
  const speech = (await buildExportCues(source, false)).find(cue => cue.speech?.speakerId && cue.source.kind === "werewolf")!;
  if (speech.source.kind !== "werewolf" || !speech.speech?.speakerId) throw new Error("Fixture requires speech");
  const cues = await buildExportCues({...source, thoughts: [{cursor: speech.source.cursor, actorId: speech.speech.speakerId, day: 0, action: "introduce", thinking: "Consider the village carefully."}]}, true);
  const timeline = compileTiming(cues.map(cue => cue.timing), parseTimingProfile(), 30);
  const time = timeline.find(cue => cue.key === speech.timing.key)!;
  const thought = time.thought!;
  expect(thought).not.toBeNull();
  expect(sampleTiming(time, time.startMs + thought.insertAt + thought.enterMs / 2).thought?.focus).toBeCloseTo(0.5);
  expect(sampleTiming(time, time.startMs + thought.insertAt + thought.readAtMs).thought?.focus).toBe(1);
  expect(sampleTiming(time, time.startMs + thought.insertAt + thought.readAtMs).thought?.opacity).toBe(1);
  expect(sampleTiming(time, time.startMs + time.speech!.showAtMs).thought).toBeNull();
});
test("gapped windows fail before they become a render manifest", async () => {
  const events = await werewolfResultsFixture("village", "gap-test");
  const window = {
    ...projectWerewolfWatch(events, "mystery", 1, 64),
    status: "completed",
    audience: "mystery",
    publicationCutoff: "2026-10-01T00:00:00.000Z",
    media: {},
  };
  window.moments.splice(1, 1);
  await expect(
    loadReplaySource(
      reader([
        { id: "gap-test", slug: "gap-test", gameKind: "werewolf" },
        window,
      ]),
      { game: "gap-test", thinking: false },
    ),
  ).rejects.toThrow("gap");
});
