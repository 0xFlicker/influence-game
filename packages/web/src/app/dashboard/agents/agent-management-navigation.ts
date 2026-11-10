/** Only return to this owner's collection; never accept an arbitrary redirect. */
export function managementReturnPath(value?: string | null): string {
  if (!value || !/^\/dashboard\/agents(?:[?#]|$)/.test(value))
    return "/dashboard/agents";
  const url = new URL(value, "https://house.invalid");
  return url.origin === "https://house.invalid" &&
    url.pathname === "/dashboard/agents"
    ? url.pathname + url.search + url.hash
    : "/dashboard/agents";
}
export function withManagementReturn(path: string, returnTo: string): string {
  return (
    path +
    (path.includes("?") ? "&" : "?") +
    new URLSearchParams({ returnTo: managementReturnPath(returnTo) })
  );
}
