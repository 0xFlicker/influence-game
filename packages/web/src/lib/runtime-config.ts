"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  createElement,
} from "react";
import { setApiBase } from "@/lib/api";
import { setWsBase } from "@/app/games/[slug]/components/use-game-websocket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  PRIVY_APP_ID: string;
  API_URL: string;
  WS_URL: string;
  ADMIN_ADDRESS: string;
  EPHEMERAL: boolean;
  EPHEMERAL_PR: string;
  SOURCE_ENV_URL: string;
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Defaults — uses NEXT_PUBLIC_ values for SSR / hydration / local dev
// ---------------------------------------------------------------------------

const hasLocalDefaults = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const defaults: RuntimeConfig = {
  PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
  API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
  WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3000",
  ADMIN_ADDRESS: process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "",
  EPHEMERAL: false,
  EPHEMERAL_PR: "",
  SOURCE_ENV_URL: "",
  ready: hasLocalDefaults, // ready immediately in local dev, wait for fetch in Docker
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RuntimeConfigContext = createContext<RuntimeConfig>(defaults);

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}

// ---------------------------------------------------------------------------
// Provider — fetches /runtime-config once on mount
// ---------------------------------------------------------------------------

export function RuntimeConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, setConfig] = useState<RuntimeConfig>(defaults);

  useEffect(() => {
    let cancelled = false;

    fetch("/runtime-config")
      .then((res) => {
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        return res.json() as Promise<RuntimeConfig>;
      })
      .then((data) => {
        if (cancelled) return;
        setConfig({ ...data, ready: true });
        // Push runtime values into imperative modules
        if (data.API_URL) setApiBase(data.API_URL);
        if (data.WS_URL) setWsBase(data.WS_URL);
      })
      .catch((err) => {
        // In dev or if the endpoint isn't available, fall back silently
        console.warn("[RuntimeConfig] Could not fetch /runtime-config:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return createElement(
    RuntimeConfigContext.Provider,
    { value: config },
    children,
  );
}
