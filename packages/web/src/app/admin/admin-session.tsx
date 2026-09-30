"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, useCallback } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";

export type Operation = { phase: "submitting" | "unknown" | "accepted" | "rejected"; url: string; body: Record<string, unknown>; result?: unknown; error?: string };
/** Browser-session ownership. Server receipts still own accepted work. Never persist credentials or image bytes. */
export class AdminSession {
  active = true;
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  constructor(readonly scope: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  set<T>(key: string, value: T) { if (!this.active) return; this.values.set(key, value); this.emit(); }
  delete(key: string) { this.values.delete(key); this.emit(); }
  clearMatching(predicate: (key: string) => boolean) { for (const key of this.values.keys()) if (predicate(key)) this.values.delete(key); this.emit(); }
  pending(prefix: string) { return [...this.values.entries()].some(([key, value]) => key.startsWith(prefix) && value && typeof value === "object" && "phase" in value && (value.phase === "submitting" || value.phase === "unknown")); }
  activate() { this.active = true; }
  dispose() { this.active = false; this.values.clear(); this.emit(); }
  private emit() { for (const listener of this.listeners) listener(); }
  /** Fence private evidence reads too, without caching image bytes in the session. */
  async read<T>(url: string, signal?: AbortSignal): Promise<T> {
      const family = adminAccessResource(url), fence = `access-version:${family}`, denied = `access-denied:${family}`;
      const version = this.get<number>(fence) ?? 0;
      try {
        const result = await apiFetch<T>(url, { signal, cache: "no-store" });
        if (!this.active || signal?.aborted || version !== (this.get<number>(fence) ?? 0)) throw new Error("Administration access changed; refresh to retry");
        this.set(denied, false);
        return result;
      } catch (error) {
        if (this.active && !signal?.aborted && accessDenied(error)) {
          this.set(fence, (this.get<number>(fence) ?? 0) + 1);
          this.set(denied, true);
          this.clearMatching(key => (key.startsWith("operation:") || key.startsWith("draft:") || key.startsWith("ui:")) && key.includes(family));
        }
        throw error;
      }
  }
  async execute<T>(key: string, url: string, input: Record<string, unknown>, retryUnknown = true): Promise<T | undefined> {
    const previous = this.get<Operation>(key);
    if (!this.active || previous?.phase === "submitting") return;
    if (previous?.phase === "unknown" && !retryUnknown) throw new Error("Check the saved receipt before submitting this operation again.");
    const body = previous?.phase === "unknown" ? previous.body : structuredClone(input);
    const target = previous?.phase === "unknown" ? previous.url : url;
    const submitting: Operation = { phase: "submitting", url: target, body };
    this.set(key, submitting);
    try {
      const result = await apiFetch<T>(target, { method: "POST", body: JSON.stringify(body) });
      if (!this.active || this.get(key) !== submitting) return;
      this.set<Operation>(key, { phase: "accepted", url: target, body, result });
      return result;
    } catch (error) {
      if (this.get(key) === submitting) this.set<Operation>(key, { phase: error instanceof ApiError && error.status < 500 ? "rejected" : "unknown", url: target, body, error: error instanceof Error ? error.message : "Response unavailable" });
      throw error;
    }
  }
}
const Context = createContext<AdminSession | null>(null);
export function AdminSessionProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  const [session] = useState(() => new AdminSession(scope));
  const client = useQueryClient();
  useEffect(() => {
    session.activate();
    return () => { session.dispose(); void client.cancelQueries({ queryKey: ["admin", scope] }); client.removeQueries({ queryKey: ["admin", scope] }); };
  }, [client, scope, session]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useAdminSession() {
  const value = useContext(Context);
  if (!value) throw new Error("AdminSessionProvider is required");
  return value;
}
export function useAdminValue<T>(key: string, initial: T) {
  const session = useAdminSession();
  const value = useSyncExternalStore(session.subscribe, () => session.get<T>(key), () => undefined) ?? initial;
  const set = useCallback((next: T | ((previous: T) => T)) => {
    session.set(key, typeof next === "function" ? (next as (previous: T) => T)(session.get<T>(key) ?? initial) : next);
  }, [session, key, initial]);
  return [value, set] as const;
}
export const accessDenied = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403);
export function adminAccessResource(url: string): string {
  return url.match(/^\/api\/admin\/production\/games\/[^/]+/)?.[0]
    ?? url.match(/^\/api\/admin\/werewolf\/[^/]+/)?.[0]
    ?? url.match(/^\/api\/admin\/games\/[^/]+\/visual/)?.[0]
    ?? url;
}
export function adminReadOptions<T>(session: AdminSession, url: string) {
  return queryOptions({
    queryKey: ["admin", session.scope, url],
    queryFn: async ({ signal }) => {
      return session.read<T>(url, signal);
    },
    staleTime: 10_000, gcTime: 10 * 60_000, retry: false,
  });
}
export function useAdminRead<T>(url: string, interval: number | false = false) {
  const session = useAdminSession();
  const client = useQueryClient();
  const family = adminAccessResource(url);
  const [blocked] = useAdminValue(`access-denied:${family}`, false);
  const query = useQuery({ ...adminReadOptions<T>(session, url), enabled: !blocked, refetchInterval: interval, refetchOnWindowFocus: "always" });
  useEffect(() => {
    if (!blocked) return;
    const filter = { predicate: (candidate: { queryKey: readonly unknown[] }) => candidate.queryKey[0] === "admin" && candidate.queryKey[1] === session.scope && adminAccessResource(String(candidate.queryKey[2])) === family };
    void client.cancelQueries(filter);
    client.removeQueries(filter);
  }, [blocked, client, session, family]);
  return { ...query, data: blocked || accessDenied(query.error) ? undefined : query.data, error: query.error?.message ?? (blocked ? "Access is no longer available. Refresh to check current permissions." : null), denied: blocked || accessDenied(query.error), refresh: query.refetch };
}

export function useAdminPending(prefix: string) {
  const session = useAdminSession();
  return useSyncExternalStore(session.subscribe, () => session.pending(prefix), () => false);
}
