"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { useMiniApp } from "@/components/farcaster-miniapp-provider";
import { HOUSE_VENUE } from "@/lib/product-identity";

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
  const { ready, authenticated, openSignIn, logout } = useAuth();
  const { isAdmin, loading: permissionsLoading, hasPermission } = usePermissions();
  const pathname = usePathname();
  const { suppressWebsiteAuthChrome, isMiniApp, contextUser } = useMiniApp();
  const gameRoute = pathname?.split("/")[2];
  const focusedFlow = !pathname || pathname === "/dashboard/agents/create"
    || /^\/dashboard\/agents\/[^/]+\/edit(?:\/|$)/.test(pathname)
    || pathname === "/games/new"
    || pathname === "/admin/games/new"
    || (pathname.startsWith("/games/") && !["free", "public", "private", "season"].includes(gameRoute));
  const showCreateActions = authenticated && !permissionsLoading && !focusedFlow;

  const navLinks = (
    <>
      {showCreateActions && (
        <Link href="/dashboard/agents/create" className={`influence-button-primary rounded-md px-4 py-2 whitespace-nowrap ${pathname === "/dashboard" ? "xl:hidden" : ""}`} onClick={() => setMobileOpen(false)}>
          <span aria-hidden="true">＋ </span>Create agent
        </Link>
      )}
      {showCreateActions && hasPermission("create_game") && (
        <Link href="/games/new" className={`influence-copy whitespace-nowrap hover:text-text-primary transition-colors ${pathname === "/dashboard" ? "xl:hidden" : ""}`} onClick={() => setMobileOpen(false)}>
          <span aria-hidden="true">＋ </span>Create game
        </Link>
      )}
      <Link href="/games" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
        Games
      </Link>

      <Link href="/games/free" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
        Intake
      </Link>

      <Link href="/rules" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
        Rules
      </Link>

      {authenticated && (
        <Link href="/dashboard" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
          Dashboard
        </Link>
      )}

      {authenticated && (
        <Link href="/dashboard/profile" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
          Profile
        </Link>
      )}

      {authenticated && hasPermission("review_agent_content") && (
        <Link href="/moderation" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>Moderation</Link>
      )}
      {authenticated && isAdmin && (
        <Link href="/admin" className="influence-copy hover:text-text-primary transition-colors" onClick={() => setMobileOpen(false)}>
          Admin
        </Link>
      )}

      {isMiniApp && authenticated && contextUser?.username && (
        <span className="influence-copy-muted" title="Farcaster identity">
          @{contextUser.username}
        </span>
      )}

      {ready && !suppressWebsiteAuthChrome && (
        authenticated ? (
          <button
            onClick={() => { setMobileOpen(false); logout(); }}
            className="influence-copy-muted hover:text-text-primary transition-colors"
          >
            Sign out
          </button>
        ) : (
          <button
            onClick={() => { setMobileOpen(false); openSignIn(); }}
            className="influence-button-primary px-4 py-1.5 rounded-md"
          >
            Sign in
          </button>
        )
      )}
    </>
  );

  return (
    <nav className="border-b border-border-active/60 bg-surface-overlay/30 px-6 py-4 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight text-text-primary">
          {HOUSE_VENUE.name}
        </Link>

        {/* Desktop nav */}
        <div className="hidden xl:flex items-center gap-5 text-sm">
          {navLinks}
        </div>

        {/* Mobile hamburger */}
        <button
          className="xl:hidden influence-copy hover:text-text-primary transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="xl:hidden mt-4 flex flex-col items-start gap-4 text-sm border-t border-border-active/60 pt-4">
          {navLinks}
        </div>
      )}
    </nav>
  );
}
