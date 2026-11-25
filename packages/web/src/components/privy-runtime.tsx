"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { createConfig, WagmiProvider } from "@privy-io/wagmi";
import { mainnet } from "viem/chains";
import { http, useAccount } from "wagmi";

export interface PrivyControls {
  getAccessToken: () => Promise<string | null>;
  login: () => void;
  logout: () => Promise<void>;
}

interface Props {
  appId: string;
  admin: boolean;
  onReady: (controls: PrivyControls) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onAddress: (address: string | undefined) => void;
}

const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
});

function WalletAddress({ onAddress }: Pick<Props, "onAddress">) {
  const { address } = useAccount();
  useLayoutEffect(() => {
    onAddress(address);
    return () => onAddress(undefined);
  }, [address, onAddress]);
  return null;
}

function Controls({ onReady, onComplete, onError, children }: Pick<Props, "onReady" | "onComplete" | "onError"> & { children?: ReactNode }) {
  const { ready, getAccessToken, logout } = usePrivy();
  const { login } = useLogin({ onComplete, onError });
  useLayoutEffect(() => {
    if (ready) onReady({ getAccessToken, login, logout });
  }, [getAccessToken, login, logout, onReady, ready]);
  return children;
}

export function PrivyRuntime({ appId, admin, onReady, onComplete, onError, onAddress }: Props) {
  return <PrivyProvider appId={appId} config={{
    loginMethods: ["email", "wallet"],
    appearance: { theme: "dark", accentColor: "#6366f1" },
    embeddedWallets: { ethereum: { createOnLogin: "off" } },
  }}>
    <Controls onReady={onReady} onComplete={onComplete} onError={onError}>
      {admin && <WagmiProvider config={wagmiConfig}><WalletAddress onAddress={onAddress} /></WagmiProvider>}
    </Controls>
  </PrivyProvider>;
}
