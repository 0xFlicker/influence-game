import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const freeContentSource = readFileSync(
  join(import.meta.dir, "../app/games/free/free-game-content.tsx"),
  "utf8",
);
const freePageSource = readFileSync(
  join(import.meta.dir, "../app/games/free/page.tsx"),
  "utf8",
);
const combinedSource = `${freeContentSource}\n${freePageSource}`;

describe("free queue Influence framing", () => {
  it("names the Influence queue across entry states", () => {
    expect(combinedSource).toContain("ACTIVE_GAME.queueLabel");
    expect(combinedSource).toContain("Join ${ACTIVE_GAME.name} Queue");
    expect(combinedSource).toContain("Today&apos;s {ACTIVE_GAME.name} Game");
    expect(combinedSource).toContain("Next {ACTIVE_GAME.name} game in");
  });

  it("keeps the free queue route and avoids future-game choices", () => {
    expect(freeContentSource).toContain('href="/dashboard/agents"');
    expect(combinedSource).not.toContain("Werewolf");
    expect(combinedSource).not.toContain("Mafia");
    expect(combinedSource).not.toContain("Salem");
  });
});
