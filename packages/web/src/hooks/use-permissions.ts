"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getMe, getAuthToken, type AuthMe } from "@/lib/api";
import { useE2EAuth } from "@/app/providers";

interface PermissionsState {
  loading: boolean;
  user: AuthMe | null;
  roles: string[];
  permissions: string[];
  isAdmin: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...perms: string[]) => boolean;
}

function clearState(
  setUser: (u: AuthMe | null) => void,
  setLoading: (l: boolean) => void,
) {
  setUser(null);
  setLoading(false);
}

export function usePermissions(): PermissionsState {
  const e2e = useE2EAuth();
  const { ready, authenticated } = usePrivy();
  const [user, setUser] = useState<AuthMe | null>(null);
  const [loading, setLoading] = useState(true);

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  const fetchMe = useCallback(() => {
    setLoading(true);
    getMe()
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!effectiveReady || !effectiveAuth) {
      clearState(setUser, setLoading);
      return;
    }

    const token = getAuthToken();
    if (!token) {
      if (e2e.isE2E) {
        // In e2e mode without token, just stop loading
        clearState(setUser, setLoading);
        return;
      }
      const handleReady = () => fetchMe();
      window.addEventListener("auth:session-ready", handleReady);
      return () => window.removeEventListener("auth:session-ready", handleReady);
    }

    fetchMe();
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

  return { loading, user, roles, permissions, isAdmin, hasPermission, hasAnyPermission };
}
