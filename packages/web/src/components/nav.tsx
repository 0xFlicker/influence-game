"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { getMe, getAuthToken } from "@/lib/api";

export function Nav() {
  const { ready, authenticated, login, logout } = usePrivy();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) {
      setIsAdmin(false);
      return;
    }

    const token = getAuthToken();
    if (!token) {
      const handleReady = () => {
        fetchRoles();
      };
      window.addEventListener("auth:session-ready", handleReady);
      return () => window.removeEventListener("auth:session-ready", handleReady);
    }

    fetchRoles();

    function fetchRoles() {
      getMe()
        .then((me) => setIsAdmin(me.roles.isAdmin))
        .catch(() => setIsAdmin(false));
    }
  }, [ready, authenticated]);

  return (
    <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <Link href="/" className="text-lg font-bold tracking-tight text-white">
        Influence
      </Link>

      <div className="flex items-center gap-6 text-sm">
        <Link href="/games" className="text-white/70 hover:text-white transition-colors">
          Games
        </Link>

        {authenticated && (
          <Link href="/dashboard" className="text-white/70 hover:text-white transition-colors">
            Dashboard
          </Link>
        )}

        {authenticated && isAdmin && (
          <Link href="/admin" className="text-white/70 hover:text-white transition-colors">
            Admin
          </Link>
        )}

        {ready && (
          authenticated ? (
            <button
              onClick={logout}
              className="text-white/50 hover:text-white transition-colors"
            >
              Sign out
            </button>
          ) : (
            <button
              onClick={login}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-md transition-colors"
            >
              Sign in
            </button>
          )
        )}
      </div>
    </nav>
  );
}
