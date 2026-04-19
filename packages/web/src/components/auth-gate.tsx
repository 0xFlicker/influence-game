"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useE2EAuth } from "@/app/providers";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const e2e = useE2EAuth();
  const { ready, authenticated, login } = usePrivy();

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  if (!effectiveReady) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <span className="influence-copy-muted text-sm">Loading...</span>
      </div>
    );
  }

  if (!effectiveAuth) {
    return (
      <div className="influence-panel mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 rounded-xl px-6 py-10 text-center">
        <p className="influence-copy">Sign in to access this page.</p>
        <button
          onClick={login}
          className="influence-button-primary rounded-lg px-6 py-2"
        >
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
