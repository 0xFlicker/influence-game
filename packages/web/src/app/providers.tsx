"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RuntimeConfigProvider, useRuntimeConfig } from "@/lib/runtime-config";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  WagmiProvider as PrivyWagmiProvider,
  createConfig as createPrivyConfig,
} from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet } from "viem/chains";
import { http } from "wagmi";
import {
  loginWithPrivyToken,
  setAuthToken,
  clearAuthToken,
  getAuthToken,
  checkInviteRequired,
  validateInviteCode,
  ApiError,
} from "@/lib/api";
import { isE2EMode } from "@/lib/wallet-adapter";
import { InviteCodeModal } from "@/components/invite-code-modal";

// ---------------------------------------------------------------------------
// Wagmi config (Privy-managed)
// ---------------------------------------------------------------------------

const wagmiConfig = createPrivyConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
});

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// E2E auth context — signals e2e mode to auth gates
// ---------------------------------------------------------------------------

interface E2EAuthState {
  isE2E: boolean;
  authenticated: boolean;
  ready: boolean;
}

const E2EAuthContext = createContext<E2EAuthState>({
  isE2E: false,
  authenticated: false,
  ready: false,
});

export function useE2EAuth(): E2EAuthState {
  return useContext(E2EAuthContext);
}

// ---------------------------------------------------------------------------
// Invite code context — gates login behind invite code when required
// ---------------------------------------------------------------------------

interface InviteState {
  /** True when the invite code modal should be shown (pre-auth) */
  needsInvite: boolean;
  /** Validate and accept an invite code, then proceed to Privy login */
  submitInvite: (code: string) => Promise<void>;
  /** Dismiss the invite modal without logging in */
  cancelInvite: () => void;
  inviteError: string | null;
  submitting: boolean;
}

const InviteContext = createContext<InviteState>({
  needsInvite: false,
  submitInvite: async () => {},
  cancelInvite: () => {},
  inviteError: null,
  submitting: false,
});

export function useInvite(): InviteState {
  return useContext(InviteContext);
}

// ---------------------------------------------------------------------------
// Login gate context — wraps Privy login with invite-code pre-check
// ---------------------------------------------------------------------------

interface LoginGateState {
  /** Call this instead of Privy's login(). It checks invite requirement first. */
  gatedLogin: () => void;
}

const LoginGateContext = createContext<LoginGateState>({
  gatedLogin: () => {},
});

export function useLoginGate(): LoginGateState {
  return useContext(LoginGateContext);
}

// ---------------------------------------------------------------------------
// AuthSync — production Privy → backend JWT sync (skipped in e2e)
// Now also handles pre-auth invite gating.
// ---------------------------------------------------------------------------

function AuthSync({ children }: { children: React.ReactNode }) {
  const { authenticated, getAccessToken, logout, login: privyLogin } = usePrivy();
  const e2e = useE2EAuth();
  const [needsInvite, setNeedsInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Stores a validated invite code to pass along during Privy→backend token exchange
  const pendingInviteCodeRef = useRef<string | null>(null);

  // ------ Pre-auth invite gating ------

  const gatedLogin = useCallback(() => {
    if (e2e.isE2E) return;
    // Check if invites are required before opening Privy
    checkInviteRequired()
      .then(({ required }) => {
        if (required) {
          setNeedsInvite(true);
          setInviteError(null);
        } else {
          privyLogin();
        }
      })
      .catch(() => {
        // If the check fails, fall through to Privy login
        privyLogin();
      });
  }, [e2e.isE2E, privyLogin]);

  const submitInvite = useCallback(async (inviteCode: string) => {
    setSubmitting(true);
    setInviteError(null);
    try {
      const { valid } = await validateInviteCode(inviteCode);
      if (!valid) {
        setInviteError("Invalid or already used invite code");
        return;
      }
      // Store the validated code so AuthSync can pass it during token exchange
      pendingInviteCodeRef.current = inviteCode;
      setNeedsInvite(false);
      // Now open Privy login
      privyLogin();
    } catch {
      setInviteError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [privyLogin]);

  const cancelInvite = useCallback(() => {
    setNeedsInvite(false);
    setInviteError(null);
  }, []);

  // ------ Privy → backend token exchange ------

  useEffect(() => {
    if (e2e.isE2E) return;

    if (!authenticated) {
      clearAuthToken();
      pendingInviteCodeRef.current = null;
      return;
    }

    getAccessToken().then(async (privyToken) => {
      if (!privyToken) return;
      try {
        const inviteCode = pendingInviteCodeRef.current ?? undefined;
        const { token } = await loginWithPrivyToken(privyToken, inviteCode);
        setAuthToken(token);
        pendingInviteCodeRef.current = null;
      } catch (err) {
        if (err instanceof ApiError) {
          try {
            const body = JSON.parse(err.message);
            if (body.code === "INVITE_REQUIRED") {
              // Edge case: server still requires invite but we don't have one
              // (e.g. code became invalid between validate and login)
              setNeedsInvite(true);
              setInviteError("Your invite code was already used. Please enter another.");
              return;
            }
          } catch { /* not JSON, fall through */ }
        }
        console.error("[AuthSync] Failed to exchange Privy token:", err);
      }
    });
  }, [authenticated, getAccessToken, e2e.isE2E]);

  useEffect(() => {
    if (e2e.isE2E) return;

    const handleExpired = () => {
      console.warn("[AuthSync] Session expired (401). Logging out.");
      logout();
    };
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, [logout, e2e.isE2E]);

  const inviteState = useMemo<InviteState>(() => ({
    needsInvite,
    submitInvite,
    cancelInvite,
    inviteError,
    submitting,
  }), [needsInvite, submitInvite, cancelInvite, inviteError, submitting]);

  const loginGateState = useMemo<LoginGateState>(() => ({
    gatedLogin,
  }), [gatedLogin]);

  return (
    <LoginGateContext.Provider value={loginGateState}>
      <InviteContext.Provider value={inviteState}>
        {children}
        <InviteCodeModal />
      </InviteContext.Provider>
    </LoginGateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// Dummy Privy app ID for e2e mode (Privy SDK requires a non-empty string)
const E2E_PRIVY_APP_ID = "e2e-dummy-privy-app-id";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RuntimeConfigProvider>
      <InnerProviders>{children}</InnerProviders>
    </RuntimeConfigProvider>
  );
}

function InnerProviders({ children }: { children: React.ReactNode }) {
  const runtimeConfig = useRuntimeConfig();
  const [e2e, setE2e] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setE2e(isE2EMode());
    setChecked(true);
  }, []);

  const privyAppId = e2e
    ? E2E_PRIVY_APP_ID
    : runtimeConfig.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const e2eAuth = useMemo<E2EAuthState>(() => {
    if (!e2e) return { isE2E: false, authenticated: false, ready: false };
    const hasToken =
      typeof window !== "undefined" && !!getAuthToken();
    return { isE2E: true, authenticated: hasToken, ready: true };
  }, [e2e]);

  if (!checked || !runtimeConfig.ready) {
    return null; // Wait for client-side e2e detection and runtime config
  }

  if (!privyAppId) {
    throw new Error("PRIVY_APP_ID is not set (check runtime env or NEXT_PUBLIC_PRIVY_APP_ID)");
  }

  return (
    <E2EAuthContext.Provider value={e2eAuth}>
      <PrivyProvider
        appId={privyAppId}
        config={{
          loginMethods: ["email", "wallet"],
          appearance: {
            theme: "dark",
            accentColor: "#6366f1",
          },
          embeddedWallets: {
            ethereum: { createOnLogin: "users-without-wallets" },
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>
            <AuthSync>
              {children}
            </AuthSync>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </E2EAuthContext.Provider>
  );
}
