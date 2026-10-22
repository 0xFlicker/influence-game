import { describe, expect, test } from "bun:test";
import { ADMIN_TABS, adminTabHref, isAdminTab,adminRoute,permitsAdminEntry } from "../app/admin/admin-sections";

describe("admin section routes", () => {
  test("gives every admin tab a direct route", () => {
    expect(ADMIN_TABS.map((tab) => adminTabHref(tab.id))).toEqual([
      "/admin/inference",
      "/admin/seasons",
      "/admin/games",
      "/admin/production",
      "/admin/providers",
      "/admin/reviews",
      "/admin/free-queue",
      "/admin/agents",
      "/admin/users",
      "/admin/invites",
    ]);
  });

  test("rejects unknown admin tab segments", () => {
    expect(isAdminTab("games")).toBeTrue();
    expect(isAdminTab("unknown")).toBeFalse();
  });
  test("production discovery preserves Influence operator entry without granting producer evidence", () => {
    const route = adminRoute("/admin/production/games/g")!;
    expect(permitsAdminEntry(route,{roles:[],permissions:["view_admin"]})).toBeTrue();
    expect(permitsAdminEntry({access:"producer"},{roles:[],permissions:["view_admin"]})).toBeFalse();
    expect(permitsAdminEntry(route,{roles:[],permissions:[]})).toBeFalse();
  });
});

test("invite controls require their own capability", () => {
  for (const [path, permission] of [["/admin/invites", "manage_invites"]]) {
    const entry = adminRoute(path)!;
    expect(permitsAdminEntry(entry, { roles: [], permissions: ["view_admin", "manage_roles"] })).toBeFalse();
    expect(permitsAdminEntry(entry, { roles: [], permissions: [permission] })).toBeTrue();
  }
});

test("remote import has no admin navigation or tab", () => {
  expect(isAdminTab("import")).toBeFalse();
  expect(adminRoute("/admin/import")).toBeUndefined();
});
