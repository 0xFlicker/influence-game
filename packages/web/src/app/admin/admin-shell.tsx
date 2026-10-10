"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/nav";
import { useAuth, AUTH_GENERATION_KEY } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { ADMIN_ENTRIES, adminRoute, permitsAdminEntry, type AdminArea } from "./admin-sections";
import { AdminSessionProvider, useAdminSession } from "./admin-session";

const areas: AdminArea[] = ["Games", "Production", "Operations", "People"];
export function AdminShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth(), access = usePermissions(), path = usePathname();
  const links = ADMIN_ENTRIES.filter(entry => permitsAdminEntry(entry, access));
  const route = adminRoute(path), area = route?.area ?? "Games";
  const productionWorkspace = /^\/admin\/production\/games\/[^/]+\/?$/.test(path);
  const generation = typeof window === "undefined" ? "initial" : window.localStorage.getItem(AUTH_GENERATION_KEY) ?? "initial";
  const scope = `${auth.account?.id ?? "guest"}:${generation}`;
  const ready = auth.ready && !access.loading;
  return <div className="min-h-screen bg-[#08090b] text-white" data-admin-shell data-production-shell={productionWorkspace || undefined}>
    <Nav />
    <div className="border-b border-white/10 bg-black/20">
      <nav aria-label="Administration" className="mx-auto flex max-w-[90rem] gap-2 px-4 sm:px-6 lg:px-8">
        {areas.map(name => { const first = links.find(entry => entry.area === name); return first && <Link key={name} href={first.href} aria-current={area === name ? "true" : undefined} className={`min-h-12 border-b-2 px-3 py-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${area === name ? "border-indigo-400 text-white" : "border-transparent text-white/50 hover:text-white"}`}>{name}</Link>; })}
      </nav>
    </div>
    <main className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8" data-admin-content>
      {!ready ? <p role="status" className="min-h-64 py-12 text-white/60">Connecting to administration…</p> : !auth.authenticated ? <div className="py-12"><p>Sign in to access administration.</p><button onClick={auth.openSignIn} className="influence-button-primary mt-4 rounded px-4 py-2">Sign in</button></div> : <AdminSessionProvider key={scope} scope={scope}>
        <ProductionAccessBoundary />
        {!productionWorkspace && <nav aria-label={`${area} sections`} className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {links.filter(entry => entry.area === area).map(entry => <Link key={entry.href} href={entry.href} aria-current={route?.href === entry.href ? "page" : undefined} className={route?.href === entry.href ? "py-2 text-white" : "py-2 text-white/45 hover:text-white"}>{entry.label}</Link>)}
        </nav>}
        {route && !permitsAdminEntry(route, access) ? <div role="alert" className="py-12">You do not have access to this administration section.</div> : children}
      </AdminSessionProvider>}
    </main>
  </div>;
}
function ProductionAccessBoundary() {
  const { roles, hasPermission } = usePermissions(), session = useAdminSession(), client = useQueryClient();
  const allowed = roles.includes("producer") || roles.includes("sysop");
  const discoveryAllowed = allowed || hasPermission("view_admin") || hasPermission("manage_roles");
  useEffect(() => {
    if (allowed) return;
    const prefix = "/api/admin/production/";
    const privateResource = (url: string) => {
      const path = url.split("?")[0]!;
      const metadata = path === `${prefix}library` || /^\/api\/admin\/production\/games\/[^/]+$/.test(path);
      return url.startsWith(prefix) && (!discoveryAllowed || !metadata);
    };
    session.invalidateReadsMatching(privateResource);
    session.clearMatching(key => key.includes(prefix) && privateResource(key.slice(key.indexOf(prefix))));
    const filter = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && privateResource(String(query.queryKey[2])) };
    void client.cancelQueries(filter); client.removeQueries(filter);
  }, [allowed, discoveryAllowed, session, client]);
  return null;
}
