import { describe, expect, test } from "bun:test";
import { canVoidSuspendedGame } from "../app/admin/admin-panel";

describe("admin suspended-game escape hatch", () => {
  test("only exposes voiding for authorized suspended games", () => {
    expect(canVoidSuspendedGame("suspended", true)).toBe(true);
    expect(canVoidSuspendedGame("suspended", false)).toBe(false);
    expect(canVoidSuspendedGame("completed", true)).toBe(false);
    expect(canVoidSuspendedGame("cancelled", true)).toBe(false);
  });
});
