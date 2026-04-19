const ROLE_LABELS: Record<string, string> = {
  sysop: "Sysop",
  admin: "Admin",
  gamer: "Game Operator",
  player: "Player",
};

const ROLE_BADGE_STYLES: Record<string, string> = {
  sysop: "bg-red-900/40 text-red-300 border border-red-800/70",
  admin: "bg-blue-900/40 text-blue-300 border border-blue-800/70",
  gamer: "bg-amber-900/40 text-amber-300 border border-amber-800/70",
  player: "bg-emerald-900/40 text-emerald-300 border border-emerald-800/70",
};

export function formatRoleName(name: string): string {
  return ROLE_LABELS[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getRoleBadgeClass(name: string): string {
  return ROLE_BADGE_STYLES[name] ?? "bg-white/10 text-white/70 border border-white/10";
}
