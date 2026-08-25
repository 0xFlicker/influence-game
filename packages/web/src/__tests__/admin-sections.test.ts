import { describe, expect, test } from "bun:test";
import { ADMIN_TABS, adminTabHref, isAdminTab } from "../app/admin/admin-sections";

describe("admin section routes", () => {
  test("gives every admin tab a direct route", () => {
    expect(ADMIN_TABS.map((tab) => adminTabHref(tab.id))).toEqual([
      "/admin/seasons",
      "/admin/games",
      "/admin/providers",
      "/admin/reviews",
      "/admin/free-queue",
      "/admin/agents",
      "/admin/users",
      "/admin/invites",
      "/admin/import",
    ]);
  });

  test("rejects unknown admin tab segments", () => {
    expect(isAdminTab("games")).toBeTrue();
    expect(isAdminTab("unknown")).toBeFalse();
  });
});
