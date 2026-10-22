import { expect, test } from "bun:test";
import { parseHouseShareTarget } from "../house-share-target";

test("all supported House share routes validate without becoming a general redirect service", () => {
  for (const path of ["/", "/games", "/games/public", "/games/free", "/games/type/werewolf", "/games/season/season-0", "/games/red-fox", "/games/red-fox/results", "/games/red-fox/replay", "/games/red-fox/replay/35", "/games/red-fox/highlights?scene=cut%3A1&audience=public", "/profile/flick?game=werewolf", "/rules", "/about", "/updates", "/updates/launch", "/privacy", "/terms", "/get-mcp"]) {
    expect(parseHouseShareTarget(path).path).toStartWith("/");
  }
  for (const path of ["https://thehouse.game/games/g", "//evil.test", "/\\evil.test", "/games/../admin", "/games/%2e%2e/admin", "/games/g%2fadmin", "/dashboard", "/admin", "/auth/cli", "/sign-in", "/s/7mK9pR2xQa", "/games/new", "/games/g?redirect=https://evil.test", "/games/g/replay?token=secret", "/games/g/replay?speed=9", "/games/g/replay?thinking=true", "/games/g/replay?cue=a&cue=b", "/games/g/replay?cursor=1", "/games/g/replay?audience=private", "/games/g/replay/-1", "/games/g/highlights?scene=", "/profile/flick?game=secret"]) {
    expect(() => parseHouseShareTarget(path)).toThrow();
  }
});

test("replay coordinates normalize deterministically and preserve settings and anchors", () => {
  const target = parseHouseShareTarget("/games/g/replay/0035?volume=0.60&muted=0&thinking=1&speed=2&t=1.250&cue=id%3A35");
  expect(target.path).toBe("/games/g/replay/35?cue=id%3A35&muted=0&speed=2&t=1.25&thinking=1&volume=0.6");
  expect(parseHouseShareTarget("/games/g/highlights?scene=cut%3A1#scene-cut%3A1").path).toEndWith("#scene-cut%3A1");
});
