"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useE2EAuth } from "@/app/providers";

export function Nav() {
  const e2e = useE2EAuth();
  const { ready, authenticated, login, logout } = usePrivy();
  const { isAdmin } = usePermissions();

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  return (
    <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <Link href="/" className="text-lg font-bold tracking-tight text-white">
        Influence
      </Link>

      <div className="flex items-center gap-6 text-sm">
        <Link href="/games" className="text-white/70 hover:text-white transition-colors">
          Games
        </Link>

        <Link href="/games/free" className="text-white/70 hover:text-white transition-colors">
          Free Games
        </Link>

        {effectiveAuth && (
          <Link href="/dashboard" className="text-white/70 hover:text-white transition-colors">
            Dashboard
          </Link>
        )}

        {effectiveAuth && isAdmin && (
          <Link href="/admin" className="text-white/70 hover:text-white transition-colors">
            Admin
          </Link>
        )}

        {effectiveReady && (
          effectiveAuth ? (
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
