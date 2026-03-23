"use client";

import { useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useE2EAuth } from "@/app/providers";

function HamburgerIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const e2e = useE2EAuth();
  const { ready, authenticated, login, logout } = usePrivy();
  const { isAdmin } = usePermissions();

  const effectiveReady = e2e.isE2E ? e2e.ready : ready;
  const effectiveAuth = e2e.isE2E ? e2e.authenticated : authenticated;

  const navLinks = (
    <>
      <Link href="/games" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
        Games
      </Link>

      <Link href="/games/free" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
        Free Games
      </Link>

      <Link href="/rules" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
        Rules
      </Link>

      <Link href="/about" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
        About
      </Link>

      {effectiveAuth && (
        <Link href="/dashboard" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
          Dashboard
        </Link>
      )}

      {effectiveAuth && isAdmin && (
        <Link href="/admin" className="text-white/70 hover:text-white transition-colors" onClick={() => setMobileOpen(false)}>
          Admin
        </Link>
      )}

      {effectiveReady && (
        effectiveAuth ? (
          <button
            onClick={() => { setMobileOpen(false); logout(); }}
            className="text-white/50 hover:text-white transition-colors"
          >
            Sign out
          </button>
        ) : (
          <button
            onClick={() => { setMobileOpen(false); login(); }}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-md transition-colors"
          >
            Sign in
          </button>
        )
      )}
    </>
  );

  return (
    <nav className="border-b border-white/10 px-6 py-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight text-white">
          Influence
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-6 text-sm">
          {navLinks}
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden text-white/70 hover:text-white transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden mt-4 flex flex-col gap-4 text-sm border-t border-white/10 pt-4">
          {navLinks}
        </div>
      )}
    </nav>
  );
}
