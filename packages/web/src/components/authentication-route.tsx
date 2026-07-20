"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRuntimeConfig } from "@/lib/runtime-config";

export function AuthenticationRoute({
  intent,
}: {
  intent: "sign_in" | "create_account";
}) {
  const {
    ready,
    authenticated,
    openSignIn,
    openCreateAccount,
  } = useAuth();
  const { MANAGED_AUTH_MODE } = useRuntimeConfig();
  const openedRef = useRef(false);
  const createAccountAvailable =
    intent === "create_account" && MANAGED_AUTH_MODE === "full";

  const openAuthentication = useCallback(() => {
    if (intent === "create_account") {
      if (MANAGED_AUTH_MODE === "full") openCreateAccount();
      return;
    }
    openSignIn();
  }, [
    intent,
    MANAGED_AUTH_MODE,
    openCreateAccount,
    openSignIn,
  ]);

  useEffect(() => {
    if (!ready || authenticated || openedRef.current) return;
    if (intent === "create_account" && !createAccountAvailable) return;
    openedRef.current = true;
    queueMicrotask(openAuthentication);
  }, [
    authenticated,
    createAccountAvailable,
    intent,
    openAuthentication,
    ready,
  ]);

  const title =
    intent === "create_account"
      ? "Create an Influence account"
      : "Sign in to Influence";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <section className="influence-panel space-y-6 rounded-xl p-8">
        <div className="space-y-3">
          <p className="influence-table-header text-xs font-semibold uppercase tracking-wider">
            Influence authentication
          </p>
          <h1 className="influence-phase-title text-3xl font-bold">{title}</h1>
          <p className="influence-copy">
            {intent === "create_account"
              ? "Create an account with a verified email and password."
              : "Use email/password, Privy email, or your wallet."}
          </p>
        </div>

        {authenticated ? (
          <p role="status" className="influence-copy">
            You are already signed in.{" "}
            <Link href="/" className="influence-link">
              Continue to Influence
            </Link>.
          </p>
        ) : intent === "create_account" && !createAccountAvailable ? (
          <p role="status" className="influence-copy">
            Email/password account creation is temporarily unavailable.{" "}
            <Link href="/sign-in" className="influence-link">
              Sign in with an existing method
            </Link>.
          </p>
        ) : (
          <button
            type="button"
            disabled={!ready}
            className="influence-button-primary min-h-11 rounded-lg px-4 py-2 text-sm"
            onClick={openAuthentication}
          >
            {intent === "create_account" ? "Create account" : "Open sign in"}
          </button>
        )}

        <p className="influence-copy-muted text-sm">
          {intent === "create_account" ? (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="influence-link">
                Sign in
              </Link>.
            </>
          ) : (
            <>
              Need an email/password account?{" "}
              <Link href="/sign-up" className="influence-link">
                Create one
              </Link>.
            </>
          )}
        </p>
      </section>
    </main>
  );
}
