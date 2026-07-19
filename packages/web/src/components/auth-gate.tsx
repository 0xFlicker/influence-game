"use client";

import { useAuth } from "@/hooks/use-auth";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, openSignIn } = useAuth();

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="influence-copy-muted text-sm">Loading...</span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy">Sign in to access this page.</p>
        <button
          onClick={openSignIn}
          className="influence-button-primary rounded-lg px-6 py-2"
        >
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
