import { observeApiResponse } from "./request-diagnostics";
import { getAuthToken } from "./api";
import { parseHouseShareTarget, SHARE_CODE_PATTERN } from "@influence/engine/house-share-target";

function sharingSession() {
  // Public embeds never access account credentials or browser storage.
  if (typeof window === "undefined" || window.location.pathname.startsWith("/embed/")) return null;
  try { return getAuthToken(); }
  catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return null;
    throw error;
  }
}

export async function createHouseShareLink(href: string, origin: string): Promise<string> {
  const url = new URL(href, origin);
  if (url.origin !== new URL(origin).origin) throw new Error("Only House links can be shared.");
  const target = parseHouseShareTarget(`${url.pathname}${url.search}${url.hash}`);
  const path = "/api/share-links";
  const token = sharingSession();
  const options: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: "same-origin",
    body: JSON.stringify({ path: target.path }), signal: AbortSignal.timeout(15_000),
  };
  return observeApiResponse(path, options, () => fetch(path, options), async response => {
    if (!response.ok) throw new Error(response.status === 429 ? "Too many share requests. Try again in a minute." : "Couldn't create a share link. Try again.");
    const result = await response.json();
    if (typeof result.code !== "string" || !SHARE_CODE_PATTERN.test(result.code)) throw new Error("Couldn't create a share link. Try again.");
    return new URL(`/s/${result.code}`, origin).href;
  });
}
