import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { adminLanding } from "../app/admin/admin-sections";

test("delegated invite managers can discover administration and lose the link on revocation", async () => {
  // Keep auth and navigation mocks out of other suites.
  if (process.env.ADMIN_INVITE_NAV_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, ADMIN_INVITE_NAV_TEST: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  let permissions = ["manage_invites"];
  let authenticated = true;
  mock.module("next/navigation", () => ({ usePathname: () => "/" }));
  mock.module("@/hooks/use-auth", () => ({ useAuth: () => ({ ready: true, authenticated, openSignIn() {}, logout() {} }) }));
  mock.module("@/hooks/use-permissions", () => ({ usePermissions: () => ({
    isAdmin: false, roles: [], loading: false, hasPermission: (permission: string) => permissions.includes(permission),
  }) }));
  mock.module("@/components/farcaster-miniapp-provider", () => ({ useMiniApp: () => ({ suppressWebsiteAuthChrome: false, isMiniApp: false }) }));
  const { Nav } = await import("../components/nav");
  expect(renderToStaticMarkup(<Nav />)).toContain('href="/admin"');
  expect(adminLanding({ roles: [], permissions })).toBe("/admin/invites");
  permissions = [];
  expect(renderToStaticMarkup(<Nav />)).not.toContain('href="/admin"');
  expect(adminLanding({ roles: [], permissions })).toBeNull();
  permissions = ["manage_invites"];
  authenticated = false;
  expect(renderToStaticMarkup(<Nav />)).not.toContain('href="/admin"');
});
