"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getMe, getAuthToken } from "@/lib/api";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login } = usePrivy();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !authenticated) {
      setIsAdmin(null);
      setLoading(false);
      return;
    }

    // Wait for session token to be available
    const token = getAuthToken();
    if (!token) {
      // Listen for the session-ready event from AuthSync
      const handleReady = () => {
        fetchRoles();
      };
      window.addEventListener("auth:session-ready", handleReady);
      return () => window.removeEventListener("auth:session-ready", handleReady);
    }

    fetchRoles();

    function fetchRoles() {
      setLoading(true);
      getMe()
        .then((me) => setIsAdmin(me.roles.isAdmin))
        .catch(() => setIsAdmin(false))
        .finally(() => setLoading(false));
    }
  }, [ready, authenticated]);

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
