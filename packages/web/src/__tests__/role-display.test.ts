import { describe, expect, it } from "bun:test";
import { formatRoleName, getRoleBadgeClass } from "../lib/role-display";

describe("formatRoleName", () => {
  it("renders system roles with user-facing labels", () => {
    expect(formatRoleName("sysop")).toBe("Sysop");
    expect(formatRoleName("admin")).toBe("Admin");
    expect(formatRoleName("gamer")).toBe("Game Operator");
    expect(formatRoleName("player")).toBe("Player");
  });

  it("falls back to title-cased labels for unknown roles", () => {
    expect(formatRoleName("event_runner")).toBe("Event Runner");
  });
});

describe("getRoleBadgeClass", () => {
  it("returns themed badge styles for known roles", () => {
    expect(getRoleBadgeClass("gamer")).toContain("bg-amber-900/40");
    expect(getRoleBadgeClass("sysop")).toContain("bg-red-900/40");
  });

  it("returns a neutral badge style for unknown roles", () => {
    expect(getRoleBadgeClass("unknown")).toContain("bg-white/10");
  });
});
