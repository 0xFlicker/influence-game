import { expect, test } from "bun:test";
import { prepareReply } from "../../packages/api/src/discord/conversation/policy.js";

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
    `[Open the replay](${replay})\n\n\n${profile}\n${season}`,
  );
});

test("the reply keeps its explanation when pasted links fail validation", () => {
  const external = "https://other.example/games/copper-fox";
  const unavailable = `${origin}/games/unlisted/replay/14`;
  const short = `${origin}/s/Lk3WEcewWi`;
  const prep = prepareReply(`I could not read [that replay](${unavailable}). ${external} ${short}`, origin);
  expect(prep.links).toEqual([unavailable]);
  expect(prep.render(new Set())).toBe("I could not read that replay.");
  expect(prepareReply(unavailable, origin).render(new Set())).toBe("");
  expect(prepareReply(external, origin).render(new Set())).toBe("");
});

test("authorization keeps a whole replay URL and trailing prose beyond the former reply cutoff", () => {
  const replay = `${origin}/games/copper-fox/replay?audience=mystery&cursor=8`;
  const text = ` \n${"x".repeat(1980)}\n\n[Watch the replay](${replay})\nThe last sentence follows the link.  \n`;
  const prep = prepareReply(text, origin);
  expect(prep.links).toEqual([replay]);
  expect(prep.render(new Set([replay]))).toBe(text);
});

test("authorization retains all distinct links for batched checks and preserves their model-authored order", () => {
  const links = Array.from({ length: 14 }, (_, index) => `${origin}/games/fixture-${index}`);
  const text = links.map((link, index) => `[Game ${index + 1}](${link})`).join("\n");
  const prep = prepareReply(text, origin);
  expect(prep.links).toEqual(links);
  expect(prep.render(new Set(links.toReversed()))).toBe(text);
});

test("sentence punctuation stays outside a verified bare link", () => {
  const replay = `${origin}/games/copper-fox/replay?audience=mystery&cursor=8`;
  const prep = prepareReply(`Watch at ${replay}.`, origin);
  expect(prep.links).toEqual([replay]);
  expect(prep.render(new Set([replay]))).toBe(`Watch at ${replay}.`);
});
