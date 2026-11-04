import { describe, expect, test } from "bun:test";
import { ADMIN_TABS, adminTabHref, isAdminTab,adminRoute,permitsAdminEntry } from "../app/admin/admin-sections";

describe("admin section routes", () => {
  test("gives every admin tab a direct route", () => {
    expect(ADMIN_TABS.map((tab) => adminTabHref(tab.id))).toEqual([
      "/admin/inference",
      "/admin/seasons",
      "/admin/championships",
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
  test("render monitor uses its specific producer route without changing the Production landing",()=> {
    const route=adminRoute("/admin/production/renders")!;
    expect(route.label).toBe("Render jobs");
    expect(permitsAdminEntry(route,{roles:[],permissions:["view_admin"]})).toBeFalse();
    expect(permitsAdminEntry(route,{roles:["producer"],permissions:[]})).toBeTrue();
    expect(permitsAdminEntry(route,{roles:["sysop"],permissions:[]})).toBeTrue();
    expect(adminRoute("/admin/production")?.label).toBe("Production");
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

test("championship navigation uses its explicit permission", () => {
  const entry = adminRoute("/admin/championships")!;
  expect(permitsAdminEntry(entry, { roles: [], permissions: ["manage_championships"] })).toBe(true);
  expect(permitsAdminEntry(entry, { roles: ["producer"], permissions: [] })).toBe(false);
});
