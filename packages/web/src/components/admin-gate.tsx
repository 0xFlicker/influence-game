"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

// Address that 10xeng.eth resolves to. Set NEXT_PUBLIC_ADMIN_ADDRESS to override.
const ADMIN_ADDRESS =
  (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login } = usePrivy();
  const { address } = useAccount();

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && ADMIN_ADDRESS === "") {
      console.warn(
        "[AdminGate] NEXT_PUBLIC_ADMIN_ADDRESS is not set. " +
        "The admin panel will show \"Access denied\" for every wallet. " +
        "Set this to the resolved address of 10xeng.eth (or your dev wallet) in .env.local.",
      );
    }
  }, []);

  if (!ready) {
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

  const isAdmin =
    ADMIN_ADDRESS !== "" &&
    address?.toLowerCase() === ADMIN_ADDRESS;

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-2">
        <p className="text-white/60 font-medium">Access denied.</p>
        <p className="text-white/30 text-sm">
          Admin panel is restricted to the 10xeng.eth wallet.
        </p>
        {address && (
          <p className="text-white/20 text-xs font-mono mt-2">{address}</p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
