"use client";

import { useEffect, useRef } from "react";
import { useMiniApp } from "@/components/farcaster-miniapp-provider";
import { useAuth } from "@/hooks/use-auth";

/**
 * When running inside a confirmed Mini App host, exchange Quick Auth for an
 * Influence session and dismiss the Farcaster splash via ready().
 */
export function FarcasterMiniAppAuthBootstrap() {
  const { isMiniApp, status, markReady } = useMiniApp();
  const {
    ready: authReady,
    authenticated,
    runFarcasterMiniAppLogin,
  } = useAuth();
  const startedRef = useRef(false);

  useEffect(() => {
    if (status !== "miniapp" || !isMiniApp) return;
    if (!authReady) return;
    if (authenticated) {
      void markReady();
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        await runFarcasterMiniAppLogin();
      } finally {
        if (!cancelled) {
          await markReady();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    status,
    isMiniApp,
    authReady,
    authenticated,
    runFarcasterMiniAppLogin,
    markReady,
  ]);

  return null;
}
