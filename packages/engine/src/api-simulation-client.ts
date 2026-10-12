/** Shared HTTP transport for local API simulation CLIs. */

export async function apiFetch<T = unknown>(
  apiBaseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${init?.method ?? "GET"} ${url.pathname} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
