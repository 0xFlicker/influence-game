"use client";

import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";

/** Gates content behind the `view_admin` permission (or admin role). */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, openSignIn } = useAuth();
  const { loading, isAdmin } = usePermissions();

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="influence-copy-muted text-sm">Loading...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy">Sign in to access the admin panel.</p>
        <button
          onClick={openSignIn}
          className="influence-button-primary rounded-lg px-6 py-2"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-2 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy-strong font-medium">Access denied.</p>
        <p className="influence-copy-muted text-sm">
          Admin panel is restricted to authorized accounts.
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
