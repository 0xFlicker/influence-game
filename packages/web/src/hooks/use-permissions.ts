"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getMe, getAuthToken, type AuthMe } from "@/lib/api";
import { useE2EAuth } from "@/app/providers";

interface PermissionsState {
  loading: boolean;
  user: AuthMe | null;
  authError: boolean;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...perms: string[]) => boolean;
}

function invalidateFetchGeneration(fetchGeneration: { current: number }): number {
  const generation = fetchGeneration.current + 1;
  fetchGeneration.current = generation;
  return generation;
}

function deferPermissionState(params: {
  fetchGeneration: { current: number };
  generation: number;
  setUser: (u: AuthMe | null) => void;
  setLoading: (l: boolean) => void;
  setAuthError: (e: boolean) => void;
  user: AuthMe | null;
  loading: boolean;
  authError: boolean;
}): void {
  queueMicrotask(() => {
    if (params.fetchGeneration.current !== params.generation) return;
    params.setAuthError(params.authError);
    params.setUser(params.user);
    params.setLoading(params.loading);
  });
}

export function usePermissions(): PermissionsState {
  const e2e = useE2EAuth();
  const { ready, authenticated } = usePrivy();
  const [user, setUser] = useState<AuthMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const fetchGeneration = useRef(0);

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  const fetchMe = useCallback(() => {
    const generation = invalidateFetchGeneration(fetchGeneration);
    setLoading(true);
    setAuthError(false);
    getMe()
      .then((me) => {
        if (fetchGeneration.current !== generation) return;
        setUser(me);
      })
      .catch((err) => {
        if (fetchGeneration.current !== generation) return;
        console.warn("[usePermissions] /auth/me request failed:", err);
        setUser(null);
        setAuthError(true);
      })
      .finally(() => {
        if (fetchGeneration.current !== generation) return;
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!effectiveReady || !effectiveAuth) {
      const generation = invalidateFetchGeneration(fetchGeneration);
      deferPermissionState({
        fetchGeneration,
        generation,
        setUser,
        setLoading,
        setAuthError,
        user: null,
        loading: false,
        authError: false,
      });
      return;
    }

    const token = getAuthToken();
    if (!token) {
      const generation = invalidateFetchGeneration(fetchGeneration);
      if (e2e.isE2E) {
        deferPermissionState({
          fetchGeneration,
          generation,
          setUser,
          setLoading,
          setAuthError,
          user: null,
          loading: false,
          authError: false,
        });
        return;
      }
      deferPermissionState({
        fetchGeneration,
        generation,
        setUser,
        setLoading,
        setAuthError,
        user: null,
        loading: true,
        authError: false,
      });
      const handleReady = () => fetchMe();
      window.addEventListener("auth:session-ready", handleReady);
      return () => window.removeEventListener("auth:session-ready", handleReady);
    }

    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) fetchMe();
    });
    return () => {
      canceled = true;
    };
  }, [effectiveReady, effectiveAuth, fetchMe, e2e.isE2E]);

  const roles = useMemo(() => user?.roles ?? [], [user]);
  const permissions = useMemo(() => user?.permissions ?? [], [user]);
  const isAdmin = user?.isAdmin ?? false;

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const hasPermission = useCallback(
    (permission: string) => permissionSet.has(permission),
    [permissionSet],
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]) => perms.some((p) => permissionSet.has(p)),
    [permissionSet],
  );

  return { loading, user, authError, roles, permissions, isAdmin, hasPermission, hasAnyPermission };
}
