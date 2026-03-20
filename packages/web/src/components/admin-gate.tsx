"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePermissions } from "@/hooks/use-permissions";

/** Gates content behind the `view_admin` permission (or admin role). */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login } = usePrivy();
  const { loading, isAdmin } = usePermissions();

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="text-white/40 text-sm">Loading...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4">
        <p className="text-white/60">Admin access requires a connected wallet.</p>
        <button
          onClick={login}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg transition-colors"
        >
          Connect wallet
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-2">
        <p className="text-white/60 font-medium">Access denied.</p>
        <p className="text-white/30 text-sm">
          Admin panel is restricted to authorized wallets.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Generic gate: renders children only if the user has the required permission. */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { loading, hasPermission } = usePermissions();

  if (loading) return null;
  if (!hasPermission(permission)) return <>{fallback}</>;
  return <>{children}</>;
}
