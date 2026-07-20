"use client";

import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { AuthMe } from "@/lib/api";

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

export function usePermissions(): PermissionsState {
  const {
    ready,
    authenticated,
    account,
    hydrationError,
  } = useAuth();
  const user = authenticated ? account : null;
  const loading = !ready || (authenticated && !account && !hydrationError);
  const roles = useMemo(() => user?.roles ?? [], [user]);
  const permissions = useMemo(() => user?.permissions ?? [], [user]);
  const isAdmin = user?.isAdmin ?? false;
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const hasPermission = useCallback(
    (permission: string) => permissionSet.has(permission),
    [permissionSet],
  );
  const hasAnyPermission = useCallback(
    (...perms: string[]) => perms.some((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  return {
    loading,
    user,
    authError: hydrationError,
    roles,
    permissions,
    isAdmin,
    hasPermission,
    hasAnyPermission,
  };
}
