import { test, expect } from "bun:test";
import { projectWerewolfWatch } from "@influence/engine/werewolf/watch";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { loadReplaySource, type ReadReplayJson } from "./source";

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
      thinkingOrder: "thinking-first",
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
    thinkingOrder: "thinking-first",
  });
  expect(source.kind).toBe("werewolf");
  if (source.kind === "werewolf") expect(source.title).toBe("Silence Beneath the Lanterns");
  expect(JSON.stringify(source)).not.toContain('"thinking":');
  expect(JSON.stringify(source)).not.toContain('"wolfForms":');
  expect(JSON.stringify(source)).not.toContain('"staging":');
  const poisoned = structuredClone(windows[0]!);
  poisoned.moments[0]!.wolfForms = { wolf: "/private-wolf.png" };
  await expect(
    loadReplaySource(
      reader([
        { id: "export-test", slug: "export-test", gameKind: "werewolf" },
        poisoned,
      ]),
      { game: "export-test", thinking: false, thinkingOrder: "thinking-first" },
    ),
  ).rejects.toThrow("private");
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
      { game: "gap-test", thinking: false, thinkingOrder: "thinking-first" },
    ),
  ).rejects.toThrow("gap");
});
