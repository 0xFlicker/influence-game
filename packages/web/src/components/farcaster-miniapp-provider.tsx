"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isMiniAppModeHint } from "@/lib/farcaster-miniapp";

export type MiniAppStatus =
  | "idle"
  | "probing"
  | "browser"
  | "miniapp"
  | "error";

export interface MiniAppUserContext {
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
}

export interface MiniAppState {
  status: MiniAppStatus;
  /** True only after sdk.isInMiniApp() confirms host context. */
  isMiniApp: boolean;
  /** Best-effort SSR/client hint from ?app=mini — not a security proof. */
  modeHint: boolean;
  /** True while detecting or while hint suggests mini chrome before probe settles. */
  suppressWebsiteAuthChrome: boolean;
  contextUser: MiniAppUserContext | null;
  error: string | null;
  markReady: () => Promise<void>;
}

const MiniAppContext = createContext<MiniAppState>({
  status: "idle",
  isMiniApp: false,
  modeHint: false,
  suppressWebsiteAuthChrome: false,
  contextUser: null,
  error: null,
  markReady: async () => {},
});

function readModeHint(): boolean {
  if (typeof window === "undefined") return false;
  return isMiniAppModeHint(window.location.search);
}

export function MiniAppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MiniAppStatus>("probing");
  const [modeHint, setModeHint] = useState(false);
  const [contextUser, setContextUser] = useState<MiniAppUserContext | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const readyCalledRef = useRef(false);
  const sdkRef = useRef<MiniAppSdk | null>(null);

  useEffect(() => {
    setModeHint(readModeHint());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const mod = await import("@farcaster/miniapp-sdk");
        const sdk = mod.sdk;
        if (cancelled) return;
        sdkRef.current = sdk;

        const inMiniApp = await sdk.isInMiniApp();
        if (cancelled) return;

        if (!inMiniApp) {
          setStatus("browser");
          setContextUser(null);
          setError(null);
          return;
        }

        try {
          const context = await sdk.context;
          const user = context.user;
          setContextUser({
            fid: user.fid,
            username: user.username,
            displayName: user.displayName,
            pfpUrl: user.pfpUrl,
          });
        } catch {
          setContextUser(null);
        }

        setStatus("miniapp");
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Mini App detection failed");
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const markReady = useCallback(async () => {
    if (readyCalledRef.current) return;
    const sdk = sdkRef.current;
    if (!sdk) return;
    readyCalledRef.current = true;
    try {
      await sdk.actions.ready();
    } catch (err) {
      readyCalledRef.current = false;
      console.warn("[MiniApp] ready() failed:", err);
    }
  }, []);

  const isMiniApp = status === "miniapp";
  // Hide website Sign in/out when Mini App is confirmed, or while a launch
  // hint is still probing (avoid Privy chrome flash on Mini App open).
  const suppressWebsiteAuthChrome = isMiniApp
    || (modeHint && status !== "browser");

  const value = useMemo<MiniAppState>(() => ({
    status,
    isMiniApp,
    modeHint,
    suppressWebsiteAuthChrome,
    contextUser,
    error,
    markReady,
  }), [status, isMiniApp, modeHint, suppressWebsiteAuthChrome, contextUser, error, markReady]);

  return (
    <MiniAppContext.Provider value={value}>
      {children}
    </MiniAppContext.Provider>
  );
}

export function useMiniApp(): MiniAppState {
  return useContext(MiniAppContext);
}

/** Narrow surface we need from the dynamic SDK import (avoids leaking loose SDK types). */
interface MiniAppSdk {
  isInMiniApp: (timeoutMs?: number) => Promise<boolean>;
  context: Promise<{
    user: {
      fid: number;
      username?: string;
      displayName?: string;
      pfpUrl?: string;
    };
  }>;
  actions: {
    ready: () => Promise<void>;
  };
  quickAuth: {
    getToken: () => Promise<{ token: string }>;
  };
}
