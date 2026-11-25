"use client";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import type { PrivyControls, PrivyRuntime } from "@/components/privy-runtime";

export const AdminWalletAddressContext = createContext<string | undefined>(undefined);

export function usePrivyRuntime(appId: string) {
  const [Runtime, setRuntime] = useState<typeof PrivyRuntime>();
  const controls = useRef<PrivyControls | null>(null);
  const pending = useRef<{
    promise: Promise<PrivyControls>;
    resolve: (value: PrivyControls) => void;
    cancel: () => void;
  } | null>(null);

  useEffect(() => () => {
    const request = pending.current;
    pending.current = null;
    request?.cancel();
  }, []);

  const onReady = useCallback((next: PrivyControls) => {
    controls.current = next;
    pending.current?.resolve(next);
  }, []);

  const load = useCallback((): Promise<PrivyControls> => {
    if (!appId) return Promise.reject(new Error("Privy is unavailable."));
    if (controls.current) return Promise.resolve(controls.current);
    if (pending.current) return pending.current.promise;

    const { promise, resolve, reject } = Promise.withResolvers<PrivyControls>();
    const timeout = setTimeout(() => reject(new Error("Privy took too long to start.")), 8_000);
    const request = {
      promise: promise.finally(() => {
        clearTimeout(timeout);
        if (pending.current === request) pending.current = null;
      }),
      resolve,
      cancel: () => reject(new Error("Privy startup was interrupted.")),
    };
    pending.current = request;
    void import("@/components/privy-runtime").then(({ PrivyRuntime }) => {
      if (pending.current === request) setRuntime(() => PrivyRuntime);
    }, reject);
    return request.promise;
  }, [appId]);

  return { Runtime, load, onReady };
}
