"use client";

import { useEffect } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mainnet } from "viem/chains";
import { http } from "wagmi";
import { loginWithPrivyToken, setAuthToken, clearAuthToken } from "@/lib/api";

const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});

const queryClient = new QueryClient();

/** Syncs Privy auth state to a backend session JWT stored in localStorage. */
function AuthSync() {
  const { authenticated, getAccessToken, logout } = usePrivy();

  useEffect(() => {
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
  }, [authenticated, getAccessToken]);

  // Listen for 401 responses from apiFetch — clear session and log out via Privy
  useEffect(() => {
    const handleExpired = () => {
      console.warn("[AuthSync] Session expired (401). Logging out.");
      logout();
    };
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, [logout]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    throw new Error("NEXT_PUBLIC_PRIVY_APP_ID is not set");
  }

  return (
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
        <WagmiProvider config={wagmiConfig}>
          <AuthSync />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
