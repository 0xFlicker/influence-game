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
        <span className="text-white/40 text-sm">Loading...</span>
      </div>
    );
  }

  if (!effectiveAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-4">
        <p className="text-white/60">Sign in to access this page.</p>
        <button
          onClick={login}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
