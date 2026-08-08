import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const createFormSource = readFileSync(
  join(import.meta.dir, "../app/admin/games/new/create-game-form.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  join(import.meta.dir, "../lib/api.ts"),
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

  it("defaults new public games to GPT-5.6 Luna", () => {
    expect(createFormSource).toContain("modelCatalogId: DEFAULT_MODEL_CATALOG_ID");
    expect(createFormSource).toContain('DEFAULT_MODEL_CATALOG_ID');
    expect(createFormSource).toContain('visibility: "public"');
    expect(createFormSource).toContain('reasoningPolicy: "medium"');
    expect(createFormSource).not.toContain("modelTier");
    expect(createFormSource).not.toContain("estimateCost");
    expect(createFormSource).not.toContain("Cost estimate");
  });

  it("only offers supported six-player-and-up game sizes", () => {
    expect(createFormSource).toContain("playerCount: 6 | 8 | 10 | 12;");
    expect(createFormSource).toContain("options={[6, 8, 10, 12].map");
    expect(apiSource).toContain("playerCount: 6 | 8 | 10 | 12;");
    expect(createFormSource).not.toContain("playerCount: 4 | 6");
    expect(apiSource).not.toContain("playerCount: 4 | 6");
  });

  it("does not add a fake multi-game selector", () => {
    expect(combinedSource).not.toContain("Werewolf");
    expect(combinedSource).not.toContain("Mafia");
    expect(combinedSource).not.toContain("Salem");
    expect(combinedSource).not.toContain("disabled future");
  });
});
