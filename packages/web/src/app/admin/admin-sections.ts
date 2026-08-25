export const ADMIN_TABS = [
  { id: "seasons", label: "Seasons" },
  { id: "games", label: "Games" },
  { id: "providers", label: "Providers" },
  { id: "reviews", label: "Reviews" },
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
