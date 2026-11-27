import { uuid } from "@influence/engine/operational-errors";

export const SHARE_OPEN_QUERY = "house_share";
const STORAGE_KEY = "house:first-share-open";

export function hasShareOpenTicket(): boolean {
  return new URLSearchParams(location.search).has(SHARE_OPEN_QUERY);
}

export function removeShareOpenTicket(): string | null {
  const ticket = new URLSearchParams(location.search).get(SHARE_OPEN_QUERY);
  if (ticket !== null) {
    const url = new URL(location.href);
    url.searchParams.delete(SHARE_OPEN_QUERY);
    history.replaceState(history.state, "", url);
  }
  return ticket;
}

export function getFirstShareOpen(): string | undefined {
  try { return uuid(globalThis.localStorage?.getItem(STORAGE_KEY)); }
  catch { return undefined; }
}

export function retainFirstShareOpen(openId: string): void {
  try {
    if (!getFirstShareOpen()) globalThis.localStorage?.setItem(STORAGE_KEY, openId);
  } catch { /* No accessible storage. */ }
}

export function clearShareAttribution(): void {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); }
  catch { /* No accessible storage. */ }
}
