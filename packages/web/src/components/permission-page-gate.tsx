"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useE2EAuth } from "@/app/providers";
import { usePermissions } from "@/hooks/use-permissions";

interface PermissionPageGateProps {
  permission: string;
  children: React.ReactNode;
  deniedTitle?: string;
  deniedMessage?: string;
  unauthenticatedMessage?: string;
}

export function PermissionPageGate({
  permission,
  children,
  deniedTitle = "Access denied.",
  deniedMessage = "This page is restricted to authorized operators.",
  unauthenticatedMessage = "Sign in to access this page.",
}: PermissionPageGateProps) {
  const e2e = useE2EAuth();
  const { ready, authenticated, login } = usePrivy();
  const { loading, hasPermission } = usePermissions();

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  if (!effectiveReady || loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="influence-copy-muted text-sm">Loading...</span>
      </div>
    );
  }

  if (!effectiveAuth) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy">{unauthenticatedMessage}</p>
        <button
          onClick={login}
          className="influence-button-primary rounded-lg px-6 py-2"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (!hasPermission(permission)) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-2 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy-strong font-medium">{deniedTitle}</p>
        <p className="influence-copy-muted text-sm">{deniedMessage}</p>
      </div>
    );
  }

  return <>{children}</>;
}
