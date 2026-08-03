import { afterEach, describe, it, expect } from "bun:test";
import {
  isFillAccepted,
  resolveApiUrl,
  setApiBase,
} from "../lib/api";
import type { FillGameResponse } from "../lib/api";

describe("isFillAccepted", () => {
  it("returns true for FillGameAccepted responses", () => {
    const accepted: FillGameResponse = {
      filling: true,
      slotsToFill: 3,
      filled: 1,
      totalPlayers: 2,
      maxPlayers: 6,
      players: [{ id: "1", name: "Alice", archetype: "strategic" }],
    };
    expect(isFillAccepted(accepted)).toBe(true);
  });

  it("returns false for FillGameResult responses", () => {
    const result: FillGameResponse = {
      filled: 6,
      totalPlayers: 6,
      maxPlayers: 6,
      players: [{ id: "1", name: "Alice", archetype: "strategic" }],
    };
    expect(isFillAccepted(result)).toBe(false);
  });
});

describe("resolveApiUrl", () => {
  afterEach(() => {
    setApiBase("");
  });

  it("keeps API calls hostless until runtime configuration supplies an API origin", () => {
    setApiBase("");
    expect(resolveApiUrl("/api/auth/me")).toBe("/api/auth/me");
  });
});
