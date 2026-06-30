import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const createFormSource = readFileSync(
  join(import.meta.dir, "../app/admin/games/new/create-game-form.tsx"),
  "utf8",
);
const createPageSource = readFileSync(
  join(import.meta.dir, "../app/games/new/page.tsx"),
  "utf8",
);
const adminCreatePageSource = readFileSync(
  join(import.meta.dir, "../app/admin/games/new/page.tsx"),
  "utf8",
);
const combinedSource = `${createFormSource}\n${createPageSource}\n${adminCreatePageSource}`;

describe("create game Influence selection", () => {
  it("shows Influence as the selected game before submission", () => {
    expect(combinedSource).toContain("ACTIVE_GAME.name");
    expect(createFormSource).toContain("Selected ruleset");
    expect(createFormSource).toContain("Selected");
    expect(createPageSource).toContain("Create {ACTIVE_GAME.name} Game");
    expect(adminCreatePageSource).toContain("Create {ACTIVE_GAME.name} Game");
  });

  it("does not add a fake multi-game selector", () => {
    expect(combinedSource).not.toContain("Werewolf");
    expect(combinedSource).not.toContain("Mafia");
    expect(combinedSource).not.toContain("Salem");
    expect(combinedSource).not.toContain("disabled future");
  });
});
