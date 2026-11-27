import { expect, test } from "bun:test";
import { prepareReply } from "../../packages/api/src/discord/conversation/reply-links.js";

const origin = "https://thehouse.game";

test("only exact currently authorized House resource URLs are rendered", () => {
  const replay = `${origin}/games/copper-fox/replay?audience=mystery&cursor=8`;
  const changed = replay.replace("mystery", "omniscient");
  const unknown = `${origin}/games/unlisted`;
  const profile = `${origin}/profile/thehouse`;
  const season = `${origin}/seasons?season=season-1`;
  const prep = prepareReply(`[Open the replay](${replay})\n${changed}\n${unknown}\n${profile}\n${season}`, origin);
  expect(prep.links).toEqual([replay, changed, unknown, profile]);
  expect(prep.render(new Set([replay, profile]))).toBe(
    `[Open the replay](${replay})\n[link removed]\n[link removed]\n${profile}\n${season}`,
  );
});

test("the reply keeps its explanation when pasted links fail validation", () => {
  const external = "https://other.example/games/copper-fox";
  const unavailable = `${origin}/games/unlisted/replay/14`;
  const short = `${origin}/s/Lk3WEcewWi`;
  const prep = prepareReply(`I could not read [that replay](${unavailable}). ${external} ${short}`, origin);
  expect(prep.links).toEqual([unavailable]);
  expect(prep.render(new Set())).toBe("I could not read that replay. [link removed] [link removed]");
});

test("a truncated reply never creates a partial resource URL", () => {
  const replay = `${origin}/games/copper-fox/replay?audience=mystery&cursor=8`;
  const lead = "x".repeat(1880);
  const prep = prepareReply(`${lead} ${replay}`, origin);
  expect(prep.links).toEqual([]);
  expect(prep.render(new Set([replay]))).toBe(lead);
});

test("sentence punctuation stays outside a verified bare link", () => {
  const replay = `${origin}/games/copper-fox/replay?audience=mystery&cursor=8`;
  const prep = prepareReply(`Watch at ${replay}.`, origin);
  expect(prep.links).toEqual([replay]);
  expect(prep.render(new Set([replay]))).toBe(`Watch at ${replay}.`);
});
