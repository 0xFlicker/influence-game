export const ADMIN_TABS = [
  { id: "inference", label: "Inference" },
  { id: "seasons", label: "Seasons" },
  { id: "games", label: "Games" },
  { id: "production", label: "Production" },
  { id: "providers", label: "Providers" },
  { id: "reviews", label: "Learning reviews" },
  { id: "free-queue", label: "Free Queue" },
  { id: "agents", label: "Agents" },
  { id: "users", label: "Users & Roles", permission: "manage_roles" },
  { id: "invites", label: "Invites" },
  { id: "import", label: "Import Game" },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]["id"];

export function isAdminTab(value: string): value is AdminTab {
  return ADMIN_TABS.some((tab) => tab.id === value);
}

export function adminTabHref(tab: AdminTab): string {
  return `/admin/${tab}`;
}

export function adminTabLabel(tab: AdminTab): string {
  return ADMIN_TABS.find((candidate) => candidate.id === tab)?.label ?? tab;
}


export type AdminAccess = { permissions: readonly string[]; roles: readonly string[] };
export type AdminArea = "Games" | "Production" | "Operations" | "People";
export type AdminEntry = { label: string; href: string; area: AdminArea; access: "admin" | "werewolf" | "producer" | "roles" | "visual" | "operator" };
export const ADMIN_ENTRIES: readonly AdminEntry[] = [
  { label: "Influence", href: "/admin/games", area: "Games", access: "admin" },
  { label: "Werewolf", href: "/admin/werewolf", area: "Games", access: "werewolf" },
  { label: "Seasons", href: "/admin/seasons", area: "Games", access: "visual" },
  { label: "Import game", href: "/admin/import", area: "Games", access: "admin" },
  { label: "Production", href: "/admin/production", area: "Production", access: "producer" },
  { label: "Inference", href: "/admin/inference", area: "Operations", access: "operator" },
  { label: "Providers", href: "/admin/providers", area: "Operations", access: "operator" },
  { label: "Free queue", href: "/admin/free-queue", area: "Operations", access: "admin" },
  { label: "Agents", href: "/admin/agents", area: "People", access: "admin" },
  { label: "Learning reviews", href: "/admin/reviews", area: "People", access: "admin" },
  { label: "Users & roles", href: "/admin/users", area: "People", access: "roles" },
  { label: "Invites", href: "/admin/invites", area: "People", access: "admin" },
];
export function permitsAdminEntry(entry: Pick<AdminEntry, "access">, user: AdminAccess): boolean {
  const permission = (name: string) => user.permissions.includes(name);
  const producer = user.roles.some(role => role === "producer" || role === "sysop");
  switch (entry.access) {
    case "operator": return user.roles.some(role => role === "admin" || role === "sysop");
    case "producer": return producer;
    case "werewolf": return permission("view_admin") || producer;
    case "roles": return permission("manage_roles");
    case "visual": return permission("view_admin");
    default: return permission("view_admin") || permission("manage_roles");
  }
}
export function adminRoute(path: string): AdminEntry | undefined {
  if (/^\/admin\/games\/[^/]+\/visual(?:\/|$)/.test(path)) return { label: "Visual editor", href: path, area: "Production", access: "visual" };
  return ADMIN_ENTRIES.find(entry => path === entry.href || path.startsWith(`${entry.href}/`));
}
export function adminLanding(user: AdminAccess): string | null {
  return ADMIN_ENTRIES.find(entry => permitsAdminEntry(entry, user))?.href ?? null;
}
