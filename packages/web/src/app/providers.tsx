"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
} from "@/lib/api";
import { isE2EMode } from "@/lib/wallet-adapter";

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
// AuthSync — production Privy → backend JWT sync (skipped in e2e)
// ---------------------------------------------------------------------------

function AuthSync() {
  const { authenticated, getAccessToken, logout } = usePrivy();
  const e2e = useE2EAuth();

  useEffect(() => {
    // In e2e mode, JWT is injected by test harness — skip Privy sync
    if (e2e.isE2E) return;

    if (!authenticated) {
      clearAuthToken();
      return;
    }

    getAccessToken().then(async (privyToken) => {
      if (!privyToken) return;
      try {
        const { token } = await loginWithPrivyToken(privyToken);
        setAuthToken(token);
      } catch (err) {
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

  return null;
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
            <AuthSync />
            {children}
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </E2EAuthContext.Provider>
  );
}
